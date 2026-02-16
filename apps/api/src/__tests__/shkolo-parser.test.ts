import assert from "node:assert/strict";
import test from "node:test";

import { parseShkoloDiaryText, parseShkoloPages } from "../shkolo-pdf.js";

const fixture = `
Справка за оценки
1. Български език и литература Първи срок Текущи 6 5 6 Срочна 6 Втори срок Текущи 5 5 6 Срочна 5 Годишна 6
2. Математика Първи срок Текущи 4 5 5 Срочна 5 Втори срок Текущи 5 6 Срочна 6 Годишна 6
3. История Първи срок Текущи 5 5 Срочна 5 Втори срок Текущи 6 6 Срочна 6
4. Средноаритметично Първи срок Текущи 5.33 Срочна 5 Втори срок Текущи 5.66 Срочна 6 Годишна 6
`;

test("parseShkoloPages parses subjects and grades", () => {
  const parsed = parseShkoloPages([{ page: 1, text: fixture }]);
  assert.equal(parsed.detectedYear, null);
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.rows[0]?.extractedSubject, "Български език и литература");
  assert.deepEqual(parsed.rows[0]?.currentGrades, [6, 5, 6, 5, 5, 6]);
  assert.equal(parsed.rows[0]?.term1, 6);
  assert.equal(parsed.rows[0]?.term2, 5);
  assert.equal(parsed.rows[0]?.term1Final, 6);
  assert.equal(parsed.rows[0]?.term2Final, 5);
  assert.equal(parsed.rows[0]?.yearFinal, 6);
  assert.ok((parsed.rows[0]?.confidence ?? 0) > 0.5);
  assert.equal(parsed.rows[2]?.extractedSubject, "История");
  assert.equal(parsed.rows[2]?.term2, 6);
});

test("parseShkoloDiaryText captures wrapped subjects and full token sequences across pages", () => {
  const page1 = `
Справка
1 Български език и
литература Първи срок Текущи 6 5 6 4
5 6 Втори срок Текущи 5 5 6 Срочна 5
2 Математика Първи срок Текущи 4 5 6
`;
  const page2 = `
4 5 Срочна 5 Втори срок Текущи 5 6 6 Срочна 6
3 Английски език Първи срок Текущи 6 6
Втори срок Текущи 5 6 Срочна 6
`;

  const parsed = parseShkoloDiaryText([page1, page2]);
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.rows[0]?.extractedSubject, "Български език и литература");
  assert.deepEqual(parsed.rows[0]?.tokens, [6, 5, 6, 4, 5, 6, 5, 5, 6, 5]);
  assert.equal(parsed.rows[1]?.extractedSubject, "Математика");
  assert.deepEqual(parsed.rows[1]?.tokens, [4, 5, 6, 4, 5, 5, 5, 6, 6, 6]);
});

test("regression: BEL tokens are captured across all numeric continuation lines", () => {
  const debugSnippet = `
1 Български език и литература
Първи срок Текущи 6 5 6
5 4 6
4 5 6
Срочна 6
Втори срок Текущи 5 5 6
Срочна 5 Годишна 6
2 Математика Първи срок Текущи 4 5 6 Срочна 5
`;

  const parsed = parseShkoloDiaryText([debugSnippet]);
  const bel = parsed.rows.find((row) => row.index === 1);
  assert.ok(bel);
  assert.equal(bel?.extractedSubject, "Български език и литература");
  assert.ok((bel?.tokens.length ?? 0) >= 9);
  assert.deepEqual(bel?.tokens.slice(0, 9), [6, 5, 6, 5, 4, 6, 4, 5, 6]);
});
