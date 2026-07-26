"use client";

import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { MaterialProfile } from "@/app/types/job";
import { cn } from "@/app/lib/utils";
import {
  createPreparedPrintId,
  preparedPrintStorageKey,
  type PreparedPrintDraft,
} from "@/app/lib/prepared-print";
import { settingsFromMaterialProfile } from "@/app/lib/material-profiles";
import {
  availableHardnessTicks,
  filterMaterialPickerOptionsForHardness,
  hardnessBucket,
  filterMaterialPickerOptionsForTechnology,
  type MaterialPickerOption,
} from "@/app/lib/material-picker";
import {
  buildVolumeBlock,
  DEFAULT_FGF_BUILD_VOLUME,
  parseBuildVolume,
} from "@/app/lib/printability";
import {
  assessPreviewTrust,
  type PreviewTrust,
} from "@/app/lib/gcode-artifact-analysis";
import type { SlicerFace } from "@/app/lib/slicer-client";
import type { Printer } from "@/app/types/printer";
import { PrepareStepper } from "./PrepareStepper";
import { SliceResultSummary } from "./SliceResultSummary";
import {
  NEXT_READY_CLASS,
  PREPARE_STEPS,
  usePrepareStepper,
} from "./prepare-workflow";

const MAX_STL_BYTES = 100 * 1024 * 1024;
const SliceViewer = dynamic(
  () => import("./SliceViewer").then((module) => module.SliceViewer),
  { ssr: false },
);
const PrepareScene = dynamic(
  () => import("./PrepareScene").then((module) => module.PrepareScene),
  { ssr: false },
);

type SliceStatus =
  "idle" | "queued" | "slicing" | "done" | "failed" | "printing";
type OrientationState = "uploaded" | "user-picked" | "auto" | null;

interface SlicerJobResult {
  gcode_url: string;
  print_time_s: number;
  material_used_mm3: number;
  material_used_g: number;
  layer_count?: number | null;
  engine: string;
  profile_id: string;
  rotation?: number[] | null;
  supports?: boolean | null;
}

interface SlicerJob {
  job_id: string;
  status: SliceStatus;
  result?: SlicerJobResult | null;
  error?: { code?: string; message?: string };
}

interface SliceNotice {
  tone: "info" | "success" | "error";
  message: string;
  code?: string;
}

interface InspectResult {
  bounding_box_mm: { x: number; y: number; z: number };
  is_watertight: boolean;
  overhang_ratio: number;
  triangle_count: number;
  faces?: SlicerFace[];
}

interface CloudSlicerClientProps {
  materialProfiles: MaterialProfile[];
  printers: Printer[];
  materialOptions: MaterialPickerOption[];
  materialOptionsError: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function swatchColor(color: string): string {
  return (
    {
      natural: "#c8a47e",
      clear: "#dbeafe",
      black: "#111827",
      white: "#f8fafc",
      blue: "#3b82f6",
      red: "#ef4444",
      green: "#22c55e",
    }[color.trim().toLowerCase()] ?? "#94a3b8"
  );
}

async function readJsonOrThrow<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      json?.error?.message ??
      json?.error ??
      `Request failed with HTTP ${response.status}.`;
    const code = json?.error?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }

  return json as T;
}

export function CloudSlicerClient({
  materialProfiles,
  printers,
  materialOptions,
  materialOptionsError,
}: CloudSlicerClientProps) {
  const router = useRouter();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [selectedStockId, setSelectedStockId] = useState("");
  const [selectedHardness, setSelectedHardness] = useState("");
  const { activeStep, highestStepIndex, goToStep, resetPrepareSteps } =
    usePrepareStepper();
  const [status, setStatus] = useState<SliceStatus>("idle");
  const [job, setJob] = useState<SlicerJob | null>(null);
  const [gcode, setGcode] = useState<string | null>(null);
  const [previewTrust, setPreviewTrust] = useState<PreviewTrust | null>(null);
  const [previewRendererReady, setPreviewRendererReady] = useState(false);
  const [notice, setNotice] = useState<SliceNotice | null>(null);
  const [rotation, setRotation] = useState<number[] | null>(null);
  const [orientationState, setOrientationState] =
    useState<OrientationState>(null);
  const [supports, setSupports] = useState(false);
  const [inspectResult, setInspectResult] = useState<InspectResult | null>(
    null,
  );
  const [inspectPending, setInspectPending] = useState(false);

  const effectiveProfileId = materialProfiles.some(
    (profile) => profile.id === selectedProfileId,
  )
    ? selectedProfileId
    : "";
  const selectedProfile = useMemo(
    () =>
      materialProfiles.find((profile) => profile.id === effectiveProfileId) ??
      null,
    [effectiveProfileId, materialProfiles],
  );
  const targets = useMemo(
    () => [
      ...printers.map((printer) => ({
        id: `printer:${printer.id}`,
        label: printer.name,
        technology: printer.type,
        kind: "printer" as const,
        printer,
      })),
      {
        id: "preform:sla",
        label: "SLA · Prepare in PreForm",
        technology: "SLA" as const,
        kind: "preform" as const,
        printer: null,
      },
    ],
    [printers],
  );
  const selectedTarget =
    targets.find((target) => target.id === selectedTargetId) ?? null;
  const technologyMaterials = filterMaterialPickerOptionsForTechnology(
    materialOptions,
    selectedTarget?.technology,
  );
  const visibleMaterials =
    selectedTarget?.technology === "FDM"
      ? technologyMaterials.filter((option) => option.profile?.id === "pla-fdm")
      : technologyMaterials;
  const hardnessRequired =
    selectedTarget?.technology === "FDM" ||
    selectedTarget?.technology === "FGF";
  const hardnessOptions = availableHardnessTicks(visibleMaterials);
  const effectiveHardness = hardnessOptions.includes(selectedHardness)
    ? selectedHardness
    : (hardnessOptions[0] ?? "");
  const hardnessFilteredMaterials = hardnessRequired
    ? filterMaterialPickerOptionsForHardness(
        visibleMaterials,
        effectiveHardness,
      )
    : visibleMaterials;
  const selectedMaterial =
    hardnessFilteredMaterials.find(
      (option) => option.id === selectedMaterialId,
    ) ?? null;
  const selectedLot =
    selectedMaterial?.lots.find((lot) => lot.id === selectedStockId) ?? null;
  const isPreForm = selectedTarget?.kind === "preform";
  const canSlice =
    selectedFile !== null &&
    selectedProfile !== null &&
    orientationState !== null &&
    status !== "queued" &&
    status !== "slicing";
  const layerCount = job?.result?.layer_count ?? null;
  const defaultPrinter =
    selectedTarget?.printer ??
    printers.find((printer) => printer.type === "FGF") ??
    printers.find((printer) => printer.build_volume) ??
    null;
  const buildVolume =
    parseBuildVolume(defaultPrinter?.build_volume) ?? DEFAULT_FGF_BUILD_VOLUME;
  const buildBlock = buildVolumeBlock(
    inspectResult?.bounding_box_mm ?? null,
    buildVolume,
  );
  const supportsRecommended =
    inspectResult !== null && inspectResult.overhang_ratio > 0.45 && !supports;
  const canPrint =
    status === "done" &&
    gcode !== null &&
    selectedProfile !== null &&
    !buildBlock &&
    previewTrust?.status === "trusted" &&
    previewRendererReady;
  const hasCompletedSliceResult =
    activeStep === "slice" &&
    status === "done" &&
    gcode !== null &&
    !!job?.result;
  const hasSliceViewerOutcome =
    activeStep === "slice" &&
    ((status === "done" && gcode !== null) || status === "failed");
  const activeStepIndex = PREPARE_STEPS.findIndex(
    (step) => step.id === activeStep,
  );
  const canGoNext = (() => {
    if (activeStep === "upload") {
      return (
        selectedFile !== null && orientationState !== null && !inspectPending
      );
    }
    if (activeStep === "material")
      return (
        !isPreForm &&
        selectedMaterial !== null &&
        selectedLot !== null &&
        selectedProfile !== null
      );
    if (activeStep === "supports") {
      return (
        selectedFile !== null &&
        selectedProfile !== null &&
        orientationState !== null &&
        !inspectPending
      );
    }
    return false;
  })();
  const sliceDisabledReason = useMemo(() => {
    if (!selectedFile) return "Upload an STL before slicing.";
    if (!selectedProfile) return "Select a material profile before slicing.";
    if (!orientationState)
      return "Choose or confirm an orientation before slicing.";
    if (status === "queued" || status === "slicing")
      return "The current slice job is still running.";
    return null;
  }, [orientationState, selectedFile, selectedProfile, status]);
  const printerDisabledReason = (() => {
    if (status !== "done") return "Slice the part before selecting a printer.";
    if (!gcode) return "Downloadable G-code is not ready yet.";
    if (!selectedProfile)
      return "Select a material profile before printer handoff.";
    if (previewTrust?.status !== "trusted")
      return "Preview validation must pass before printer handoff.";
    if (!previewRendererReady)
      return "Wait for the trusted toolpath preview to render before printer handoff.";
    if (buildBlock)
      return `Part exceeds build volume on ${buildBlock.axis.toUpperCase()} by ${buildBlock.overageMm.toFixed(1)} mm.`;
    return null;
  })();
  const visibleNotice = useMemo<SliceNotice | null>(() => {
    if (
      notice?.tone === "error" ||
      status === "queued" ||
      status === "slicing" ||
      status === "done"
    ) {
      return notice;
    }
    if (activeStep === "upload" && selectedFile) {
      return {
        tone: "info",
        message:
          orientationState === "auto"
            ? `${selectedFile.name} is auto-oriented. Continue when the placement looks right.`
            : orientationState === "user-picked"
              ? `${selectedFile.name} is oriented from your selected face. Continue when the placement looks right.`
              : `${selectedFile.name} is using the uploaded pose. Auto-orient is available if you want it.`,
      };
    }
    if (activeStep === "material" && selectedProfile) {
      return {
        tone: "success",
        message: `Material selected: ${selectedProfile.name}. Review the settings, then continue.`,
      };
    }
    if (activeStep === "supports") {
      return {
        tone: "info",
        message: supports
          ? "Supports enabled. The preview highlights the planned support volume; final support toolpaths appear after slicing."
          : "Supports disabled. Turn them on to compare the support preview before slicing.",
      };
    }
    return notice;
  }, [
    activeStep,
    notice,
    orientationState,
    selectedFile,
    selectedProfile,
    status,
    supports,
  ]);

  function validateFile(file: File): string | null {
    if (file.size > MAX_STL_BYTES) return "STL must be 100 MB or smaller.";
    const name = file.name.trim();
    const hasExtension = /\.[^./\\]+$/.test(name);
    if (hasExtension && !name.toLowerCase().endsWith(".stl")) {
      return "Upload an STL file.";
    }
    return null;
  }

  function uploadFilename(file: File): string {
    const name = file.name.trim();
    if (name.toLowerCase().endsWith(".stl")) return name;
    const stem = name ? name.replace(/\.[^/.\\]+$/, "") : "mobile-upload";
    return `${stem || "mobile-upload"}.stl`;
  }

  function handleFile(file: File | null) {
    setNotice(null);
    setJob(null);
    setGcode(null);
    setPreviewTrust(null);
    setPreviewRendererReady(false);
    setStatus("idle");
    setRotation(null);
    setOrientationState(null);
    setInspectResult(null);
    setSelectedTargetId("");
    setSelectedMaterialId("");
    setSelectedStockId("");
    setSelectedHardness("");
    setSelectedProfileId("");
    resetPrepareSteps();

    if (!file) {
      setSelectedFile(null);
      return;
    }

    const error = validateFile(file);
    if (error) {
      setSelectedFile(null);
      setNotice({
        tone: "error",
        message: error,
        code: "SLICER_INVALID_INPUT",
      });
      return;
    }

    setSelectedFile(file);
    setOrientationState("uploaded");
    setNotice({
      tone: "info",
      message: `${uploadFilename(file)} accepted. Choose auto-orient or keep the uploaded pose, then continue.`,
    });
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0] ?? null;
    if (!file) return;
    handleFile(file);
  }

  function goNext() {
    if (!canGoNext) return;
    const nextStep = PREPARE_STEPS[activeStepIndex + 1];
    if (nextStep) goToStep(nextStep.id);
  }

  function handleOrientationChange(
    nextRotation: number[] | null,
    nextState: Exclude<OrientationState, null> = nextRotation
      ? "user-picked"
      : "uploaded",
  ) {
    setRotation(nextRotation);
    setOrientationState(nextState);
  }

  function handleFacePick(face: SlicerFace) {
    handleOrientationChange(face.quaternion_xyzw, "user-picked");
  }

  function handleAutoOrient() {
    const face = inspectResult?.faces?.[0];
    if (!face) return;
    handleOrientationChange(face.quaternion_xyzw, "auto");
  }

  useEffect(() => {
    if (!selectedFile) return;
    let cancelled = false;

    async function inspect() {
      setInspectPending(true);
      try {
        const form = new FormData();
        form.append(
          "model",
          selectedFile as File,
          uploadFilename(selectedFile as File),
        );
        if (rotation) form.append("rotation", JSON.stringify(rotation));
        form.append("include_faces", "true");
        const response = await fetch("/api/slicer/inspect", {
          method: "POST",
          body: form,
        });
        const body = await readJsonOrThrow<{ result: InspectResult }>(response);
        if (!cancelled) {
          setInspectResult(body.result);
        }
      } catch (error) {
        if (!cancelled) {
          setInspectResult(null);
          setNotice({
            tone: "error",
            message:
              error instanceof Error
                ? error.message
                : "Unable to inspect this STL.",
          });
        }
      } finally {
        if (!cancelled) setInspectPending(false);
      }
    }

    inspect();
    return () => {
      cancelled = true;
    };
  }, [rotation, selectedFile]);

  async function pollJob(jobId: string): Promise<SlicerJob> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < 90_000) {
      const response = await fetch(`/api/slicer/jobs/${jobId}`, {
        cache: "no-store",
      });
      const body = await readJsonOrThrow<{ job: SlicerJob }>(response);
      setJob(body.job);
      setStatus(body.job.status);
      if (body.job.status === "queued" || body.job.status === "slicing") {
        setNotice({
          tone: "info",
          message:
            body.job.status === "queued"
              ? "Slice job accepted. Waiting for the slicer queue."
              : "Slicing in progress. Polling the slicer for updates.",
        });
      }

      if (body.job.status === "done" || body.job.status === "failed")
        return body.job;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    throw new Error("Timed out waiting for the slicer job.");
  }

  async function handleSlice() {
    if (!selectedFile || !selectedProfile || !orientationState) return;

    setNotice({
      tone: "info",
      message: "Uploading STL to the slicer service.",
    });
    setGcode(null);
    setPreviewTrust(null);
    setPreviewRendererReady(false);
    setStatus("queued");

    try {
      const form = new FormData();
      form.append("model", selectedFile, uploadFilename(selectedFile));
      form.append("profile_id", selectedProfile.id);
      if (rotation) form.append("rotation", JSON.stringify(rotation));
      form.append("supports", String(supports));

      const submitResponse = await fetch("/api/slicer/slice", {
        method: "POST",
        body: form,
      });
      const submitBody = await readJsonOrThrow<{
        job: { job_id: string; status: "queued" };
      }>(submitResponse);
      setJob({ job_id: submitBody.job.job_id, status: submitBody.job.status });
      setNotice({
        tone: "info",
        message: `Slice job ${submitBody.job.job_id} accepted. Slicing in progress.`,
      });
      setStatus("slicing");

      const doneJob = await pollJob(submitBody.job.job_id);
      if (doneJob.status === "failed") {
        throw new Error(doneJob.error?.message ?? "Slicer job failed.");
      }

      const gcodeResponse = await fetch(
        `/api/slicer/jobs/${doneJob.job_id}/gcode`,
        { cache: "no-store" },
      );
      if (!gcodeResponse.ok)
        throw new Error(`Unable to fetch G-code (${gcodeResponse.status}).`);
      const nextGcode = await gcodeResponse.text();

      const nextTrust = await assessPreviewTrust(
        nextGcode,
        doneJob.result?.layer_count ?? null,
      );
      setGcode(nextGcode);
      setPreviewTrust(nextTrust);
      setPreviewRendererReady(false);
      setStatus("done");
      setNotice({
        tone: nextTrust.status === "trusted" ? "success" : "error",
        message:
          nextTrust.status === "trusted"
            ? "Slice complete. Review the trusted toolpath before selecting a printer."
            : "Slice completed, but preview validation blocked printer handoff.",
      });
    } catch (error) {
      setStatus("failed");
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Unable to slice this STL.",
      });
    }
  }

  async function handleSelectPrinter() {
    if (
      !canPrint ||
      !selectedProfile ||
      !gcode ||
      !orientationState ||
      !previewTrust ||
      !job
    )
      return;

    setNotice({
      tone: "info",
      message: "Prepared print saved. Choose a printer from the fleet.",
    });

    try {
      const draftId = createPreparedPrintId();
      const draft: PreparedPrintDraft = {
        id: draftId,
        filename: `${job?.job_id ?? "cloud-slice"}.gcode`,
        displayName:
          selectedFile?.name ?? `${job?.job_id ?? "cloud-slice"}.gcode`,
        gcode,
        sourceSlicerJobId: job.job_id,
        previewTrust,
        materialProfileId: selectedProfile.id,
        settings: settingsFromMaterialProfile(selectedProfile),
        prepareSettings: {
          supports,
          rotation,
          orientation: orientationState,
        },
        experimentParams: {},
        createdAt: new Date().toISOString(),
      };
      window.sessionStorage.setItem(
        preparedPrintStorageKey(draftId),
        JSON.stringify(draft),
      );
      router.push(`/printers?preparedJob=${encodeURIComponent(draftId)}`);
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to prepare this G-code for printer selection.",
      });
    }
  }

  const handleRendererState = useCallback((state: "ready" | "failed") => {
    setPreviewRendererReady(state === "ready");
    if (state === "failed") {
      setNotice({
        tone: "error",
        message: "Toolpath rendering failed. Printer handoff remains blocked.",
        code: "PREVIEW_RENDER_FAILED",
      });
    }
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-6 animate-fade-up">
      <div
        className={cn(
          "grid gap-6",
          activeStep === "slice"
            ? "lg:grid-cols-[1.2fr_0.8fr]"
            : "lg:grid-cols-1",
        )}
      >
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-[var(--color-text)]">
                Cloud Slicer
              </h1>
              <p className="text-sm text-[var(--color-muted)] mt-1">
                STL to pellet G-code
              </p>
            </div>
            <span
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-mono",
                status === "done"
                  ? "bg-[var(--color-green)]/10 text-[var(--color-green)]"
                  : status === "failed"
                    ? "bg-[var(--color-red)]/10 text-[var(--color-red)]"
                    : status === "queued" ||
                        status === "slicing" ||
                        status === "printing"
                      ? "bg-[var(--color-amber)]/10 text-[var(--color-amber)]"
                      : "bg-white/5 text-[var(--color-muted)]",
              )}
            >
              {status}
            </span>
          </div>

          <PrepareStepper
            activeStep={activeStep}
            highestStepIndex={highestStepIndex}
            onStepSelect={goToStep}
          />

          {activeStep === "upload" && (
            <div className="mt-5">
              {selectedFile ? (
                <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[#111927]">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {selectedFile.name}
                      </p>
                      <p className="mt-1 font-mono text-xs text-white/60">
                        {formatBytes(selectedFile.size)}
                      </p>
                    </div>
                    <label className="relative cursor-pointer rounded-md border border-white/15 px-3 py-2 text-xs font-semibold text-white transition-colors hover:border-[var(--color-teal)]">
                      <input
                        type="file"
                        className="absolute inset-0 cursor-pointer opacity-0"
                        onChange={handleFileInput}
                      />
                      Replace STL
                    </label>
                  </div>
                  <PrepareScene
                    file={selectedFile}
                    rotation={rotation}
                    buildVolume={buildVolume}
                    bounds={inspectResult?.bounding_box_mm ?? null}
                    faces={inspectResult?.faces ?? []}
                    onFacePick={handleFacePick}
                  />
                  <div className="border-t border-white/10 px-4 py-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/10 bg-black/25 p-3">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {orientationState === "auto"
                            ? "Auto-oriented — largest flat face down"
                            : orientationState === "user-picked"
                              ? "User-picked face down"
                              : "Uploaded pose"}
                        </p>
                        <p className="mt-1 text-xs text-white/60">
                          {inspectPending
                            ? "Inspecting planar faces."
                            : "Use auto-orient, keep the uploaded pose, or click a highlighted face on the model."}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={!inspectResult?.faces?.length}
                          onClick={handleAutoOrient}
                          className="rounded-md border border-[var(--color-green)]/50 px-3 py-2 text-xs font-semibold text-[var(--color-green)] transition-colors hover:bg-[var(--color-green)]/10 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Auto-orient
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleOrientationChange(null, "uploaded")
                          }
                          className="rounded-md border border-white/15 px-3 py-2 text-xs font-semibold text-white transition-colors hover:border-[var(--color-teal)]"
                        >
                          Keep uploaded
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!canGoNext}
                      onClick={goNext}
                      className={cn(
                        "rounded-lg border px-4 py-2 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40",
                        canGoNext
                          ? NEXT_READY_CLASS
                          : "border-[var(--color-border-2)] text-[var(--color-text)]",
                      )}
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : (
                <label className="relative flex min-h-44 w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-[var(--color-border-2)] bg-[var(--color-surface-2)] px-4 text-center transition-colors hover:border-[var(--color-teal)]">
                  <input
                    type="file"
                    className="absolute inset-0 z-10 cursor-pointer opacity-0"
                    onChange={handleFileInput}
                  />
                  <span className="text-2xl">+</span>
                  <span className="mt-2 text-sm font-medium text-[var(--color-text)]">
                    Select STL
                  </span>
                  <span className="mt-1 text-xs text-[var(--color-muted)]">
                    100 MB max
                  </span>
                </label>
              )}
            </div>
          )}

          {activeStep === "material" && (
            <div className="mt-5 grid gap-4">
              <label className="flex flex-col gap-2">
                <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                  Print target
                </span>
                <select
                  aria-label="Print target"
                  value={selectedTargetId}
                  onChange={(event) => {
                    setSelectedTargetId(event.target.value);
                    setSelectedMaterialId("");
                    setSelectedStockId("");
                    setSelectedHardness("");
                    setSelectedProfileId("");
                  }}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-teal)]"
                >
                  <option value="">Select a printer or PreForm</option>
                  {targets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.label} · {target.technology}
                    </option>
                  ))}
                </select>
              </label>
              {materialOptionsError && (
                <div
                  role="alert"
                  className="rounded-lg border border-[var(--color-red)]/30 bg-[var(--color-red)]/10 p-4 text-sm text-[var(--color-red)]"
                >
                  Unable to load material availability: {materialOptionsError}
                </div>
              )}
              {selectedTarget && visibleMaterials.length === 0 && (
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-5 text-sm text-[var(--color-muted)]">
                  No verified materials with positive, non-depleted stock are
                  available for {selectedTarget.technology}.
                </div>
              )}
              {hardnessRequired && visibleMaterials.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                    Shore hardness
                  </p>
                  <div className="mt-3">
                    <input
                      aria-label="Shore hardness"
                      type="range"
                      min="0"
                      max={Math.max(0, hardnessOptions.length - 1)}
                      step="1"
                      value={Math.max(
                        0,
                        hardnessOptions.indexOf(effectiveHardness),
                      )}
                      disabled={hardnessOptions.length <= 1}
                      onChange={(event) => {
                        setSelectedHardness(
                          hardnessOptions[Number(event.target.value)] ?? "",
                        );
                        setSelectedMaterialId("");
                        setSelectedStockId("");
                        setSelectedProfileId("");
                      }}
                      className="w-full accent-[var(--color-teal)] disabled:cursor-default"
                    />
                    <div
                      className="mt-1 grid text-[10px] text-[var(--color-muted)]"
                      style={{
                        gridTemplateColumns: `repeat(${Math.max(1, hardnessOptions.length)}, minmax(0, 1fr))`,
                      }}
                    >
                      {hardnessOptions.map((hardness) => (
                        <span
                          key={hardness}
                          className={cn(
                            "text-center",
                            effectiveHardness === hardness &&
                              "font-semibold text-[var(--color-teal)]",
                          )}
                        >
                          {hardness}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {hardnessFilteredMaterials.length > 0 && (
                <div className="grid gap-3 md:grid-cols-2">
                  {hardnessFilteredMaterials.map((material) => {
                    const selected = material.id === selectedMaterialId;
                    return (
                      <div
                        key={material.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setSelectedMaterialId(material.id);
                          setSelectedStockId("");
                          setSelectedProfileId(material.profile?.id ?? "");
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedMaterialId(material.id);
                            setSelectedStockId("");
                            setSelectedProfileId(material.profile?.id ?? "");
                          }
                        }}
                        className={cn(
                          "rounded-lg border p-4 transition-colors",
                          selected
                            ? "border-[var(--color-teal)] bg-[var(--color-teal)]/10"
                            : "border-[var(--color-border)] bg-[var(--color-surface-2)] hover:border-[var(--color-border-2)]",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-semibold text-[var(--color-text)]">
                              {material.name}
                            </h3>
                            <p className="mt-1 text-xs text-[var(--color-muted)]">
                              {material.provider ?? "Provider not recorded"}
                            </p>
                          </div>
                          <span className="rounded bg-white/5 px-2 py-1 font-mono text-[10px]">
                            {material.form}
                          </span>
                        </div>
                        <p className="mt-3 text-xs text-[var(--color-muted)]">
                          In stock:{" "}
                          {material.stock
                            .map((item) => `${item.quantity} ${item.unit}`)
                            .join(" · ")}
                        </p>
                        <div
                          className="mt-3 flex flex-wrap gap-2"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {material.lots.map((lot) => (
                            <button
                              key={lot.id}
                              type="button"
                              onClick={() => {
                                setSelectedMaterialId(material.id);
                                setSelectedStockId(lot.id);
                                setSelectedProfileId(
                                  material.profile?.id ?? "",
                                );
                              }}
                              className={cn(
                                "rounded border px-2 py-1 text-xs",
                                selectedStockId === lot.id
                                  ? "border-[var(--color-teal)] bg-[var(--color-teal)]/10 text-[var(--color-teal)]"
                                  : "border-[var(--color-border)] text-[var(--color-text)]",
                              )}
                            >
                              <span
                                className="mr-1 inline-block h-2.5 w-2.5 rounded-full border border-white/25 align-middle"
                                style={{
                                  backgroundColor: swatchColor(lot.color),
                                }}
                              />
                              {lot.color}
                            </button>
                          ))}
                        </div>
                        {(material.baseChemistry ||
                          material.nominalHardness) && (
                          <p className="mt-1 text-xs text-[var(--color-muted)]">
                            {[
                              material.baseChemistry,
                              material.nominalHardness
                                ? hardnessBucket(material.nominalHardness)
                                : "Rigid",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                          {material.sdsUrl && (
                            <a
                              href={material.sdsUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(event) => event.stopPropagation()}
                              className="text-[var(--color-teal)] underline"
                            >
                              SDS
                            </a>
                          )}
                          {material.placeholderProfile && (
                            <span className="rounded bg-[var(--color-amber)]/15 px-2 py-1 text-[var(--color-amber)]">
                              Temporary placeholder profile
                            </span>
                          )}
                          {!isPreForm && !material.profile && (
                            <span className="text-[var(--color-amber)]">
                              Profile needed before slicing
                            </span>
                          )}
                          {material.profile && !material.placeholderProfile && (
                            <span className="text-[var(--color-green)]">
                              Profile: {material.profile.name}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {isPreForm && selectedMaterial && selectedLot && (
                <div className="rounded-lg border border-[var(--color-teal)]/30 bg-[var(--color-teal)]/10 p-4">
                  <p className="font-semibold text-[var(--color-text)]">
                    Prepare in PreForm
                  </p>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">
                    Use Formlabs PreForm for setup and dispatch. EvoFab will not
                    slice or create a printer job for this resin.
                  </p>
                  <a
                    href="https://formlabs.com/software/preform/"
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-block text-sm text-[var(--color-teal)] underline"
                  >
                    Download PreForm
                  </a>
                  {selectedMaterial.sdsUrl && (
                    <a
                      href={selectedMaterial.sdsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-block text-sm text-[var(--color-teal)] underline"
                    >
                      Open safety data sheet
                    </a>
                  )}
                </div>
              )}
              {!isPreForm && (
                <button
                  type="button"
                  disabled={!canGoNext}
                  onClick={goNext}
                  className={cn(
                    "w-fit rounded-lg border px-4 py-2 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40",
                    canGoNext
                      ? NEXT_READY_CLASS
                      : "border-[var(--color-border-2)] text-[var(--color-text)]",
                  )}
                >
                  Next
                </button>
              )}
            </div>
          )}

          {activeStep === "supports" && (
            <div className="mt-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-3 text-sm font-medium text-[var(--color-text)]">
                  <input
                    type="checkbox"
                    checked={supports}
                    onChange={(event) => setSupports(event.target.checked)}
                    className="h-4 w-4 accent-[var(--color-teal)]"
                  />
                  Add supports
                </label>
                {supportsRecommended && (
                  <button
                    type="button"
                    onClick={() => setSupports(true)}
                    className="rounded-md border border-[var(--color-amber)]/40 px-3 py-1.5 text-xs font-semibold text-[var(--color-amber)]"
                  >
                    Supports recommended
                  </button>
                )}
              </div>
              <div className="mt-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm text-[var(--color-text)]">
                <p className="font-semibold">
                  {supports
                    ? "Support generation is on"
                    : "Support generation is off"}
                </p>
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  {inspectResult
                    ? `${(inspectResult.overhang_ratio * 100).toFixed(1)}% overhang area detected. ${
                        supports
                          ? "The slicer will include support toolpaths in the G-code preview."
                          : "Turn supports on if this part needs temporary structure under overhangs."
                      }`
                    : "Inspect data is still loading for this model."}
                </p>
              </div>
              {selectedFile && (
                <div className="mt-3 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[#111927]">
                  <PrepareScene
                    file={selectedFile}
                    rotation={rotation}
                    buildVolume={buildVolume}
                    bounds={inspectResult?.bounding_box_mm ?? null}
                    faces={[]}
                    showSupportPreview={supports}
                    onFacePick={handleFacePick}
                  />
                </div>
              )}
              <button
                type="button"
                disabled={!canGoNext}
                onClick={goNext}
                className={cn(
                  "mt-3 rounded-md border px-3 py-2 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40",
                  canGoNext
                    ? NEXT_READY_CLASS
                    : "border-[var(--color-border-2)] text-[var(--color-text)]",
                )}
              >
                Next
              </button>
            </div>
          )}

          {activeStep === "slice" &&
            (inspectPending || inspectResult || buildBlock) && (
              <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm text-[var(--color-text)]">
                <div className="flex flex-wrap gap-3 font-mono text-xs text-[var(--color-muted)]">
                  <span>
                    {inspectPending ? "Inspecting STL" : "Inspect ready"}
                  </span>
                  {inspectResult && (
                    <>
                      <span>
                        {inspectResult.bounding_box_mm.x.toFixed(1)} x{" "}
                        {inspectResult.bounding_box_mm.y.toFixed(1)} x{" "}
                        {inspectResult.bounding_box_mm.z.toFixed(1)} mm
                      </span>
                      <span>{inspectResult.triangle_count} triangles</span>
                    </>
                  )}
                </div>
                {buildBlock && (
                  <p className="mt-2 text-[var(--color-red)]">
                    Part exceeds printer build volume on{" "}
                    {buildBlock.axis.toUpperCase()} by{" "}
                    {buildBlock.overageMm.toFixed(1)} mm.
                  </p>
                )}
                {inspectResult && !inspectResult.is_watertight && (
                  <p className="mt-2 text-[var(--color-amber)]">
                    Mesh is not watertight; slicing can continue, but inspect
                    the first layer carefully.
                  </p>
                )}
              </div>
            )}

          {visibleNotice && (
            <p
              className={cn(
                "mt-4 rounded-lg border px-3 py-2 text-sm",
                visibleNotice.tone === "error"
                  ? "border-[var(--color-red)]/30 bg-[var(--color-red)]/10 text-[var(--color-red)]"
                  : visibleNotice.tone === "success"
                    ? "border-[var(--color-green)]/30 bg-[var(--color-green)]/10 text-[var(--color-green)]"
                    : "border-[var(--color-teal)]/30 bg-[var(--color-teal)]/10 text-[var(--color-text)]",
              )}
            >
              {visibleNotice.code && (
                <span className="mr-2 font-mono text-xs uppercase">
                  {visibleNotice.code}
                </span>
              )}
              {visibleNotice.message}
            </p>
          )}

          {activeStep === "slice" && (
            <div className="mt-5 flex flex-wrap items-start gap-3">
              <div>
                <button
                  onClick={handleSlice}
                  disabled={!canSlice}
                  className={cn(
                    "rounded-lg px-5 py-2.5 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40",
                    canSlice
                      ? "bg-[var(--color-green)] text-[var(--color-bg)] shadow-[0_0_20px_rgba(34,197,94,0.3)] hover:brightness-110"
                      : "bg-[var(--color-teal)] text-[var(--color-bg)]",
                  )}
                >
                  Slice
                </button>
                {sliceDisabledReason && (
                  <p className="mt-2 max-w-xs text-xs text-[var(--color-muted)]">
                    {sliceDisabledReason}
                  </p>
                )}
              </div>
              <div>
                <button
                  onClick={handleSelectPrinter}
                  disabled={!canPrint}
                  className="rounded-lg border border-[var(--color-border-2)] px-5 py-2.5 text-sm font-semibold text-[var(--color-text)] transition-all hover:border-[var(--color-teal)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Select a printer
                </button>
                {printerDisabledReason && (
                  <p className="mt-2 max-w-xs text-xs text-[var(--color-muted)]">
                    {printerDisabledReason}
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        {hasCompletedSliceResult && (
          <SliceResultSummary
            printTimeS={job?.result?.print_time_s ?? null}
            materialUsedG={job?.result?.material_used_g ?? null}
            engine={job?.result?.engine}
            gcodeBytes={gcode ? new Blob([gcode]).size : null}
            layerCount={layerCount}
            orientationLabel={
              orientationState === "user-picked"
                ? "user-picked side down"
                : orientationState === "auto"
                  ? "auto-oriented"
                  : "uploaded orientation"
            }
            supports={supports}
          />
        )}
      </div>
      {hasSliceViewerOutcome && (
        <SliceViewer
          key={job?.job_id ?? "pending-preview"}
          file={selectedFile}
          gcode={gcode}
          status={status}
          buildVolume={buildVolume}
          previewTrust={previewTrust}
          onRendererState={handleRendererState}
        />
      )}
    </div>
  );
}
