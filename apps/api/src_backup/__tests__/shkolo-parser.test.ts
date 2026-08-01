import assert from "node:assert/strict";
import test from "node:test";

import { parseShkoloDiaryText, parseShkoloPageItems, parseShkoloPages } from "../shkolo-pdf.js";

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

test("coordinate parser keeps grade tokens in the correct subject row", () => {
  const itemsByPage = {
    1: [
      { page: 1, str: "Предмет", x: 20, y: 800, width: 40, height: 10 },
      { page: 1, str: "Първи", x: 170, y: 800, width: 30, height: 10 },
      { page: 1, str: "срок", x: 208, y: 800, width: 30, height: 10 },
      { page: 1, str: "Текущи", x: 170, y: 780, width: 40, height: 10 },
      { page: 1, str: "Срочна", x: 300, y: 780, width: 40, height: 10 },
      { page: 1, str: "Втори", x: 390, y: 800, width: 30, height: 10 },
      { page: 1, str: "срок", x: 425, y: 800, width: 30, height: 10 },
      { page: 1, str: "Текущи", x: 390, y: 780, width: 40, height: 10 },
      { page: 1, str: "Срочна", x: 500, y: 780, width: 40, height: 10 },
      { page: 1, str: "Годишна", x: 570, y: 790, width: 50, height: 10 },

      { page: 1, str: "1 Български език и литература", x: 20, y: 740, width: 120, height: 10 },
      { page: 1, str: "6 5 6 5 4 6", x: 175, y: 740, width: 80, height: 10 },
      { page: 1, str: "6", x: 305, y: 740, width: 10, height: 10 },
      { page: 1, str: "5 5 6", x: 395, y: 740, width: 50, height: 10 },
      { page: 1, str: "5", x: 505, y: 740, width: 10, height: 10 },
      { page: 1, str: "6", x: 575, y: 740, width: 10, height: 10 },

      { page: 1, str: "2 Математика", x: 20, y: 700, width: 80, height: 10 },
      { page: 1, str: "4 5 5", x: 175, y: 700, width: 40, height: 10 },
      { page: 1, str: "5", x: 305, y: 700, width: 10, height: 10 },
      { page: 1, str: "5 6", x: 395, y: 700, width: 40, height: 10 },
      { page: 1, str: "6", x: 505, y: 700, width: 10, height: 10 },
      { page: 1, str: "6", x: 575, y: 700, width: 10, height: 10 },
    ],
  };

  const parsed = parseShkoloPageItems(itemsByPage);
  assert.equal(parsed.rows.length, 2);

  const bel = parsed.rows.find((row) => row.extractedSubject.includes("Български"));
  assert.ok(bel);
  assert.ok((bel?.currentGrades.length ?? 0) >= 3);
  assert.ok((bel?.t1CurrentGrades?.length ?? 0) >= 1);
  assert.ok((bel?.t2CurrentGrades?.length ?? 0) >= 1);
  assert.ok((bel?.t1FinalGrade ?? 0) >= 2);
  assert.ok((bel?.t2FinalGrade ?? 0) >= 2);

  const math = parsed.rows.find((row) => row.extractedSubject.includes("Математика"));
  assert.ok(math);
  assert.ok((math?.currentGrades.length ?? 0) >= 2);
  assert.ok((math?.t1CurrentGrades?.length ?? 0) >= 1);
  assert.ok((math?.t2CurrentGrades?.length ?? 0) >= 1);
});
