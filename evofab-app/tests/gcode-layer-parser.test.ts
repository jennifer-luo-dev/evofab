import assert from "node:assert/strict";
import test from "node:test";
import {
  parseGcodeLayers,
  layerTotalFromGcode,
} from "../app/lib/gcode-layer-parser";
import { MOCK_GCODE_FIXTURE } from "../app/lib/slicer-client";

test("parses deterministic mock slicer layers and Z heights", () => {
  const layers = parseGcodeLayers(MOCK_GCODE_FIXTURE);
  const total = layerTotalFromGcode(MOCK_GCODE_FIXTURE);

  assert.equal(total, 48);
  assert.equal(layers.length, total);
  assert.equal(layers[0].index, 0);
  assert.equal(layers[0].z, 1.2);
  assert.equal(layers[47].index, 47);
  assert.ok(layers.every((layer) => layer.segments.length > 0));
});

test("returns no layers for empty or travel-only G-code", () => {
  assert.deepEqual(parseGcodeLayers(""), []);
  assert.deepEqual(parseGcodeLayers("G1 X1 Y1\nG1 Z2"), []);
  assert.equal(layerTotalFromGcode("G1 X1 Y1"), null);
});
