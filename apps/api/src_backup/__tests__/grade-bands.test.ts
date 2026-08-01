import assert from "node:assert/strict";
import test from "node:test";

import { getGradeBand, shouldSuppressAttentionForExcellent } from "../grades.js";

test("bulgarian avg=6.0 is excellent and never flagged when trend is stable/up", () => {
  const band = getGradeBand("bulgarian", 6.0);
  assert.equal(band, "excellent");
  assert.equal(shouldSuppressAttentionForExcellent(band, 0), true);
  assert.equal(shouldSuppressAttentionForExcellent(band, 1.2), true);
});

test("bulgarian thresholds map to expected bands", () => {
  assert.equal(getGradeBand("bulgarian", 3.99), "atRisk");
  assert.equal(getGradeBand("bulgarian", 4.0), "watch");
  assert.equal(getGradeBand("bulgarian", 4.5), "good");
  assert.equal(getGradeBand("bulgarian", 5.5), "excellent");
});
