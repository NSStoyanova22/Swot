import { prisma } from "./db.js";

export type GradeScale = "percentage" | "german" | "bulgarian";
export type RiskThresholdMode = "score" | "grade";
export type RiskLookback = "currentTerm" | "previousTerm" | "academicYear";
export type CelebrationShowFor =
  | "gradeItem"
  | "termFinal"
  | "courseAverage"
  | "all";

export type CelebrationSettings = {
  celebrationEnabled: boolean;
  celebrationScoreThreshold: number;
  celebrationCooldownHours: number;
  celebrationShowFor: CelebrationShowFor;
};

export type CelebrationTriggerType = "gradeItem" | "termFinal" | "courseAverage";

export type CelebrationCandidate = {
  type: CelebrationTriggerType;
  courseId: string;
  score: number;
  gradeValue?: number | null;
  delta?: number;
};

export type GradeRiskSettings = {
  riskEnabled: boolean;
  riskThresholdMode: RiskThresholdMode;
  riskScoreThreshold: number;
  riskGradeThresholdByScale: {
    bulgarian: number;
    german: number;
    percentage: number;
  };
  riskLookback: RiskLookback;
  riskMinDataPoints: number;
  riskUseTermFinalIfAvailable: boolean;
  riskShowOnlyIfBelowThreshold: boolean;
};

export const DEFAULT_GRADE_RISK_SETTINGS: GradeRiskSettings = {
  riskEnabled: true,
  riskThresholdMode: "score",
  riskScoreThreshold: 70,
  riskGradeThresholdByScale: {
    bulgarian: 4.5,
    german: 3.5,
    percentage: 70,
  },
  riskLookback: "currentTerm",
  riskMinDataPoints: 2,
  riskUseTermFinalIfAvailable: true,
  riskShowOnlyIfBelowThreshold: true,
};

export const DEFAULT_CELEBRATION_SETTINGS: CelebrationSettings = {
  celebrationEnabled: true,
  celebrationScoreThreshold: 90,
  celebrationCooldownHours: 24,
  celebrationShowFor: "all",
};

export type RiskTermInfo = {
  id: number;
  schoolYear: string;
  position: number;
};

export type RiskSource = "yearFinal" | "termFinal" | "current";

export type RiskSelectableGradeItem = {
  finalType?: string | null;
  isFinal?: boolean | number;
  categoryName?: string | null;
};

export function normalizeGradeScale(value: string | undefined): GradeScale {
  if (value === "german" || value === "bulgarian") return value;
  return "percentage";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isRiskThresholdMode(value: string | undefined): value is RiskThresholdMode {
  return value === "score" || value === "grade";
}

function isRiskLookback(value: string | undefined): value is RiskLookback {
  return value === "currentTerm" || value === "previousTerm" || value === "academicYear";
}

function isCelebrationShowFor(value: string | undefined): value is CelebrationShowFor {
  return (
    value === "gradeItem" ||
    value === "termFinal" ||
    value === "courseAverage" ||
    value === "all"
  );
}

export function normalizeGradeRiskSettings(
  input?: Partial<GradeRiskSettings> | null,
): GradeRiskSettings {
  const raw = input ?? {};
  const rawThresholds: Partial<GradeRiskSettings["riskGradeThresholdByScale"]> =
    raw.riskGradeThresholdByScale ?? {};
  return {
    riskEnabled: raw.riskEnabled ?? DEFAULT_GRADE_RISK_SETTINGS.riskEnabled,
    riskThresholdMode: isRiskThresholdMode(raw.riskThresholdMode)
      ? raw.riskThresholdMode
      : DEFAULT_GRADE_RISK_SETTINGS.riskThresholdMode,
    riskScoreThreshold: clamp(
      Number.isFinite(Number(raw.riskScoreThreshold))
        ? Number(raw.riskScoreThreshold)
        : DEFAULT_GRADE_RISK_SETTINGS.riskScoreThreshold,
      0,
      100,
    ),
    riskGradeThresholdByScale: {
      bulgarian: clamp(
        Number.isFinite(Number(rawThresholds.bulgarian))
          ? Number(rawThresholds.bulgarian)
          : DEFAULT_GRADE_RISK_SETTINGS.riskGradeThresholdByScale.bulgarian,
        2,
        6,
      ),
      german: clamp(
        Number.isFinite(Number(rawThresholds.german))
          ? Number(rawThresholds.german)
          : DEFAULT_GRADE_RISK_SETTINGS.riskGradeThresholdByScale.german,
        1,
        6,
      ),
      percentage: clamp(
        Number.isFinite(Number(rawThresholds.percentage))
          ? Number(rawThresholds.percentage)
          : DEFAULT_GRADE_RISK_SETTINGS.riskGradeThresholdByScale.percentage,
        0,
        100,
      ),
    },
    riskLookback: isRiskLookback(raw.riskLookback)
      ? raw.riskLookback
      : DEFAULT_GRADE_RISK_SETTINGS.riskLookback,
    riskMinDataPoints: Math.max(
      1,
      Math.round(
        Number.isFinite(Number(raw.riskMinDataPoints))
          ? Number(raw.riskMinDataPoints)
          : DEFAULT_GRADE_RISK_SETTINGS.riskMinDataPoints,
      ),
    ),
    riskUseTermFinalIfAvailable:
      raw.riskUseTermFinalIfAvailable ??
      DEFAULT_GRADE_RISK_SETTINGS.riskUseTermFinalIfAvailable,
    riskShowOnlyIfBelowThreshold:
      raw.riskShowOnlyIfBelowThreshold ??
      DEFAULT_GRADE_RISK_SETTINGS.riskShowOnlyIfBelowThreshold,
  };
}

export function normalizeCelebrationSettings(
  input?: Partial<CelebrationSettings> | null,
): CelebrationSettings {
  const raw = input ?? {};
  return {
    celebrationEnabled:
      raw.celebrationEnabled ?? DEFAULT_CELEBRATION_SETTINGS.celebrationEnabled,
    celebrationScoreThreshold: clamp(
      Number.isFinite(Number(raw.celebrationScoreThreshold))
        ? Number(raw.celebrationScoreThreshold)
        : DEFAULT_CELEBRATION_SETTINGS.celebrationScoreThreshold,
      0,
      100,
    ),
    celebrationCooldownHours: clamp(
      Number.isFinite(Number(raw.celebrationCooldownHours))
        ? Number(raw.celebrationCooldownHours)
        : DEFAULT_CELEBRATION_SETTINGS.celebrationCooldownHours,
      1,
      24 * 14,
    ),
    celebrationShowFor: isCelebrationShowFor(raw.celebrationShowFor)
      ? raw.celebrationShowFor
      : DEFAULT_CELEBRATION_SETTINGS.celebrationShowFor,
  };
}

export function resolveRiskLookbackTerms(
  termsInYear: RiskTermInfo[],
  currentTermId: number,
  lookback: RiskLookback,
) {
  const sorted = termsInYear
    .slice()
    .sort((a, b) => (a.position === b.position ? a.id - b.id : a.position - b.position));
  const currentIndex = sorted.findIndex((term) => term.id === currentTermId);
  if (currentIndex < 0) {
    return {
      referenceTermId: currentTermId,
      evaluationTermIds: [currentTermId],
      previousForTrendTermId: null as number | null,
    };
  }
  const previousTermId =
    currentIndex > 0 ? (sorted[currentIndex - 1]?.id ?? null) : null;
  const referenceTermId =
    lookback === "previousTerm" && previousTermId != null
      ? previousTermId
      : currentTermId;
  const referenceIndex = sorted.findIndex((term) => term.id === referenceTermId);
  const previousForTrendTermId =
    referenceIndex > 0 ? (sorted[referenceIndex - 1]?.id ?? null) : null;
  const evaluationTermIds =
    lookback === "academicYear" ? sorted.map((term) => term.id) : [referenceTermId];
  return {
    referenceTermId,
    evaluationTermIds,
    previousForTrendTermId,
  };
}

export function selectRiskEvaluationItems(
  items: RiskSelectableGradeItem[],
  lookback: RiskLookback,
  riskUseTermFinalIfAvailable: boolean,
) {
  const normalizeCategory = (value: string | null | undefined) =>
    (value ?? "").trim().toLocaleLowerCase("bg");
  const isYearFinal = (item: RiskSelectableGradeItem) =>
    item.finalType === "YEAR";
  const isTermFinal = (item: RiskSelectableGradeItem) => {
    const category = normalizeCategory(item.categoryName);
    return (
      item.finalType === "TERM1" ||
      item.finalType === "TERM2" ||
      ((item.isFinal ? 1 : 0) === 1 && category === "term grade")
    );
  };

  const yearFinal = items.filter((item) => isYearFinal(item));
  const termFinal = items.filter(
    (item) => !isYearFinal(item) && isTermFinal(item),
  );
  const current = items.filter(
    (item) => !isYearFinal(item) && !isTermFinal(item),
  );

  if (lookback === "academicYear") {
    if (yearFinal.length) return { source: "yearFinal" as RiskSource, items: yearFinal };
    if (riskUseTermFinalIfAvailable && termFinal.length) {
      return { source: "termFinal" as RiskSource, items: termFinal };
    }
    return { source: "current" as RiskSource, items: current };
  }

  if (riskUseTermFinalIfAvailable && termFinal.length) {
    return { source: "termFinal" as RiskSource, items: termFinal };
  }
  if (current.length) return { source: "current" as RiskSource, items: current };
  return { source: "termFinal" as RiskSource, items: termFinal };
}

export function isBelowRiskThreshold(
  settings: GradeRiskSettings,
  displayScale: GradeScale,
  metric: { score: number | null; grade: number | null },
) {
  if (settings.riskThresholdMode === "score") {
    return metric.score != null && metric.score <= settings.riskScoreThreshold;
  }
  return (
    metric.grade != null &&
    metric.grade <= settings.riskGradeThresholdByScale[displayScale]
  );
}

export function hasEnoughRiskDataPoints(
  settings: GradeRiskSettings,
  lookback: RiskLookback,
  dataPoints: number,
  source: RiskSource,
) {
  if (dataPoints >= settings.riskMinDataPoints) return true;
  return (
    lookback === "academicYear" &&
    dataPoints >= 1 &&
    (source === "yearFinal" || source === "termFinal")
  );
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

export function fromPerformanceScore(scale: GradeScale, score: number) {
  const clamped = clamp(Number.isFinite(score) ? score : 0, 0, 100);
  if (scale === "german") {
    return clamp(6 - (clamped / 100) * 5, 1, 6);
  }
  if (scale === "bulgarian") {
    return clamp(2 + (clamped / 100) * 4, 2, 6);
  }
  return clamped;
}

export function isExcellentTermFinalForScale(scale: GradeScale, gradeValue: number) {
  if (!Number.isFinite(gradeValue)) return false;
  if (scale === "bulgarian") return gradeValue >= 5.75 || Math.abs(gradeValue - 6) < 0.001;
  if (scale === "german") return gradeValue <= 1.5;
  return gradeValue >= 90;
}

export function shouldCelebrateGradeItem(score: number, threshold: number) {
  return Number.isFinite(score) && Number.isFinite(threshold) && score >= threshold;
}

export function shouldCelebrateTermFinal(
  scale: GradeScale,
  gradeValue: number,
  score: number,
  threshold: number,
) {
  return (
    shouldCelebrateGradeItem(score, threshold) &&
    isExcellentTermFinalForScale(scale, gradeValue)
  );
}

export function hasCrossedCelebrationThreshold(
  beforeScore: number | null | undefined,
  afterScore: number | null | undefined,
  threshold: number,
) {
  if (
    beforeScore == null ||
    afterScore == null ||
    !Number.isFinite(beforeScore) ||
    !Number.isFinite(afterScore) ||
    !Number.isFinite(threshold)
  ) {
    return false;
  }
  return beforeScore < threshold && afterScore >= threshold;
}

export function canCelebrateByCooldown(
  lastCelebratedAt: string | Date | null | undefined,
  cooldownHours: number,
  nowMs = Date.now(),
) {
  if (!lastCelebratedAt) return true;
  const lastMs =
    lastCelebratedAt instanceof Date
      ? lastCelebratedAt.getTime()
      : new Date(lastCelebratedAt).getTime();
  if (!Number.isFinite(lastMs)) return true;
  const cooldownMs = Math.max(1, cooldownHours) * 60 * 60 * 1000;
  return nowMs - lastMs >= cooldownMs;
}

export function pickBestCelebrationCandidate(candidates: CelebrationCandidate[]) {
  if (!candidates.length) return null;
  const normalized = candidates
    .filter((item) => Number.isFinite(item.score))
    .map((item) => ({
      ...item,
      delta: Number.isFinite(item.delta) ? Number(item.delta) : 0,
    }));
  if (!normalized.length) return null;
  normalized.sort((a, b) => {
    if (b.delta !== a.delta) return b.delta - a.delta;
    return b.score - a.score;
  });
  return normalized[0] ?? null;
}

export type GradeAverageInputItem = {
  scale: GradeScale;
  gradeValue: number;
  performanceScore: number;
  weight: number;
  categoryName?: string | null;
};

export type GradeBand = "atRisk" | "watch" | "good" | "excellent";

export const GRADE_BAND_THRESHOLDS = {
  bulgarian: {
    atRiskMax: 4.0,
    watchMax: 4.5,
    goodMax: 5.5,
  },
  percentage: {
    atRiskMax: 60,
    watchMax: 75,
    goodMax: 90,
  },
} as const;

export function getGradeBand(scale: GradeScale, averageValue: number | null): GradeBand {
  if (averageValue == null || !Number.isFinite(averageValue)) return "atRisk";
  if (scale === "bulgarian") {
    if (averageValue < GRADE_BAND_THRESHOLDS.bulgarian.atRiskMax) return "atRisk";
    if (averageValue < GRADE_BAND_THRESHOLDS.bulgarian.watchMax) return "watch";
    if (averageValue < GRADE_BAND_THRESHOLDS.bulgarian.goodMax) return "good";
    return "excellent";
  }

  const normalized =
    scale === "percentage" ? averageValue : toPerformanceScore(scale, averageValue);
  if (normalized < GRADE_BAND_THRESHOLDS.percentage.atRiskMax) return "atRisk";
  if (normalized < GRADE_BAND_THRESHOLDS.percentage.watchMax) return "watch";
  if (normalized < GRADE_BAND_THRESHOLDS.percentage.goodMax) return "good";
  return "excellent";
}

export function shouldSuppressAttentionForExcellent(gradeBand: GradeBand, trendDelta: number | null | undefined) {
  return gradeBand === "excellent" && (trendDelta == null || trendDelta >= 0);
}

function normalizeCategoryName(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("bg");
}

function toDisplayValue(item: GradeAverageInputItem, displayScale: GradeScale) {
  if (item.scale === displayScale) {
    return Number(item.gradeValue);
  }
  return fromPerformanceScore(displayScale, Number(item.performanceScore));
}

export function computeCourseAverage(
  items: GradeAverageInputItem[],
  options: { displayScale: GradeScale; includeTermGrade: boolean }
) {
  const includeTermGrade = Boolean(options.includeTermGrade);
  const displayScale = options.displayScale;
  const isBulgarian = displayScale === "bulgarian";

  const filtered = isBulgarian
    ? items.filter((item) => {
        const category = normalizeCategoryName(item.categoryName);
        if (category === "current") return true;
        if (includeTermGrade && category === "term grade") return true;
        return false;
      })
    : items;

  if (!filtered.length) {
    return { averageValue: null, normalizedScore: null, itemCount: 0 };
  }

  let weightedValue = 0;
  let weightedScore = 0;
  let totalWeight = 0;
  for (const item of filtered) {
    const category = normalizeCategoryName(item.categoryName);
    const effectiveWeight =
      isBulgarian && category === "term grade"
        ? 1
        : Math.max(0.05, Number(item.weight || 1));
    const displayValue = toDisplayValue(item, displayScale);
    weightedValue += displayValue * effectiveWeight;
    weightedScore += Number(item.performanceScore) * effectiveWeight;
    totalWeight += effectiveWeight;
  }

  if (totalWeight <= 0) {
    return { averageValue: null, normalizedScore: null, itemCount: 0 };
  }

  return {
    averageValue: weightedValue / totalWeight,
    normalizedScore: weightedScore / totalWeight,
    itemCount: filtered.length,
  };
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

function parseGradeRiskSettingsJson(value: string | null) {
  if (!value) return DEFAULT_GRADE_RISK_SETTINGS;
  try {
    const parsed = JSON.parse(value) as Partial<GradeRiskSettings>;
    return normalizeGradeRiskSettings(parsed);
  } catch {
    return DEFAULT_GRADE_RISK_SETTINGS;
  }
}

export async function getGradeRiskSettings(userId: string) {
  const rows = await prisma.$queryRaw<Array<{ config_json: string | null }>>`
    SELECT config_json
    FROM user_grade_risk_preferences
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return parseGradeRiskSettingsJson(rows[0]?.config_json ?? null);
}

export async function setGradeRiskSettings(
  userId: string,
  settings: Partial<GradeRiskSettings> | null | undefined,
) {
  const normalized = normalizeGradeRiskSettings(settings);
  await prisma.$executeRaw`
    INSERT INTO user_grade_risk_preferences (user_id, config_json)
    VALUES (${userId}, ${JSON.stringify(normalized)})
    ON DUPLICATE KEY UPDATE config_json = VALUES(config_json)
  `;
  return normalized;
}

function parseCelebrationSettingsJson(value: string | null) {
  if (!value) return DEFAULT_CELEBRATION_SETTINGS;
  try {
    const parsed = JSON.parse(value) as Partial<CelebrationSettings>;
    return normalizeCelebrationSettings(parsed);
  } catch {
    return DEFAULT_CELEBRATION_SETTINGS;
  }
}

export async function getCelebrationSettings(userId: string) {
  const rows = await prisma.$queryRaw<Array<{ config_json: string | null }>>`
    SELECT config_json
    FROM user_celebration_preferences
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return parseCelebrationSettingsJson(rows[0]?.config_json ?? null);
}

export async function setCelebrationSettings(
  userId: string,
  settings: Partial<CelebrationSettings> | null | undefined,
) {
  const normalized = normalizeCelebrationSettings(settings);
  await prisma.$executeRaw`
    INSERT INTO user_celebration_preferences (user_id, config_json)
    VALUES (${userId}, ${JSON.stringify(normalized)})
    ON DUPLICATE KEY UPDATE config_json = VALUES(config_json)
  `;
  return normalized;
}

export type CourseCelebrationRecord = {
  courseId: string;
  lastCelebratedAt: string;
  lastCelebratedScore: number | null;
  lastCelebratedType: string | null;
};

export async function getCourseCelebrationRecords(userId: string) {
  const rows = await prisma.$queryRaw<
    Array<{
      course_id: string;
      last_celebrated_at: Date;
      last_celebrated_score: number | null;
      last_celebrated_type: string | null;
    }>
  >`
    SELECT course_id, last_celebrated_at, last_celebrated_score, last_celebrated_type
    FROM user_course_celebrations
    WHERE user_id = ${userId}
  `;
  return rows.map((row) => ({
    courseId: row.course_id,
    lastCelebratedAt: row.last_celebrated_at.toISOString(),
    lastCelebratedScore: row.last_celebrated_score == null ? null : Number(row.last_celebrated_score),
    lastCelebratedType: row.last_celebrated_type,
  })) as CourseCelebrationRecord[];
}

export async function recordCourseCelebration(
  userId: string,
  payload: {
    courseId: string;
    score: number | null;
    type: CelebrationShowFor | "manual";
  },
) {
  const score =
    payload.score == null || !Number.isFinite(payload.score)
      ? null
      : clamp(Number(payload.score), 0, 100);
  await prisma.$executeRaw`
    INSERT INTO user_course_celebrations (user_id, course_id, last_celebrated_at, last_celebrated_score, last_celebrated_type)
    VALUES (${userId}, ${payload.courseId}, NOW(), ${score}, ${payload.type})
    ON DUPLICATE KEY UPDATE
      last_celebrated_at = VALUES(last_celebrated_at),
      last_celebrated_score = VALUES(last_celebrated_score),
      last_celebrated_type = VALUES(last_celebrated_type)
  `;
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

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS user_grade_risk_preferences (
      user_id VARCHAR(191) NOT NULL PRIMARY KEY,
      config_json TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS user_celebration_preferences (
      user_id VARCHAR(191) NOT NULL PRIMARY KEY,
      config_json TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS user_course_celebrations (
      user_id VARCHAR(191) NOT NULL,
      course_id VARCHAR(191) NOT NULL,
      last_celebrated_at DATETIME NOT NULL,
      last_celebrated_score DECIMAL(7,3) NULL,
      last_celebrated_type VARCHAR(32) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, course_id),
      INDEX idx_course_celebrations_user_date (user_id, last_celebrated_at)
    )
  `);
}
