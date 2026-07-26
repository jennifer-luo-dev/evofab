import {
  assessPreviewTrust,
  normalizedGcodeHash,
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
  const trust = await assessPreviewTrust(
    sourceGcode,
    sourceJob.result.layer_count ?? null,
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
  return { ok: true, trust };
}
