import assert from "node:assert/strict";
import test from "node:test";
import {
  assessSourceOutputCorrelation,
  type GcodeArtifactAnalysis,
} from "../app/lib/gcode-artifact-analysis";

function analysisForSpan(
  x: number,
  y: number,
  z: number,
): GcodeArtifactAnalysis {
  return {
    byteCount: 1,
    lineCount: 1,
    normalizedHash: null,
    parsedLayerCount: 2,
    bounds: { minX: 0, maxX: x, minY: 0, maxY: y, minZ: 0, maxZ: z },
    extrusionMoveCount: 20,
    extrusionPathLengthMm: 100,
    features: ["outer_wall"],
    featureMoveCounts: { outer_wall: 20 },
    hasStartPrintMarker: true,
    occupancy: { bottom: 10, middle: 10, top: 10 },
    representativePathLengthMm: { bottom: 30, middle: 30, top: 30 },
  };
}

function correlate(
  output: [number, number, number],
  source: [number, number, number] | null,
  transformed: [number, number, number] | null = source,
) {
  return assessSourceOutputCorrelation(analysisForSpan(...output), {
    preparedSourceBounds: source && {
      x: source[0],
      y: source[1],
      z: source[2],
    },
    transformedResultBounds: transformed && {
      x: transformed[0],
      y: transformed[1],
      z: transformed[2],
    },
    rotation: [0, 0, 0, 1],
  });
}

test("source-output correlation blocks a long asymmetric source against a cube-like output", () => {
  const reasons = correlate([24, 24, 37.6], [120, 30, 4]);
  assert.match(reasons.join(" "), /materially smaller/i);
});

test("source-output correlation allows translation, approved XY swaps, and support expansion", () => {
  // Correlation uses dimensions only, so a bed-coordinate translation is allowed.
  assert.deepEqual(correlate([120, 30, 4], [120, 30, 4]), []);
  assert.deepEqual(correlate([30, 120, 4], [120, 30, 4], [30, 120, 4]), []);
  assert.deepEqual(correlate([124, 34, 4], [120, 30, 4]), []);
});

test("source-output correlation blocks undersized Z/XY output and missing source bounds", () => {
  assert.match(
    correlate([80, 30, 4], [120, 30, 4]).join(" "),
    /materially smaller/i,
  );
  assert.match(
    correlate([120, 30, 2], [120, 30, 4]).join(" "),
    /materially smaller/i,
  );
  assert.match(correlate([120, 30, 4], null).join(" "), /unavailable/i);
});
