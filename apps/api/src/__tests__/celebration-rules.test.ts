import test from "node:test";
import assert from "node:assert/strict";

import {
  canCelebrateByCooldown,
  hasCrossedCelebrationThreshold,
  pickBestCelebrationCandidate,
  shouldCelebrateGradeItem,
  shouldCelebrateTermFinal,
  toPerformanceScore,
} from "../grades.js";

test("grade item celebrates only when score meets threshold", () => {
  assert.equal(shouldCelebrateGradeItem(95, 90), true);
  assert.equal(shouldCelebrateGradeItem(89.9, 90), false);
});

test("term final celebration requires scale excellence and score threshold", () => {
  assert.equal(
    shouldCelebrateTermFinal("bulgarian", 6, toPerformanceScore("bulgarian", 6), 90),
    true,
  );
  assert.equal(
    shouldCelebrateTermFinal("bulgarian", 5.5, toPerformanceScore("bulgarian", 5.5), 90),
    false,
  );
  assert.equal(
    shouldCelebrateTermFinal("percentage", 92, 92, 90),
    true,
  );
  assert.equal(
    shouldCelebrateTermFinal("percentage", 92, 92, 95),
    false,
  );
});

test("course average crossing only triggers on upward threshold crossing", () => {
  assert.equal(hasCrossedCelebrationThreshold(88, 91, 90), true);
  assert.equal(hasCrossedCelebrationThreshold(90, 91, 90), false);
  assert.equal(hasCrossedCelebrationThreshold(86, 89, 90), false);
});

test("bulk save best candidate selection prefers highest delta then score", () => {
  const best = pickBestCelebrationCandidate([
    { type: "gradeItem", courseId: "a", score: 99, delta: 0 },
    { type: "courseAverage", courseId: "b", score: 92, delta: 4 },
    { type: "termFinal", courseId: "c", score: 95, delta: 2 },
  ]);
  assert.deepEqual(best, {
    type: "courseAverage",
    courseId: "b",
    score: 92,
    delta: 4,
  });
});

test("cooldown gate blocks repeated celebration within cooldown window", () => {
  const now = Date.now();
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const twentyFiveHoursAgo = new Date(now - 25 * 60 * 60 * 1000).toISOString();

  assert.equal(canCelebrateByCooldown(twoHoursAgo, 24, now), false);
  assert.equal(canCelebrateByCooldown(twentyFiveHoursAgo, 24, now), true);
  assert.equal(canCelebrateByCooldown(null, 24, now), true);
});
