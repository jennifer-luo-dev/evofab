"use client";

import { displaySlicerEngine } from "@/app/lib/slicer-display";
import type { SlicerArtifactProvenance } from "@/app/lib/slicer-client";

interface SliceResultSummaryProps {
  printTimeS: number | null;
  materialUsedG: number | null;
  engine: string | undefined;
  gcodeBytes: number | null;
  layerCount: number | null;
  orientationLabel: string;
  supports: boolean;
  supportsGenerated: boolean | null | undefined;
  supportDetected: boolean | undefined;
  provenance: SlicerArtifactProvenance | undefined;
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

export function SliceResultSummary({
  printTimeS,
  materialUsedG,
  engine,
  gcodeBytes,
  layerCount,
  orientationLabel,
  supports,
  supportsGenerated,
  supportDetected,
  provenance,
}: SliceResultSummaryProps) {
  return (
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
            {printTimeS ? formatDuration(printTimeS) : "—"}
          </p>
        </div>
        <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            Material
          </p>
          <p className="mt-2 font-mono text-lg text-[var(--color-text)]">
            {materialUsedG ? `${materialUsedG.toFixed(2)} g` : "—"}
          </p>
        </div>
        <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            Engine
          </p>
          <p className="mt-2 truncate font-mono text-sm text-[var(--color-text)]">
            {provenance?.kind === "mock"
              ? "Simulation (fixed test toolpath)"
              : displaySlicerEngine(engine)}
          </p>
        </div>
        <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            G-code
          </p>
          <p className="mt-2 font-mono text-sm text-[var(--color-text)]">
            {gcodeBytes ? formatBytes(gcodeBytes) : "—"}
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
            {orientationLabel} · requested {supports ? "yes" : "no"}
            {" · "}generated{" "}
            {supportsGenerated == null
              ? "unknown"
              : supportsGenerated
                ? "yes"
                : "no"}
            {" · "}feature detected{" "}
            {supportDetected == null
              ? "unknown"
              : supportDetected
                ? "yes"
                : "no"}
          </p>
        </div>
      </div>
    </section>
  );
}
