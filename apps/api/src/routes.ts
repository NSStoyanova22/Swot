import type { FastifyInstance } from "fastify";
import { prisma } from "./db.js";

const USER_ID = "swot-user";

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

  // Sessions
  app.get("/sessions", async (req) => {
    const q = req.query as { from?: string; to?: string; courseId?: string };
    return prisma.studySession.findMany({
      where: {
        userId: USER_ID,
        ...(q.courseId ? { courseId: q.courseId } : {}),
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

    return prisma.studySession.create({
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
  });
}
