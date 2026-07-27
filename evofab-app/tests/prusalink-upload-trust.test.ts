import assert from "node:assert/strict";
import test from "node:test";
import { normalizedGcodeHash } from "../app/lib/gcode-artifact-analysis";
import {
  validatePrusaUploadArtifact,
  type PrusaUploadSlicer,
} from "../app/lib/prusalink-upload-trust";
import {
  cube20mmGcode,
  SPARSE_GCODE,
  SPARSE_MULTILAYER_STRING_GCODE,
  supportHeavyGcode,
} from "./fixtures/gcode-fixtures";

const cubeBounds = { x: 20, y: 20, z: 19.8 };

function slicer(
  gcode: string,
  options: {
    layerCount?: number;
    supportsRequested?: boolean;
    supportsGenerated?: boolean;
    provenance?: "real" | "mock" | "unknown" | null;
    preparedBounds?: { x: number; y: number; z: number } | null;
    transformedBounds?: { x: number; y: number; z: number } | null;
    rotation?: number[] | null;
  } = {},
): PrusaUploadSlicer {
  const provenance =
    options.provenance === undefined ? "real" : options.provenance;
  const jobProvenance =
    provenance === null
      ? undefined
      : {
          kind: provenance,
          mode:
            provenance === "real"
              ? ("real" as const)
              : provenance === "mock"
                ? ("mock" as const)
                : ("unknown" as const),
          engine: provenance === "mock" ? "mock" : "fixture-engine",
          source:
            provenance === "real"
              ? ("slicer_service" as const)
              : provenance === "mock"
                ? ("fixed_test_toolpath" as const)
                : ("unknown" as const),
        };
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
          layer_count: options.layerCount ?? 21,
          engine: provenance === "mock" ? "mock" : "fixture-engine",
          profile_id: "fixture-profile",
          provenance: jobProvenance,
          prepared_source_bounding_box_mm: options.preparedBounds ?? cubeBounds,
          transformed_bounding_box_mm: options.transformedBounds ?? cubeBounds,
          rotation: options.rotation ?? null,
          supports_requested: options.supportsRequested ?? false,
          supports_generated: options.supportsGenerated ?? false,
        },
      };
    },
    async fetchGcode() {
      return gcode;
    },
  };
}

async function validate(gcode: string, slicerOptions = {}) {
  return validatePrusaUploadArtifact({
    slicer: slicer(gcode, slicerOptions),
    slicerJobId: "fixture-slice",
    submittedGcode: gcode,
    submittedHash: await normalizedGcodeHash(gcode),
  });
}

test("Prusa upload trust accepts a matching real source artifact with server correlation", async () => {
  const result = await validate(cube20mmGcode());
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

  const sparse = await validate(SPARSE_GCODE, { layerCount: 1 });
  assert.equal(sparse.ok, false);
  if (!sparse.ok) assert.equal(sparse.code, "PREVIEW_UNTRUSTED");

  const sparseStrings = await validate(SPARSE_MULTILAYER_STRING_GCODE, {
    layerCount: 3,
  });
  assert.equal(sparseStrings.ok, false);
  if (!sparseStrings.ok) {
    assert.equal(sparseStrings.code, "PREVIEW_UNTRUSTED");
    assert.match(sparseStrings.message, /density|occupancy/i);
  }
});

test("matching mock artifacts are blocked before any printer storage lifecycle", async () => {
  const cube = await validate(cube20mmGcode(), { provenance: "mock" });
  assert.equal(cube.ok, false);
  if (!cube.ok) assert.equal(cube.code, "PREVIEW_MOCK_ARTIFACT");

  const support = await validate(supportHeavyGcode(), {
    layerCount: 12,
    supportsGenerated: true,
    provenance: "mock",
  });
  assert.equal(support.ok, false);
  if (!support.ok) assert.equal(support.code, "PREVIEW_MOCK_ARTIFACT");
});

test("support request alone does not require generated support paths", async () => {
  const requestedWithoutGeneration = await validate(cube20mmGcode(), {
    supportsRequested: true,
    supportsGenerated: false,
  });
  assert.equal(requestedWithoutGeneration.ok, true);

  const generatedWithoutPaths = await validate(cube20mmGcode(), {
    supportsRequested: true,
    supportsGenerated: true,
  });
  assert.equal(generatedWithoutPaths.ok, false);
  if (!generatedWithoutPaths.ok) {
    assert.equal(generatedWithoutPaths.code, "PREVIEW_UNTRUSTED");
    assert.match(generatedWithoutPaths.message, /support evidence/i);
  }
});

test("a forged client real claim cannot override server mock provenance", async () => {
  const result = await validatePrusaUploadArtifact({
    slicer: slicer(cube20mmGcode(), { provenance: "mock" }),
    slicerJobId: "fixture-slice",
    submittedGcode: cube20mmGcode(),
    submittedHash: await normalizedGcodeHash(cube20mmGcode()),
    // This intentionally untyped browser-shaped field is ignored by the API.
    clientProvenance: "real",
  } as Parameters<typeof validatePrusaUploadArtifact>[0]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "PREVIEW_MOCK_ARTIFACT");
});

test("missing provenance and asymmetric source/output mismatches are blocked", async () => {
  const missing = await validate(cube20mmGcode(), { provenance: null });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "PREVIEW_PROVENANCE_UNVERIFIED");

  const mismatch = await validate(cube20mmGcode(), {
    preparedBounds: { x: 10, y: 40, z: 19.8 },
    transformedBounds: { x: 40, y: 10, z: 19.8 },
    rotation: [0, 0, 0.707107, 0.707107],
  });
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) {
    assert.equal(mismatch.code, "PREVIEW_SOURCE_OUTPUT_MISMATCH");
    assert.match(mismatch.message, /materially smaller/i);
  }
});
