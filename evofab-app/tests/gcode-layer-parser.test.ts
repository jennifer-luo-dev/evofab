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
  assert.ok(layers[0].segments.length > 4);
  assert.ok(
    layers[0].segments.some(
      (segment) =>
        segment.type === "external_perimeter" || segment.type === "outer_wall",
    ),
  );
  assert.ok(
    layers[0].segments.some((segment) => segment.type === "sparse_infill"),
  );
  assert.ok(layers[0].segments.every((segment) => segment.lineNumber > 0));
});

test("returns no layers for empty G-code and parses travel moves", () => {
  assert.deepEqual(parseGcodeLayers(""), []);
  const travel = parseGcodeLayers(";LAYER:0\nG1 Z2\nG1 X1 Y1\n");
  assert.equal(travel.length, 1);
  assert.equal(travel[0].segments[0].type, "travel");
  assert.equal(layerTotalFromGcode("G1 X1 Y1"), null);
});

test("parses support feature comments", () => {
  const layers = parseGcodeLayers(
    "SET_PRINT_STATS_INFO TOTAL_LAYER=1\n;LAYER:0\nG1 Z0.2\n;TYPE:Support\nG1 X0 Y0\nG1 X5 Y5 E1\n",
  );

  assert.equal(layers[0].segments.at(-1)?.type, "support");
});

test("parses Orca layer-change comments and relative extrusion", () => {
  const gcode = [
    "; total layer number: 2",
    "M83 ; use relative distances for extrusion",
    ";LAYER_CHANGE",
    ";Z:1",
    ";TYPE:Outer wall",
    "G1 X0 Y0 Z1",
    "G1 X10 Y0 E3",
    "G1 X10 Y10 E0.5",
    ";LAYER_CHANGE",
    ";Z:2.2",
    ";TYPE:Sparse infill",
    "G1 X0 Y0 Z2.2",
    "G1 X8 Y8 E1",
  ].join("\n");
  const layers = parseGcodeLayers(gcode);

  assert.equal(layerTotalFromGcode(gcode), 2);
  assert.equal(layers.length, 2);
  assert.equal(layers[0].index, 0);
  assert.equal(layers[0].z, 1);
  assert.equal(layers[0].segments.length, 2);
  assert.equal(layers[1].index, 1);
  assert.equal(layers[1].z, 2.2);
  assert.equal(layers[1].segments.at(-1)?.type, "sparse_infill");
});
