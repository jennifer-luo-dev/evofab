import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  analyzeGcodeArtifact,
  normalizeGcode,
} from "../app/lib/gcode-artifact-analysis";
import { cube20mmGcode, supportHeavyGcode } from "./fixtures/gcode-fixtures";

const gcodeDirectory = new URL("./fixtures/gcode/", import.meta.url);

async function readFixture(filename: string) {
  return readFile(new URL(filename, gcodeDirectory), "utf8");
}

test("exported synthetic G-code fixtures exactly match their deterministic generators", async () => {
  const fixtures = [
    ["cube-20mm.gcode", cube20mmGcode()],
    ["support-heavy.gcode", supportHeavyGcode()],
  ] as const;

  for (const [filename, generated] of fixtures) {
    assert.equal(
      normalizeGcode(await readFixture(filename)),
      normalizeGcode(generated),
    );
  }
});

test("export manifest matches the analyzed static artifacts", async () => {
  const manifest = JSON.parse(await readFixture("manifest.json")) as {
    artifact_classification: string;
    fixtures: Array<{
      filename: string;
      sha256: string;
      byte_count: number;
      parsed_layer_count: number;
      xy_bounds_mm: { min: [number, number]; max: [number, number] };
      z_range_mm: [number, number];
      extrusion_move_count: number;
      extrusion_path_length_mm: number;
      major_features: string[];
    }>;
  };

  assert.match(manifest.artifact_classification, /synthetic/i);
  assert.match(manifest.artifact_classification, /not slicer output/i);

  for (const entry of manifest.fixtures) {
    const analysis = await analyzeGcodeArtifact(
      await readFixture(entry.filename),
    );
    assert.equal(analysis.normalizedHash, entry.sha256);
    assert.equal(analysis.byteCount, entry.byte_count);
    assert.equal(analysis.parsedLayerCount, entry.parsed_layer_count);
    assert.deepEqual(
      [analysis.bounds?.minX, analysis.bounds?.minY],
      entry.xy_bounds_mm.min,
    );
    assert.deepEqual(
      [analysis.bounds?.maxX, analysis.bounds?.maxY],
      entry.xy_bounds_mm.max,
    );
    assert.deepEqual(
      [analysis.bounds?.minZ, analysis.bounds?.maxZ],
      entry.z_range_mm,
    );
    assert.equal(analysis.extrusionMoveCount, entry.extrusion_move_count);
    assert.equal(
      analysis.extrusionPathLengthMm,
      entry.extrusion_path_length_mm,
    );
    assert.deepEqual(analysis.features, entry.major_features);
  }
});
