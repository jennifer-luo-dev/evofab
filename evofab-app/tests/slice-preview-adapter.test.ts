import assert from "node:assert/strict";
import test from "node:test";
import {
  createSlicePreviewAdapter,
  previewFitBounds,
  previewGeometryForArtifact,
} from "../app/components/cloud-slicer/preview-adapter";
import type { GcodeArtifactAnalysis } from "../app/lib/gcode-artifact-analysis";

const ORCA_GCODE = [
  "; layer height = 0.28",
  "; external perimeters extrusion width = 0.72mm",
  ";LAYER_CHANGE",
  ";Z:0.28",
  ";TYPE:Skirt",
  "G1 X-20 Y-20 Z0.28 E1",
  ";TYPE:Outer wall",
  "G1 X0 Y0 E2",
  "G1 X20 Y0 E3",
  ";LAYER_CHANGE",
  ";Z:0.56",
  ";TYPE:Brim",
  "G1 X-25 Y-25 Z0.56 E4",
  ";TYPE:Top surface",
  "G1 X20 Y20 E5",
].join("\n");

const analysis: GcodeArtifactAnalysis = {
  byteCount: 1,
  lineCount: 1,
  normalizedHash: null,
  parsedLayerCount: 2,
  bounds: { minX: -25, maxX: 20, minY: -25, maxY: 20, minZ: 0.28, maxZ: 0.56 },
  extrusionMoveCount: 5,
  extrusionPathLengthMm: 20,
  features: ["brim", "outer_wall", "skirt", "top_surface"],
  featureMoveCounts: {},
  hasStartPrintMarker: true,
  occupancy: { bottom: 2, middle: 2, top: 2 },
  representativePathLengthMm: { bottom: 10, middle: 10, top: 10 },
};

test("Preview adapter passes the original Orca artifact to the visible renderer", async () => {
  const processed: string[] = [];
  const options: Record<string, unknown>[] = [];
  const adapter = createSlicePreviewAdapter({
    schedule: async () => {},
    loadPreview: (async () => ({
      init: (initOptions: Record<string, unknown>) => {
        options.push(initOptions);
        return {
          resize() {},
          processGCode(gcode: string) {
            processed.push(gcode);
          },
          controls: {
            target: { set() {} },
            update() {},
            minDistance: 0,
            maxDistance: 0,
          },
          camera: { position: { copy: () => ({ addScalar() {} }) } },
          render() {},
          dispose() {},
        };
      },
    })) as never,
  });
  const layers = adapter.parse(ORCA_GCODE);
  const renderer = await adapter.createRenderer({
    canvas: {} as HTMLCanvasElement,
    gcode: ORCA_GCODE,
    layers,
    analysis,
    buildVolume: { x: 300, y: 300, z: 400 },
    geometry: {},
    options: { startLayer: 0, endLayer: 1, showTravel: false },
  });

  assert.deepEqual(processed, [ORCA_GCODE]);
  assert.equal(options[0].extrusionWidth, 0.72);
  assert.equal(options[0].lineHeight, 0.28);
  renderer.dispose();
});

test("preview fit excludes skirt and brim without reconstructing their toolpath", () => {
  const layers = createSlicePreviewAdapter().parse(ORCA_GCODE);
  const fit = previewFitBounds(layers, analysis.bounds);
  assert.deepEqual(fit, {
    minX: 0,
    maxX: 20,
    minY: 0,
    maxY: 20,
    minZ: 0.28,
    maxZ: 0.56,
  });
  assert.deepEqual(previewGeometryForArtifact(ORCA_GCODE, layers, {}), {
    extrusionWidthMm: 0.72,
    layerHeightMm: 0.28,
  });
});
