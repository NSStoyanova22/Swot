import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_GRADE_RISK_SETTINGS,
  hasEnoughRiskDataPoints,
  isBelowRiskThreshold,
  normalizeGradeRiskSettings,
  resolveRiskLookbackTerms,
  selectRiskEvaluationItems,
  shouldNeverFlagBestRiskMetric,
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

test("risk evaluation prefers term final when enabled, otherwise uses lookback window grades", () => {
  const withTermFinal = [
    { categoryName: "Current", isFinal: 0, finalType: null },
    { categoryName: "Term grade", isFinal: 1, finalType: "TERM1" },
    { categoryName: "Term grade", isFinal: 1, finalType: "YEAR" },
  ];
  const pickedTerm = selectRiskEvaluationItems(withTermFinal, "academicYear", true);
  assert.equal(pickedTerm.source, "termFinal");
  assert.equal(pickedTerm.items.length, 1);

  const pickedAllWindowGrades = selectRiskEvaluationItems(withTermFinal, "academicYear", false);
  assert.equal(pickedAllWindowGrades.source, "current");
  assert.equal(pickedAllWindowGrades.items.length, 2);

  const currentOnly = [{ categoryName: "Current", isFinal: 0, finalType: null }, { categoryName: "Current", isFinal: 0, finalType: null }];
  const pickedCurrent = selectRiskEvaluationItems(currentOnly, "academicYear", false);
  assert.equal(pickedCurrent.source, "current");
  assert.equal(pickedCurrent.items.length, 2);
});

test("risk data points always require configured minimum", () => {
  const settings = normalizeGradeRiskSettings({ riskMinDataPoints: 2 });
  assert.equal(hasEnoughRiskDataPoints(settings, "academicYear", 1, "yearFinal"), false);
  assert.equal(hasEnoughRiskDataPoints(settings, "academicYear", 1, "termFinal"), false);
  assert.equal(hasEnoughRiskDataPoints(settings, "currentTerm", 1, "termFinal"), false);
  assert.equal(hasEnoughRiskDataPoints(settings, "currentTerm", 2, "current"), true);
});

test("best-grade metrics are never flagged", () => {
  assert.equal(shouldNeverFlagBestRiskMetric({ score: 95, grade: 5.2 }), true);
  assert.equal(shouldNeverFlagBestRiskMetric({ score: 89, grade: 6 }), true);
  assert.equal(shouldNeverFlagBestRiskMetric({ score: 70, grade: 4.2 }), false);
});
