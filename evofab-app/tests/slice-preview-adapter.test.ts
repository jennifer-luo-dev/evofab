import assert from "node:assert/strict";
import test from "node:test";
import { phaseJPreviewAdapter } from "../app/components/cloud-slicer/preview-adapter";

test("Phase J preview adapter exposes parse and render entry points", () => {
  const layers = phaseJPreviewAdapter.parse(
    "START_PRINT\n;LAYER:0\n;TYPE:Outer wall\nG1 X0 Y0 Z0.2\nG1 X10 Y0 E1\n",
  );

  assert.equal(layers.length, 1);
  assert.equal(layers[0].segments.length, 1);
  assert.doesNotThrow(() => phaseJPreviewAdapter.render());
});
