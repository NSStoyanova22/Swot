import { prisma } from "./db.js";

export type GradeScale = "percentage" | "german" | "bulgarian";

export function normalizeGradeScale(value: string | undefined): GradeScale {
  if (value === "german" || value === "bulgarian") return value;
  return "percentage";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function toPerformanceScore(scale: GradeScale, value: number) {
  if (!Number.isFinite(value)) return 0;
  if (scale === "german") {
    const clamped = clamp(value, 1, 6);
    return clamp(((6 - clamped) / 5) * 100, 0, 100);
  }
  if (scale === "bulgarian") {
    const clamped = clamp(value, 2, 6);
    return clamp(((clamped - 2) / 4) * 100, 0, 100);
  }
  return clamp(value, 0, 100);
}

function normalizeIgnoredShkoloSubject(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function parseIgnoredSubjectsJson(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const output: string[] = [];
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const normalized = normalizeIgnoredShkoloSubject(item);
      if (!normalized) continue;
      const key = normalized.toLocaleLowerCase("bg");
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(normalized);
    }
    return output;
  } catch {
    return [];
  }
}

export async function getIgnoredShkoloSubjects(userId: string) {
  const rows = await prisma.$queryRaw<Array<{ ignored_shkolo_subjects: string | null }>>`
    SELECT ignored_shkolo_subjects
    FROM user_grade_import_preferences
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return parseIgnoredSubjectsJson(rows[0]?.ignored_shkolo_subjects ?? null);
}

export async function setIgnoredShkoloSubjects(userId: string, subjects: string[]) {
  const normalized = parseIgnoredSubjectsJson(JSON.stringify(subjects));
  await prisma.$executeRaw`
    INSERT INTO user_grade_import_preferences (user_id, ignored_shkolo_subjects)
    VALUES (${userId}, ${JSON.stringify(normalized)})
    ON DUPLICATE KEY UPDATE ignored_shkolo_subjects = VALUES(ignored_shkolo_subjects)
  `;
  return normalized;
}

export async function ensureGradesTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS terms (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      school_year VARCHAR(64) NOT NULL,
      name VARCHAR(64) NOT NULL,
      position INT NOT NULL DEFAULT 1,
      start_date DATE NULL,
      end_date DATE NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_terms_user_year_name (user_id, school_year, name),
      INDEX idx_terms_user_year_position (user_id, school_year, position)
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS grade_categories (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      course_id VARCHAR(191) NOT NULL,
      name VARCHAR(64) NOT NULL,
      weight DECIMAL(7,3) NOT NULL DEFAULT 20,
      drop_lowest TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_grade_categories_user_course_name (user_id, course_id, name),
      INDEX idx_grade_categories_user_course (user_id, course_id)
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS grade_items (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      term_id BIGINT NOT NULL,
      course_id VARCHAR(191) NOT NULL,
      category_id BIGINT NULL,
      scale VARCHAR(24) NOT NULL,
      grade_value DECIMAL(7,3) NOT NULL,
      performance_score DECIMAL(7,3) NOT NULL,
      weight DECIMAL(7,3) NOT NULL DEFAULT 1,
      is_final TINYINT(1) NOT NULL DEFAULT 0,
      final_type VARCHAR(16) NULL,
      graded_on DATE NOT NULL,
      note TEXT NULL,
      import_metadata TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_grades_user_term (user_id, term_id),
      INDEX idx_grades_user_course (user_id, course_id),
      INDEX idx_grades_user_category (user_id, category_id),
      INDEX idx_grades_user_term_course_date (user_id, term_id, course_id, graded_on)
    )
  `);

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE grade_items
      ADD COLUMN category_id BIGINT NULL
    `);
  } catch {
    // Column already exists.
  }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE grade_items
      ADD INDEX idx_grades_user_category (user_id, category_id)
    `);
  } catch {
    // Index already exists.
  }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE grade_items
      ADD COLUMN is_final TINYINT(1) NOT NULL DEFAULT 0
    `);
  } catch {
    // Column already exists.
  }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE grade_items
      ADD COLUMN final_type VARCHAR(16) NULL
    `);
  } catch {
    // Column already exists.
  }

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE grade_items
      ADD COLUMN import_metadata TEXT NULL
    `);
  } catch {
    // Column already exists.
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS course_grade_targets (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      course_id VARCHAR(191) NOT NULL,
      target_score DECIMAL(7,3) NOT NULL,
      scale VARCHAR(24) NOT NULL,
      target_value DECIMAL(7,3) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_grade_target_user_course (user_id, course_id),
      INDEX idx_grade_target_user_course (user_id, course_id)
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS user_grade_import_preferences (
      user_id VARCHAR(191) NOT NULL PRIMARY KEY,
      ignored_shkolo_subjects TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}
