import type { FastifyInstance } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import { Prisma } from "@prisma/client";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { recomputeAndStoreAchievements } from "./achievements.js";
import { prisma } from "./db.js";
import { addDistraction, getSessionDistractions, isDistractionType } from "./distractions.js";
import {
  computeCourseAverage,
  fromPerformanceScore,
  getCelebrationSettings,
  getCourseCelebrationRecords,
  getGradeRiskSettings,
  getGradeBand,
  hasEnoughRiskDataPoints,
  getIgnoredShkoloSubjects,
  isBelowRiskThreshold,
  normalizeGradeScale,
  recordCourseCelebration,
  resolveRiskLookbackTerms,
  selectRiskEvaluationItems,
  shouldNeverFlagBestRiskMetric,
  shouldSuppressAttentionForExcellent,
  toPerformanceScore,
  type CelebrationShowFor,
  type GradeAverageInputItem,
  type GradeScale,
} from "./grades.js";
import {
  computeNextReminderTrigger,
  type ReminderRepeatRule,
} from "./organization.js";
import { recomputeAndStoreProductivity } from "./productivity.js";
import {
  extractShkoloPdfPages,
  parseShkoloDiaryText,
  parseShkoloPages,
  renderPdfPagesToPng,
} from "./shkolo-pdf.js";
import { recomputeAndStoreStreak } from "./streak.js";

const USER_ID = "swot-user";
const require = createRequire(import.meta.url);
const createTesseractWorker = require("tesseract.js-node") as (options: {
  tessdata: string | Buffer;
  languages: string[];
}) => Promise<{ recognize: (input: string | Buffer, language: string) => string }>;
const tesseractJs = require("tesseract.js") as {
  createWorker: (
    langs?: string | string[],
    oem?: number,
    options?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ) => Promise<{
    setParameters: (params: Record<string, string>) => Promise<unknown>;
    recognize: (
      image: Buffer,
      options?: Record<string, unknown>,
    ) => Promise<{ data: { text: string } }>;
  }>;
};
const defaultTessdataDir = fileURLToPath(new URL("../tessdata", import.meta.url));
const ocrTessdataDir = process.env.OCR_TESSDATA_DIR ?? defaultTessdataDir;
let ocrWorkerPromise: Promise<{ recognize: (input: string | Buffer, language: string) => string }> | null = null;
let shkoloPdfOcrWorkerPromise: Promise<{
  setParameters: (params: Record<string, string>) => Promise<unknown>;
  recognize: (
    image: Buffer,
    options?: Record<string, unknown>,
  ) => Promise<{ data: { text: string } }>;
}> | null = null;

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

function toIsoDate(value: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

function roundScore(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function weekDayLabel(index: number) {
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][index] ?? "Day";
}

function splitMinutes(totalMinutes: number, sessionLength: number) {
  const chunks: number[] = [];
  let remaining = Math.max(0, Math.round(totalMinutes));
  const base = clamp(Math.round(sessionLength), 25, 120);
  const minChunk = Math.max(20, Math.round(base * 0.6));

  while (remaining > 0) {
    if (remaining <= base) {
      if (remaining < minChunk && chunks.length > 0) {
        const lastIndex = chunks.length - 1;
        const current = chunks[lastIndex] ?? 0;
        chunks[lastIndex] = current + remaining;
      } else {
        chunks.push(remaining);
      }
      break;
    }

    if (remaining < base * 2 && remaining > base + minChunk) {
      const first = Math.round(remaining / 2);
      chunks.push(first);
      chunks.push(remaining - first);
      break;
    }

    chunks.push(base);
    remaining -= base;
  }

  return chunks;
}

function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createTesseractWorker({
      tessdata: ocrTessdataDir,
      languages: ["eng"],
    });
  }
  return ocrWorkerPromise;
}

function getShkoloPdfOcrWorker() {
  if (!shkoloPdfOcrWorkerPromise) {
    shkoloPdfOcrWorkerPromise = tesseractJs.createWorker("bul+eng");
  }
  return shkoloPdfOcrWorkerPromise;
}

type FinalType = "TERM1" | "TERM2" | "YEAR";

function normalizeFinalType(value: unknown): FinalType | null {
  if (value === "TERM1" || value === "TERM2" || value === "YEAR") return value;
  return null;
}

function parseImportMetadata(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function findOpenPlannerSlot(
  dayDate: Date,
  existingBlocks: Array<{ startTime: Date; endTime: Date }>,
  durationMinutes: number
) {
  const slotStarts = ["08:00", "10:00", "14:00", "16:00", "18:00", "20:00"];

  for (const slot of slotStarts) {
    const [h = 8, m = 0] = slot.split(":").map(Number);
    const start = new Date(dayDate);
    start.setHours(h, m, 0, 0);
    const end = new Date(start.getTime() + durationMinutes * 60_000);

    const overlaps = existingBlocks.some((block) =>
      overlapMinutes(start, end, block.startTime, block.endTime) > 0
    );
    if (!overlaps) return { start, end };
  }

  const fallbackStart = new Date(dayDate);
  fallbackStart.setHours(20, 0, 0, 0);
  return {
    start: fallbackStart,
    end: new Date(fallbackStart.getTime() + durationMinutes * 60_000),
  };
}

const DEFAULT_GRADE_CATEGORIES = [
  { name: "Exam", weight: 30 },
  { name: "Quiz", weight: 20 },
  { name: "Homework", weight: 15 },
  { name: "Project", weight: 20 },
  { name: "Final", weight: 15 },
];

type GradeCategoryRow = {
  id: number;
  user_id: string;
  course_id: string;
  name: string;
  weight: number;
  drop_lowest: number;
  created_at: Date;
  updated_at: Date;
};

type GradeItemScoreRow = {
  id: number;
  category_id: number | null;
  performance_score: number;
  weight: number;
};

function computeCategoryAverages(
  categories: Array<{ id: number; name: string; weight: number; dropLowest: boolean }>,
  items: GradeItemScoreRow[]
) {
  const itemsByCategory = new Map<number, GradeItemScoreRow[]>();
  for (const item of items) {
    if (!item.category_id) continue;
    const bucket = itemsByCategory.get(item.category_id) ?? [];
    bucket.push(item);
    itemsByCategory.set(item.category_id, bucket);
  }

  return categories.map((category) => {
    const rawItems = (itemsByCategory.get(category.id) ?? []).slice();
    if (category.dropLowest && rawItems.length > 1) {
      rawItems.sort((a, b) => Number(a.performance_score) - Number(b.performance_score));
      rawItems.shift();
    }
    const totalWeight = rawItems.reduce((sum, item) => sum + Number(item.weight), 0);
    const weighted =
      totalWeight > 0
        ? rawItems.reduce(
            (sum, item) => sum + Number(item.performance_score) * Number(item.weight),
            0
          ) / totalWeight
        : null;

    return {
      categoryId: String(category.id),
      name: category.name,
      weight: Number(category.weight),
      dropLowest: category.dropLowest,
      itemsCount: rawItems.length,
      averageScore: weighted == null ? null : roundScore(weighted),
    };
  });
}

function computeOverallFromCategoryAverages(
  categoryAverages: Array<{ weight: number; averageScore: number | null }>
) {
  const present = categoryAverages.filter((item) => item.averageScore != null && item.weight > 0);
  if (!present.length) return null;
  const totalWeight = present.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return null;
  const weighted = present.reduce(
    (sum, item) => sum + (item.averageScore ?? 0) * item.weight,
    0
  );
  return roundScore(weighted / totalWeight);
}

export async function routes(app: FastifyInstance) {
  app.post("/ocr", async (req, reply) => {
    const file = (await req.file()) as MultipartFile | undefined;
    if (!file) {
      return reply.code(400).send({ error: "Missing image file in multipart form-data field 'file'." });
    }

    if (!file.mimetype.startsWith("image/")) {
      return reply.code(400).send({ error: `Unsupported file type '${file.mimetype}'.` });
    }

    try {
      const worker = await getOcrWorker();
      const bytes = await file.toBuffer();
      const text = worker.recognize(bytes, "eng").trim();

      return {
        fileName: file.filename,
        mimeType: file.mimetype,
        text,
      };
    } catch (error) {
      req.log.error({ err: error }, "OCR failed");
      return reply.code(500).send({
        error: "OCR failed. Ensure OCR_TESSDATA_DIR contains eng.traineddata.",
      });
    }
  });

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

  app.get("/celebrations/state", async () => {
    const settings = await getCelebrationSettings(USER_ID);
    const records = await getCourseCelebrationRecords(USER_ID);
    return {
      settings,
      records,
    };
  });

  app.post("/celebrations/record", async (req, reply) => {
    const body = req.body as {
      courseId?: string;
      score?: number | null;
      type?: CelebrationShowFor | "manual";
    };
    const courseId = body.courseId?.trim();
    if (!courseId) {
      return reply.code(400).send({ error: "Missing courseId." });
    }
    const exists = await prisma.course.findFirst({
      where: { id: courseId, userId: USER_ID },
      select: { id: true },
    });
    if (!exists) {
      return reply.code(404).send({ error: "Course not found." });
    }

    await recordCourseCelebration(USER_ID, {
      courseId,
      score: body.score ?? null,
      type: body.type ?? "manual",
    });
    return { ok: true };
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

  // Terms
  app.get("/terms", async (req) => {
    const query = req.query as { schoolYear?: string };
    const schoolYear = query.schoolYear?.trim();

    const terms = await prisma.$queryRaw<
      Array<{
        id: number;
        user_id: string;
        school_year: string;
        name: string;
        position: number;
        start_date: Date | null;
        end_date: Date | null;
        created_at: Date;
        updated_at: Date;
      }>
    >`
      SELECT id, user_id, school_year, name, position, start_date, end_date, created_at, updated_at
      FROM terms
      WHERE user_id = ${USER_ID}
      ${schoolYear ? Prisma.sql`AND school_year = ${schoolYear}` : Prisma.empty}
      ORDER BY school_year DESC, position ASC, created_at ASC
    `;

    return terms.map((term) => ({
      id: String(term.id),
      userId: term.user_id,
      schoolYear: term.school_year,
      name: term.name,
      position: term.position,
      startDate: toIsoDate(term.start_date),
      endDate: toIsoDate(term.end_date),
      createdAt: term.created_at.toISOString(),
      updatedAt: term.updated_at.toISOString(),
    }));
  });

  app.post("/terms", async (req) => {
    const body = req.body as {
      schoolYear: string;
      name: string;
      position?: number;
      startDate?: string | null;
      endDate?: string | null;
    };
    const schoolYear = body.schoolYear.trim();
    const name = body.name.trim();
    const position = Number.isFinite(body.position) ? Math.max(1, Math.round(body.position ?? 1)) : 1;
    const startDate = body.startDate ? new Date(body.startDate) : null;
    const endDate = body.endDate ? new Date(body.endDate) : null;

    await prisma.$executeRaw`
      INSERT INTO terms (user_id, school_year, name, position, start_date, end_date)
      VALUES (${USER_ID}, ${schoolYear}, ${name}, ${position}, ${startDate}, ${endDate})
    `;

    const row = await prisma.$queryRaw<
      Array<{
        id: number;
        created_at: Date;
        updated_at: Date;
      }>
    >`
      SELECT id, created_at, updated_at
      FROM terms
      WHERE user_id = ${USER_ID}
      ORDER BY id DESC
      LIMIT 1
    `;

    const inserted = row[0];
    if (!inserted) throw new Error("Could not create term");

    return {
      id: String(inserted.id),
      userId: USER_ID,
      schoolYear,
      name,
      position,
      startDate: toIsoDate(startDate),
      endDate: toIsoDate(endDate),
      createdAt: inserted.created_at.toISOString(),
      updatedAt: inserted.updated_at.toISOString(),
    };
  });

  app.put("/terms/:id", async (req) => {
    const params = req.params as { id: string };
    const body = req.body as {
      schoolYear?: string;
      name?: string;
      position?: number;
      startDate?: string | null;
      endDate?: string | null;
    };

    const rows = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id
      FROM terms
      WHERE id = ${Number(params.id)} AND user_id = ${USER_ID}
      LIMIT 1
    `;
    if (rows.length === 0) throw new Error("Term not found");

    const current = await prisma.$queryRaw<
      Array<{
        school_year: string;
        name: string;
        position: number;
        start_date: Date | null;
        end_date: Date | null;
      }>
    >`
      SELECT school_year, name, position, start_date, end_date
      FROM terms
      WHERE id = ${Number(params.id)}
      LIMIT 1
    `;
    const currentRow = current[0];
    if (!currentRow) throw new Error("Term not found");

    const schoolYear = body.schoolYear?.trim() || currentRow.school_year;
    const name = body.name?.trim() || currentRow.name;
    const position = Number.isFinite(body.position) ? Math.max(1, Math.round(body.position as number)) : currentRow.position;
    const startDate = body.startDate === undefined ? currentRow.start_date : body.startDate ? new Date(body.startDate) : null;
    const endDate = body.endDate === undefined ? currentRow.end_date : body.endDate ? new Date(body.endDate) : null;

    await prisma.$executeRaw`
      UPDATE terms
      SET school_year = ${schoolYear},
          name = ${name},
          position = ${position},
          start_date = ${startDate},
          end_date = ${endDate}
      WHERE id = ${Number(params.id)} AND user_id = ${USER_ID}
    `;

    return {
      id: params.id,
      userId: USER_ID,
      schoolYear,
      name,
      position,
      startDate: toIsoDate(startDate),
      endDate: toIsoDate(endDate),
    };
  });

  app.delete("/terms/:id", async (req) => {
    const params = req.params as { id: string };
    const termId = Number(params.id);

    await prisma.$executeRaw`
      DELETE FROM grade_items
      WHERE user_id = ${USER_ID} AND term_id = ${termId}
    `;
    await prisma.$executeRaw`
      DELETE FROM terms
      WHERE user_id = ${USER_ID} AND id = ${termId}
    `;

    return { ok: true };
  });

  app.delete("/terms/:termId/grades", async (req, reply) => {
    const params = req.params as { termId?: string; id?: string };
    const rawTermId = params.termId ?? params.id ?? "";
    const termId = Number.parseInt(String(rawTermId).trim(), 10);
    if (!Number.isFinite(termId)) {
      req.log.warn({ params }, "delete-term-grades invalid termId");
      return reply
        .code(400)
        .send({ error: "Invalid termId.", receivedTermId: rawTermId });
    }

    const termRows = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id
      FROM terms
      WHERE id = ${termId} AND user_id = ${USER_ID}
      LIMIT 1
    `;
    if (!termRows.length) {
      return reply.code(404).send({ error: "Term not found." });
    }

    const deleted = await prisma.$executeRaw`
      DELETE FROM grade_items
      WHERE user_id = ${USER_ID} AND term_id = ${termId}
    `;

    return { deletedCount: Number(deleted) };
  });

  // Grade categories
  app.get("/grade-categories", async (req) => {
    const query = req.query as { courseId?: string };
    const courseId = query.courseId?.trim() || null;

    if (courseId) {
      const existing = await prisma.$queryRaw<Array<{ id: number }>>`
        SELECT id
        FROM grade_categories
        WHERE user_id = ${USER_ID} AND course_id = ${courseId}
        LIMIT 1
      `;
      if (!existing.length) {
        for (const category of DEFAULT_GRADE_CATEGORIES) {
          await prisma.$executeRaw`
            INSERT INTO grade_categories (user_id, course_id, name, weight, drop_lowest)
            VALUES (${USER_ID}, ${courseId}, ${category.name}, ${category.weight}, ${0})
          `;
        }
      }
    }

    const rows = await prisma.$queryRaw<GradeCategoryRow[]>`
      SELECT id, user_id, course_id, name, weight, drop_lowest, created_at, updated_at
      FROM grade_categories
      WHERE user_id = ${USER_ID}
      ${courseId ? Prisma.sql`AND course_id = ${courseId}` : Prisma.empty}
      ORDER BY course_id ASC, name ASC
    `;

    return rows.map((row) => ({
      id: String(row.id),
      userId: row.user_id,
      courseId: row.course_id,
      name: row.name,
      weight: Number(row.weight),
      dropLowest: Boolean(row.drop_lowest),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));
  });

  app.post("/grade-categories", async (req) => {
    const body = req.body as {
      courseId: string;
      name: string;
      weight: number;
      dropLowest?: boolean;
    };
    const courseId = body.courseId?.trim();
    const name = body.name?.trim();
    if (!courseId || !name) throw new Error("Missing category courseId or name");

    await prisma.course.findFirstOrThrow({
      where: { id: courseId, userId: USER_ID },
      select: { id: true },
    });

    const weight = clamp(Number(body.weight), 0, 100);
    const dropLowest = body.dropLowest ? 1 : 0;

    await prisma.$executeRaw`
      INSERT INTO grade_categories (user_id, course_id, name, weight, drop_lowest)
      VALUES (${USER_ID}, ${courseId}, ${name}, ${weight}, ${dropLowest})
    `;

    const row = await prisma.$queryRaw<GradeCategoryRow[]>`
      SELECT id, user_id, course_id, name, weight, drop_lowest, created_at, updated_at
      FROM grade_categories
      WHERE user_id = ${USER_ID}
      ORDER BY id DESC
      LIMIT 1
    `;
    const created = row[0];
    if (!created) throw new Error("Could not create grade category");

    return {
      id: String(created.id),
      userId: created.user_id,
      courseId: created.course_id,
      name: created.name,
      weight: Number(created.weight),
      dropLowest: Boolean(created.drop_lowest),
      createdAt: created.created_at.toISOString(),
      updatedAt: created.updated_at.toISOString(),
    };
  });

  app.put("/grade-categories/:id", async (req) => {
    const params = req.params as { id: string };
    const categoryId = Number(params.id);
    const body = req.body as {
      name?: string;
      weight?: number;
      dropLowest?: boolean;
    };

    const currentRows = await prisma.$queryRaw<GradeCategoryRow[]>`
      SELECT id, user_id, course_id, name, weight, drop_lowest, created_at, updated_at
      FROM grade_categories
      WHERE id = ${categoryId} AND user_id = ${USER_ID}
      LIMIT 1
    `;
    const current = currentRows[0];
    if (!current) throw new Error("Grade category not found");

    const name = body.name?.trim() || current.name;
    const weight = body.weight === undefined ? Number(current.weight) : clamp(Number(body.weight), 0, 100);
    const dropLowest = body.dropLowest === undefined ? Boolean(current.drop_lowest) : Boolean(body.dropLowest);

    await prisma.$executeRaw`
      UPDATE grade_categories
      SET name = ${name},
          weight = ${weight},
          drop_lowest = ${dropLowest ? 1 : 0}
      WHERE id = ${categoryId} AND user_id = ${USER_ID}
    `;

    return {
      id: String(categoryId),
      userId: current.user_id,
      courseId: current.course_id,
      name,
      weight,
      dropLowest,
    };
  });

  app.delete("/grade-categories/:id", async (req) => {
    const params = req.params as { id: string };
    const categoryId = Number(params.id);

    await prisma.$executeRaw`
      UPDATE grade_items
      SET category_id = NULL
      WHERE user_id = ${USER_ID} AND category_id = ${categoryId}
    `;
    await prisma.$executeRaw`
      DELETE FROM grade_categories
      WHERE id = ${categoryId} AND user_id = ${USER_ID}
    `;

    return { ok: true };
  });

  // Grades
  app.get("/grades", async (req) => {
    const query = req.query as { termId?: string; courseId?: string };
    const termId = query.termId ? Number(query.termId) : null;
    const courseId = query.courseId?.trim() || null;

    const rows = await prisma.$queryRaw<
      Array<{
        id: number;
        user_id: string;
        term_id: number;
        course_id: string;
        scale: string;
        grade_value: number;
        performance_score: number;
        weight: number;
        is_final: number;
        final_type: string | null;
        graded_on: Date;
        note: string | null;
        import_metadata: string | null;
        created_at: Date;
        updated_at: Date;
        term_name: string;
        term_school_year: string;
        term_position: number;
        course_name: string;
        category_id: number | null;
        category_name: string | null;
        category_weight: number | null;
        category_drop_lowest: number | null;
      }>
    >`
      SELECT
        g.id,
        g.user_id,
        g.term_id,
        g.course_id,
        g.scale,
        g.grade_value,
        g.performance_score,
        g.weight,
        g.is_final,
        g.final_type,
        g.graded_on,
        g.note,
        g.import_metadata,
        g.created_at,
        g.updated_at,
        t.name AS term_name,
        t.school_year AS term_school_year,
        t.position AS term_position,
        c.name AS course_name,
        gc.id AS category_id,
        gc.name AS category_name,
        gc.weight AS category_weight,
        gc.drop_lowest AS category_drop_lowest
      FROM grade_items g
      INNER JOIN terms t ON t.id = g.term_id
      INNER JOIN \`Course\` c ON BINARY c.id = BINARY g.course_id
      LEFT JOIN grade_categories gc ON gc.id = g.category_id
      WHERE g.user_id = ${USER_ID}
      ${termId ? Prisma.sql`AND g.term_id = ${termId}` : Prisma.empty}
      ${courseId ? Prisma.sql`AND g.course_id = ${courseId}` : Prisma.empty}
      ORDER BY g.graded_on DESC, g.created_at DESC
    `;

    return rows.map((row) => ({
      id: String(row.id),
      userId: row.user_id,
      termId: String(row.term_id),
      courseId: row.course_id,
      scale: normalizeGradeScale(row.scale),
      gradeValue: Number(row.grade_value),
      performanceScore: Number(row.performance_score),
      weight: Number(row.weight),
      isFinal: Boolean(row.is_final),
      finalType: normalizeFinalType(row.final_type),
      gradedOn: toIsoDate(row.graded_on),
      note: row.note,
      importMetadata: parseImportMetadata(row.import_metadata),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      term: {
        id: String(row.term_id),
        schoolYear: row.term_school_year,
        name: row.term_name,
        position: row.term_position,
      },
      course: {
        id: row.course_id,
        name: row.course_name,
      },
      categoryId: row.category_id ? String(row.category_id) : null,
      category: row.category_id
        ? {
            id: String(row.category_id),
            name: row.category_name ?? "Category",
            weight: Number(row.category_weight ?? 0),
            dropLowest: Boolean(row.category_drop_lowest ?? 0),
          }
        : null,
    }));
  });

  app.post("/grades", async (req) => {
    const body = req.body as {
      termId: string;
      courseId: string;
      categoryId?: string | null;
      scale: GradeScale;
      gradeValue: number;
      weight?: number;
      gradedOn: string;
      note?: string;
      isFinal?: boolean;
      finalType?: "TERM1" | "TERM2" | "YEAR" | null;
      importMetadata?: Record<string, unknown> | null;
    };

    const termId = Number(body.termId);
    const scale = normalizeGradeScale(body.scale);
    const gradeValue = Number(body.gradeValue);
    const weight = Math.max(0.05, Number(body.weight ?? 1));
    const gradedOn = new Date(body.gradedOn);
    const performanceScore = toPerformanceScore(scale, gradeValue);
    const categoryId = body.categoryId ? Number(body.categoryId) : null;
    const isFinal = Boolean(body.isFinal);
    const finalType = isFinal ? normalizeFinalType(body.finalType) : null;
    const importMetadata =
      body.importMetadata && typeof body.importMetadata === "object"
        ? JSON.stringify(body.importMetadata)
        : null;

    await prisma.$queryRaw`
      SELECT id
      FROM terms
      WHERE id = ${termId} AND user_id = ${USER_ID}
      LIMIT 1
    `;
    if (categoryId) {
      const categoryRows = await prisma.$queryRaw<Array<{ id: number }>>`
        SELECT id
        FROM grade_categories
        WHERE id = ${categoryId} AND user_id = ${USER_ID} AND course_id = ${body.courseId}
        LIMIT 1
      `;
      if (!categoryRows.length) throw new Error("Invalid grade category");
    }

    await prisma.$executeRaw`
      INSERT INTO grade_items (user_id, term_id, course_id, category_id, scale, grade_value, performance_score, weight, is_final, final_type, graded_on, note, import_metadata)
      VALUES (${USER_ID}, ${termId}, ${body.courseId}, ${categoryId}, ${scale}, ${gradeValue}, ${performanceScore}, ${weight}, ${isFinal}, ${finalType}, ${gradedOn}, ${
      body.note?.trim() || null
    }, ${importMetadata})
    `;

    const row = await prisma.$queryRaw<
      Array<{
        id: number;
        created_at: Date;
        updated_at: Date;
      }>
    >`
      SELECT id, created_at, updated_at
      FROM grade_items
      WHERE user_id = ${USER_ID}
      ORDER BY id DESC
      LIMIT 1
    `;

    const inserted = row[0];
    if (!inserted) throw new Error("Could not create grade");

    return {
      id: String(inserted.id),
      userId: USER_ID,
      termId: String(termId),
      courseId: body.courseId,
      categoryId: categoryId ? String(categoryId) : null,
      scale,
      gradeValue,
      performanceScore: roundScore(performanceScore),
      weight,
      isFinal,
      finalType,
      gradedOn: toIsoDate(gradedOn),
      note: body.note?.trim() || null,
      importMetadata: parseImportMetadata(importMetadata),
      createdAt: inserted.created_at.toISOString(),
      updatedAt: inserted.updated_at.toISOString(),
    };
  });

  app.post("/grades/bulk", async (req) => {
    const body = req.body as {
      termId: string;
      scale: GradeScale;
      gradedOn?: string;
      items: Array<{
        courseId: string;
        categoryId?: string | null;
        gradeValue: number;
        weight?: number;
        note?: string;
        isFinal?: boolean;
        finalType?: "TERM1" | "TERM2" | "YEAR" | null;
        importMetadata?: Record<string, unknown> | null;
      }>;
    };

    const termId = Number(body.termId);
    if (!Number.isFinite(termId)) {
      return { count: 0, items: [] };
    }

    const scale = normalizeGradeScale(body.scale);
    const gradedOn = body.gradedOn ? new Date(body.gradedOn) : new Date();
    const payload = Array.isArray(body.items) ? body.items : [];
    if (!payload.length) return { count: 0, items: [] };

    await prisma.$queryRaw`
      SELECT id
      FROM terms
      WHERE id = ${termId} AND user_id = ${USER_ID}
      LIMIT 1
    `;

    const insertedIds: string[] = [];
    for (const item of payload) {
      const gradeValue = Number(item.gradeValue);
      const weight = Math.max(0.05, Number(item.weight ?? 1));
      const performanceScore = toPerformanceScore(scale, gradeValue);
      const categoryId = item.categoryId ? Number(item.categoryId) : null;
      const isFinal = Boolean(item.isFinal);
      const finalType = isFinal ? normalizeFinalType(item.finalType) : null;
      const importMetadata =
        item.importMetadata && typeof item.importMetadata === "object"
          ? JSON.stringify(item.importMetadata)
          : null;
      if (categoryId) {
        const categoryRows = await prisma.$queryRaw<Array<{ id: number }>>`
          SELECT id
          FROM grade_categories
          WHERE id = ${categoryId} AND user_id = ${USER_ID} AND course_id = ${item.courseId}
          LIMIT 1
        `;
        if (!categoryRows.length) throw new Error("Invalid grade category");
      }
      await prisma.$executeRaw`
        INSERT INTO grade_items (user_id, term_id, course_id, category_id, scale, grade_value, performance_score, weight, is_final, final_type, graded_on, note, import_metadata)
        VALUES (${USER_ID}, ${termId}, ${item.courseId}, ${categoryId}, ${scale}, ${gradeValue}, ${performanceScore}, ${weight}, ${isFinal}, ${finalType}, ${gradedOn}, ${
        item.note?.trim() || null
      }, ${importMetadata})
      `;
      const row = await prisma.$queryRaw<Array<{ id: number }>>`
        SELECT id
        FROM grade_items
        WHERE user_id = ${USER_ID}
        ORDER BY id DESC
        LIMIT 1
      `;
      const last = row[0];
      if (last) insertedIds.push(String(last.id));
    }

    return {
      count: insertedIds.length,
      itemIds: insertedIds,
    };
  });

  app.post("/grades/import-shkolo-pdf", async (req, reply) => {
    const query = req.query as { debug?: string };
    const debugEnabled = query.debug === "1";
    const scannedThreshold = 300;
    const file = (await req.file()) as MultipartFile | undefined;
    if (!file) {
      return reply
        .code(400)
        .send({ error: "Missing PDF file in multipart form-data field 'file'." });
    }

    const isPdfMime =
      file.mimetype === "application/pdf" ||
      file.mimetype === "application/x-pdf";
    const isPdfName = /\.pdf$/i.test(file.filename || "");
    if (!isPdfMime && !isPdfName) {
      return reply
        .code(400)
        .send({ error: `Unsupported file type '${file.mimetype}'. Expected PDF.` });
    }

    try {
      const bytes = await file.toBuffer();
      req.log.info(
        {
          mimeType: file.mimetype,
          fileName: file.filename,
          fileSize: bytes.length,
        },
        "Shkolo PDF upload metadata",
      );

      const extracted = await extractShkoloPdfPages(bytes, { debugEnabled });
      const pages = extracted.pages;
      const pageItemsByPage = extracted.pageItemsByPage ?? {};
      const extractedPageTextLengths = pages.map((page) => ({
        page: page.page,
        length: page.text.length,
      }));
      for (const page of pages) {
        req.log.info(
          { page: page.page, textLength: page.text.length },
          "Shkolo PDF extracted page text",
        );
      }

      const totalExtractedLength = pages.reduce(
        (sum, page) => sum + page.text.length,
        0,
      );

      let usedOcrFallback = false;
      let pagesForParsing = pages;
      let ocrPageTextLengths: Array<{ page: number; general: number; digits: number; total: number }> = [];

      if (totalExtractedLength < scannedThreshold) {
        usedOcrFallback = true;
        req.log.info(
          {
            totalExtractedLength,
            threshold: scannedThreshold,
          },
          "Shkolo PDF detected as scanned. Using OCR fallback.",
        );

        const renderedPages = await renderPdfPagesToPng(bytes);
        const ocrWorker = await getShkoloPdfOcrWorker();
        const ocrPages: Array<{ page: number; text: string }> = [];

        for (const rendered of renderedPages) {
          await ocrWorker.setParameters({ tessedit_char_whitelist: "" });
          const generalResult = await ocrWorker.recognize(rendered.image);
          const generalText = generalResult?.data?.text ?? "";

          await ocrWorker.setParameters({
            tessedit_char_whitelist: "0123456789.,",
          });
          const digitsResult = await ocrWorker.recognize(rendered.image);
          const digitsText = digitsResult?.data?.text ?? "";

          const combinedText = `${generalText}\n${digitsText}`.trim();
          ocrPages.push({ page: rendered.page, text: combinedText });

          ocrPageTextLengths.push({
            page: rendered.page,
            general: generalText.length,
            digits: digitsText.length,
            total: combinedText.length,
          });
          req.log.info(
            {
              page: rendered.page,
              generalTextLength: generalText.length,
              digitsTextLength: digitsText.length,
              combinedTextLength: combinedText.length,
            },
            "Shkolo PDF OCR fallback text lengths",
          );
        }

        pagesForParsing = ocrPages;
      }

      const parsed = parseShkoloPages(
        pagesForParsing,
        usedOcrFallback ? {} : { pageItemsByPage },
      );
      const ignoredShkoloSubjects = await getIgnoredShkoloSubjects(USER_ID);
      const ignoredSet = new Set(
        ignoredShkoloSubjects.map((value) =>
          value.trim().replace(/\s+/g, " ").toLocaleLowerCase("bg")
        )
      );
      const filteredRows = parsed.rows.filter((row) => {
        const key = row.extractedSubject
          .trim()
          .replace(/\s+/g, " ")
          .toLocaleLowerCase("bg");
        return !ignoredSet.has(key);
      });
      const diaryParsed = debugEnabled
        ? parseShkoloDiaryText(pagesForParsing.map((page) => page.text))
        : null;

      const rawSamples = debugEnabled
        ? pagesForParsing.map((page) => page.text.slice(0, 500))
        : undefined;
      const pagesText = debugEnabled ? pagesForParsing.map((page) => ({ page: page.page, text: page.text })) : undefined;

      return {
        fileName: file.filename,
        detectedYear: parsed.detectedYear,
        rows: filteredRows,
        skippedLines: parsed.skippedLines,
        parseWarnings: parsed.parseWarnings ?? [],
        debug: rawSamples
          ? {
              rawSamples,
              usedOcrFallback,
              scannedThreshold,
              totalExtractedLength,
              extractedPageTextLengths,
              ocrPageTextLengths,
              pagesText,
              pageItems: pageItemsByPage,
              subjectBlocks:
                diaryParsed?.rows.map((row) => ({
                  index: row.index,
                  extractedSubject: row.extractedSubject,
                  tokensCount: row.tokens.length,
                  chosenFinals: {
                    term1Final: row.term1Final,
                    term2Final: row.term2Final,
                    yearFinal: row.yearFinal,
                    confidence: row.confidence,
                  },
                  last15Tokens: row.last15Tokens,
                  rawBlockSample: row.rawBlockSample,
                })) ?? [],
              ignoredShkoloSubjects,
              filteredOutCount: parsed.rows.length - filteredRows.length,
            }
          : undefined,
      };
    } catch (error) {
      req.log.error({ err: error }, "Shkolo PDF parsing failed");
      return reply.code(500).send({
        error:
          "Could not parse Shkolo PDF. Make sure this is a text-based PDF export from Shkolo Дневник.",
      });
    }
  });

  app.post("/grades/import-photo", async (req) => {
    const body = req.body as {
      imageDataUrl?: string;
      fileName?: string;
      scale?: GradeScale;
      termId?: string;
    };

    // TODO(OCR): Replace mock extraction with real OCR pipeline.
    // Suggested integration points:
    // 1) Upload image bytes to OCR provider/service.
    // 2) Parse recognized text into { courseName, gradeValue } candidates.
    // 3) Return confidence + source spans for UI highlighting.
    if (!body.imageDataUrl) {
      return { items: [] };
    }

    const mockItems = [
      { courseName: "Math", gradeValue: 5.25, confidence: 0.94 },
      { courseName: "German", gradeValue: 4.5, confidence: 0.89 },
      { courseName: "English", gradeValue: 5.75, confidence: 0.92 },
    ];

    return {
      source: "mock",
      fileName: body.fileName ?? "upload",
      items: mockItems,
    };
  });

  app.put("/grades/:id", async (req) => {
    const params = req.params as { id: string };
    const gradeId = Number(params.id);
    const body = req.body as {
      termId?: string;
      courseId?: string;
      categoryId?: string | null;
      scale?: GradeScale;
      gradeValue?: number;
      weight?: number;
      gradedOn?: string;
      note?: string | null;
      isFinal?: boolean;
      finalType?: "TERM1" | "TERM2" | "YEAR" | null;
      importMetadata?: Record<string, unknown> | null;
    };

    const currentRows = await prisma.$queryRaw<
      Array<{
        id: number;
        term_id: number;
        course_id: string;
        category_id: number | null;
        scale: string;
        grade_value: number;
        performance_score: number;
        weight: number;
        is_final: number;
        final_type: string | null;
        graded_on: Date;
        note: string | null;
        import_metadata: string | null;
      }>
    >`
      SELECT id, term_id, course_id, category_id, scale, grade_value, performance_score, weight, is_final, final_type, graded_on, note, import_metadata
      FROM grade_items
      WHERE id = ${gradeId} AND user_id = ${USER_ID}
      LIMIT 1
    `;
    const current = currentRows[0];
    if (!current) throw new Error("Grade item not found");

    const scale = body.scale ? normalizeGradeScale(body.scale) : normalizeGradeScale(current.scale);
    const gradeValue = body.gradeValue === undefined ? Number(current.grade_value) : Number(body.gradeValue);
    const termId = body.termId ? Number(body.termId) : Number(current.term_id);
    const courseId = body.courseId ?? current.course_id;
    const categoryId =
      body.categoryId === undefined ? current.category_id : body.categoryId ? Number(body.categoryId) : null;
    const weight = body.weight === undefined ? Number(current.weight) : Math.max(0.05, Number(body.weight));
    const gradedOn = body.gradedOn ? new Date(body.gradedOn) : new Date(current.graded_on);
    const note = body.note === undefined ? current.note : body.note?.trim() || null;
    const importMetadata =
      body.importMetadata === undefined
        ? parseImportMetadata(current.import_metadata)
        : body.importMetadata && typeof body.importMetadata === "object"
          ? body.importMetadata
          : null;
    const importMetadataJson =
      importMetadata && typeof importMetadata === "object"
        ? JSON.stringify(importMetadata)
        : null;
    const isFinal =
      body.isFinal === undefined ? Boolean(current.is_final) : Boolean(body.isFinal);
    const finalType =
      body.isFinal === undefined
        ? normalizeFinalType(current.final_type)
        : isFinal
          ? normalizeFinalType(body.finalType)
          : null;
    const performanceScore = toPerformanceScore(scale, gradeValue);
    if (categoryId) {
      const categoryRows = await prisma.$queryRaw<Array<{ id: number }>>`
        SELECT id
        FROM grade_categories
        WHERE id = ${categoryId} AND user_id = ${USER_ID} AND course_id = ${courseId}
        LIMIT 1
      `;
      if (!categoryRows.length) throw new Error("Invalid grade category");
    }

    await prisma.$executeRaw`
      UPDATE grade_items
      SET term_id = ${termId},
          course_id = ${courseId},
          category_id = ${categoryId},
          scale = ${scale},
          grade_value = ${gradeValue},
          performance_score = ${performanceScore},
          weight = ${weight},
          is_final = ${isFinal},
          final_type = ${finalType},
          graded_on = ${gradedOn},
          note = ${note},
          import_metadata = ${importMetadataJson}
      WHERE id = ${gradeId} AND user_id = ${USER_ID}
    `;

    return {
      id: String(gradeId),
      userId: USER_ID,
      termId: String(termId),
      courseId,
      categoryId: categoryId ? String(categoryId) : null,
      scale,
      gradeValue,
      performanceScore: roundScore(performanceScore),
      weight,
      isFinal,
      finalType,
      gradedOn: toIsoDate(gradedOn),
      note,
      importMetadata,
    };
  });

  app.delete("/grades/:id", async (req) => {
    const params = req.params as { id: string };
    const gradeId = Number(params.id);
    await prisma.$executeRaw`
      DELETE FROM grade_items
      WHERE id = ${gradeId} AND user_id = ${USER_ID}
    `;
    return { ok: true };
  });

  app.post("/grades/what-if", async (req) => {
    const body = req.body as {
      termId: string;
      courseId: string;
      categoryId: string;
      scale: GradeScale;
      gradeValue: number;
      weight?: number;
    };

    const termId = Number(body.termId);
    const categoryId = Number(body.categoryId);
    const hypotheticalWeight = Math.max(0.05, Number(body.weight ?? 1));
    const hypotheticalScore = toPerformanceScore(normalizeGradeScale(body.scale), Number(body.gradeValue));

    if (!Number.isFinite(termId) || !body.courseId || !Number.isFinite(categoryId)) {
      return {
        currentAverage: null,
        resultingAverage: null,
        delta: null,
        categoryAverages: [],
      };
    }

    const categoryRows = await prisma.$queryRaw<
      Array<{ id: number; name: string; weight: number; drop_lowest: number }>
    >`
      SELECT id, name, weight, drop_lowest
      FROM grade_categories
      WHERE user_id = ${USER_ID} AND course_id = ${body.courseId}
      ORDER BY name ASC
    `;
    if (!categoryRows.length) {
      return {
        currentAverage: null,
        resultingAverage: null,
        delta: null,
        categoryAverages: [],
      };
    }

    const categories = categoryRows.map((row) => ({
      id: row.id,
      name: row.name,
      weight: Number(row.weight),
      dropLowest: Boolean(row.drop_lowest),
    }));

    const baseItems = await prisma.$queryRaw<GradeItemScoreRow[]>`
      SELECT id, category_id, performance_score, weight
      FROM grade_items
      WHERE user_id = ${USER_ID}
        AND term_id = ${termId}
        AND course_id = ${body.courseId}
    `;

    const currentCategoryAverages = computeCategoryAverages(categories, baseItems);
    const currentAverage = computeOverallFromCategoryAverages(currentCategoryAverages);

    const augmentedItems = [
      ...baseItems,
      {
        id: -1,
        category_id: categoryId,
        performance_score: hypotheticalScore,
        weight: hypotheticalWeight,
      },
    ];

    const resultingCategoryAverages = computeCategoryAverages(categories, augmentedItems);
    const resultingAverage = computeOverallFromCategoryAverages(resultingCategoryAverages);

    const categoriesWithResult = categories.map((category, index) => ({
      categoryId: String(category.id),
      name: category.name,
      weight: category.weight,
      dropLowest: category.dropLowest,
      currentAverage: currentCategoryAverages[index]?.averageScore ?? null,
      resultingAverage: resultingCategoryAverages[index]?.averageScore ?? null,
    }));

    return {
      currentAverage,
      resultingAverage,
      delta:
        currentAverage == null || resultingAverage == null
          ? null
          : roundScore(resultingAverage - currentAverage),
      categoryAverages: categoriesWithResult,
    };
  });

  app.get("/grades/targets", async () => {
    const rows = await prisma.$queryRaw<
      Array<{
        id: number;
        user_id: string;
        course_id: string;
        target_score: number;
        scale: string;
        target_value: number;
        created_at: Date;
        updated_at: Date;
        course_name: string;
      }>
    >`
      SELECT
        t.id,
        t.user_id,
        t.course_id,
        t.target_score,
        t.scale,
        t.target_value,
        t.created_at,
        t.updated_at,
        c.name AS course_name
      FROM course_grade_targets t
      INNER JOIN \`Course\` c ON BINARY c.id = BINARY t.course_id
      WHERE t.user_id = ${USER_ID}
      ORDER BY c.name ASC
    `;

    return rows.map((row) => ({
      id: String(row.id),
      userId: row.user_id,
      courseId: row.course_id,
      courseName: row.course_name,
      targetScore: Number(row.target_score),
      scale: normalizeGradeScale(row.scale),
      targetValue: Number(row.target_value),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));
  });

  app.put("/grades/targets/:courseId", async (req) => {
    const params = req.params as { courseId: string };
    const body = req.body as { scale: GradeScale; targetValue: number };
    const scale = normalizeGradeScale(body.scale);
    const targetValue = Number(body.targetValue);
    const targetScore = toPerformanceScore(scale, targetValue);

    await prisma.$executeRaw`
      INSERT INTO course_grade_targets (user_id, course_id, target_score, scale, target_value)
      VALUES (${USER_ID}, ${params.courseId}, ${targetScore}, ${scale}, ${targetValue})
      ON DUPLICATE KEY UPDATE
        target_score = VALUES(target_score),
        scale = VALUES(scale),
        target_value = VALUES(target_value)
    `;

    return {
      userId: USER_ID,
      courseId: params.courseId,
      scale,
      targetValue,
      targetScore: roundScore(targetScore),
    };
  });

  app.get("/recommendations/study-plan", async (req) => {
    const query = req.query as {
      termId?: string;
      from?: string;
      to?: string;
      displayScale?: string;
      includeTermGrade?: string;
    };
    const termId = Number(query.termId);
    if (!Number.isFinite(termId)) return [];

    const displayScale = normalizeGradeScale(query.displayScale);
    const includeTermGrade = query.includeTermGrade === "1" || query.includeTermGrade === "true";
    const toDate = query.to ? new Date(query.to) : new Date();
    const fromDate = query.from
      ? new Date(query.from)
      : new Date(toDate.getTime() - 14 * 24 * 60 * 60 * 1000);
    const upcomingEnd = new Date(toDate.getTime() + 14 * 24 * 60 * 60 * 1000);

    const gradeRows = await prisma.$queryRaw<
      Array<{
        course_id: string;
        scale: string;
        grade_value: number;
        performance_score: number;
        weight: number;
        category_name: string | null;
      }>
    >`
      SELECT g.course_id, g.scale, g.grade_value, g.performance_score, g.weight, gc.name AS category_name
      FROM grade_items g
      LEFT JOIN grade_categories gc ON gc.id = g.category_id
      WHERE g.user_id = ${USER_ID} AND g.term_id = ${termId}
    `;

    const trendRows = await prisma.$queryRaw<
      Array<{
        course_id: string;
        graded_on: Date;
        performance_score: number;
      }>
    >`
      SELECT course_id, graded_on, performance_score
      FROM grade_items
      WHERE user_id = ${USER_ID} AND term_id = ${termId}
      ORDER BY graded_on DESC, id DESC
    `;

    const studyRows = await prisma.$queryRaw<
      Array<{
        course_id: string;
        total_minutes: number;
      }>
    >`
      SELECT s.\`courseId\` AS course_id, SUM(s.\`durationMinutes\`) AS total_minutes
      FROM \`StudySession\` s
      WHERE s.\`userId\` = ${USER_ID} AND s.\`startTime\` >= ${fromDate} AND s.\`startTime\` < ${toDate}
      GROUP BY s.\`courseId\`
    `;

    const targetRows = await prisma.$queryRaw<
      Array<{
        course_id: string;
        target_score: number;
      }>
    >`
      SELECT course_id, target_score
      FROM course_grade_targets
      WHERE user_id = ${USER_ID}
    `;

    const deadlineRows = await prisma.$queryRaw<
      Array<{ course_id: string; deadlines_count: number; exams_count: number }>
    >`
      SELECT
        course_id,
        COUNT(*) AS deadlines_count,
        SUM(CASE WHEN kind = 'exam' THEN 1 ELSE 0 END) AS exams_count
      FROM tasks
      WHERE user_id = ${USER_ID}
        AND status <> 'done'
        AND due_at IS NOT NULL
        AND due_at >= ${toDate}
        AND due_at < ${upcomingEnd}
        AND course_id IS NOT NULL
      GROUP BY course_id
    `;

    const courses = await prisma.course.findMany({
      where: { userId: USER_ID },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });

    const gradeItemsByCourse = new Map<string, GradeAverageInputItem[]>();
    for (const row of gradeRows) {
      const list = gradeItemsByCourse.get(row.course_id) ?? [];
      list.push({
        scale: normalizeGradeScale(row.scale),
        gradeValue: Number(row.grade_value),
        performanceScore: Number(row.performance_score),
        weight: Number(row.weight),
        categoryName: row.category_name,
      });
      gradeItemsByCourse.set(row.course_id, list);
    }
    const minutesByCourse = new Map(
      studyRows.map((row) => [row.course_id, Number(row.total_minutes ?? 0)])
    );
    const targetByCourse = new Map(
      targetRows.map((row) => [row.course_id, Number(row.target_score)])
    );
    const deadlinesByCourse = new Map(
      deadlineRows.map((row) => [
        row.course_id,
        { deadlines: Number(row.deadlines_count ?? 0), exams: Number(row.exams_count ?? 0) },
      ])
    );

    const trendByCourse = new Map<string, number>();
    const groupedTrend = new Map<string, number[]>();
    for (const row of trendRows) {
      const list = groupedTrend.get(row.course_id) ?? [];
      if (list.length < 5) list.push(Number(row.performance_score));
      groupedTrend.set(row.course_id, list);
    }
    groupedTrend.forEach((scores, courseId) => {
      if (scores.length < 2) {
        trendByCourse.set(courseId, 0);
        return;
      }
      const newest = scores[0] ?? 0;
      const oldest = scores[scores.length - 1] ?? 0;
      trendByCourse.set(courseId, newest - oldest);
    });

    const formatScaleValue = (value: number) =>
      displayScale === "percentage" ? roundScore(value).toFixed(1) : roundScore(value).toFixed(2);
    const defaultTargetValue =
      displayScale === "bulgarian"
        ? 4.5
        : displayScale === "percentage"
          ? 75
          : fromPerformanceScore(displayScale, 75);

    const result = courses.map((course) => {
      const average = computeCourseAverage(gradeItemsByCourse.get(course.id) ?? [], {
        displayScale,
        includeTermGrade,
      });
      const gradeAverage = average.averageValue;
      const normalizedAverage = average.normalizedScore;
      const gradeBand = getGradeBand(displayScale, gradeAverage);
      const trend = trendByCourse.get(course.id) ?? 0;
      const studyMinutes = minutesByCourse.get(course.id) ?? 0;
      const targetScore = targetByCourse.get(course.id) ?? null;
      const targetValue = targetScore == null ? defaultTargetValue : fromPerformanceScore(displayScale, targetScore);
      const upcoming = deadlinesByCourse.get(course.id) ?? { deadlines: 0, exams: 0 };

      let attention = 0;
      const reasons: string[] = [];

      if (gradeAverage == null) {
        attention += 40;
        reasons.push("No grades recorded in this term yet.");
      } else {
        if (gradeBand === "atRisk") attention += 42;
        else if (gradeBand === "watch") attention += 22;
        else if (gradeBand === "good") attention += 6;

        if (gradeBand === "atRisk" || gradeBand === "watch") {
          reasons.push(`Avg ${formatScaleValue(gradeAverage)} below target ${formatScaleValue(targetValue)}.`);
        }
      }

      if (trend < -3) {
        attention += clamp(Math.abs(trend) * 1.35, 0, 24);
        reasons.push("Grade trend is declining.");
      }

      const courseImportance =
        1 +
        upcoming.exams * 0.7 +
        upcoming.deadlines * 0.25 +
        (gradeBand === "atRisk" ? 0.5 : gradeBand === "watch" ? 0.25 : 0);
      const expectedStudyMinutes = clamp(Math.round(80 * courseImportance), 60, 240);
      if (studyMinutes < expectedStudyMinutes) {
        const shortfall = expectedStudyMinutes - studyMinutes;
        attention += clamp((shortfall / expectedStudyMinutes) * 28, 0, 28);
        reasons.push(
          `Study time is low (${Math.round(studyMinutes)} min vs expected ${expectedStudyMinutes} min).`
        );
      }

      if (upcoming.exams > 0 || upcoming.deadlines > 0) {
        attention += clamp(upcoming.exams * 10 + upcoming.deadlines * 4, 0, 24);
        reasons.push(
          `${upcoming.exams} upcoming exam${upcoming.exams === 1 ? "" : "s"} and ${upcoming.deadlines} upcoming task${upcoming.deadlines === 1 ? "" : "s"}.`
        );
      }

      const isExcellentStable = shouldSuppressAttentionForExcellent(gradeBand, trend);
      if (isExcellentStable) {
        attention = 0;
        reasons.splice(0, reasons.length, "Excellent performance with stable or improving trend.");
      }

      const attentionScore = clamp(Math.round(attention), 0, 100);
      const recommendedMinutes = isExcellentStable
        ? 0
        : clamp(Math.round((45 + attentionScore * 1.35) / 15) * 15, 30, 240);

      return {
        courseId: course.id,
        courseName: course.name,
        displayScale,
        gradeBand,
        averageValue: gradeAverage == null ? null : roundScore(gradeAverage),
        averageNormalized: normalizedAverage == null ? null : roundScore(normalizedAverage),
        attentionScore,
        recommendedMinutes,
        reasons: reasons.length ? reasons : ["Maintain current progress with steady study cadence."],
      };
    });

    return result.sort((a, b) => b.attentionScore - a.attentionScore);
  });

  app.get("/analytics/academic-risk", async (req) => {
    const query = req.query as {
      termId?: string;
      from?: string;
      to?: string;
      displayScale?: string;
      includeTermGrade?: string;
    };
    const displayScale = normalizeGradeScale(query.displayScale);
    let termId = query.termId ? Number(query.termId) : NaN;
    const riskSettings = await getGradeRiskSettings(USER_ID);

    if (!riskSettings.riskEnabled) return [];

    if (!Number.isFinite(termId)) {
      const fallbackTerm = await prisma.$queryRaw<Array<{ id: number }>>`
        SELECT id
        FROM terms
        WHERE user_id = ${USER_ID}
        ORDER BY school_year DESC, position DESC, id DESC
        LIMIT 1
      `;
      termId = fallbackTerm[0]?.id ?? NaN;
    }
    if (!Number.isFinite(termId)) return [];

    const termRows = await prisma.$queryRaw<
      Array<{ id: number; school_year: string; position: number }>
    >`
      SELECT id, school_year, position
      FROM terms
      WHERE id = ${termId} AND user_id = ${USER_ID}
      LIMIT 1
    `;
    const currentTerm = termRows[0];
    if (!currentTerm) return [];

    const termsInYear = await prisma.$queryRaw<
      Array<{ id: number; school_year: string; position: number }>
    >`
      SELECT id, school_year, position
      FROM terms
      WHERE user_id = ${USER_ID} AND school_year = ${currentTerm.school_year}
      ORDER BY position ASC, id ASC
    `;
    const resolvedLookback = resolveRiskLookbackTerms(
      termsInYear.map((item) => ({
        id: item.id,
        schoolYear: item.school_year,
        position: item.position,
      })),
      currentTerm.id,
      riskSettings.riskLookback,
    );
    const lookbackReferenceTermId = resolvedLookback.referenceTermId;
    const trendPreviousTermId = resolvedLookback.previousForTrendTermId;
    const evaluationTermIds = resolvedLookback.evaluationTermIds;
    if (!evaluationTermIds.length) return [];

    const toDate = query.to ? new Date(query.to) : new Date();
    const fromDate = query.from
      ? new Date(query.from)
      : new Date(toDate.getTime() - 14 * 24 * 60 * 60 * 1000);
    const upcomingEnd = new Date(toDate.getTime() + 14 * 24 * 60 * 60 * 1000);

    const courses = await prisma.course.findMany({
      where: { userId: USER_ID },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    if (!courses.length) return [];

    const evaluationRows = await prisma.$queryRaw<
      Array<{
        term_id: number;
        course_id: string;
        scale: string;
        grade_value: number;
        performance_score: number;
        weight: number;
        category_name: string | null;
        is_final: number;
        final_type: string | null;
      }>
    >`
      SELECT g.term_id, g.course_id, g.scale, g.grade_value, g.performance_score, g.weight, gc.name AS category_name, g.is_final, g.final_type
      FROM grade_items g
      LEFT JOIN grade_categories gc ON gc.id = g.category_id
      WHERE g.user_id = ${USER_ID} AND g.term_id IN (${Prisma.join(evaluationTermIds)})
    `;

    const trendCurrentRows = await prisma.$queryRaw<
      Array<{ course_id: string; performance_score: number; weight: number }>
    >`
      SELECT course_id, performance_score, weight
      FROM grade_items
      WHERE user_id = ${USER_ID} AND term_id = ${lookbackReferenceTermId}
    `;
    const trendPreviousRows = trendPreviousTermId
      ? await prisma.$queryRaw<
          Array<{ course_id: string; performance_score: number; weight: number }>
        >`
          SELECT course_id, performance_score, weight
          FROM grade_items
          WHERE user_id = ${USER_ID} AND term_id = ${trendPreviousTermId}
        `
      : [];

    let studyRows: Array<{ course_id: string; total_minutes: number | null }> = [];
    try {
      studyRows = await prisma.$queryRaw<
        Array<{ course_id: string; total_minutes: number | null }>
      >`
        SELECT s.\`courseId\` AS course_id, SUM(s.\`durationMinutes\`) AS total_minutes
        FROM \`StudySession\` s
        WHERE s.\`userId\` = ${USER_ID}
          AND s.\`startTime\` >= ${fromDate}
          AND s.\`startTime\` < ${toDate}
        GROUP BY s.\`courseId\`
      `;
    } catch (error) {
      req.log.warn({ err: error }, "academic-risk: failed to load study rows");
    }

    let deadlineRows: Array<{ course_id: string; deadlines_count: number; exams_count: number }> = [];
    try {
      deadlineRows = await prisma.$queryRaw<
        Array<{ course_id: string; deadlines_count: number; exams_count: number }>
      >`
        SELECT
          course_id,
          COUNT(*) AS deadlines_count,
          SUM(CASE WHEN kind = 'exam' THEN 1 ELSE 0 END) AS exams_count
        FROM tasks
        WHERE user_id = ${USER_ID}
          AND status <> 'done'
          AND due_at IS NOT NULL
          AND due_at >= ${toDate}
          AND due_at < ${upcomingEnd}
          AND course_id IS NOT NULL
        GROUP BY course_id
      `;
    } catch (error) {
      req.log.warn({ err: error }, "academic-risk: failed to load deadlines rows");
    }

    const weightedAverageScore = (
      rows: Array<{ performance_score: number; weight: number }>
    ) => {
      if (!rows.length) return null;
      let weighted = 0;
      let totalWeight = 0;
      for (const row of rows) {
        const weight = Math.max(0.05, Number(row.weight ?? 1));
        weighted += Number(row.performance_score) * weight;
        totalWeight += weight;
      }
      if (totalWeight <= 0) return null;
      return weighted / totalWeight;
    };

    type EvalRow = (typeof evaluationRows)[number];

    const rowsByCourse = new Map<string, EvalRow[]>();
    for (const row of evaluationRows) {
      const list = rowsByCourse.get(row.course_id) ?? [];
      list.push(row);
      rowsByCourse.set(row.course_id, list);
    }
    const trendCurrentByCourse = new Map<string, Array<{ performance_score: number; weight: number }>>();
    for (const row of trendCurrentRows) {
      const list = trendCurrentByCourse.get(row.course_id) ?? [];
      list.push(row);
      trendCurrentByCourse.set(row.course_id, list);
    }
    const trendPreviousByCourse = new Map<string, Array<{ performance_score: number; weight: number }>>();
    for (const row of trendPreviousRows) {
      const list = trendPreviousByCourse.get(row.course_id) ?? [];
      list.push(row);
      trendPreviousByCourse.set(row.course_id, list);
    }
    const studyByCourse = new Map(
      studyRows.map((row) => [row.course_id, Number(row.total_minutes ?? 0)])
    );
    const deadlinesByCourse = new Map(
      deadlineRows.map((row) => [
        row.course_id,
        { deadlines: Number(row.deadlines_count ?? 0), exams: Number(row.exams_count ?? 0) },
      ])
    );

    const totalStudy = courses.reduce((sum, course) => sum + (studyByCourse.get(course.id) ?? 0), 0);
    const averageStudy = totalStudy / Math.max(1, courses.length);
    const formatScaleValue = (value: number) =>
      displayScale === "percentage"
        ? roundScore(value).toFixed(1)
        : roundScore(value).toFixed(2);
    const thresholdLabel =
      riskSettings.riskThresholdMode === "score"
        ? `${roundScore(riskSettings.riskScoreThreshold).toFixed(1)} score`
        : `${formatScaleValue(riskSettings.riskGradeThresholdByScale[displayScale])}`;

    const result = courses.map((course) => {
      const courseRows = (rowsByCourse.get(course.id) ?? []).map((row) => ({
        ...row,
        finalType: row.final_type,
        isFinal: row.is_final,
        categoryName: row.category_name,
      }));
      const selected = selectRiskEvaluationItems(
        courseRows,
        riskSettings.riskLookback,
        riskSettings.riskUseTermFinalIfAvailable,
      );
      const selectedRows = selected.items as Array<EvalRow>;
      const performanceScore = weightedAverageScore(
        selectedRows.map((row) => ({
          performance_score: Number(row.performance_score),
          weight: Number(row.weight ?? 1),
        }))
      );
      const performanceGrade =
        performanceScore == null
          ? null
          : fromPerformanceScore(displayScale, performanceScore);
      const gradeBand = getGradeBand(displayScale, performanceGrade);
      const dataPoints = selectedRows.length;
      const deltaFromPrevious = (() => {
        const currentAvg = weightedAverageScore(trendCurrentByCourse.get(course.id) ?? []);
        const previousAvg = weightedAverageScore(trendPreviousByCourse.get(course.id) ?? []);
        if (currentAvg == null || previousAvg == null) return null;
        const currentValue = fromPerformanceScore(displayScale, currentAvg);
        const previousValue = fromPerformanceScore(displayScale, previousAvg);
        return roundScore(currentValue - previousValue);
      })();

      const belowThreshold = isBelowRiskThreshold(riskSettings, displayScale, {
        score: performanceScore,
        grade: performanceGrade,
      });
      const hasEnoughData = hasEnoughRiskDataPoints(
        riskSettings,
        riskSettings.riskLookback,
        dataPoints,
        selected.source,
      );
      const isBestMetric = shouldNeverFlagBestRiskMetric({
        score: performanceScore,
        grade: performanceGrade,
      });
      const isAtRisk = Boolean(belowThreshold && hasEnoughData && !isBestMetric);

      const studyMinutes = studyByCourse.get(course.id) ?? 0;
      const upcoming = deadlinesByCourse.get(course.id) ?? {
        deadlines: 0,
        exams: 0,
      };
      const reasons: string[] = [];
      const suggestedActions: string[] = [];
      let riskPoints = 0;

      if (belowThreshold) {
        if (riskSettings.riskThresholdMode === "score") {
          reasons.push(
            `Score ${performanceScore == null ? "-" : roundScore(performanceScore).toFixed(1)} below threshold ${roundScore(riskSettings.riskScoreThreshold).toFixed(1)}`
          );
        } else {
          reasons.push(
            `Grade ${performanceGrade == null ? "-" : formatScaleValue(performanceGrade)} below threshold ${formatScaleValue(
              riskSettings.riskGradeThresholdByScale[displayScale],
            )}`
          );
        }
      }
      if (!hasEnoughData) {
        reasons.push(
          `Only ${dataPoints} data point${dataPoints === 1 ? "" : "s"}, min ${riskSettings.riskMinDataPoints} required`
        );
      }
      if (isBestMetric) {
        reasons.push("Best-grade performance (>=90 / 6) is never flagged.");
      }

      if (isAtRisk) {
        riskPoints += 52;
      }
      if (deltaFromPrevious != null && deltaFromPrevious < -1) {
        if (isAtRisk) {
          riskPoints += clamp(Math.abs(deltaFromPrevious) * 1.5, 6, 24);
        }
        reasons.push(`Downward trend (${deltaFromPrevious.toFixed(2)}).`);
      }
      if (averageStudy > 0 && isAtRisk) {
        const studyRatio = studyMinutes / averageStudy;
        if (studyRatio < 0.6) {
          riskPoints += 20;
          reasons.push(`Low study time (${Math.round(studyMinutes)} min in 14 days).`);
        } else if (studyRatio < 0.85) {
          riskPoints += 12;
          reasons.push(`Study time is below your average (${Math.round(studyMinutes)} min).`);
        }
      }
      if (isAtRisk && (upcoming.exams > 0 || upcoming.deadlines > 0)) {
        riskPoints += clamp(upcoming.exams * 12 + upcoming.deadlines * 5, 5, 24);
        reasons.push(
          `${upcoming.exams} upcoming exam${upcoming.exams === 1 ? "" : "s"} and ${upcoming.deadlines} deadline${upcoming.deadlines === 1 ? "" : "s"}.`
        );
      }

      const isExcellentStable = shouldSuppressAttentionForExcellent(
        gradeBand,
        deltaFromPrevious,
      );
      if (isExcellentStable) riskPoints = 0;
      if (!isAtRisk) riskPoints = 0;

      const riskScore = clamp(Math.round(riskPoints), 0, 100);
      const riskLevel = riskScore >= 70 ? "high" : riskScore >= 40 ? "medium" : "low";
      const recommendedMinutes = isAtRisk
        ? clamp(Math.round((45 + riskScore * 1.2) / 15) * 15, 30, 240)
        : 0;

      if (isAtRisk && recommendedMinutes > 0) {
        suggestedActions.push(`Add ${recommendedMinutes}m this week`);
        if (upcoming.exams > 0 || upcoming.deadlines > 0) {
          suggestedActions.push("Schedule revision");
        }
        suggestedActions.push("Create checklist");
      }

      return {
        courseId: course.id,
        courseName: course.name,
        isBelowThreshold: belowThreshold,
        hasEnoughData,
        isAtRisk,
        riskScore,
        riskLevel,
        gradeBand,
        displayScale,
        reasons:
          reasons.length > 0
            ? reasons
            : [
                `Based on ${riskSettings.riskLookback} and threshold ${thresholdLabel}.`,
              ],
        suggestedActions,
        recommendedMinutes,
        studyMinutes14d: Math.round(studyMinutes),
        upcomingDeadlines: upcoming.deadlines,
        upcomingExams: upcoming.exams,
        currentAverage:
          performanceGrade == null ? null : roundScore(performanceGrade),
        currentAverageNormalized:
          performanceScore == null ? null : roundScore(performanceScore),
        deltaFromPrevious,
      };
    });

    const filtered = result.filter((item) =>
      item.isAtRisk &&
      (!riskSettings.riskShowOnlyIfBelowThreshold || item.isBelowThreshold)
    );
    return filtered.sort((a, b) => b.riskScore - a.riskScore);
  });

  app.get("/analytics/grades-summary", async (req) => {
    const query = req.query as {
      termId?: string;
      displayScale?: string;
      includeTermGrade?: string;
    };
    const displayScale = normalizeGradeScale(query.displayScale);
    const includeTermGrade = query.includeTermGrade === "1" || query.includeTermGrade === "true";
    const termId = Number(query.termId);
    if (!Number.isFinite(termId)) {
      return {
        termId: null,
        displayScale,
        includeTermGrade,
        method: includeTermGrade
          ? "Course averages from Current grades + Term grade (1 item weight), then averaged across courses."
          : "Course averages from Current grades only, then averaged across courses.",
        overallAverage: null,
        overallAverageNormalized: null,
        previousTermAverage: null,
        previousTermAverageNormalized: null,
        deltaFromPrevious: null,
        bestCourses: [],
        worstCourses: [],
        courseTrends: [],
      };
    }

    const termRows = await prisma.$queryRaw<
      Array<{
        id: number;
        school_year: string;
        name: string;
        position: number;
      }>
    >`
      SELECT id, school_year, name, position
      FROM terms
      WHERE id = ${termId} AND user_id = ${USER_ID}
      LIMIT 1
    `;
    const term = termRows[0];
    if (!term) {
      return {
        termId: null,
        displayScale,
        includeTermGrade,
        method: includeTermGrade
          ? "Course averages from Current grades + Term grade (1 item weight), then averaged across courses."
          : "Course averages from Current grades only, then averaged across courses.",
        overallAverage: null,
        overallAverageNormalized: null,
        previousTermAverage: null,
        previousTermAverageNormalized: null,
        deltaFromPrevious: null,
        bestCourses: [],
        worstCourses: [],
        courseTrends: [],
      };
    }

    const termsInYear = await prisma.$queryRaw<
      Array<{ id: number; position: number }>
    >`
      SELECT id, position
      FROM terms
      WHERE user_id = ${USER_ID} AND school_year = ${term.school_year}
      ORDER BY position ASC, id ASC
    `;
    const currentIndex = termsInYear.findIndex((item) => item.id === term.id);
    const previousTerm = currentIndex > 0 ? termsInYear[currentIndex - 1] : undefined;
    const previousTermId = previousTerm?.id ?? null;

    const currentRows = await prisma.$queryRaw<
      Array<{
        course_id: string;
        course_name: string;
        scale: string;
        grade_value: number;
        performance_score: number;
        weight: number;
        category_name: string | null;
      }>
    >`
      SELECT
        g.course_id,
        c.name AS course_name,
        g.scale,
        g.grade_value,
        g.performance_score,
        g.weight,
        gc.name AS category_name
      FROM grade_items g
      INNER JOIN \`Course\` c ON BINARY c.id = BINARY g.course_id
      LEFT JOIN grade_categories gc ON gc.id = g.category_id
      WHERE g.user_id = ${USER_ID} AND g.term_id = ${term.id}
      ORDER BY c.name ASC, g.graded_on DESC, g.id DESC
    `;
    const previousRows = previousTermId
      ? await prisma.$queryRaw<
          Array<{
            course_id: string;
            course_name: string;
            scale: string;
            grade_value: number;
            performance_score: number;
            weight: number;
            category_name: string | null;
          }>
        >`
          SELECT
            g.course_id,
            c.name AS course_name,
            g.scale,
            g.grade_value,
            g.performance_score,
            g.weight,
            gc.name AS category_name
          FROM grade_items g
          INNER JOIN \`Course\` c ON BINARY c.id = BINARY g.course_id
          LEFT JOIN grade_categories gc ON gc.id = g.category_id
          WHERE g.user_id = ${USER_ID} AND g.term_id = ${previousTermId}
          ORDER BY c.name ASC, g.graded_on DESC, g.id DESC
        `
      : [];

    const buildMap = (
      rows: Array<{
        course_id: string;
        course_name: string;
        scale: string;
        grade_value: number;
        performance_score: number;
        weight: number;
        category_name: string | null;
      }>
    ) => {
      const byCourse = new Map<
        string,
        {
          courseName: string;
          items: GradeAverageInputItem[];
        }
      >();
      for (const row of rows) {
        const current = byCourse.get(row.course_id) ?? {
          courseName: row.course_name,
          items: [],
        };
        current.items.push({
          scale: normalizeGradeScale(row.scale),
          gradeValue: Number(row.grade_value),
          performanceScore: Number(row.performance_score),
          weight: Number(row.weight),
          categoryName: row.category_name,
        });
        byCourse.set(row.course_id, current);
      }
      return byCourse;
    };

    const currentByCourse = buildMap(currentRows);
    const previousByCourse = buildMap(previousRows);

    const ranked = Array.from(currentByCourse.entries())
      .map(([courseId, course]) => {
        const average = computeCourseAverage(course.items, { displayScale, includeTermGrade });
        return {
          courseId,
          courseName: course.courseName,
          averageValue: average.averageValue,
          averageScore: average.averageValue,
          averageNormalizedScore: average.normalizedScore,
          itemCount: average.itemCount,
        };
      })
      .filter((row) => row.averageValue != null)
      .map((row) => ({
        ...row,
        averageValue: roundScore(row.averageValue ?? 0),
        averageScore: roundScore(row.averageScore ?? 0),
        averageNormalizedScore:
          row.averageNormalizedScore == null ? null : roundScore(row.averageNormalizedScore),
      }))
      .sort((a, b) => (b.averageValue ?? 0) - (a.averageValue ?? 0));

    const courseTrends = ranked.map((row) => {
      const previousCourse = previousByCourse.get(row.courseId);
      const previousAverage = previousCourse
        ? computeCourseAverage(previousCourse.items, { displayScale, includeTermGrade })
        : null;
      const previousValue =
        previousAverage?.averageValue == null ? null : roundScore(previousAverage.averageValue);
      const previousNormalized =
        previousAverage?.normalizedScore == null ? null : roundScore(previousAverage.normalizedScore);
      return {
        ...row,
        previousAverageValue: previousValue,
        previousAverageScore: previousValue,
        previousAverageNormalizedScore: previousNormalized,
        delta:
          row.averageValue == null || previousValue == null
            ? null
            : roundScore(row.averageValue - previousValue),
      };
    });

    const averageAcrossCourses = (rows: typeof ranked, key: "averageValue" | "averageNormalizedScore") => {
      const values = rows
        .map((row) => row[key])
        .filter((value): value is number => value != null && Number.isFinite(value));
      if (!values.length) return null;
      return roundScore(values.reduce((sum, value) => sum + value, 0) / values.length);
    };

    const overallAverage = averageAcrossCourses(ranked, "averageValue");
    const overallAverageNormalized = averageAcrossCourses(ranked, "averageNormalizedScore");

    const previousRanked = Array.from(previousByCourse.entries()).map(([_, course]) =>
      computeCourseAverage(course.items, { displayScale, includeTermGrade })
    );
    const previousAverageValues = previousRanked
      .map((row) => row.averageValue)
      .filter((value): value is number => value != null && Number.isFinite(value));
    const previousNormalizedValues = previousRanked
      .map((row) => row.normalizedScore)
      .filter((value): value is number => value != null && Number.isFinite(value));
    const previousTermAverage = previousAverageValues.length
      ? roundScore(previousAverageValues.reduce((sum, value) => sum + value, 0) / previousAverageValues.length)
      : null;
    const previousTermAverageNormalized = previousNormalizedValues.length
      ? roundScore(
          previousNormalizedValues.reduce((sum, value) => sum + value, 0) / previousNormalizedValues.length
        )
      : null;

    return {
      termId: String(term.id),
      termName: term.name,
      schoolYear: term.school_year,
      displayScale,
      includeTermGrade,
      method: includeTermGrade
        ? "Course averages from Current grades + Term grade (1 item weight), then averaged across courses."
        : "Course averages from Current grades only, then averaged across courses.",
      overallAverage,
      overallAverageNormalized,
      previousTermAverage,
      previousTermAverageNormalized,
      deltaFromPrevious:
        overallAverage != null && previousTermAverage != null
          ? roundScore(overallAverage - previousTermAverage)
          : null,
      bestCourses: ranked.slice(0, 3),
      worstCourses: [...ranked].reverse().slice(0, 3).reverse(),
      courseTrends,
    };
  });

  // Planner
  app.post("/planner/auto-add", async (req) => {
    const body = req.body as {
      courseId: string;
      totalMinutes: number;
      weekStartDate: string;
    };

    const totalMinutes = Math.max(0, Math.round(Number(body.totalMinutes)));
    if (!body.courseId || !body.weekStartDate || totalMinutes <= 0) {
      return { blockIds: [], dayLabels: [], blocksCount: 0 };
    }

    const weekStart = new Date(body.weekStartDate);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    await prisma.course.findFirstOrThrow({
      where: { id: body.courseId, userId: USER_ID },
      select: { id: true },
    });

    const settings = await prisma.settings.findUnique({
      where: { userId: USER_ID },
      select: { shortSessionMinutes: true },
    });
    const sessionLength = settings?.shortSessionMinutes ?? 45;
    const chunks = splitMinutes(totalMinutes, sessionLength);

    const plannedRows = await prisma.$queryRaw<
      Array<{
        id: number;
        start_time: Date;
        end_time: Date;
      }>
    >`
      SELECT id, start_time, end_time
      FROM planned_study_blocks
      WHERE user_id = ${USER_ID}
        AND start_time >= ${weekStart}
        AND start_time < ${weekEnd}
      ORDER BY start_time ASC
    `;

    const targets = await prisma.dailyTarget.findMany({
      where: { userId: USER_ID },
      select: { weekday: true, targetMinutes: true },
    });
    const targetByDay = new Map<number, number>(
      targets.map((item) => [item.weekday, item.targetMinutes])
    );

    const blocksByDay = new Map<number, Array<{ startTime: Date; endTime: Date }>>();
    const plannedMinutesByDay = new Map<number, number>();
    for (let day = 0; day < 7; day += 1) {
      blocksByDay.set(day, []);
      plannedMinutesByDay.set(day, 0);
    }

    plannedRows.forEach((row) => {
      const start = new Date(row.start_time);
      const end = new Date(row.end_time);
      const dayIndex = (start.getDay() + 6) % 7;
      const list = blocksByDay.get(dayIndex) ?? [];
      list.push({ startTime: start, endTime: end });
      blocksByDay.set(dayIndex, list);

      const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
      plannedMinutesByDay.set(
        dayIndex,
        (plannedMinutesByDay.get(dayIndex) ?? 0) + minutes
      );
    });

    const insertedIds: string[] = [];
    const usedDays = new Set<number>();

    for (const chunkMinutes of chunks) {
      const rankedDays = Array.from({ length: 7 }, (_, dayIndex) => {
        const planned = plannedMinutesByDay.get(dayIndex) ?? 0;
        const target = targetByDay.get(dayIndex + 1) ?? 90;
        const remaining = target - planned;
        const loadRatio = target > 0 ? planned / target : planned / 90;
        return { dayIndex, planned, target, remaining, loadRatio };
      }).sort((a, b) => {
        if (b.remaining !== a.remaining) return b.remaining - a.remaining;
        return a.loadRatio - b.loadRatio;
      });

      const chosen = rankedDays[0];
      if (!chosen) continue;

      const dayDate = new Date(weekStart);
      dayDate.setDate(dayDate.getDate() + chosen.dayIndex);
      const dayBlocks = blocksByDay.get(chosen.dayIndex) ?? [];
      const slot = findOpenPlannerSlot(dayDate, dayBlocks, chunkMinutes);

      await prisma.$executeRaw`
        INSERT INTO planned_study_blocks (user_id, course_id, activity_id, start_time, end_time, note)
        VALUES (${USER_ID}, ${body.courseId}, ${null}, ${slot.start}, ${slot.end}, ${`Auto-added ${chunkMinutes}m from recommendations`})
      `;
      const inserted = await prisma.$queryRaw<Array<{ id: number }>>`
        SELECT id
        FROM planned_study_blocks
        WHERE user_id = ${USER_ID}
        ORDER BY id DESC
        LIMIT 1
      `;
      const last = inserted[0];
      if (last) insertedIds.push(String(last.id));

      dayBlocks.push({ startTime: slot.start, endTime: slot.end });
      blocksByDay.set(chosen.dayIndex, dayBlocks);
      plannedMinutesByDay.set(
        chosen.dayIndex,
        (plannedMinutesByDay.get(chosen.dayIndex) ?? 0) + chunkMinutes
      );
      usedDays.add(chosen.dayIndex);
    }

    return {
      blockIds: insertedIds,
      blocksCount: insertedIds.length,
      dayLabels: Array.from(usedDays).sort((a, b) => a - b).map(weekDayLabel),
    };
  });

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
        spent_minutes: number;
        created_at: Date;
        updated_at: Date;
      }>
    >`
      SELECT id, user_id, title, description, kind, status, progress, priority, due_at, course_id, activity_id, spent_minutes, created_at, updated_at
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
          timeSpentMinutes: Number(task.spent_minutes ?? 0),
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
      timeSpentMinutes?: number;
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
    const timeSpentMinutes = Math.max(0, Math.round(Number(body.timeSpentMinutes ?? 0)));

    await prisma.$executeRaw`
      INSERT INTO tasks (user_id, title, description, kind, status, progress, priority, due_at, course_id, activity_id, spent_minutes)
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
        ${body.activityId ?? null},
        ${timeSpentMinutes}
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
      timeSpentMinutes,
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
      timeSpentMinutes?: number;
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
        spent_minutes: number;
      }>
    >`
      SELECT title, description, kind, status, progress, priority, due_at, course_id, activity_id, spent_minutes
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
      timeSpentMinutes:
        body.timeSpentMinutes === undefined
          ? Number(row.spent_minutes ?? 0)
          : Math.max(0, Math.round(Number(body.timeSpentMinutes))),
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
        activity_id = ${next.activityId},
        spent_minutes = ${next.timeSpentMinutes}
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
      taskId?: string | null;
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

    const taskId = body.taskId ? Number(body.taskId) : NaN;
    if (Number.isInteger(taskId)) {
      const taskRows = await prisma.$queryRaw<
        Array<{ progress: number; status: string; spent_minutes: number }>
      >`
        SELECT progress, status, spent_minutes
        FROM tasks
        WHERE id = ${taskId} AND user_id = ${USER_ID}
        LIMIT 1
      `;

      const task = taskRows[0];
      if (task) {
        const addedMinutes = Math.max(0, created.durationMinutes);
        const nextSpentMinutes = Number(task.spent_minutes ?? 0) + addedMinutes;
        const progressBoost = Math.min(25, Math.max(2, Math.round(addedMinutes / 5)));
        const boostedProgress = Math.min(100, Number(task.progress ?? 0) + progressBoost);
        const nextProgress = task.status === "done" ? 100 : boostedProgress;
        const nextStatus =
          task.status === "done"
            ? "done"
            : nextProgress >= 100
              ? "done"
              : task.status === "todo"
                ? "in_progress"
                : task.status;

        await prisma.$executeRaw`
          UPDATE tasks
          SET
            spent_minutes = ${nextSpentMinutes},
            progress = ${nextProgress},
            status = ${nextStatus}
          WHERE id = ${taskId} AND user_id = ${USER_ID}
        `;
      }
    }

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
