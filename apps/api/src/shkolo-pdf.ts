export type ShkoloParsedRow = {
  extractedSubject: string;
  currentGrades: number[];
  term1: number | null;
  term2: number | null;
  t1CurrentGrades?: number[];
  t2CurrentGrades?: number[];
  t1FinalGrade?: number | null;
  t2FinalGrade?: number | null;
  yearFinalGrade?: number | null;
  rawRowText?: string;
  parseWarnings?: string[];
  term1Final?: number | null;
  term2Final?: number | null;
  yearFinal?: number | null;
  confidence?: number;
};

export type ShkoloParsedResult = {
  detectedYear: string | null;
  rows: ShkoloParsedRow[];
  skippedLines: number;
  parseWarnings?: string[];
};

export type ShkoloPdfPageText = {
  page: number;
  text: string;
};

export type ShkoloPdfPageItem = {
  page: number;
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ShkoloPdfExtractedContent = {
  pages: ShkoloPdfPageText[];
  pageItemsByPage?: Record<number, ShkoloPdfPageItem[]>;
};

type ShkoloRowCluster = {
  page: number;
  y: number;
  items: ShkoloPdfPageItem[];
  rowText: string;
};

type ShkoloColumnBoundaries = {
  subjectMaxX: number;
  t1StartX: number;
  t1FinalX: number;
  t2StartX: number;
  t2FinalX: number;
  yearStartX: number;
};

const GRADE_TOKEN_REGEX = /\b([2-6](?:[.,]\d{1,2})?)\b/g;
const SUBJECT_START_REGEX = /^(\d{1,2})[.)]?\s+(\p{L}.*)$/u;
const SUBJECT_LABELS = [
  "Първи срок",
  "Втори срок",
  "Текущи",
  "Срочна",
  "Годишна",
] as const;

export type ShkoloDiaryRow = {
  index: number;
  extractedSubject: string;
  currentGrades: number[];
  tokens: number[];
  rawBlock: string;
  rawBlockSample: string;
  term1Final: number | null;
  term2Final: number | null;
  yearFinal: number | null;
  confidence: number;
  last15Tokens: number[];
};

export type ShkoloDiaryParseResult = {
  rows: ShkoloDiaryRow[];
  skippedLines: number;
};

function normalizeText(value: string) {
  return value
    .replace(/\u00A0/g, " ")
    .replace(/\t/g, " ")
    .replace(/[\uE000-\uF8FF]/g, " ")
    .replace(/[•●■◆★☆☑✓✔✕✖✗✘]/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\r/g, "")
    .trim();
}

function normalizeYear(value: string) {
  return value.replace(/\s+/g, "").replace("-", "/");
}

function detectYear(text: string): string | null {
  const explicit = text.match(
    /Учебна\s+година\s*[:\-]?\s*((?:20\d{2})\s*[\/-]\s*(?:20\d{2}|\d{2}))/i,
  );
  if (explicit?.[1]) return normalizeYear(explicit[1]);

  const generic = text.match(/((?:20\d{2})\s*[\/-]\s*(?:20\d{2}|\d{2}))/);
  if (generic?.[1]) return normalizeYear(generic[1]);

  return null;
}

function parseGradeToken(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

type GradeTokenMeta = { value: number; start: number; end: number };

function extractGradeTokens(text: string) {
  const matches = text.matchAll(GRADE_TOKEN_REGEX);
  const tokens: number[] = [];
  for (const match of matches) {
    const raw = match[1];
    if (!raw) continue;
    const parsed = parseGradeToken(raw);
    if (parsed != null) tokens.push(parsed);
  }
  return tokens;
}

function extractGradeTokensWithMeta(text: string) {
  const matches = text.matchAll(GRADE_TOKEN_REGEX);
  const tokens: GradeTokenMeta[] = [];
  for (const match of matches) {
    const raw = match[1];
    const start = match.index ?? -1;
    if (!raw || start < 0) continue;
    const parsed = parseGradeToken(raw);
    if (parsed == null) continue;
    tokens.push({
      value: parsed,
      start,
      end: start + raw.length,
    });
  }
  return tokens;
}

function extractSection(block: string, startLabel: string, endLabels: string[]) {
  const start = block.search(new RegExp(startLabel, "i"));
  if (start < 0) return "";
  const tail = block.slice(start);

  let end = tail.length;
  for (const label of endLabels) {
    const idx = tail.search(new RegExp(label, "i"));
    if (idx > 0 && idx < end) end = idx;
  }

  return tail.slice(0, end);
}

function buildSubjectName(lines: string[], index: number) {
  const parts: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = i === 0
      ? lines[i]?.replace(new RegExp(`^${index}[.)]?\\s+`), "").trim() ?? ""
      : lines[i] ?? "";
    if (!line) continue;

    const lower = line.toLowerCase();
    let labelIdx = -1;
    for (const label of SUBJECT_LABELS) {
      const idx = lower.indexOf(label.toLowerCase());
      if (idx >= 0 && (labelIdx < 0 || idx < labelIdx)) labelIdx = idx;
    }
    const gradeIdx = line.search(/\b[2-6](?:[.,]\d{1,2})?\b/);
    const stopIdxCandidates = [labelIdx, gradeIdx].filter((value) => value >= 0);
    const stopIdx =
      stopIdxCandidates.length > 0 ? Math.min(...stopIdxCandidates) : -1;
    const candidate =
      stopIdx >= 0 ? line.slice(0, stopIdx).trim() : line.trim();

    if (candidate) {
      parts.push(candidate);
    }
    if (stopIdx >= 0) break;
  }

  const subject = normalizeSubject(parts.join(" "));
  if (subject) return subject;

  const fallback = lines[0]?.replace(new RegExp(`^${index}[.)]?\\s+`), "") ?? "";
  return normalizeSubject(fallback);
}

function extractCurrentGrades(section: string) {
  const matches = section.matchAll(
    /Текущи\s*[:\-]?\s*([\s\S]*?)(?=(Срочна|Текущи|Годишна|$))/gi,
  );
  const grades: number[] = [];

  for (const match of matches) {
    const segment = match[1];
    if (!segment) continue;
    grades.push(...extractGradeTokens(segment));
  }

  return grades;
}

function extractTermFinal(section: string) {
  const match = section.match(/Срочна\s*[:\-]?\s*([2-6](?:[.,]\d{1,2})?)/i);
  if (!match?.[1]) return null;
  return parseGradeToken(match[1]);
}

function extractYearFinal(block: string) {
  const match = block.match(/Годишна\s*[:\-]?\s*([2-6](?:[.,]\d{1,2})?)/i);
  if (!match?.[1]) return null;
  return parseGradeToken(match[1]);
}

function normalizeSubject(value: string) {
  return value
    .replace(/^\d+\s*[.)]\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:|,-]+|[\s:|,-]+$/g, "")
    .trim();
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

function isGarbageRow(text: string) {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) return true;
  if (/средноаритметично/i.test(normalized)) return true;
  if (/shkolo\s*дневник/i.test(normalized)) return true;
  if (/https?:\/\/app\.shkolo\.bg/i.test(normalized)) return true;
  if (/^\d+\s*\/\s*\d+$/.test(normalized)) return true;
  if (/^[.\s…]+$/.test(normalized)) return true;
  if (/^\(\s*\.\.\.\s*\)$/.test(normalized)) return true;
  return false;
}

function hasHeaderKeywords(row: ShkoloRowCluster) {
  const lower = row.rowText.toLowerCase();
  return (
    lower.includes("първи срок") ||
    lower.includes("втори срок") ||
    lower.includes("годишна") ||
    lower.includes("текущи") ||
    lower.includes("срочна")
  );
}

function getKeywordXs(rows: ShkoloRowCluster[], keyword: string) {
  const out: number[] = [];
  const target = keyword.toLowerCase();
  const usePairDetection = target.includes(" ");
  for (const row of rows) {
    const sorted = row.items
      .slice()
      .sort((a, b) => a.x - b.x)
      .map((item) => ({ ...item, lower: normalizeText(item.str).toLowerCase() }));
    for (let index = 0; index < sorted.length; index += 1) {
      const item = sorted[index];
      if (!item || !item.lower) continue;
      if (item.lower.includes(target)) {
        out.push(item.x);
      }
      const next = sorted[index + 1];
      if (usePairDetection && next) {
        const pair = `${item.lower} ${next.lower}`;
        if (pair.includes(target)) {
          out.push(Math.min(item.x, next.x));
        }
      }
    }
  }
  return out.sort((a, b) => a - b);
}

export function groupItemsIntoRows(items: ShkoloPdfPageItem[], yTolerance = 1.9) {
  const sorted = items
    .slice()
    .filter((item) => normalizeText(item.str).length > 0)
    .sort((a, b) => {
      if (a.page !== b.page) return a.page - b.page;
      if (Math.abs(a.y - b.y) > 0.001) return b.y - a.y;
      return a.x - b.x;
    });

  const rows: ShkoloRowCluster[] = [];
  for (const item of sorted) {
    const last = rows[rows.length - 1];
    if (!last || last.page !== item.page || Math.abs(item.y - last.y) > yTolerance) {
      rows.push({ page: item.page, y: item.y, items: [item], rowText: normalizeText(item.str) });
      continue;
    }

    last.items.push(item);
    last.y = median(last.items.map((value) => value.y));
    last.items.sort((a, b) => a.x - b.x);
    last.rowText = normalizeText(last.items.map((value) => value.str).join(" "));
  }

  return rows;
}

export function detectColumnBoundaries(rows: ShkoloRowCluster[]): ShkoloColumnBoundaries | null {
  const headerRows = rows.filter((row) => hasHeaderKeywords(row));
  if (!headerRows.length) return null;

  const currentXs = getKeywordXs(headerRows, "текущи");
  const finalXs = getKeywordXs(headerRows, "срочна");
  const term1Xs = getKeywordXs(headerRows, "първи срок");
  const term2Xs = getKeywordXs(headerRows, "втори срок");
  const yearXs = getKeywordXs(headerRows, "годишна");

  const term1X = term1Xs[0] ?? currentXs[0] ?? finalXs[0] ?? 190;
  const term2X = term2Xs[0] ?? currentXs[1] ?? finalXs[1] ?? term1X + 150;
  const yearX = yearXs[0] ?? finalXs[2] ?? term2X + 130;

  const t1StartX = Math.min(term1X, currentXs[0] ?? term1X);
  const t2StartX = Math.min(term2X, currentXs[1] ?? term2X);
  const t1FinalX =
    finalXs.find((x) => x > t1StartX + 8 && x < t2StartX - 6) ??
    ((t1StartX + t2StartX) / 2);
  const t2FinalX =
    finalXs.find((x) => x > t2StartX + 8 && x < yearX - 6) ??
    ((t2StartX + yearX) / 2);
  const subjectMaxX = Math.max(85, Math.min(t1StartX, term1X) - 14);

  return {
    subjectMaxX,
    t1StartX,
    t1FinalX,
    t2StartX,
    t2FinalX,
    yearStartX: Math.max(yearX, t2FinalX + 10),
  };
}

function extractGradeTokensFromItems(items: ShkoloPdfPageItem[]) {
  const values: number[] = [];
  for (const item of items) {
    const matches = normalizeText(item.str).matchAll(GRADE_TOKEN_REGEX);
    for (const match of matches) {
      const token = match[1];
      if (!token) continue;
      const parsed = parseGradeToken(token);
      if (parsed != null) values.push(parsed);
    }
  }
  return values;
}

function isSubjectStartRow(row: ShkoloRowCluster, subjectMaxX: number) {
  const leftItems = row.items.filter((item) => item.x <= subjectMaxX + 4).sort((a, b) => a.x - b.x);
  const leftText = normalizeText(leftItems.map((item) => item.str).join(" "));
  const match = leftText.match(/^(\d{1,2})[.)]?\s+(.+)$/u);
  return {
    isStart: Boolean(match),
    index: match?.[1] ? Number(match[1]) : null,
    subjectChunk: match?.[2] ?? "",
  };
}

function dedupeNearbyValues(values: number[]) {
  if (!values.length) return values;
  const sorted = values.slice().sort((a, b) => a - b);
  const deduped: number[] = [sorted[0] ?? 0];
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index] ?? 0;
    const last = deduped[deduped.length - 1] ?? 0;
    if (Math.abs(current - last) < 0.01) continue;
    deduped.push(current);
  }
  return deduped;
}

export function parseShkoloPageItems(
  itemsByPage: Record<number, ShkoloPdfPageItem[]>,
  yTolerance = 1.9
): { rows: ShkoloParsedRow[]; skippedRows: number; parseWarnings: string[] } {
  const allItems = Object.values(itemsByPage).flatMap((items) => items);
  const rows = groupItemsIntoRows(allItems, yTolerance);
  const boundaries = detectColumnBoundaries(rows);
  if (!boundaries) {
    return {
      rows: [],
      skippedRows: rows.length,
      parseWarnings: ["Could not detect table headers/column boundaries."],
    };
  }

  const parseWarnings: string[] = [];
  const parsedRows: ShkoloParsedRow[] = [];
  let skippedRows = 0;
  let current: {
    index: number;
    subjectParts: string[];
    t1Current: number[];
    t1Final: number[];
    t2Current: number[];
    t2Final: number[];
    yearFinal: number[];
    rawRows: string[];
    parseWarnings: string[];
  } | null = null;

  const flushCurrent = () => {
    if (!current) return;
    const subjectName = normalizeSubject(current.subjectParts.join(" "));
    if (!subjectName || !isSubjectLike(subjectName)) {
      skippedRows += current.rawRows.length;
      current = null;
      return;
    }

    current.t1Current = dedupeNearbyValues(current.t1Current);
    current.t2Current = dedupeNearbyValues(current.t2Current);
    current.t1Final = dedupeNearbyValues(current.t1Final);
    current.t2Final = dedupeNearbyValues(current.t2Final);
    current.yearFinal = dedupeNearbyValues(current.yearFinal);

    if (!current.t1Current.length && !current.t2Current.length) {
      current.parseWarnings.push("No current grades detected in table regions.");
    }
    if (!current.t1Final.length) current.parseWarnings.push("No term 1 final detected.");
    if (!current.t2Final.length) current.parseWarnings.push("No term 2 final detected.");

    parsedRows.push({
      extractedSubject: subjectName,
      currentGrades: [...current.t1Current, ...current.t2Current],
      term1: current.t1Final.length ? current.t1Final[current.t1Final.length - 1] ?? null : null,
      term2: current.t2Final.length ? current.t2Final[current.t2Final.length - 1] ?? null : null,
      t1CurrentGrades: current.t1Current,
      t2CurrentGrades: current.t2Current,
      t1FinalGrade: current.t1Final.length ? current.t1Final[current.t1Final.length - 1] ?? null : null,
      t2FinalGrade: current.t2Final.length ? current.t2Final[current.t2Final.length - 1] ?? null : null,
      yearFinalGrade: current.yearFinal.length ? current.yearFinal[current.yearFinal.length - 1] ?? null : null,
      term1Final: current.t1Final.length ? current.t1Final[current.t1Final.length - 1] ?? null : null,
      term2Final: current.t2Final.length ? current.t2Final[current.t2Final.length - 1] ?? null : null,
      yearFinal: current.yearFinal.length ? current.yearFinal[current.yearFinal.length - 1] ?? null : null,
      rawRowText: current.rawRows.join("\n"),
      parseWarnings: current.parseWarnings,
      confidence: 0.9,
    });
    current = null;
  };

  for (const row of rows) {
    if (isGarbageRow(row.rowText)) {
      skippedRows += 1;
      continue;
    }
    if (hasHeaderKeywords(row)) continue;

    const start = isSubjectStartRow(row, boundaries.subjectMaxX);
    if (start.isStart && start.index != null) {
      flushCurrent();
      current = {
        index: start.index,
        subjectParts: [start.subjectChunk],
        t1Current: [],
        t1Final: [],
        t2Current: [],
        t2Final: [],
        yearFinal: [],
        rawRows: [row.rowText],
        parseWarnings: [],
      };
    } else if (!current) {
      skippedRows += 1;
      continue;
    } else {
      current.rawRows.push(row.rowText);
    }

    if (!current) continue;

    const leftRegion = row.items.filter((item) => item.x <= boundaries.subjectMaxX);
    const rowSubjectText = normalizeSubject(leftRegion.map((item) => item.str).join(" "));
    if (!start.isStart && rowSubjectText && !/^[2-6](?:[.,]\d+)?$/.test(rowSubjectText)) {
      current.subjectParts.push(rowSubjectText);
    }

    const t1CurrentItems = row.items.filter(
      (item) => item.x >= boundaries.t1StartX && item.x < boundaries.t1FinalX
    );
    const t1FinalItems = row.items.filter(
      (item) => item.x >= boundaries.t1FinalX && item.x < boundaries.t2StartX
    );
    const t2CurrentItems = row.items.filter(
      (item) => item.x >= boundaries.t2StartX && item.x < boundaries.t2FinalX
    );
    const t2FinalItems = row.items.filter(
      (item) => item.x >= boundaries.t2FinalX && item.x < boundaries.yearStartX
    );
    const yearItems = row.items.filter((item) => item.x >= boundaries.yearStartX);

    current.t1Current.push(...extractGradeTokensFromItems(t1CurrentItems));
    current.t1Final.push(...extractGradeTokensFromItems(t1FinalItems));
    current.t2Current.push(...extractGradeTokensFromItems(t2CurrentItems));
    current.t2Final.push(...extractGradeTokensFromItems(t2FinalItems));
    current.yearFinal.push(...extractGradeTokensFromItems(yearItems));

    const regionTokenCount =
      current.t1Current.length +
      current.t1Final.length +
      current.t2Current.length +
      current.t2Final.length +
      current.yearFinal.length;
    if (regionTokenCount === 0) {
      current.parseWarnings.push(
        `No grade tokens mapped for row "${row.rowText.slice(0, 120)}".`,
      );
    }
  }

  flushCurrent();

  if (!parsedRows.length) {
    parseWarnings.push("Coordinate parser found no subject rows.");
  }

  return {
    rows: parsedRows,
    skippedRows,
    parseWarnings,
  };
}

function isSubjectLike(value: string) {
  if (!value || value.length < 2) return false;
  if (/Средноаритметично/i.test(value)) return false;
  if (/^(Предмет|Учебна година|Срок|Текущи|Срочна|Годишна)/i.test(value))
    return false;
  return true;
}

function extractSubjectFromBlock(block: string) {
  const normalized = normalizeText(block);
  const numbered = normalized.match(
    /^\d+\s*[.)]\s*(.+?)(?=\s*(Първи срок|Втори срок|Текущи|Срочна|Годишна|$))/i,
  );
  if (numbered?.[1]) return normalizeSubject(numbered[1]);

  const lower = normalized.toLowerCase();
  let split = -1;
  for (const label of SUBJECT_LABELS) {
    const idx = lower.indexOf(label.toLowerCase());
    if (idx > 0 && (split < 0 || idx < split)) split = idx;
  }
  if (split > 0) return normalizeSubject(normalized.slice(0, split));

  const firstGrade = normalized.search(/\b[2-6](?:[.,]\d{1,2})?\b/);
  if (firstGrade > 0) return normalizeSubject(normalized.slice(0, firstGrade));

  return "";
}

function parseRowFromBlock(block: string): ShkoloParsedRow | null {
  const subject = extractSubjectFromBlock(block);
  if (!isSubjectLike(subject)) return null;

  const term1Section = extractSection(block, "Първи срок", ["Втори срок", "Годишна"]);
  const term2Section = extractSection(block, "Втори срок", ["Годишна"]);
  const currentGrades = [
    ...extractCurrentGrades(term1Section),
    ...extractCurrentGrades(term2Section),
  ];

  const term1 = extractTermFinal(term1Section);
  const term2 = extractTermFinal(term2Section);

  if (!currentGrades.length && term1 == null && term2 == null) return null;

  return {
    extractedSubject: subject,
    currentGrades,
    term1,
    term2,
  };
}

function parseLineFallback(line: string): ShkoloParsedRow | null {
  const normalized = normalizeText(line);
  if (!normalized) return null;
  if (!extractGradeTokens(normalized).length) return null;

  const subject = extractSubjectFromBlock(normalized);
  if (!isSubjectLike(subject)) return null;

  const term1 = normalized.includes("Първи срок")
    ? extractTermFinal(normalized)
    : null;
  const term2 = normalized.includes("Втори срок")
    ? extractTermFinal(normalized)
    : null;
  const currentGrades = extractCurrentGrades(normalized);
  const fallbackCurrent =
    currentGrades.length > 0 ? currentGrades : extractGradeTokens(normalized);

  return {
    extractedSubject: subject,
    currentGrades: fallbackCurrent,
    term1,
    term2,
  };
}

type SubjectHeuristicResult = {
  currentGrades: number[];
  term1Final: number | null;
  term2Final: number | null;
  yearFinal: number | null;
  confidence: number;
  last15Tokens: number[];
};

function resolveSubjectGradesHeuristics(block: string): SubjectHeuristicResult {
  const term1Section = extractSection(block, "Първи срок", ["Втори срок", "Годишна"]);
  const term2Section = extractSection(block, "Втори срок", ["Годишна"]);
  const labeledCurrent = [
    ...extractCurrentGrades(term1Section),
    ...extractCurrentGrades(term2Section),
  ];
  const tokenMeta = extractGradeTokensWithMeta(block);
  const tokens = tokenMeta.map((token) => token.value);
  const hasTerm1Label = /Първи срок/i.test(block);
  const hasTerm2Label = /Втори срок/i.test(block);
  const hasYearLabel = /Годишна/i.test(block);

  let term1Final = extractTermFinal(term1Section);
  let term2Final = extractTermFinal(term2Section);
  let yearFinal = extractYearFinal(block);

  const tail = tokens.slice();
  const chosenFromTail: number[] = [];
  const pickFromTail = () => {
    if (!tail.length) return null;
    const value = tail.pop() ?? null;
    if (value != null) chosenFromTail.push(value);
    return value;
  };

  if (yearFinal == null && hasYearLabel) yearFinal = pickFromTail();

  if (hasTerm1Label && hasTerm2Label) {
    if (term2Final == null) term2Final = pickFromTail();
    if (term1Final == null) term1Final = pickFromTail();
  } else if (hasTerm1Label && term1Final == null) {
    term1Final = pickFromTail();
  } else if (hasTerm2Label && term2Final == null) {
    term2Final = pickFromTail();
  } else if ((term1Final == null || term2Final == null) && tokens.length >= 2) {
    // Weak fallback when labels are noisy/missing.
    if (term2Final == null) term2Final = pickFromTail();
    if (term1Final == null) term1Final = pickFromTail();
  }

  let confidence = 0;
  if (extractTermFinal(term1Section) != null) confidence += 0.4;
  if (extractTermFinal(term2Section) != null) confidence += 0.4;
  if (extractYearFinal(block) != null) confidence += 0.15;
  if (chosenFromTail.length > 0) confidence += Math.min(0.2, chosenFromTail.length * 0.08);
  if (labeledCurrent.length > 0) confidence += 0.1;
  confidence = Math.min(1, Math.max(0, confidence));

  const fallbackCurrent = tail.filter((token) => Number.isFinite(token));
  return {
    currentGrades:
      labeledCurrent.length > 0 ? labeledCurrent : fallbackCurrent,
    term1Final,
    term2Final,
    yearFinal,
    confidence,
    last15Tokens: tokens.slice(-15),
  };
}

function toDiaryRow(blockLines: string[]): ShkoloDiaryRow | null {
  const first = blockLines[0] ?? "";
  const startMatch = first.match(SUBJECT_START_REGEX);
  if (!startMatch?.[1]) return null;
  const index = Number(startMatch[1]);
  if (!Number.isFinite(index)) return null;

  const firstLine = (blockLines[0] ?? "").replace(
    new RegExp(`^${index}[.)]?\\s+`),
    "",
  );
  const rawBlock = normalizeText([firstLine, ...blockLines.slice(1)].join("\n"));
  const extractedSubject = buildSubjectName(blockLines, index);
  if (!isSubjectLike(extractedSubject)) return null;

  return {
    index,
    extractedSubject,
    tokens: extractGradeTokens(rawBlock),
    rawBlock,
    rawBlockSample: rawBlock.slice(0, 500),
    ...resolveSubjectGradesHeuristics(rawBlock),
  };
}

export function parseShkoloDiaryText(pagesText: string[]): ShkoloDiaryParseResult {
  const lines = pagesText
    .flatMap((page) => page.split("\n"))
    .map((line) => normalizeText(line))
    .filter(Boolean);

  const rows: ShkoloDiaryRow[] = [];
  let skippedLines = 0;
  let currentBlock: string[] = [];

  const flushCurrent = () => {
    if (!currentBlock.length) return;
    const row = toDiaryRow(currentBlock);
    if (row) {
      rows.push(row);
    } else {
      skippedLines += currentBlock.length;
    }
    currentBlock = [];
  };

  for (const line of lines) {
    if (SUBJECT_START_REGEX.test(line)) {
      flushCurrent();
      currentBlock = [line];
      continue;
    }

    if (currentBlock.length) {
      currentBlock.push(line);
    } else {
      skippedLines += 1;
    }
  }

  flushCurrent();
  return { rows, skippedLines };
}

function mergeRows(rows: ShkoloParsedRow[]) {
  const bySubject = new Map<string, ShkoloParsedRow>();

  for (const row of rows) {
    const key = row.extractedSubject.toLowerCase();
    const existing = bySubject.get(key);
    if (!existing) {
      const baseRow: ShkoloParsedRow = {
        extractedSubject: row.extractedSubject,
        currentGrades: [...row.currentGrades],
        term1: row.term1,
        term2: row.term2,
        term1Final: row.term1Final ?? row.term1 ?? null,
        term2Final: row.term2Final ?? row.term2 ?? null,
        yearFinal: row.yearFinal ?? null,
        confidence: row.confidence ?? 0,
        t1FinalGrade: row.t1FinalGrade ?? row.term1Final ?? row.term1 ?? null,
        t2FinalGrade: row.t2FinalGrade ?? row.term2Final ?? row.term2 ?? null,
        yearFinalGrade: row.yearFinalGrade ?? row.yearFinal ?? null,
      };
      if (row.t1CurrentGrades) baseRow.t1CurrentGrades = [...row.t1CurrentGrades];
      if (row.t2CurrentGrades) baseRow.t2CurrentGrades = [...row.t2CurrentGrades];
      if (row.rawRowText) baseRow.rawRowText = row.rawRowText;
      if (row.parseWarnings?.length) baseRow.parseWarnings = [...row.parseWarnings];
      bySubject.set(key, baseRow);
      continue;
    }

    existing.currentGrades.push(...row.currentGrades);
    if (row.t1CurrentGrades?.length) {
      existing.t1CurrentGrades = [...(existing.t1CurrentGrades ?? []), ...row.t1CurrentGrades];
    }
    if (row.t2CurrentGrades?.length) {
      existing.t2CurrentGrades = [...(existing.t2CurrentGrades ?? []), ...row.t2CurrentGrades];
    }
    if (existing.term1 == null && row.term1 != null) existing.term1 = row.term1;
    if (existing.term2 == null && row.term2 != null) existing.term2 = row.term2;
    if ((existing.term1Final ?? null) == null && (row.term1Final ?? row.term1 ?? null) != null) {
      existing.term1Final = row.term1Final ?? row.term1 ?? null;
    }
    if ((existing.term2Final ?? null) == null && (row.term2Final ?? row.term2 ?? null) != null) {
      existing.term2Final = row.term2Final ?? row.term2 ?? null;
    }
    if ((existing.yearFinal ?? null) == null && row.yearFinal != null) {
      existing.yearFinal = row.yearFinal;
    }
    if ((existing.t1FinalGrade ?? null) == null && (row.t1FinalGrade ?? null) != null) {
      existing.t1FinalGrade = row.t1FinalGrade ?? null;
    }
    if ((existing.t2FinalGrade ?? null) == null && (row.t2FinalGrade ?? null) != null) {
      existing.t2FinalGrade = row.t2FinalGrade ?? null;
    }
    if ((existing.yearFinalGrade ?? null) == null && (row.yearFinalGrade ?? null) != null) {
      existing.yearFinalGrade = row.yearFinalGrade ?? null;
    }
    if (!existing.rawRowText && row.rawRowText) {
      existing.rawRowText = row.rawRowText;
    }
    if (row.parseWarnings?.length) {
      existing.parseWarnings = [...(existing.parseWarnings ?? []), ...row.parseWarnings];
    }
    existing.confidence = Math.max(existing.confidence ?? 0, row.confidence ?? 0);
  }

  return Array.from(bySubject.values()).map((row) => {
    const normalized: ShkoloParsedRow = {
      ...row,
      currentGrades: row.currentGrades.filter((grade) => Number.isFinite(grade)),
    };
    if (row.t1CurrentGrades) {
      normalized.t1CurrentGrades = row.t1CurrentGrades.filter((grade) =>
        Number.isFinite(grade),
      );
    }
    if (row.t2CurrentGrades) {
      normalized.t2CurrentGrades = row.t2CurrentGrades.filter((grade) =>
        Number.isFinite(grade),
      );
    }
    if (row.parseWarnings?.length) {
      normalized.parseWarnings = Array.from(new Set(row.parseWarnings));
    }
    return normalized;
  });
}

export function parseShkoloPages(
  pages: ShkoloPdfPageText[],
  options: { pageItemsByPage?: Record<number, ShkoloPdfPageItem[]> } = {},
): ShkoloParsedResult {
  const allText = pages.map((page) => page.text).join("\n");
  const normalizedAll = normalizeText(allText);
  const detectedYear = detectYear(normalizedAll);
  const coordinateParsed =
    options.pageItemsByPage && Object.keys(options.pageItemsByPage).length > 0
      ? parseShkoloPageItems(options.pageItemsByPage)
      : null;
  const diary = parseShkoloDiaryText(pages.map((page) => page.text));
  const rows: ShkoloParsedRow[] = [];
  let skippedLines = diary.skippedLines + (coordinateParsed?.skippedRows ?? 0);
  const parseWarnings = coordinateParsed?.parseWarnings
    ? [...coordinateParsed.parseWarnings]
    : [];

  if (coordinateParsed?.rows.length) {
    rows.push(...coordinateParsed.rows);
  }

  if (!rows.length) {
    for (const diaryRow of diary.rows) {
      rows.push({
        extractedSubject: diaryRow.extractedSubject,
        currentGrades: diaryRow.currentGrades,
        term1: diaryRow.term1Final,
        term2: diaryRow.term2Final,
        term1Final: diaryRow.term1Final,
        term2Final: diaryRow.term2Final,
        yearFinal: diaryRow.yearFinal,
        confidence: diaryRow.confidence,
      });
    }
  }

  if (!rows.length) {
    for (const page of pages) {
      const lines = page.text.split("\n");
      for (const line of lines) {
        const parsed = parseLineFallback(line);
        if (!parsed) {
          skippedLines += 1;
          continue;
        }
        rows.push(parsed);
      }
    }
  }

  return {
    detectedYear,
    rows: mergeRows(rows),
    skippedLines,
    parseWarnings,
  };
}

export async function extractShkoloPdfPages(
  input: Buffer,
  options: { debugEnabled?: boolean } = {}
): Promise<ShkoloPdfExtractedContent> {
  const debugEnabled = Boolean(options.debugEnabled);
  const pdfModulePath = "pdfjs-dist/legacy/build/pdf.mjs";
  const pdfjs = await import(pdfModulePath);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(input),
    disableWorker: true,
    isEvalSupported: false,
  });
  const document = await loadingTask.promise;

  const pages: ShkoloPdfPageText[] = [];
  const pageItemsByPage: Record<number, ShkoloPdfPageItem[]> = {};

  for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex += 1) {
    const page = await document.getPage(pageIndex);
    const content = await page.getTextContent();
    const items: ShkoloPdfPageItem[] = [];
    const lines: string[] = [];

    for (const rawItem of content.items as Array<Record<string, unknown>>) {
      const str = typeof rawItem.str === "string" ? rawItem.str : "";
      if (!str.trim()) continue;
      const transform = Array.isArray(rawItem.transform)
        ? (rawItem.transform as number[])
        : [0, 0, 0, 0, 0, 0];
      const width = Number(rawItem.width ?? 0);
      const height = Number(rawItem.height ?? 0);
      const x = Number(transform[4] ?? 0);
      const y = Number(transform[5] ?? 0);

      items.push({
        page: pageIndex,
        str,
        x,
        y,
        width,
        height,
      });
      lines.push(str);
    }

    pages.push({
      page: pageIndex,
      text: normalizeText(lines.join("\n")),
    });

    if (debugEnabled) {
      pageItemsByPage[pageIndex] = items;
    }
  }

  await loadingTask.destroy();
  if (debugEnabled) {
    return {
      pages,
      pageItemsByPage,
    };
  }
  return { pages };
}

export async function renderPdfPagesToPng(input: Buffer) {
  const { pdf } = await import("pdf-to-img");
  const document = await pdf(input, { scale: 2 });
  const pages: Array<{ page: number; image: Buffer }> = [];
  let index = 1;
  for await (const image of document) {
    pages.push({ page: index, image });
    index += 1;
  }
  return pages;
}
