import { prisma } from "./db.js";

type FocusGardenSummaryRow = {
  total_plants: number;
  total_growth_points: number;
  last_growth_at: Date | null;
};

type FocusGardenDailyRow = {
  study_date: Date;
  growth_points: number;
  plants: number;
  session_minutes: number;
};

type FocusGardenTimelineRow = {
  id: number;
  session_id: string;
  growth_points: number;
  session_minutes: number;
  plant_type: string;
  growth_stage: string;
  grew_at: Date;
  created_at: Date;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function addDays(date: Date, days: number) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

function weekdayMonToSun(date: Date) {
  return date.getDay() === 0 ? 7 : date.getDay();
}

function toPlantType(minutes: number) {
  if (minutes >= 120) return "tree";
  if (minutes >= 80) return "shrub";
  if (minutes >= 45) return "flower";
  return "sprout";
}

function toGrowthStage(minutes: number) {
  if (minutes >= 150) return "ancient";
  if (minutes >= 100) return "mature";
  if (minutes >= 60) return "blooming";
  if (minutes >= 30) return "young";
  return "seedling";
}

function growthPointsForMinutes(minutes: number) {
  return clamp(Math.round(minutes * 1.15), 5, 240);
}

export async function ensureFocusGardenTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS focus_garden_growth (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      session_id VARCHAR(191) NOT NULL,
      growth_points INT NOT NULL,
      session_minutes INT NOT NULL,
      plant_type VARCHAR(32) NOT NULL,
      growth_stage VARCHAR(32) NOT NULL,
      grew_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_focus_garden_user_session (user_id, session_id),
      INDEX idx_focus_garden_user_grew_at (user_id, grew_at)
    )
  `);
}

export async function upsertFocusGardenGrowthFromSession(
  userId: string,
  session: { id: string; startTime: Date; durationMinutes: number }
) {
  const durationMinutes = Math.max(0, Math.round(session.durationMinutes));

  if (durationMinutes <= 0) {
    await prisma.$executeRaw`
      DELETE FROM focus_garden_growth
      WHERE user_id = ${userId} AND session_id = ${session.id}
    `;
    return;
  }

  const points = growthPointsForMinutes(durationMinutes);
  const plantType = toPlantType(durationMinutes);
  const growthStage = toGrowthStage(durationMinutes);

  await prisma.$executeRaw`
    INSERT INTO focus_garden_growth (
      user_id,
      session_id,
      growth_points,
      session_minutes,
      plant_type,
      growth_stage,
      grew_at
    )
    VALUES (
      ${userId},
      ${session.id},
      ${points},
      ${durationMinutes},
      ${plantType},
      ${growthStage},
      ${session.startTime}
    )
    ON DUPLICATE KEY UPDATE
      growth_points = VALUES(growth_points),
      session_minutes = VALUES(session_minutes),
      plant_type = VALUES(plant_type),
      growth_stage = VALUES(growth_stage),
      grew_at = VALUES(grew_at)
  `;
}

export async function getFocusGardenOverview(
  userId: string,
  lookbackDays = 90,
  timelineLimit = 120
) {
  const safeLookbackDays = clamp(Math.round(lookbackDays), 14, 365);
  const safeTimelineLimit = clamp(Math.round(timelineLimit), 20, 240);
  const fromDate = addDays(startOfDay(new Date()), -(safeLookbackDays - 1));

  const [summaryRows, dailyRows, timelineRows] = await Promise.all([
    prisma.$queryRaw<FocusGardenSummaryRow[]>`
      SELECT
        COUNT(*) AS total_plants,
        COALESCE(SUM(growth_points), 0) AS total_growth_points,
        MAX(grew_at) AS last_growth_at
      FROM focus_garden_growth
      WHERE user_id = ${userId}
    `,
    prisma.$queryRaw<FocusGardenDailyRow[]>`
      SELECT
        DATE(grew_at) AS study_date,
        COALESCE(SUM(growth_points), 0) AS growth_points,
        COUNT(*) AS plants,
        COALESCE(SUM(session_minutes), 0) AS session_minutes
      FROM focus_garden_growth
      WHERE user_id = ${userId}
        AND grew_at >= ${fromDate}
      GROUP BY DATE(grew_at)
      ORDER BY study_date ASC
    `,
    prisma.$queryRaw<FocusGardenTimelineRow[]>`
      SELECT
        id,
        session_id,
        growth_points,
        session_minutes,
        plant_type,
        growth_stage,
        grew_at,
        created_at
      FROM focus_garden_growth
      WHERE user_id = ${userId}
      ORDER BY grew_at DESC, id DESC
      LIMIT ${safeTimelineLimit}
    `,
  ]);

  const sessionIds = timelineRows.map((item) => item.session_id);
  const timelineSessions = sessionIds.length
    ? await prisma.studySession.findMany({
        where: { userId, id: { in: sessionIds } },
        include: { course: true, activity: true },
      })
    : [];
  const sessionById = new Map(timelineSessions.map((item) => [item.id, item]));

  const summary = summaryRows[0] ?? {
    total_plants: 0,
    total_growth_points: 0,
    last_growth_at: null,
  };

  const dailyByKey = new Map(
    dailyRows.map((row) => [
      toDateKey(new Date(row.study_date)),
      {
        growthPoints: Number(row.growth_points ?? 0),
        plants: Number(row.plants ?? 0),
        sessionMinutes: Number(row.session_minutes ?? 0),
      },
    ])
  );

  const daily = [];
  const today = startOfDay(new Date());
  for (let offset = safeLookbackDays - 1; offset >= 0; offset -= 1) {
    const day = addDays(today, -offset);
    const key = toDateKey(day);
    const values = dailyByKey.get(key) ?? {
      growthPoints: 0,
      plants: 0,
      sessionMinutes: 0,
    };
    daily.push({
      date: key,
      growthPoints: values.growthPoints,
      plants: values.plants,
      sessionMinutes: values.sessionMinutes,
      weekday: weekdayMonToSun(day),
      hasGrowth: values.plants > 0,
    });
  }

  let consistencyStreak = 0;
  for (let i = daily.length - 1; i >= 0; i -= 1) {
    if (daily[i]?.hasGrowth) {
      consistencyStreak += 1;
    } else {
      break;
    }
  }

  const gardenLevel = Math.max(
    1,
    Math.floor(Math.sqrt(Math.max(0, Number(summary.total_growth_points ?? 0))) / 2) + 1
  );

  const timeline = timelineRows.map((row) => {
    const session = sessionById.get(row.session_id);
    return {
      id: String(row.id),
      sessionId: row.session_id,
      growthPoints: Number(row.growth_points),
      sessionMinutes: Number(row.session_minutes),
      plantType: row.plant_type,
      growthStage: row.growth_stage,
      grewAt: new Date(row.grew_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
      courseName: session?.course?.name ?? "Study Session",
      activityName: session?.activity?.name ?? null,
      note: session?.note ?? null,
    };
  });

  return {
    summary: {
      totalPlants: Number(summary.total_plants ?? 0),
      totalGrowthPoints: Number(summary.total_growth_points ?? 0),
      consistencyStreak,
      gardenLevel,
      lastGrowthAt: summary.last_growth_at ? new Date(summary.last_growth_at).toISOString() : null,
    },
    daily,
    timeline,
  };
}
