"use client";

import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { MaterialProfile } from "@/app/types/job";
import { cn } from "@/app/lib/utils";
import {
  createPreparedPrintId,
  preparedPrintStorageKey,
  type PreparedPrintDraft,
} from "@/app/lib/prepared-print";
import {
  filterMaterialProfilesForPrinterType,
  settingsFromMaterialProfile,
} from "@/app/lib/material-profiles";
import {
  buildVolumeBlock,
  DEFAULT_FGF_BUILD_VOLUME,
  parseBuildVolume,
} from "@/app/lib/printability";
import { layerTotalFromGcode } from "@/app/lib/gcode-layer-parser";
import { displaySlicerEngine } from "@/app/lib/slicer-display";
import type { SlicerFace } from "@/app/lib/slicer-client";
import type { Printer } from "@/app/types/printer";

const MAX_STL_BYTES = 100 * 1024 * 1024;
const EXTRUDING_G1_RE = /^G1\b(?=[^\n]*\bE[-+]?\d*\.?\d+)/m;
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
type PrepareStep = "upload" | "material" | "supports" | "slice";
type OrientationState = "uploaded" | "user-picked" | "auto" | null;

const PREPARE_STEPS: Array<{ id: PrepareStep; label: string }> = [
  { id: "upload", label: "Upload" },
  { id: "material", label: "Material" },
  { id: "supports", label: "Supports" },
  { id: "slice", label: "Slice" },
];
const NEXT_READY_CLASS =
  "border-[var(--color-green)]/70 bg-[var(--color-green)]/10 text-[var(--color-green)] shadow-[0_0_18px_rgba(34,197,94,0.28)]";

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
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
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
}: CloudSlicerClientProps) {
  const router = useRouter();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [activeStep, setActiveStep] = useState<PrepareStep>("upload");
  const [highestStepIndex, setHighestStepIndex] = useState(0);
  const [status, setStatus] = useState<SliceStatus>("idle");
  const [job, setJob] = useState<SlicerJob | null>(null);
  const [gcode, setGcode] = useState<string | null>(null);
  const [notice, setNotice] = useState<SliceNotice | null>(null);
  const [rotation, setRotation] = useState<number[] | null>(null);
  const [orientationState, setOrientationState] =
    useState<OrientationState>(null);
  const [supports, setSupports] = useState(false);
  const [inspectResult, setInspectResult] = useState<InspectResult | null>(
    null,
  );
  const [inspectPending, setInspectPending] = useState(false);

  const filteredProfiles = useMemo(
    () => filterMaterialProfilesForPrinterType(materialProfiles, undefined),
    [materialProfiles],
  );
  const effectiveProfileId = filteredProfiles.some(
    (profile) => profile.id === selectedProfileId,
  )
    ? selectedProfileId
    : "";
  const selectedProfile = useMemo(
    () =>
      filteredProfiles.find((profile) => profile.id === effectiveProfileId) ??
      null,
    [effectiveProfileId, filteredProfiles],
  );
  const canSlice =
    selectedFile !== null &&
    selectedProfile !== null &&
    orientationState !== null &&
    status !== "queued" &&
    status !== "slicing";
  const layerCount = useMemo(
    () =>
      job?.result?.layer_count ?? (gcode ? layerTotalFromGcode(gcode) : null),
    [gcode, job?.result?.layer_count],
  );
  const defaultPrinter = useMemo(
    () =>
      printers.find((printer) => printer.type === "FGF") ??
      printers.find((printer) => printer.build_volume) ??
      null,
    [printers],
  );
  const buildVolume = useMemo(
    () =>
      parseBuildVolume(defaultPrinter?.build_volume) ??
      DEFAULT_FGF_BUILD_VOLUME,
    [defaultPrinter?.build_volume],
  );
  const buildBlock = useMemo(
    () => buildVolumeBlock(inspectResult?.bounding_box_mm ?? null, buildVolume),
    [buildVolume, inspectResult?.bounding_box_mm],
  );
  const supportsRecommended =
    inspectResult !== null && inspectResult.overhang_ratio > 0.45 && !supports;
  const canPrint =
    status === "done" &&
    gcode !== null &&
    selectedProfile !== null &&
    !buildBlock;
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
  const canGoNext = useMemo(() => {
    if (activeStep === "upload") {
      return (
        selectedFile !== null && orientationState !== null && !inspectPending
      );
    }
    if (activeStep === "material") return selectedProfile !== null;
    if (activeStep === "supports") {
      return (
        selectedFile !== null &&
        selectedProfile !== null &&
        orientationState !== null &&
        !inspectPending
      );
    }
    return false;
  }, [
    activeStep,
    inspectPending,
    orientationState,
    selectedFile,
    selectedProfile,
  ]);
  const sliceDisabledReason = useMemo(() => {
    if (!selectedFile) return "Upload an STL before slicing.";
    if (!selectedProfile) return "Select a material profile before slicing.";
    if (!orientationState)
      return "Choose or confirm an orientation before slicing.";
    if (status === "queued" || status === "slicing")
      return "The current slice job is still running.";
    return null;
  }, [orientationState, selectedFile, selectedProfile, status]);
  const printerDisabledReason = useMemo(() => {
    if (status !== "done") return "Slice the part before selecting a printer.";
    if (!gcode) return "Downloadable G-code is not ready yet.";
    if (!selectedProfile)
      return "Select a material profile before printer handoff.";
    if (buildBlock)
      return `Part exceeds build volume on ${buildBlock.axis.toUpperCase()} by ${buildBlock.overageMm.toFixed(1)} mm.`;
    return null;
  }, [buildBlock, gcode, selectedProfile, status]);
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
    setStatus("idle");
    setRotation(null);
    setOrientationState(null);
    setInspectResult(null);
    setHighestStepIndex(0);

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

  function goToStep(step: PrepareStep) {
    const nextIndex = PREPARE_STEPS.findIndex((item) => item.id === step);
    setActiveStep(step);
    setHighestStepIndex((current) => Math.max(current, nextIndex));
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

      if (
        !nextGcode.includes("START_PRINT") ||
        !EXTRUDING_G1_RE.test(nextGcode)
      ) {
        throw new Error(
          "Generated G-code did not include START_PRINT and extruding G1 moves.",
        );
      }

      setGcode(nextGcode);
      setStatus("done");
      setNotice({
        tone: "success",
        message:
          "Slice complete. Review the result or send the G-code to a printer.",
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
    if (!canPrint || !selectedProfile || !gcode || !orientationState) return;

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

          <div className="mt-5 grid grid-cols-4 gap-2">
            {PREPARE_STEPS.map((step, index) => (
              <button
                key={step.id}
                type="button"
                disabled={index > highestStepIndex}
                onClick={() => setActiveStep(step.id)}
                className={cn(
                  "min-h-12 rounded-md border px-2 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  activeStep === step.id
                    ? "border-[var(--color-teal)] bg-[var(--color-teal)]/10 text-[var(--color-text)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:border-[var(--color-border-2)]",
                )}
              >
                <span className="block font-mono text-[10px]">{index + 1}</span>
                <span>{step.label}</span>
              </button>
            ))}
          </div>

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
                  Material
                </span>
                <select
                  value={effectiveProfileId}
                  onChange={(event) => setSelectedProfileId(event.target.value)}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-teal)]"
                >
                  <option value="">Select a material profile</option>
                  {filteredProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </label>
              {selectedProfile && (
                <div className="grid gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 sm:grid-cols-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                      Printer
                    </p>
                    <p className="mt-1 font-mono text-sm text-[var(--color-text)]">
                      {selectedProfile.printer_type}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                      Nozzle / Bed
                    </p>
                    <p className="mt-1 font-mono text-sm text-[var(--color-text)]">
                      {selectedProfile.nozzle_temp}°C /{" "}
                      {selectedProfile.bed_temp}°C
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                      Speed
                    </p>
                    <p className="mt-1 font-mono text-sm text-[var(--color-text)]">
                      {selectedProfile.speed} mm/s
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                      Flow
                    </p>
                    <p className="mt-1 font-mono text-sm text-[var(--color-text)]">
                      {selectedProfile.flow_rate}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                      Fan
                    </p>
                    <p className="mt-1 font-mono text-sm text-[var(--color-text)]">
                      {selectedProfile.fan_speed}%
                    </p>
                  </div>
                  <div className="sm:col-span-3">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                      Notes
                    </p>
                    <p className="mt-1 text-sm text-[var(--color-text)]">
                      {selectedProfile.notes || "No notes recorded."}
                    </p>
                  </div>
                </div>
              )}
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
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">
              Slice Result
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
                <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                  Print Time
                </p>
                <p className="mt-2 font-mono text-lg text-[var(--color-text)]">
                  {job?.result?.print_time_s
                    ? formatDuration(job.result.print_time_s)
                    : "—"}
                </p>
              </div>
              <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
                <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                  Material
                </p>
                <p className="mt-2 font-mono text-lg text-[var(--color-text)]">
                  {job?.result?.material_used_g
                    ? `${job.result.material_used_g.toFixed(2)} g`
                    : "—"}
                </p>
              </div>
              <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
                <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                  Engine
                </p>
                <p className="mt-2 truncate font-mono text-sm text-[var(--color-text)]">
                  {displaySlicerEngine(job?.result?.engine)}
                </p>
              </div>
              <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
                <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                  G-code
                </p>
                <p className="mt-2 font-mono text-sm text-[var(--color-text)]">
                  {gcode ? formatBytes(new Blob([gcode]).size) : "—"}
                </p>
              </div>
              <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
                <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                  Layers
                </p>
                <p className="mt-2 font-mono text-lg text-[var(--color-text)]">
                  {layerCount ?? "—"}
                </p>
              </div>
              <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
                <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                  Prepare
                </p>
                <p className="mt-2 font-mono text-xs text-[var(--color-text)]">
                  {orientationState === "user-picked"
                    ? "user-picked side down"
                    : orientationState === "auto"
                      ? "auto-oriented"
                      : "uploaded orientation"}{" "}
                  · {supports ? "supports on" : "supports off"}
                </p>
              </div>
            </div>
          </section>
        )}
      </div>
      {hasSliceViewerOutcome && (
        <SliceViewer
          key={job?.job_id ?? "pending-preview"}
          file={selectedFile}
          gcode={gcode}
          status={status}
          rotation={rotation}
          buildVolume={buildVolume}
          reportedLayerCount={job?.result?.layer_count ?? null}
        />
      )}
    </div>
  );
}
