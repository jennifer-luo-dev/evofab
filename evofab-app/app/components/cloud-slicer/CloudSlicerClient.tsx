"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { MaterialProfile, PrintSettings } from "@/app/types/job";
import type { PrinterWithStatus } from "@/app/types/printer";
import { cn } from "@/app/lib/utils";

const MAX_STL_BYTES = 100 * 1024 * 1024;
const EXTRUDING_G1_RE = /^G1\b(?=[^\n]*\bE[-+]?\d*\.?\d+)/m;

type SliceStatus =
  "idle" | "queued" | "slicing" | "done" | "failed" | "printing";

interface SlicerJobResult {
  gcode_url: string;
  print_time_s: number;
  material_used_mm3: number;
  material_used_g: number;
  engine: string;
  profile_id: string;
}

interface SlicerJob {
  job_id: string;
  status: SliceStatus;
  result?: SlicerJobResult | null;
  error?: { code?: string; message?: string };
}

interface CloudSlicerClientProps {
  materialProfiles: MaterialProfile[];
  printers: PrinterWithStatus[];
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

function settingsFromProfile(profile: MaterialProfile): PrintSettings {
  const lineWidth = Number(profile.line_width_mm) || 1;
  const layerHeight = Number(profile.layer_height_mm) || 1;
  const maxVolumetricSpeed = Number(profile.max_volumetric_speed_mm3_s) || 40;

  return {
    nozzle_temp: Number(
      profile.temps_json.nozzle ?? profile.temps_json.melting ?? 190,
    ),
    bed_temp: Number(profile.temps_json.bed ?? 60),
    speed: Math.max(
      1,
      Math.round(maxVolumetricSpeed / Math.max(lineWidth * layerHeight, 1)),
    ),
    flow_rate: Number(profile.pellet_flow_coefficient) || 1,
    fan_speed: Number(profile.cooling_json.fan_max_pct ?? 0),
  };
}

async function readJsonOrThrow<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      json?.error?.message ??
      json?.error ??
      `Request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  return json as T;
}

export function CloudSlicerClient({
  materialProfiles,
  printers,
}: CloudSlicerClientProps) {
  const router = useRouter();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState(
    materialProfiles[0]?.id ?? "",
  );
  const [selectedPrinterId, setSelectedPrinterId] = useState(
    printers[0]?.id ?? "",
  );
  const [status, setStatus] = useState<SliceStatus>("idle");
  const [job, setJob] = useState<SlicerJob | null>(null);
  const [gcode, setGcode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedProfile = useMemo(
    () =>
      materialProfiles.find((profile) => profile.id === selectedProfileId) ??
      null,
    [materialProfiles, selectedProfileId],
  );
  const selectedPrinter = useMemo(
    () => printers.find((printer) => printer.id === selectedPrinterId) ?? null,
    [printers, selectedPrinterId],
  );
  const canSlice =
    selectedFile !== null &&
    selectedProfile !== null &&
    status !== "queued" &&
    status !== "slicing";
  const canPrint =
    status === "done" &&
    gcode !== null &&
    selectedProfile !== null &&
    selectedPrinter !== null;

  function validateFile(file: File): string | null {
    if (!file.name.toLowerCase().endsWith(".stl")) return "Upload an STL file.";
    if (file.size > MAX_STL_BYTES) return "STL must be 100 MB or smaller.";
    return null;
  }

  function handleFile(file: File | null) {
    setMessage(null);
    setJob(null);
    setGcode(null);
    setStatus("idle");

    if (!file) {
      setSelectedFile(null);
      return;
    }

    const error = validateFile(file);
    if (error) {
      setSelectedFile(null);
      setMessage(error);
      return;
    }

    setSelectedFile(file);
  }

  async function pollJob(jobId: string): Promise<SlicerJob> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < 90_000) {
      const response = await fetch(`/api/slicer/jobs/${jobId}`, {
        cache: "no-store",
      });
      const body = await readJsonOrThrow<{ job: SlicerJob }>(response);
      setJob(body.job);
      setStatus(body.job.status);

      if (body.job.status === "done" || body.job.status === "failed")
        return body.job;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    throw new Error("Timed out waiting for the slicer job.");
  }

  async function handleSlice() {
    if (!selectedFile || !selectedProfile) return;

    setMessage(null);
    setGcode(null);
    setStatus("queued");

    try {
      const form = new FormData();
      form.append("model", selectedFile);
      form.append("profile_id", selectedProfile.id);

      const submitResponse = await fetch("/api/slicer/slice", {
        method: "POST",
        body: form,
      });
      const submitBody = await readJsonOrThrow<{
        job: { job_id: string; status: "queued" };
      }>(submitResponse);
      setJob({ job_id: submitBody.job.job_id, status: submitBody.job.status });

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
    } catch (error) {
      setStatus("failed");
      setMessage(
        error instanceof Error ? error.message : "Unable to slice this STL.",
      );
    }
  }

  async function handlePrint() {
    if (!canPrint || !selectedPrinter || !selectedProfile || !gcode) return;

    setStatus("printing");
    setMessage(null);

    try {
      const file = new File([gcode], `${job?.job_id ?? "cloud-slice"}.gcode`, {
        type: "text/plain",
      });
      const form = new FormData();
      form.append("file", file);
      form.append("printer_id", selectedPrinter.id);
      form.append("experiment_id", "");
      form.append("material_profile_id", selectedProfile.id);
      form.append(
        "settings",
        JSON.stringify(settingsFromProfile(selectedProfile)),
      );
      form.append("experiment_params", "{}");

      const response = await fetch("/api/jobs", {
        method: "POST",
        body: form,
      });
      const body = await readJsonOrThrow<{ job: { id: string } }>(response);
      router.push(`/monitor/${body.job.id}`);
    } catch (error) {
      setStatus("done");
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to send this G-code to the printer.",
      );
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-6 animate-fade-up">
      <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-6">
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-[var(--color-text)]">
                Cloud Slicer
              </h1>
              <p className="text-sm text-[var(--color-muted)] mt-1">
                STL to Ginger G-code
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

          <label className="mt-5 flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[var(--color-border-2)] bg-[var(--color-surface-2)] px-4 text-center transition-colors hover:border-[var(--color-teal)]">
            <input
              type="file"
              accept=".stl,model/stl"
              className="sr-only"
              onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
            />
            <span className="text-2xl">{selectedFile ? "✓" : "+"}</span>
            <span className="mt-2 text-sm font-medium text-[var(--color-text)]">
              {selectedFile ? selectedFile.name : "Select STL"}
            </span>
            <span className="mt-1 text-xs text-[var(--color-muted)]">
              {selectedFile ? formatBytes(selectedFile.size) : "100 MB max"}
            </span>
          </label>

          <div className="mt-5 grid md:grid-cols-2 gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                Material
              </span>
              <select
                value={selectedProfileId}
                onChange={(event) => setSelectedProfileId(event.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-teal)]"
              >
                {materialProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                Printer
              </span>
              <select
                value={selectedPrinterId}
                onChange={(event) => setSelectedPrinterId(event.target.value)}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-teal)]"
              >
                {printers.map((printer) => (
                  <option key={printer.id} value={printer.id}>
                    {printer.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {message && (
            <p className="mt-4 rounded-lg border border-[var(--color-red)]/30 bg-[var(--color-red)]/10 px-3 py-2 text-sm text-[var(--color-red)]">
              {message}
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={handleSlice}
              disabled={!canSlice}
              className="rounded-lg bg-[var(--color-teal)] px-5 py-2.5 text-sm font-semibold text-[var(--color-bg)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Slice
            </button>
            <button
              onClick={handlePrint}
              disabled={!canPrint}
              className="rounded-lg border border-[var(--color-border-2)] px-5 py-2.5 text-sm font-semibold text-[var(--color-text)] transition-all hover:border-[var(--color-teal)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send To Printer
            </button>
          </div>
        </section>

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
                {job?.result?.engine ?? "—"}
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
          </div>
        </section>
      </div>
    </div>
  );
}
