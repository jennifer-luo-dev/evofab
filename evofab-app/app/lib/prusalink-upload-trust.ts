import {
  assessSourceOutputCorrelation,
  assessPreviewTrust,
  normalizedGcodeHash,
  requiredFeaturesFromSlicerMetadata,
  type PreviewTrust,
} from "./gcode-artifact-analysis";
import type { SlicerJob } from "./slicer-client";

export interface PrusaUploadSlicer {
  getJob(jobId: string): Promise<SlicerJob>;
  fetchGcode(jobId: string): Promise<string>;
}

export type PrusaUploadTrustResult =
  | { ok: true; trust: PreviewTrust }
  | { ok: false; code: string; message: string };

/**
 * The server replays the slicer lookup before Prusa storage is touched. Client
 * preview fields are evidence for the UI only; this check is the upload gate.
 */
export async function validatePrusaUploadArtifact(input: {
  slicer: PrusaUploadSlicer;
  slicerJobId: string;
  submittedGcode: string;
  submittedHash: string | null;
}): Promise<PrusaUploadTrustResult> {
  const sourceJob = await input.slicer.getJob(input.slicerJobId);
  if (sourceJob.status !== "done" || !sourceJob.result) {
    return {
      ok: false,
      code: "SLICER_JOB_NOT_READY",
      message: "A completed slicer job is required before Prusa upload.",
    };
  }
  const sourceGcode = await input.slicer.fetchGcode(input.slicerJobId);
  const [sourceHash, submittedHash] = await Promise.all([
    normalizedGcodeHash(sourceGcode),
    normalizedGcodeHash(input.submittedGcode),
  ]);
  if (
    sourceHash !== submittedHash ||
    (input.submittedHash && input.submittedHash !== submittedHash)
  ) {
    return {
      ok: false,
      code: "PREVIEW_ARTIFACT_MISMATCH",
      message:
        "The upload artifact no longer matches the verified slicer artifact.",
    };
  }

  const provenance = sourceJob.result.provenance;
  if (provenance?.kind === "mock") {
    return {
      ok: false,
      code: "PREVIEW_MOCK_ARTIFACT",
      message:
        "This artifact came from the fixed test-toolpath simulation and cannot be uploaded to a printer.",
    };
  }
  if (provenance?.kind !== "real") {
    return {
      ok: false,
      code: "PREVIEW_PROVENANCE_UNVERIFIED",
      message:
        "Server-side slicer provenance is missing, unknown, or contradictory; printer upload is blocked.",
    };
  }
  const trust = await assessPreviewTrust(
    sourceGcode,
    sourceJob.result.layer_count ?? null,
    { requiredFeatures: requiredFeaturesFromSlicerMetadata(sourceJob.result) },
  );
  if (trust.status !== "trusted") {
    return {
      ok: false,
      code: "PREVIEW_UNTRUSTED",
      message:
        trust.reasons.join(" ") ||
        "Preview validation did not establish trust.",
    };
  }
  const correlationReasons = assessSourceOutputCorrelation(trust.analysis, {
    preparedSourceBounds: sourceJob.result.prepared_source_bounding_box_mm,
    transformedResultBounds: sourceJob.result.transformed_bounding_box_mm,
    rotation: sourceJob.result.rotation,
  });
  if (correlationReasons.length > 0) {
    return {
      ok: false,
      code: "PREVIEW_SOURCE_OUTPUT_MISMATCH",
      message: correlationReasons.join(" "),
    };
  }
  return { ok: true, trust };
}
