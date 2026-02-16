import Fastify from "fastify";
import cors from "@fastify/cors";
import "dotenv/config";
import { ensureAchievementsTable, recomputeAndStoreAchievements } from "./achievements.js";
import { getAnalyticsPrediction } from "./analytics-prediction.js";
import { prisma } from "./db.js";
import { ensureDistractionTables, getDistractionAnalytics } from "./distractions.js";
import { getAnalyticsInsights } from "./insights.js";
import { ensurePlannerTables } from "./planner.js";
import { ensureStudyOrganizationTables } from "./organization.js";
import { ensurePersonalizationTable, getUiPreferences, upsertUiPreferences } from "./personalization.js";
import { ensureProductivityTables, getProductivityOverview, recomputeAndStoreProductivity } from "./productivity.js";
import { generateStudyReportPdf } from "./reports.js";
import { routes } from "./routes.js";
import { ensureStreakTables, getStreakOverview, recomputeAndStoreStreak } from "./streak.js";
import { ensureAdaptiveTimerTables, getAdaptiveEnabled, getTimerRecommendation, setAdaptiveEnabled } from "./timer-adaptive.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await ensureAchievementsTable();
await ensureStreakTables();
await ensureProductivityTables();
await ensureDistractionTables();
await ensurePlannerTables();
await ensureStudyOrganizationTables();
await ensurePersonalizationTable();
await ensureAdaptiveTimerTables();

app.get("/health", async () => ({ ok: true, name: "Swot API" }));

const USER_ID = "swot-user";

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function toIcsDateUtc(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

app.get("/me", async () => {
  const me = await prisma.user.findUnique({
    where: { id: USER_ID },
    include: { settings: true, targets: true },
  });
  if (!me) return me;

  const adaptiveEnabled = await getAdaptiveEnabled(USER_ID);
  const uiPreferences = await getUiPreferences(USER_ID);
  return {
    ...me,
    settings: me.settings
      ? {
          ...me.settings,
          adaptiveEnabled,
        }
      : null,
    uiPreferences,
  };
});

app.get("/achievements", async () => {
  return recomputeAndStoreAchievements(USER_ID);
});

app.get("/streak", async () => {
  return getStreakOverview(USER_ID);
});

app.get("/productivity", async () => {
  return getProductivityOverview(USER_ID);
});

app.get("/timer/recommendation", async () => {
  return getTimerRecommendation(USER_ID);
});

app.get("/distractions/analytics", async (req) => {
  const query = req.query as { days?: string };
  const days = query.days ? Number(query.days) : 30;
  return getDistractionAnalytics(USER_ID, days);
});

app.get("/analytics/insights", async () => {
  return getAnalyticsInsights(USER_ID);
});

app.get("/analytics/prediction", async () => {
  return getAnalyticsPrediction(USER_ID);
});

app.get("/reports/study.pdf", async (_req, reply) => {
  const bytes = await generateStudyReportPdf(USER_ID);
  reply
    .header("Content-Type", "application/pdf")
    .header("Content-Disposition", 'attachment; filename="swot-study-report.pdf"')
    .send(Buffer.from(bytes));
});

app.get("/calendar.ics", async (_req, reply) => {
  const sessions = await prisma.studySession.findMany({
    where: { userId: USER_ID },
    include: { course: true, activity: true },
    orderBy: { startTime: "asc" },
  });

  const nowStamp = toIcsDateUtc(new Date());

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Swot//Study Sessions//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Swot Study Sessions",
    ...sessions.flatMap((session) => {
      const courseName = session.course?.name ?? "Course";
      const activityName = session.activity?.name ? ` - ${session.activity.name}` : "";
      const summary = escapeIcsText(`Study: ${courseName}${activityName}`);
      const description = escapeIcsText(session.note ?? "Study session");
      return [
        "BEGIN:VEVENT",
        `UID:${session.id}@swot.local`,
        `DTSTAMP:${nowStamp}`,
        `DTSTART:${toIcsDateUtc(session.startTime)}`,
        `DTEND:${toIcsDateUtc(session.endTime)}`,
        `SUMMARY:${summary}`,
        `DESCRIPTION:${description}`,
        "END:VEVENT",
      ];
    }),
    "END:VCALENDAR",
  ];

  reply
    .header("Content-Type", "text/calendar; charset=utf-8")
    .header("Content-Disposition", 'inline; filename="swot-calendar.ics"')
    .send(`${lines.join("\r\n")}\r\n`);
});

app.put("/me/preferences", async (req, reply) => {
  const body = req.body as {
    settings?: {
      cutoffTime?: string;
      soundsEnabled?: boolean;
      shortSessionMinutes?: number;
      longSessionMinutes?: number;
      breakSessionMinutes?: number;
      adaptiveEnabled?: boolean;
    };
    targets?: Array<{ weekday: number; targetMinutes: number }>;
    uiPreferences?: {
      workspaceName?: string;
      avatar?: string;
      accentColor?: string;
      dashboardBackground?: string;
      themePreset?: "pink" | "purple" | "dark" | "minimal";
      widgetStyle?: "soft" | "glass" | "flat";
      layoutDensity?: "comfortable" | "compact" | "cozy";
    };
  };

  if (!body.settings || !body.targets) {
    return reply.code(400).send({ error: "Missing settings or targets payload." });
  }

  const { settings, targets } = body;
  const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

  if (!settings.cutoffTime || !timePattern.test(settings.cutoffTime)) {
    return reply.code(400).send({ error: "Invalid cutoffTime. Use HH:MM format." });
  }

  const cutoffTime = settings.cutoffTime;
  const soundsEnabled = settings.soundsEnabled ?? true;
  const shortSessionMinutes = Number(settings.shortSessionMinutes);
  const longSessionMinutes = Number(settings.longSessionMinutes);
  const breakSessionMinutes = Number(settings.breakSessionMinutes);
  const adaptiveEnabled = settings.adaptiveEnabled ?? true;

  if (typeof adaptiveEnabled !== "boolean") {
    return reply.code(400).send({ error: "adaptiveEnabled must be a boolean." });
  }

  const durationValues = [shortSessionMinutes, longSessionMinutes, breakSessionMinutes];
  const hasInvalidDuration = durationValues.some(
    (value) => typeof value !== "number" || !Number.isFinite(value) || value <= 0
  );
  if (hasInvalidDuration) {
    return reply.code(400).send({ error: "Session duration values must be positive numbers." });
  }

  if (!Array.isArray(targets) || targets.length !== 7) {
    return reply.code(400).send({ error: "Provide exactly seven daily targets (Mon-Sun)." });
  }

  const weekdays = new Set(targets.map((target) => target.weekday));
  const isInvalidWeekday = Array.from(weekdays).some(
    (weekday) => !Number.isInteger(weekday) || weekday < 1 || weekday > 7
  );
  const hasInvalidTargetValue = targets.some(
    (target) =>
      typeof target.targetMinutes !== "number" ||
      !Number.isFinite(target.targetMinutes) ||
      target.targetMinutes < 0
  );

  if (weekdays.size !== 7 || isInvalidWeekday || hasInvalidTargetValue) {
    return reply
      .code(400)
      .send({ error: "Targets must include weekdays 1-7 with non-negative minutes." });
  }

  await prisma.$transaction(async (tx) => {
    await tx.settings.upsert({
      where: { userId: USER_ID },
      update: {
        cutoffTime,
        soundsEnabled,
        shortSessionMinutes: Math.round(shortSessionMinutes),
        longSessionMinutes: Math.round(longSessionMinutes),
        breakSessionMinutes: Math.round(breakSessionMinutes),
      },
      create: {
        userId: USER_ID,
        cutoffTime,
        soundsEnabled,
        shortSessionMinutes: Math.round(shortSessionMinutes),
        longSessionMinutes: Math.round(longSessionMinutes),
        breakSessionMinutes: Math.round(breakSessionMinutes),
      },
    });

    for (const target of targets) {
      await tx.dailyTarget.upsert({
        where: { userId_weekday: { userId: USER_ID, weekday: target.weekday } },
        update: { targetMinutes: Math.round(target.targetMinutes) },
        create: {
          userId: USER_ID,
          weekday: target.weekday,
          targetMinutes: Math.round(target.targetMinutes),
        },
      });
    }
  });

  await setAdaptiveEnabled(USER_ID, adaptiveEnabled);
  const uiPreferences = await upsertUiPreferences(USER_ID, body.uiPreferences ?? {});

  await recomputeAndStoreAchievements(USER_ID);
  await recomputeAndStoreStreak(USER_ID);
  await recomputeAndStoreProductivity(USER_ID);
  const me = await prisma.user.findUnique({
    where: { id: USER_ID },
    include: { settings: true, targets: true },
  });
  if (!me) return me;
  return {
    ...me,
    settings: me.settings
      ? {
          ...me.settings,
          adaptiveEnabled,
        }
      : null,
    uiPreferences,
  };
});

await app.register(routes);

const port = Number(process.env.PORT ?? 4000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
