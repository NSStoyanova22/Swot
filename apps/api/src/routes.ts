import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { recomputeAndStoreAchievements } from "./achievements.js";
import { prisma } from "./db.js";
import { addDistraction, getSessionDistractions, isDistractionType } from "./distractions.js";
import {
  computeNextReminderTrigger,
  type ReminderRepeatRule,
} from "./organization.js";
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

function normalizeRepeatRule(value: string | undefined): ReminderRepeatRule {
  if (value === "daily" || value === "weekly") return value;
  return "none";
}

function getWeekday(date: Date) {
  const jsDay = date.getDay();
  return jsDay === 0 ? 7 : jsDay;
}

function timeToMinutes(value: string) {
  const [hours = 0, minutes = 0] = value.split(":").map(Number);
  return hours * 60 + minutes;
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

  // Study Organization
  app.get("/organization/tasks", async (req) => {
    const query = req.query as {
      from?: string;
      to?: string;
      status?: string;
      kind?: string;
    };
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;

    const tasks = await prisma.$queryRaw<
      Array<{
        id: number;
        user_id: string;
        title: string;
        description: string | null;
        kind: string;
        status: string;
        progress: number;
        priority: string;
        due_at: Date | null;
        course_id: string | null;
        activity_id: string | null;
        created_at: Date;
        updated_at: Date;
      }>
    >`
      SELECT id, user_id, title, description, kind, status, progress, priority, due_at, course_id, activity_id, created_at, updated_at
      FROM tasks
      WHERE user_id = ${USER_ID}
      ORDER BY
        CASE WHEN due_at IS NULL THEN 1 ELSE 0 END ASC,
        due_at ASC,
        created_at DESC
    `;

    const taskIds = tasks.map((task) => task.id);
    const subtasks = taskIds.length
      ? await prisma.$queryRaw<
          Array<{
            id: number;
            task_id: number;
            title: string;
            done: number;
            sort_order: number;
          }>
        >`
          SELECT id, task_id, title, done, sort_order
          FROM task_subtasks
          WHERE user_id = ${USER_ID}
            AND task_id IN (${Prisma.join(taskIds)})
          ORDER BY task_id ASC, sort_order ASC, id ASC
        `
      : [];

    const subtasksByTask = new Map<number, typeof subtasks>();
    subtasks.forEach((item) => {
      const current = subtasksByTask.get(item.task_id) ?? [];
      current.push(item);
      subtasksByTask.set(item.task_id, current);
    });

    return tasks
      .filter((task) => {
        if (query.status && task.status !== query.status) return false;
        if (query.kind && task.kind !== query.kind) return false;
        if (from && task.due_at && new Date(task.due_at).getTime() < from.getTime()) return false;
        if (to && task.due_at && new Date(task.due_at).getTime() >= to.getTime()) return false;
        return true;
      })
      .map((task) => {
        const items = subtasksByTask.get(task.id) ?? [];
        const completed = items.filter((sub) => Boolean(sub.done)).length;
        return {
          id: String(task.id),
          title: task.title,
          description: task.description,
          kind: task.kind,
          status: task.status,
          progress: task.progress,
          priority: task.priority,
          dueAt: task.due_at ? new Date(task.due_at).toISOString() : null,
          courseId: task.course_id,
          activityId: task.activity_id,
          createdAt: new Date(task.created_at).toISOString(),
          updatedAt: new Date(task.updated_at).toISOString(),
          subtasks: items.map((sub) => ({
            id: String(sub.id),
            title: sub.title,
            done: Boolean(sub.done),
            sortOrder: sub.sort_order,
          })),
          subtaskStats: {
            total: items.length,
            completed,
          },
        };
      });
  });

  app.post("/organization/tasks", async (req, reply) => {
    const body = req.body as {
      title?: string;
      description?: string;
      kind?: string;
      status?: string;
      progress?: number;
      priority?: string;
      dueAt?: string | null;
      courseId?: string | null;
      activityId?: string | null;
      subtasks?: Array<{ title: string }>;
    };

    const title = body.title?.trim();
    if (!title) {
      return reply.code(400).send({ error: "Task title is required." });
    }

    const progress = Math.max(0, Math.min(100, Math.round(Number(body.progress ?? 0))));
    const kind = body.kind?.trim() || "task";
    const status = body.status?.trim() || "todo";
    const priority = body.priority?.trim() || "medium";
    const dueAt = body.dueAt ? new Date(body.dueAt) : null;

    await prisma.$executeRaw`
      INSERT INTO tasks (user_id, title, description, kind, status, progress, priority, due_at, course_id, activity_id)
      VALUES (
        ${USER_ID},
        ${title},
        ${body.description?.trim() || null},
        ${kind},
        ${status},
        ${progress},
        ${priority},
        ${dueAt},
        ${body.courseId ?? null},
        ${body.activityId ?? null}
      )
    `;

    const rows = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id
      FROM tasks
      WHERE user_id = ${USER_ID}
      ORDER BY id DESC
      LIMIT 1
    `;
    const taskId = rows[0]?.id;
    if (!taskId) return reply.code(500).send({ error: "Could not create task." });

    const subtasks = (body.subtasks ?? []).map((item) => item.title.trim()).filter(Boolean);
    for (let index = 0; index < subtasks.length; index += 1) {
      await prisma.$executeRaw`
        INSERT INTO task_subtasks (user_id, task_id, title, done, sort_order)
        VALUES (${USER_ID}, ${taskId}, ${subtasks[index]}, 0, ${index})
      `;
    }

    return {
      id: String(taskId),
      title,
      description: body.description?.trim() || null,
      kind,
      status,
      progress,
      priority,
      dueAt: dueAt ? dueAt.toISOString() : null,
      courseId: body.courseId ?? null,
      activityId: body.activityId ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      subtasks: subtasks.map((subtask, index) => ({
        id: `new-${index}`,
        title: subtask,
        done: false,
        sortOrder: index,
      })),
      subtaskStats: { total: subtasks.length, completed: 0 },
    };
  });

  app.put("/organization/tasks/:id", async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as {
      title?: string;
      description?: string | null;
      kind?: string;
      status?: string;
      progress?: number;
      priority?: string;
      dueAt?: string | null;
      courseId?: string | null;
      activityId?: string | null;
    };

    const taskId = Number(params.id);
    if (!Number.isInteger(taskId)) {
      return reply.code(400).send({ error: "Invalid task id." });
    }

    const existing = await prisma.$queryRaw<
      Array<{
        title: string;
        description: string | null;
        kind: string;
        status: string;
        progress: number;
        priority: string;
        due_at: Date | null;
        course_id: string | null;
        activity_id: string | null;
      }>
    >`
      SELECT title, description, kind, status, progress, priority, due_at, course_id, activity_id
      FROM tasks
      WHERE id = ${taskId} AND user_id = ${USER_ID}
      LIMIT 1
    `;
    const row = existing[0];
    if (!row) return reply.code(404).send({ error: "Task not found." });

    const next = {
      title: body.title?.trim() || row.title,
      description:
        body.description === undefined ? row.description : body.description?.trim() || null,
      kind: body.kind?.trim() || row.kind,
      status: body.status?.trim() || row.status,
      progress:
        body.progress === undefined
          ? row.progress
          : Math.max(0, Math.min(100, Math.round(Number(body.progress)))),
      priority: body.priority?.trim() || row.priority,
      dueAt: body.dueAt === undefined ? row.due_at : body.dueAt ? new Date(body.dueAt) : null,
      courseId: body.courseId === undefined ? row.course_id : body.courseId ?? null,
      activityId: body.activityId === undefined ? row.activity_id : body.activityId ?? null,
    };

    await prisma.$executeRaw`
      UPDATE tasks
      SET
        title = ${next.title},
        description = ${next.description},
        kind = ${next.kind},
        status = ${next.status},
        progress = ${next.progress},
        priority = ${next.priority},
        due_at = ${next.dueAt},
        course_id = ${next.courseId},
        activity_id = ${next.activityId}
      WHERE id = ${taskId} AND user_id = ${USER_ID}
    `;

    return { id: String(taskId), ...next, dueAt: next.dueAt ? next.dueAt.toISOString() : null };
  });

  app.delete("/organization/tasks/:id", async (req, reply) => {
    const params = req.params as { id: string };
    const taskId = Number(params.id);
    if (!Number.isInteger(taskId)) {
      return reply.code(400).send({ error: "Invalid task id." });
    }
    await prisma.$executeRaw`
      DELETE FROM task_subtasks
      WHERE user_id = ${USER_ID} AND task_id = ${taskId}
    `;
    await prisma.$executeRaw`
      DELETE FROM reminders
      WHERE user_id = ${USER_ID} AND task_id = ${taskId}
    `;
    await prisma.$executeRaw`
      DELETE FROM tasks
      WHERE user_id = ${USER_ID} AND id = ${taskId}
    `;
    return { ok: true };
  });

  app.post("/organization/tasks/:id/subtasks", async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as { title?: string };
    const taskId = Number(params.id);
    const title = body.title?.trim();
    if (!Number.isInteger(taskId) || !title) {
      return reply.code(400).send({ error: "Valid task id and subtask title are required." });
    }

    const countRows = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*) AS count
      FROM task_subtasks
      WHERE user_id = ${USER_ID} AND task_id = ${taskId}
    `;
    const count = Number(countRows[0]?.count ?? 0);

    await prisma.$executeRaw`
      INSERT INTO task_subtasks (user_id, task_id, title, done, sort_order)
      VALUES (${USER_ID}, ${taskId}, ${title}, 0, ${count ?? 0})
    `;

    const rows = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id
      FROM task_subtasks
      WHERE user_id = ${USER_ID} AND task_id = ${taskId}
      ORDER BY id DESC
      LIMIT 1
    `;

    return {
      id: String(rows[0]?.id),
      taskId: String(taskId),
      title,
      done: false,
      sortOrder: count ?? 0,
    };
  });

  app.put("/organization/tasks/:id/subtasks/:subtaskId", async (req, reply) => {
    const params = req.params as { id: string; subtaskId: string };
    const body = req.body as { title?: string; done?: boolean; sortOrder?: number };
    const taskId = Number(params.id);
    const subtaskId = Number(params.subtaskId);
    if (!Number.isInteger(taskId) || !Number.isInteger(subtaskId)) {
      return reply.code(400).send({ error: "Invalid id." });
    }

    await prisma.$executeRaw`
      UPDATE task_subtasks
      SET
        title = COALESCE(${body.title?.trim() || null}, title),
        done = COALESCE(${typeof body.done === "boolean" ? (body.done ? 1 : 0) : null}, done),
        sort_order = COALESCE(${Number.isFinite(body.sortOrder) ? Math.round(Number(body.sortOrder)) : null}, sort_order)
      WHERE id = ${subtaskId} AND task_id = ${taskId} AND user_id = ${USER_ID}
    `;

    const rows = await prisma.$queryRaw<
      Array<{ id: number; task_id: number; title: string; done: number; sort_order: number }>
    >`
      SELECT id, task_id, title, done, sort_order
      FROM task_subtasks
      WHERE id = ${subtaskId} AND task_id = ${taskId} AND user_id = ${USER_ID}
      LIMIT 1
    `;
    const row = rows[0];
    return row
      ? {
          id: String(row.id),
          taskId: String(row.task_id),
          title: row.title,
          done: Boolean(row.done),
          sortOrder: row.sort_order,
        }
      : null;
  });

  app.delete("/organization/tasks/:id/subtasks/:subtaskId", async (req, reply) => {
    const params = req.params as { id: string; subtaskId: string };
    const taskId = Number(params.id);
    const subtaskId = Number(params.subtaskId);
    if (!Number.isInteger(taskId) || !Number.isInteger(subtaskId)) {
      return reply.code(400).send({ error: "Invalid id." });
    }

    await prisma.$executeRaw`
      DELETE FROM task_subtasks
      WHERE id = ${subtaskId} AND task_id = ${taskId} AND user_id = ${USER_ID}
    `;
    return { ok: true };
  });

  app.get("/organization/schedule-blocks", async () => {
    const rows = await prisma.$queryRaw<
      Array<{
        id: number;
        title: string;
        note: string | null;
        course_id: string | null;
        activity_id: string | null;
        day_of_week: number;
        start_time: string;
        end_time: string;
        rotation_interval_days: number | null;
        rotation_offset: number;
        is_active: number;
        created_at: Date;
        updated_at: Date;
      }>
    >`
      SELECT id, title, note, course_id, activity_id, day_of_week, start_time, end_time, rotation_interval_days, rotation_offset, is_active, created_at, updated_at
      FROM schedule_blocks
      WHERE user_id = ${USER_ID}
      ORDER BY day_of_week ASC, start_time ASC
    `;

    return rows.map((row) => ({
      id: String(row.id),
      title: row.title,
      note: row.note,
      courseId: row.course_id,
      activityId: row.activity_id,
      dayOfWeek: row.day_of_week,
      startTime: row.start_time,
      endTime: row.end_time,
      rotationIntervalDays: row.rotation_interval_days,
      rotationOffset: row.rotation_offset,
      isActive: Boolean(row.is_active),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  });

  app.post("/organization/schedule-blocks", async (req, reply) => {
    const body = req.body as {
      title?: string;
      note?: string;
      courseId?: string | null;
      activityId?: string | null;
      dayOfWeek?: number;
      startTime?: string;
      endTime?: string;
      rotationIntervalDays?: number | null;
      rotationOffset?: number;
      isActive?: boolean;
    };

    const title = body.title?.trim();
    const startTime = body.startTime?.trim();
    const endTime = body.endTime?.trim();
    const dayOfWeek = Number(body.dayOfWeek);
    if (!title || !startTime || !endTime || !Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
      return reply.code(400).send({ error: "Invalid schedule block payload." });
    }

    await prisma.$executeRaw`
      INSERT INTO schedule_blocks (
        user_id, title, note, course_id, activity_id, day_of_week, start_time, end_time, rotation_interval_days, rotation_offset, is_active
      )
      VALUES (
        ${USER_ID},
        ${title},
        ${body.note?.trim() || null},
        ${body.courseId ?? null},
        ${body.activityId ?? null},
        ${dayOfWeek},
        ${startTime},
        ${endTime},
        ${body.rotationIntervalDays ?? null},
        ${Math.max(0, Math.round(Number(body.rotationOffset ?? 0)))},
        ${body.isActive === false ? 0 : 1}
      )
    `;
    const rows = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id
      FROM schedule_blocks
      WHERE user_id = ${USER_ID}
      ORDER BY id DESC
      LIMIT 1
    `;
    return { id: String(rows[0]?.id) };
  });

  app.put("/organization/schedule-blocks/:id", async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as {
      title?: string;
      note?: string | null;
      courseId?: string | null;
      activityId?: string | null;
      dayOfWeek?: number;
      startTime?: string;
      endTime?: string;
      rotationIntervalDays?: number | null;
      rotationOffset?: number;
      isActive?: boolean;
    };
    const blockId = Number(params.id);
    if (!Number.isInteger(blockId)) {
      return reply.code(400).send({ error: "Invalid schedule block id." });
    }

    const existing = await prisma.$queryRaw<
      Array<{
        title: string;
        note: string | null;
        course_id: string | null;
        activity_id: string | null;
        day_of_week: number;
        start_time: string;
        end_time: string;
        rotation_interval_days: number | null;
        rotation_offset: number;
        is_active: number;
      }>
    >`
      SELECT title, note, course_id, activity_id, day_of_week, start_time, end_time, rotation_interval_days, rotation_offset, is_active
      FROM schedule_blocks
      WHERE id = ${blockId} AND user_id = ${USER_ID}
      LIMIT 1
    `;
    const row = existing[0];
    if (!row) return reply.code(404).send({ error: "Schedule block not found." });

    await prisma.$executeRaw`
      UPDATE schedule_blocks
      SET
        title = ${body.title?.trim() || row.title},
        note = ${body.note === undefined ? row.note : body.note?.trim() || null},
        course_id = ${body.courseId === undefined ? row.course_id : body.courseId ?? null},
        activity_id = ${body.activityId === undefined ? row.activity_id : body.activityId ?? null},
        day_of_week = ${Number.isInteger(body.dayOfWeek) ? Number(body.dayOfWeek) : row.day_of_week},
        start_time = ${body.startTime?.trim() || row.start_time},
        end_time = ${body.endTime?.trim() || row.end_time},
        rotation_interval_days = ${body.rotationIntervalDays === undefined ? row.rotation_interval_days : body.rotationIntervalDays ?? null},
        rotation_offset = ${Number.isFinite(body.rotationOffset) ? Math.max(0, Math.round(Number(body.rotationOffset))) : row.rotation_offset},
        is_active = ${typeof body.isActive === "boolean" ? (body.isActive ? 1 : 0) : row.is_active}
      WHERE id = ${blockId} AND user_id = ${USER_ID}
    `;

    return { ok: true };
  });

  app.delete("/organization/schedule-blocks/:id", async (req, reply) => {
    const params = req.params as { id: string };
    const blockId = Number(params.id);
    if (!Number.isInteger(blockId)) {
      return reply.code(400).send({ error: "Invalid schedule block id." });
    }
    await prisma.$executeRaw`
      DELETE FROM reminders
      WHERE user_id = ${USER_ID} AND schedule_block_id = ${blockId}
    `;
    await prisma.$executeRaw`
      DELETE FROM schedule_blocks
      WHERE user_id = ${USER_ID} AND id = ${blockId}
    `;
    return { ok: true };
  });

  app.get("/organization/reminders", async () => {
    const rows = await prisma.$queryRaw<
      Array<{
        id: number;
        task_id: number | null;
        schedule_block_id: number | null;
        title: string;
        remind_at: Date;
        repeat_rule: string;
        next_trigger_at: Date | null;
        delivered: number;
        last_triggered_at: Date | null;
        created_at: Date;
        updated_at: Date;
      }>
    >`
      SELECT id, task_id, schedule_block_id, title, remind_at, repeat_rule, next_trigger_at, delivered, last_triggered_at, created_at, updated_at
      FROM reminders
      WHERE user_id = ${USER_ID}
      ORDER BY COALESCE(next_trigger_at, remind_at) ASC, id ASC
    `;
    return rows.map((row) => ({
      id: String(row.id),
      taskId: row.task_id ? String(row.task_id) : null,
      scheduleBlockId: row.schedule_block_id ? String(row.schedule_block_id) : null,
      title: row.title,
      remindAt: new Date(row.remind_at).toISOString(),
      repeatRule: row.repeat_rule,
      nextTriggerAt: row.next_trigger_at ? new Date(row.next_trigger_at).toISOString() : null,
      delivered: Boolean(row.delivered),
      lastTriggeredAt: row.last_triggered_at
        ? new Date(row.last_triggered_at).toISOString()
        : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  });

  app.post("/organization/reminders", async (req, reply) => {
    const body = req.body as {
      taskId?: string | null;
      scheduleBlockId?: string | null;
      title?: string;
      remindAt?: string;
      repeatRule?: string;
    };
    const title = body.title?.trim();
    const remindAt = body.remindAt ? new Date(body.remindAt) : null;
    if (!title || !remindAt) {
      return reply.code(400).send({ error: "Reminder title and remindAt are required." });
    }
    const repeatRule = normalizeRepeatRule(body.repeatRule);
    const nextTriggerAt = computeNextReminderTrigger(remindAt, repeatRule, new Date());

    await prisma.$executeRaw`
      INSERT INTO reminders (
        user_id, task_id, schedule_block_id, title, remind_at, repeat_rule, next_trigger_at, delivered
      )
      VALUES (
        ${USER_ID},
        ${body.taskId ? Number(body.taskId) : null},
        ${body.scheduleBlockId ? Number(body.scheduleBlockId) : null},
        ${title},
        ${remindAt},
        ${repeatRule},
        ${nextTriggerAt},
        ${0}
      )
    `;
    const rows = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id
      FROM reminders
      WHERE user_id = ${USER_ID}
      ORDER BY id DESC
      LIMIT 1
    `;
    return { id: String(rows[0]?.id) };
  });

  app.put("/organization/reminders/:id", async (req, reply) => {
    const params = req.params as { id: string };
    const body = req.body as {
      taskId?: string | null;
      scheduleBlockId?: string | null;
      title?: string;
      remindAt?: string;
      repeatRule?: string;
      delivered?: boolean;
    };
    const reminderId = Number(params.id);
    if (!Number.isInteger(reminderId)) {
      return reply.code(400).send({ error: "Invalid reminder id." });
    }

    const remindAt = body.remindAt ? new Date(body.remindAt) : null;
    const repeatRule = body.repeatRule ? normalizeRepeatRule(body.repeatRule) : undefined;
    const nextTriggerAt =
      remindAt && repeatRule
        ? computeNextReminderTrigger(remindAt, repeatRule, new Date())
        : undefined;

    const existing = await prisma.$queryRaw<
      Array<{
        task_id: number | null;
        schedule_block_id: number | null;
        title: string;
        remind_at: Date;
        repeat_rule: string;
        next_trigger_at: Date | null;
        delivered: number;
      }>
    >`
      SELECT task_id, schedule_block_id, title, remind_at, repeat_rule, next_trigger_at, delivered
      FROM reminders
      WHERE id = ${reminderId} AND user_id = ${USER_ID}
      LIMIT 1
    `;
    const row = existing[0];
    if (!row) return reply.code(404).send({ error: "Reminder not found." });

    const nextRemindAt = remindAt ?? row.remind_at;
    const nextRepeat = repeatRule ?? normalizeRepeatRule(row.repeat_rule);
    const nextNextTrigger =
      nextTriggerAt ??
      computeNextReminderTrigger(nextRemindAt, nextRepeat, new Date());

    await prisma.$executeRaw`
      UPDATE reminders
      SET
        task_id = ${body.taskId === undefined ? row.task_id : body.taskId ? Number(body.taskId) : null},
        schedule_block_id = ${body.scheduleBlockId === undefined ? row.schedule_block_id : body.scheduleBlockId ? Number(body.scheduleBlockId) : null},
        title = ${body.title?.trim() || row.title},
        remind_at = ${nextRemindAt},
        repeat_rule = ${nextRepeat},
        next_trigger_at = ${nextNextTrigger},
        delivered = ${typeof body.delivered === "boolean" ? (body.delivered ? 1 : 0) : row.delivered}
      WHERE id = ${reminderId} AND user_id = ${USER_ID}
    `;
    return { ok: true };
  });

  app.delete("/organization/reminders/:id", async (req, reply) => {
    const params = req.params as { id: string };
    const reminderId = Number(params.id);
    if (!Number.isInteger(reminderId)) {
      return reply.code(400).send({ error: "Invalid reminder id." });
    }
    await prisma.$executeRaw`
      DELETE FROM reminders
      WHERE id = ${reminderId} AND user_id = ${USER_ID}
    `;
    return { ok: true };
  });

  app.get("/organization/reminders/due", async (req) => {
    const query = req.query as { at?: string };
    const now = query.at ? new Date(query.at) : new Date();
    const due = await prisma.$queryRaw<
      Array<{
        id: number;
        title: string;
        remind_at: Date;
        repeat_rule: string;
        next_trigger_at: Date | null;
      }>
    >`
      SELECT id, title, remind_at, repeat_rule, next_trigger_at
      FROM reminders
      WHERE user_id = ${USER_ID}
        AND next_trigger_at IS NOT NULL
        AND next_trigger_at <= ${now}
        AND delivered = 0
      ORDER BY next_trigger_at ASC
    `;

    for (const reminder of due) {
      const repeatRule = normalizeRepeatRule(reminder.repeat_rule);
      if (repeatRule === "none") {
        await prisma.$executeRaw`
          UPDATE reminders
          SET delivered = 1, last_triggered_at = ${now}, next_trigger_at = NULL
          WHERE user_id = ${USER_ID} AND id = ${reminder.id}
        `;
      } else {
        const next = computeNextReminderTrigger(
          reminder.next_trigger_at ?? reminder.remind_at,
          repeatRule,
          now
        );
        await prisma.$executeRaw`
          UPDATE reminders
          SET delivered = 0, last_triggered_at = ${now}, next_trigger_at = ${next}
          WHERE user_id = ${USER_ID} AND id = ${reminder.id}
        `;
      }
    }

    return due.map((item) => ({
      id: String(item.id),
      title: item.title,
      remindAt: new Date(item.remind_at).toISOString(),
      repeatRule: item.repeat_rule,
      triggeredAt: now.toISOString(),
    }));
  });

  app.get("/organization/unified", async (req) => {
    const query = req.query as { from?: string; to?: string };
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 7 * 86_400_000);
    const to = query.to ? new Date(query.to) : new Date(Date.now() + 21 * 86_400_000);

    const [plannerBlocks, sessions, tasks, reminders, scheduleBlocks] = await Promise.all([
      prisma.$queryRaw<
        Array<{ id: number; course_id: string; start_time: Date; end_time: Date; note: string | null }>
      >`
        SELECT id, course_id, start_time, end_time, note
        FROM planned_study_blocks
        WHERE user_id = ${USER_ID}
          AND start_time >= ${from}
          AND start_time < ${to}
      `,
      prisma.studySession.findMany({
        where: {
          userId: USER_ID,
          startTime: { gte: from, lt: to },
        },
        include: { course: true, activity: true },
      }),
      prisma.$queryRaw<
        Array<{ id: number; title: string; due_at: Date | null; kind: string; status: string; priority: string }>
      >`
        SELECT id, title, due_at, kind, status, priority
        FROM tasks
        WHERE user_id = ${USER_ID}
          AND due_at IS NOT NULL
          AND due_at >= ${from}
          AND due_at < ${to}
        ORDER BY due_at ASC
      `,
      prisma.$queryRaw<
        Array<{ id: number; title: string; next_trigger_at: Date | null; remind_at: Date }>
      >`
        SELECT id, title, next_trigger_at, remind_at
        FROM reminders
        WHERE user_id = ${USER_ID}
          AND COALESCE(next_trigger_at, remind_at) >= ${from}
          AND COALESCE(next_trigger_at, remind_at) < ${to}
        ORDER BY COALESCE(next_trigger_at, remind_at) ASC
      `,
      prisma.$queryRaw<
        Array<{
          id: number;
          title: string;
          day_of_week: number;
          start_time: string;
          end_time: string;
          rotation_interval_days: number | null;
          rotation_offset: number;
          is_active: number;
        }>
      >`
        SELECT id, title, day_of_week, start_time, end_time, rotation_interval_days, rotation_offset, is_active
        FROM schedule_blocks
        WHERE user_id = ${USER_ID}
          AND is_active = 1
      `,
    ]);

    const unifiedItems: Array<{
      id: string;
      type: "planned" | "session" | "task" | "reminder" | "schedule";
      title: string;
      startTime: string;
      endTime: string | null;
      tone: "default" | "success" | "warning" | "danger";
      meta: string;
    }> = [];

    plannerBlocks.forEach((item) => {
      unifiedItems.push({
        id: `planned-${item.id}`,
        type: "planned",
        title: "Planned Study Block",
        startTime: new Date(item.start_time).toISOString(),
        endTime: new Date(item.end_time).toISOString(),
        tone: "default",
        meta: item.note ?? "Planner block",
      });
    });

    sessions.forEach((session) => {
      unifiedItems.push({
        id: `session-${session.id}`,
        type: "session",
        title: `Session: ${session.course?.name ?? "Course"}`,
        startTime: new Date(session.startTime).toISOString(),
        endTime: new Date(session.endTime).toISOString(),
        tone: "success",
        meta: `${session.durationMinutes}m`,
      });
    });

    tasks.forEach((task) => {
      if (!task.due_at) return;
      unifiedItems.push({
        id: `task-${task.id}`,
        type: "task",
        title: task.kind === "exam" ? `Exam: ${task.title}` : task.title,
        startTime: new Date(task.due_at).toISOString(),
        endTime: null,
        tone: task.priority === "high" ? "danger" : "warning",
        meta: `${task.status} • ${task.priority}`,
      });
    });

    reminders.forEach((reminder) => {
      unifiedItems.push({
        id: `reminder-${reminder.id}`,
        type: "reminder",
        title: reminder.title,
        startTime: new Date(reminder.next_trigger_at ?? reminder.remind_at).toISOString(),
        endTime: null,
        tone: "warning",
        meta: "Reminder",
      });
    });

    for (
      let cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
      cursor.getTime() < to.getTime();
      cursor = new Date(cursor.getTime() + 86_400_000)
    ) {
      const day = getWeekday(cursor);
      const dayBlocks = scheduleBlocks.filter((item) => {
        if (!item.is_active || item.day_of_week !== day) return false;
        if (item.rotation_interval_days && item.rotation_interval_days > 0) {
          const epochDays = Math.floor(cursor.getTime() / 86_400_000);
          return ((epochDays + item.rotation_offset) % item.rotation_interval_days) === 0;
        }
        return true;
      });
      dayBlocks.forEach((block) => {
        const startMin = timeToMinutes(block.start_time);
        const endMin = timeToMinutes(block.end_time);
        const start = new Date(cursor);
        start.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
        const end = new Date(cursor);
        end.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);
        unifiedItems.push({
          id: `schedule-${block.id}-${cursor.toISOString().slice(0, 10)}`,
          type: "schedule",
          title: block.title,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          tone: "default",
          meta: block.rotation_interval_days
            ? `Rotating every ${block.rotation_interval_days} day(s)`
            : "Timetable block",
        });
      });
    }

    unifiedItems.sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );

    return unifiedItems;
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
