import type { FastifyInstance } from "fastify";
import { recomputeAndStoreAchievements } from "./achievements.js";
import { prisma } from "./db.js";
import { addDistraction, getSessionDistractions, isDistractionType } from "./distractions.js";
import { recomputeAndStoreProductivity } from "./productivity.js";
import { recomputeAndStoreStreak } from "./streak.js";

const USER_ID = "swot-user";

function overlapMinutes(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
) {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  if (end <= start) return 0;
  return Math.round((end - start) / 60000);
}

export async function routes(app: FastifyInstance) {
  // Courses
  app.get("/courses", async () => {
    return prisma.course.findMany({
      where: { userId: USER_ID },
      orderBy: { name: "asc" },
      include: { activities: true },
    });
  });

  app.post("/courses", async (req) => {
    const body = req.body as { name: string };
    return prisma.course.create({
      data: { userId: USER_ID, name: body.name.trim() },
    });
  });

  app.put("/courses/:id", async (req) => {
    const params = req.params as { id: string };
    const body = req.body as { name: string };
    await prisma.course.findFirstOrThrow({
      where: { id: params.id, userId: USER_ID },
    });

    return prisma.course.update({
      where: { id: params.id },
      data: { name: body.name.trim() },
    });
  });

  app.delete("/courses/:id", async (req, reply) => {
    const params = req.params as { id: string };

    const sessionsCount = await prisma.studySession.count({
      where: { userId: USER_ID, courseId: params.id },
    });

    if (sessionsCount > 0) {
      return reply.code(409).send({
        error:
          "Cannot delete a course with logged sessions. Remove or reassign sessions first.",
      });
    }

    await prisma.activity.deleteMany({
      where: { userId: USER_ID, courseId: params.id },
    });

    await prisma.course.findFirstOrThrow({
      where: { id: params.id, userId: USER_ID },
    });

    return prisma.course.delete({ where: { id: params.id } });
  });

  // Activities
  app.get("/activities", async () => {
    return prisma.activity.findMany({
      where: { userId: USER_ID },
      orderBy: [{ course: { name: "asc" } }, { name: "asc" }],
      include: { course: true },
    });
  });

  app.post("/activities", async (req) => {
    const body = req.body as { courseId: string; name: string; color?: string };
    return prisma.activity.create({
      data: {
        userId: USER_ID,
        courseId: body.courseId,
        name: body.name.trim(),
        color: body.color ?? "#ec4899",
      },
    });
  });

  app.put("/activities/:id", async (req) => {
    const params = req.params as { id: string };
    const body = req.body as { name: string; color?: string };
    await prisma.activity.findFirstOrThrow({
      where: { id: params.id, userId: USER_ID },
    });

    return prisma.activity.update({
      where: { id: params.id },
      data: {
        name: body.name.trim(),
        color: body.color ?? "#ec4899",
      },
      include: { course: true },
    });
  });

  app.delete("/activities/:id", async (req) => {
    const params = req.params as { id: string };

    await prisma.activity.findFirstOrThrow({
      where: { id: params.id, userId: USER_ID },
    });

    await prisma.studySession.updateMany({
      where: { userId: USER_ID, activityId: params.id },
      data: { activityId: null },
    });

    return prisma.activity.delete({
      where: { id: params.id },
      include: { course: true },
    });
  });

  // Planner
  app.get("/planner/blocks", async (req) => {
    const query = req.query as { from?: string; to?: string };
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;

    const blocks = await prisma.$queryRaw<
      Array<{
        id: number;
        user_id: string;
        course_id: string;
        activity_id: string | null;
        start_time: Date;
        end_time: Date;
        note: string | null;
        created_at: Date;
      }>
    >`
      SELECT id, user_id, course_id, activity_id, start_time, end_time, note, created_at
      FROM planned_study_blocks
      WHERE user_id = ${USER_ID}
      ORDER BY start_time ASC
    `;

    const filteredBlocks = blocks.filter((block) => {
      const startTs = new Date(block.start_time).getTime();
      if (from && startTs < from.getTime()) return false;
      if (to && startTs >= to.getTime()) return false;
      return true;
    });

    if (filteredBlocks.length === 0) return [];

    const sessions = await prisma.studySession.findMany({
      where: {
        userId: USER_ID,
        ...(from || to
          ? {
              startTime: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lt: to } : {}),
              },
            }
          : {}),
      },
      include: { course: true, activity: true },
    });

    const courses = await prisma.course.findMany({
      where: { userId: USER_ID },
      orderBy: { name: "asc" },
    });
    const courseById = new Map(courses.map((course) => [course.id, course]));

    const activities = await prisma.activity.findMany({
      where: { userId: USER_ID },
      include: { course: true },
    });
    const activityById = new Map(activities.map((activity) => [activity.id, activity]));

    const now = new Date();

    return filteredBlocks.map((block) => {
      const plannedMinutes = Math.max(
        0,
        Math.round(
          (new Date(block.end_time).getTime() - new Date(block.start_time).getTime()) / 60000
        )
      );

      const matchingSessions = sessions.filter(
        (session) =>
          session.courseId === block.course_id &&
          overlapMinutes(
            new Date(block.start_time),
            new Date(block.end_time),
            new Date(session.startTime),
            new Date(session.endTime)
          ) > 0
      );

      const actualMinutes = matchingSessions.reduce(
        (sum, session) =>
          sum +
          overlapMinutes(
            new Date(block.start_time),
            new Date(block.end_time),
            new Date(session.startTime),
            new Date(session.endTime)
          ),
        0
      );

      let status: "upcoming" | "completed" | "missed" = "upcoming";
      if (new Date(block.end_time).getTime() <= now.getTime()) {
        status = actualMinutes > 0 ? "completed" : "missed";
      }

      return {
        id: String(block.id),
        courseId: block.course_id,
        activityId: block.activity_id,
        startTime: new Date(block.start_time).toISOString(),
        endTime: new Date(block.end_time).toISOString(),
        note: block.note,
        createdAt: new Date(block.created_at).toISOString(),
        plannedMinutes,
        actualMinutes,
        status,
        course: courseById.get(block.course_id) ?? null,
        activity: block.activity_id ? activityById.get(block.activity_id) ?? null : null,
      };
    });
  });

  app.post("/planner/blocks", async (req) => {
    const body = req.body as {
      courseId: string;
      activityId?: string | null;
      startTime: string;
      endTime: string;
      note?: string;
    };

    const start = new Date(body.startTime);
    const end = new Date(body.endTime);

    await prisma.$executeRaw`
      INSERT INTO planned_study_blocks (user_id, course_id, activity_id, start_time, end_time, note)
      VALUES (${USER_ID}, ${body.courseId}, ${body.activityId ?? null}, ${start}, ${end}, ${
      body.note?.trim() || null
    })
    `;

    const rows = await prisma.$queryRaw<
      Array<{
        id: number;
      }>
    >`
      SELECT id
      FROM planned_study_blocks
      WHERE user_id = ${USER_ID}
      ORDER BY id DESC
      LIMIT 1
    `;

    const insertedId = rows[0]?.id;
    if (!insertedId) return null;

    const course = await prisma.course.findUnique({ where: { id: body.courseId } });
    const activity = body.activityId
      ? await prisma.activity.findUnique({ where: { id: body.activityId } })
      : null;

    return {
      id: String(insertedId),
      courseId: body.courseId,
      activityId: body.activityId ?? null,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      note: body.note?.trim() || null,
      createdAt: new Date().toISOString(),
      plannedMinutes: Math.max(
        0,
        Math.round((end.getTime() - start.getTime()) / 60000)
      ),
      actualMinutes: 0,
      status: end.getTime() <= Date.now() ? "missed" : "upcoming",
      course,
      activity,
    };
  });

  app.put("/planner/blocks/:id", async (req) => {
    const params = req.params as { id: string };
    const body = req.body as {
      courseId: string;
      activityId?: string | null;
      startTime: string;
      endTime: string;
      note?: string;
    };

    const start = new Date(body.startTime);
    const end = new Date(body.endTime);

    await prisma.$executeRaw`
      UPDATE planned_study_blocks
      SET course_id = ${body.courseId},
          activity_id = ${body.activityId ?? null},
          start_time = ${start},
          end_time = ${end},
          note = ${body.note?.trim() || null}
      WHERE id = ${Number(params.id)} AND user_id = ${USER_ID}
    `;

    const course = await prisma.course.findUnique({ where: { id: body.courseId } });
    const activity = body.activityId
      ? await prisma.activity.findUnique({ where: { id: body.activityId } })
      : null;

    return {
      id: params.id,
      courseId: body.courseId,
      activityId: body.activityId ?? null,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      note: body.note?.trim() || null,
      plannedMinutes: Math.max(
        0,
        Math.round((end.getTime() - start.getTime()) / 60000)
      ),
      course,
      activity,
    };
  });

  app.delete("/planner/blocks/:id", async (req) => {
    const params = req.params as { id: string };
    await prisma.$executeRaw`
      DELETE FROM planned_study_blocks
      WHERE id = ${Number(params.id)} AND user_id = ${USER_ID}
    `;
    return { ok: true };
  });

  app.get("/planner/overview", async (req) => {
    const query = req.query as { from?: string; to?: string };
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;

    const blocks = await prisma.$queryRaw<
      Array<{
        id: number;
        user_id: string;
        course_id: string;
        activity_id: string | null;
        start_time: Date;
        end_time: Date;
      }>
    >`
      SELECT id, user_id, course_id, activity_id, start_time, end_time
      FROM planned_study_blocks
      WHERE user_id = ${USER_ID}
      ORDER BY start_time ASC
    `;

    const filteredBlocks = blocks.filter((block) => {
      const startTs = new Date(block.start_time).getTime();
      if (from && startTs < from.getTime()) return false;
      if (to && startTs >= to.getTime()) return false;
      return true;
    });

    if (filteredBlocks.length === 0) {
      return {
        plannedMinutes: 0,
        actualMinutes: 0,
        missedSessions: 0,
        varianceMinutes: 0,
      };
    }

    const sessions = await prisma.studySession.findMany({
      where: {
        userId: USER_ID,
        ...(from || to
          ? {
              startTime: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lt: to } : {}),
              },
            }
          : {}),
      },
    });

    const now = Date.now();
    let plannedMinutes = 0;
    let actualMinutes = 0;
    let missedSessions = 0;

    for (const block of filteredBlocks) {
      const blockStart = new Date(block.start_time);
      const blockEnd = new Date(block.end_time);
      const blockPlanned = Math.max(
        0,
        Math.round((blockEnd.getTime() - blockStart.getTime()) / 60000)
      );
      plannedMinutes += blockPlanned;

      const blockActual = sessions
        .filter((session) => session.courseId === block.course_id)
        .reduce(
          (sum, session) =>
            sum +
            overlapMinutes(
              blockStart,
              blockEnd,
              new Date(session.startTime),
              new Date(session.endTime)
            ),
          0
        );

      actualMinutes += blockActual;

      if (blockEnd.getTime() <= now && blockActual <= 0) {
        missedSessions += 1;
      }
    }

    return {
      plannedMinutes,
      actualMinutes,
      missedSessions,
      varianceMinutes: actualMinutes - plannedMinutes,
    };
  });

  // Sessions
  app.get("/sessions", async (req) => {
    const q = req.query as {
      from?: string;
      to?: string;
      courseId?: string;
      q?: string;
    };
    const noteQuery = q.q?.trim();

    return prisma.studySession.findMany({
      where: {
        userId: USER_ID,
        ...(q.courseId ? { courseId: q.courseId } : {}),
        ...(noteQuery ? { note: { contains: noteQuery } } : {}),
        ...(q.from || q.to
          ? {
              startTime: {
                ...(q.from ? { gte: new Date(q.from) } : {}),
                ...(q.to ? { lt: new Date(q.to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { startTime: "desc" },
      include: { course: true, activity: true },
    });
  });

  app.post("/sessions", async (req) => {
    const body = req.body as {
      courseId: string;
      activityId?: string | null;
      startTime: string;
      endTime: string;
      breakMinutes?: number;
      note?: string;
    };

    const start = new Date(body.startTime);
    const end = new Date(body.endTime);
    const breakM = Math.max(0, Number(body.breakMinutes ?? 0));

    const durationMinutes = Math.max(
      0,
      Math.round((end.getTime() - start.getTime()) / 60000) - breakM
    );

    const created = await prisma.studySession.create({
      data: {
        userId: USER_ID,
        courseId: body.courseId,
        activityId: body.activityId ?? null,
        startTime: start,
        endTime: end,
        breakMinutes: breakM,
        durationMinutes,
        note: body.note?.trim() || null,
      },
      include: { course: true, activity: true },
    });

    await recomputeAndStoreAchievements(USER_ID);
    await recomputeAndStoreStreak(USER_ID);
    await recomputeAndStoreProductivity(USER_ID);
    return created;
  });

  app.put("/sessions/:id", async (req) => {
    const params = req.params as { id: string };
    const body = req.body as {
      courseId: string;
      activityId?: string | null;
      startTime: string;
      endTime: string;
      breakMinutes?: number;
      note?: string;
    };

    await prisma.studySession.findFirstOrThrow({
      where: { id: params.id, userId: USER_ID },
    });

    const start = new Date(body.startTime);
    const end = new Date(body.endTime);
    const breakM = Math.max(0, Number(body.breakMinutes ?? 0));

    const durationMinutes = Math.max(
      0,
      Math.round((end.getTime() - start.getTime()) / 60000) - breakM
    );

    const updated = await prisma.studySession.update({
      where: { id: params.id },
      data: {
        courseId: body.courseId,
        activityId: body.activityId ?? null,
        startTime: start,
        endTime: end,
        breakMinutes: breakM,
        durationMinutes,
        note: body.note?.trim() || null,
      },
      include: { course: true, activity: true },
    });

    await recomputeAndStoreAchievements(USER_ID);
    await recomputeAndStoreStreak(USER_ID);
    await recomputeAndStoreProductivity(USER_ID);
    return updated;
  });

  app.get("/sessions/:id/distractions", async (req) => {
    const params = req.params as { id: string };
    await prisma.studySession.findFirstOrThrow({
      where: { id: params.id, userId: USER_ID },
    });
    return getSessionDistractions(USER_ID, params.id);
  });

  app.post("/sessions/:id/distractions", async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as {
      type: string;
      minutesLost?: number;
      note?: string;
    };

    await prisma.studySession.findFirstOrThrow({
      where: { id: params.id, userId: USER_ID },
    });

    if (!isDistractionType(body.type)) {
      return reply.code(400).send({ error: "Invalid distraction type." });
    }

    const minutesLost = Math.max(0, Math.round(Number(body.minutesLost ?? 0)));

    const result = await addDistraction({
      userId: USER_ID,
      sessionId: params.id,
      type: body.type,
      minutesLost,
      ...(body.note ? { note: body.note } : {}),
    });

    return result;
  });
}
