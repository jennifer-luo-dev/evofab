import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeGcodeArtifact,
  assessPreviewTrust,
  normalizeGcode,
} from "../app/lib/gcode-artifact-analysis";
import {
  cube20mmGcode,
  SPARSE_GCODE,
  supportHeavyGcode,
} from "./fixtures/gcode-fixtures";

test("20 mm cube fixture meets documented geometric minima", async () => {
  const analysis = await analyzeGcodeArtifact(cube20mmGcode());
  assert.equal(analysis.parsedLayerCount, 21);
  assert.equal(analysis.bounds?.minX, 0);
  assert.equal(analysis.bounds?.maxX, 20);
  assert.equal(analysis.bounds?.minY, 0);
  assert.equal(analysis.bounds?.maxY, 20);
  assert.equal(analysis.bounds?.minZ, 0.2);
  assert.equal(analysis.bounds?.maxZ, 20);
  assert.ok(analysis.extrusionMoveCount >= 100);
  assert.ok(analysis.extrusionPathLengthMm >= 2_000);
  assert.ok(analysis.features.includes("outer_wall"));
  assert.ok(analysis.features.includes("sparse_infill"));
  assert.ok(Object.values(analysis.occupancy).every((count) => count > 0));
  assert.match(analysis.normalizedHash ?? "", /^[a-f0-9]{64}$/);
});

test("support fixture retains model, infill, and support evidence", async () => {
  const analysis = await analyzeGcodeArtifact(supportHeavyGcode());
  assert.ok(analysis.features.includes("outer_wall"));
  assert.ok(analysis.features.includes("sparse_infill"));
  assert.ok(analysis.features.includes("support"));
  assert.ok(Object.values(analysis.occupancy).every((count) => count > 0));
});

test("trust blocks sparse and mismatched artifacts", async () => {
  const sparse = await assessPreviewTrust(SPARSE_GCODE, 1);
  assert.equal(sparse.status, "blocked");
  const mismatch = await assessPreviewTrust(cube20mmGcode(), 20);
  assert.equal(mismatch.status, "blocked");
  assert.match(mismatch.reasons.join(" "), /Reported 20 layers/);
});

test("normalization is stable across line endings and trailing whitespace", () => {
  assert.equal(normalizeGcode("G1 X1  \r\n\r\n"), "G1 X1\n");
});
