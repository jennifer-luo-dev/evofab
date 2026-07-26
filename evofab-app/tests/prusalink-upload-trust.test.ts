import assert from "node:assert/strict";
import test from "node:test";
import { normalizedGcodeHash } from "../app/lib/gcode-artifact-analysis";
import { validatePrusaUploadArtifact } from "../app/lib/prusalink-upload-trust";
import {
  cube20mmGcode,
  SPARSE_GCODE,
  SPARSE_MULTILAYER_STRING_GCODE,
} from "./fixtures/gcode-fixtures";

function slicer(gcode: string, layerCount = 21) {
  return {
    async getJob() {
      return {
        job_id: "fixture-slice",
        status: "done" as const,
        result: {
          gcode_url: "",
          print_time_s: 1,
          material_used_mm3: 1,
          material_used_g: 1,
          layer_count: layerCount,
          engine: "fixture",
          profile_id: "fixture-profile",
        },
      };
    },
    async fetchGcode() {
      return gcode;
    },
  };
}

test("Prusa upload trust requires a matching verified source artifact", async () => {
  const gcode = cube20mmGcode();
  const result = await validatePrusaUploadArtifact({
    slicer: slicer(gcode),
    slicerJobId: "fixture-slice",
    submittedGcode: gcode,
    submittedHash: await normalizedGcodeHash(gcode),
  });
  assert.equal(result.ok, true);
});

test("Prusa upload trust blocks changed, sparse, and metadata-mismatched artifacts", async () => {
  const changed = await validatePrusaUploadArtifact({
    slicer: slicer(cube20mmGcode()),
    slicerJobId: "fixture-slice",
    submittedGcode: `${cube20mmGcode()}\n;changed`,
    submittedHash: null,
  });
  assert.equal(changed.ok, false);
  if (!changed.ok) assert.equal(changed.code, "PREVIEW_ARTIFACT_MISMATCH");

  const sparse = await validatePrusaUploadArtifact({
    slicer: slicer(SPARSE_GCODE, 1),
    slicerJobId: "fixture-slice",
    submittedGcode: SPARSE_GCODE,
    submittedHash: null,
  });
  assert.equal(sparse.ok, false);
  if (!sparse.ok) assert.equal(sparse.code, "PREVIEW_UNTRUSTED");

  const sparseStrings = await validatePrusaUploadArtifact({
    slicer: slicer(SPARSE_MULTILAYER_STRING_GCODE, 3),
    slicerJobId: "fixture-slice",
    submittedGcode: SPARSE_MULTILAYER_STRING_GCODE,
    submittedHash: null,
  });
  assert.equal(sparseStrings.ok, false);
  if (!sparseStrings.ok) {
    assert.equal(sparseStrings.code, "PREVIEW_UNTRUSTED");
    assert.match(sparseStrings.message, /density|occupancy/i);
  }
});
