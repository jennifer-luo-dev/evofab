"use client";

import { cn } from "@/app/lib/utils";
import { StatusBadge } from "@/app/components/ui/StatusDot";
import { ProgressBar } from "@/app/components/ui/ProgressBar";
import type { PrinterWithStatus, PrinterStatusType } from "@/app/types/printer";

interface PrinterCardProps {
  printer: PrinterWithStatus;
  selected: boolean;
  onSelect: (printer: PrinterWithStatus) => void;
}

export function PrinterCard({ printer, selected, onSelect }: PrinterCardProps) {
  const ps = printer.printer_status;
  const status: PrinterStatusType = ps?.status ?? "offline";
  const isAvailable = (ps?.online ?? false) && status === "idle";
  const progress = ps?.progress ?? 0;

  return (
    <button
      onClick={() => isAvailable && onSelect(printer)}
      disabled={!isAvailable}
      className={cn(
        "w-full text-left p-4 rounded-xl border transition-all duration-150",
        "bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]",
        selected
          ? "border-[var(--color-teal)] bg-[var(--color-teal-dim)]"
          : "border-[var(--color-border)] hover:border-[var(--color-border-2)]",
        !isAvailable && "opacity-40 cursor-not-allowed",
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text)]">
            {printer.name}
          </p>
          <p className="text-xs text-[var(--color-muted)] mt-0.5 font-mono">
            {printer.model}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      {status === "printing" && (
        <div className="mb-3">
          <ProgressBar value={progress} />
          <p className="text-[10px] text-[var(--color-muted)] mt-1 font-mono">
            {progress.toFixed(0)}%
          </p>
        </div>
      )}

      {ps?.online && (ps.hotend_temp != null || ps.bed_temp != null) && (
        <div className="flex gap-3 mb-3 text-[10px] font-mono text-muted">
          {ps.hotend_temp != null && (
            <span>
              Hotend {ps.hotend_temp.toFixed(1)}°
              {ps.hotend_target ? ` / ${ps.hotend_target.toFixed(0)}°` : ""}
            </span>
          )}
          {ps.bed_temp != null && (
            <span>
              Bed {ps.bed_temp.toFixed(1)}°
              {ps.bed_target ? ` / ${ps.bed_target.toFixed(0)}°` : ""}
            </span>
          )}
        </div>
      )}

      <div className="flex gap-1.5 flex-wrap">
        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/5 text-[var(--color-muted)] uppercase">
          {printer.type}
        </span>
        {printer.material && (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/5 text-[var(--color-muted)]">
            {printer.material}
          </span>
        )}
        {printer.build_volume && (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/5 text-[var(--color-muted)]">
            {printer.build_volume}
          </span>
        )}
        {ps && (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/5 text-[var(--color-muted)]">
            {printer.driver_type === "prusalink" ? "PrusaLink" : "Moonraker"}
          </span>
        )}
      </div>
    </button>
  );
}
