import assert from "node:assert/strict";
import test from "node:test";

import { computeCourseAverage, toPerformanceScore, type GradeAverageInputItem } from "../grades.js";

function currentBulgarian(value: number): GradeAverageInputItem {
  return {
    scale: "bulgarian",
    gradeValue: value,
    performanceScore: toPerformanceScore("bulgarian", value),
    weight: 1,
    categoryName: "Current",
  };
}

function termBulgarian(value: number, weight = 4): GradeAverageInputItem {
  return {
    scale: "bulgarian",
    gradeValue: value,
    performanceScore: toPerformanceScore("bulgarian", value),
    weight,
    categoryName: "Term grade",
  };
}

test("bulgarian average uses only Current grades by default", () => {
  const items = [currentBulgarian(6), currentBulgarian(4), termBulgarian(2, 10)];
  const result = computeCourseAverage(items, { displayScale: "bulgarian", includeTermGrade: false });

  assert.equal(result.itemCount, 2);
  assert.equal(result.averageValue?.toFixed(2), "5.00");
  assert.equal(result.normalizedScore?.toFixed(2), "75.00");
});

test("bulgarian average includes Term grade as one additional item when enabled", () => {
  const items = [currentBulgarian(6), currentBulgarian(4), termBulgarian(2, 20)];
  const result = computeCourseAverage(items, { displayScale: "bulgarian", includeTermGrade: true });

  assert.equal(result.itemCount, 3);
  assert.equal(result.averageValue?.toFixed(2), "4.00");
  assert.equal(result.normalizedScore?.toFixed(2), "50.00");
});

test("bulgarian display converts mixed-scale grades through normalized score", () => {
  const mixedScaleCurrent: GradeAverageInputItem = {
    scale: "percentage",
    gradeValue: 80,
    performanceScore: 80,
    weight: 1,
    categoryName: "Current",
  };
  const items = [currentBulgarian(6), mixedScaleCurrent];
  const result = computeCourseAverage(items, { displayScale: "bulgarian", includeTermGrade: false });

  // 80 normalized -> 5.2 on Bulgarian scale, average with 6 is 5.6
  assert.equal(result.averageValue?.toFixed(2), "5.60");
  assert.equal(result.normalizedScore?.toFixed(2), "90.00");
});
