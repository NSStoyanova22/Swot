import { PDFParse } from "pdf-parse";

export type ShkoloParsedRow = {
  extractedSubject: string;
  currentGrades: number[];
  term1: number | null;
  term2: number | null;
  term1Final?: number | null;
  term2Final?: number | null;
  yearFinal?: number | null;
  confidence?: number;
};

export type ShkoloParsedResult = {
  detectedYear: string | null;
  rows: ShkoloParsedRow[];
  skippedLines: number;
};

export type ShkoloPdfPageText = {
  page: number;
  text: string;
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
      bySubject.set(key, {
        extractedSubject: row.extractedSubject,
        currentGrades: [...row.currentGrades],
        term1: row.term1,
        term2: row.term2,
        term1Final: row.term1Final ?? row.term1 ?? null,
        term2Final: row.term2Final ?? row.term2 ?? null,
        yearFinal: row.yearFinal ?? null,
        confidence: row.confidence ?? 0,
      });
      continue;
    }

    existing.currentGrades.push(...row.currentGrades);
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
    existing.confidence = Math.max(existing.confidence ?? 0, row.confidence ?? 0);
  }

  return Array.from(bySubject.values()).map((row) => ({
    ...row,
    currentGrades: row.currentGrades.filter((grade) => Number.isFinite(grade)),
  }));
}

export function parseShkoloPages(pages: ShkoloPdfPageText[]): ShkoloParsedResult {
  const allText = pages.map((page) => page.text).join("\n");
  const normalizedAll = normalizeText(allText);
  const detectedYear = detectYear(normalizedAll);
  const diary = parseShkoloDiaryText(pages.map((page) => page.text));
  const rows: ShkoloParsedRow[] = [];
  let skippedLines = diary.skippedLines;

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
  };
}

export async function extractShkoloPdfPages(input: Buffer) {
  const parser = new PDFParse({ data: input });
  try {
    const parsed = await parser.getText();
    return parsed.pages.map((page) => ({
      page: page.num,
      text: normalizeText(page.text ?? ""),
    }));
  } finally {
    await parser.destroy();
  }
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
