import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_GRADE_RISK_SETTINGS,
  hasEnoughRiskDataPoints,
  isBelowRiskThreshold,
  normalizeGradeRiskSettings,
  resolveRiskLookbackTerms,
  selectRiskEvaluationItems,
} from "../grades.js";

test("course with score 95 is never at-risk when score threshold is 70", () => {
  const settings = normalizeGradeRiskSettings({
    riskThresholdMode: "score",
    riskScoreThreshold: 70,
  });
  const below = isBelowRiskThreshold(settings, "percentage", {
    score: 95,
    grade: 95,
  });
  assert.equal(below, false);
});

test("course with bulgarian grade 3.00 is at-risk when grade threshold is 4.50", () => {
  const settings = normalizeGradeRiskSettings({
    riskThresholdMode: "grade",
    riskGradeThresholdByScale: {
      ...DEFAULT_GRADE_RISK_SETTINGS.riskGradeThresholdByScale,
      bulgarian: 4.5,
    },
  });
  const below = isBelowRiskThreshold(settings, "bulgarian", {
    score: 25,
    grade: 3.0,
  });
  assert.equal(below, true);
});

test("previousTerm lookback selects previous term when current term has no grades", () => {
  const terms = [
    { id: 1, schoolYear: "2025/26", position: 1 },
    { id: 2, schoolYear: "2025/26", position: 2 },
  ];
  const resolved = resolveRiskLookbackTerms(terms, 2, "previousTerm");
  assert.equal(resolved.referenceTermId, 1);
  assert.deepEqual(resolved.evaluationTermIds, [1]);
});

test("academicYear aggregation prefers yearFinal > termFinal > current", () => {
  const mixed = [
    { categoryName: "Current", isFinal: 0, finalType: null },
    { categoryName: "Term grade", isFinal: 1, finalType: "TERM2" },
    { categoryName: "Term grade", isFinal: 1, finalType: "YEAR" },
  ];
  const pickedYear = selectRiskEvaluationItems(mixed, "academicYear", true);
  assert.equal(pickedYear.source, "yearFinal");
  assert.equal(pickedYear.items.length, 1);

  const noYear = [
    { categoryName: "Current", isFinal: 0, finalType: null },
    { categoryName: "Term grade", isFinal: 1, finalType: "TERM1" },
  ];
  const pickedTerm = selectRiskEvaluationItems(noYear, "academicYear", true);
  assert.equal(pickedTerm.source, "termFinal");
  assert.equal(pickedTerm.items.length, 1);

  const currentOnly = [{ categoryName: "Current", isFinal: 0, finalType: null }];
  const pickedCurrent = selectRiskEvaluationItems(currentOnly, "academicYear", true);
  assert.equal(pickedCurrent.source, "current");
  assert.equal(pickedCurrent.items.length, 1);
});

test("academicYear allows 1 data point when source is year/term final", () => {
  const settings = normalizeGradeRiskSettings({ riskMinDataPoints: 2 });
  assert.equal(hasEnoughRiskDataPoints(settings, "academicYear", 1, "yearFinal"), true);
  assert.equal(hasEnoughRiskDataPoints(settings, "academicYear", 1, "termFinal"), true);
  assert.equal(hasEnoughRiskDataPoints(settings, "currentTerm", 1, "termFinal"), false);
});
