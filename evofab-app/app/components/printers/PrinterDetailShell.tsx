"use client";

import { useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { PrinterCameraPanel } from "@/app/components/printers/PrinterCameraPanel";
import { PrinterConsolePanel } from "@/app/components/printers/PrinterConsolePanel";
import { PrinterExtruderPanel } from "@/app/components/printers/PrinterExtruderPanel";
import { PrinterHistoryPanel } from "@/app/components/printers/PrinterHistoryPanel";
import { PrinterLevelingPanel } from "@/app/components/printers/PrinterLevelingPanel";
import { PrinterMacroPanel } from "@/app/components/printers/PrinterMacroPanel";
import { PrinterMotionPanel } from "@/app/components/printers/PrinterMotionPanel";
import { PrinterPreheatPanel } from "@/app/components/printers/PrinterPreheatPanel";
import { PrinterQueuePanel } from "@/app/components/printers/PrinterQueuePanel";
import { StatusDot } from "@/app/components/ui/StatusDot";
import type { Job, MaterialProfile } from "@/app/types/job";
import type { PrinterWithStatus } from "@/app/types/printer";

interface PrinterDetailShellProps {
  printer: PrinterWithStatus;
  activeJob: Job | null;
  historyJobs: Job[];
  materialProfiles: MaterialProfile[];
  overlay?: boolean;
}

function formatTemp(value: number | null | undefined): string {
  return value == null ? "--" : `${value.toFixed(1)} C`;
}

function formatPosition(printer: PrinterWithStatus): string {
  const layer = printer.printer_status?.layer_current;
  const total = printer.printer_status?.layer_total;
  if (layer == null && total == null) return "Layer --";
  return `Layer ${layer ?? "--"} / ${total ?? "--"}`;
}

export function PrinterDetailShell({
  printer,
  activeJob,
  historyJobs,
  materialProfiles,
  overlay = false,
}: PrinterDetailShellProps) {
  const status = printer.printer_status;
  const readOnly = printer.driver_type === "prusalink";
  const searchParams = useSearchParams();
  const preparedJobId = searchParams.get("preparedJob");

  const close = useCallback(() => {
    const query = preparedJobId
      ? `?preparedJob=${encodeURIComponent(preparedJobId)}`
      : "";
    window.location.assign(`/printers${query}`);
  }, [preparedJobId]);

  useEffect(() => {
    if (!overlay) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, overlay]);

  const content = (
    <section
      onClick={(event) => event.stopPropagation()}
      className="flex max-h-[calc(100dvh-9rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-bg shadow-2xl"
    >
      <header className="flex items-start justify-between gap-4 border-b border-border bg-surface px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-text">{printer.name}</h1>
            <StatusDot status={status?.status ?? "offline"} />
          </div>
          <p className="mt-1 font-mono text-xs text-muted">
            {printer.model} · {readOnly ? "PrusaLink · read-only" : "Moonraker"}
          </p>
        </div>
        <button
          onClick={close}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:border-teal"
        >
          Close
        </button>
      </header>

      <div className="overflow-auto p-4">
        <div className="grid gap-4 xl:grid-cols-[1fr_0.85fr]">
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-lg bg-surface p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted">
                  State
                </p>
                <p className="mt-1 font-mono text-sm text-text">
                  {status?.status ?? "offline"}
                </p>
              </div>
              <div className="rounded-lg bg-surface p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted">
                  Hotend
                </p>
                <p className="mt-1 font-mono text-sm text-text">
                  {formatTemp(status?.hotend_temp)}
                  {status?.hotend_target
                    ? ` / ${status.hotend_target.toFixed(0)} C`
                    : ""}
                </p>
              </div>
              <div className="rounded-lg bg-surface p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted">
                  Bed
                </p>
                <p className="mt-1 font-mono text-sm text-text">
                  {formatTemp(status?.bed_temp)}
                  {status?.bed_target
                    ? ` / ${status.bed_target.toFixed(0)} C`
                    : ""}
                </p>
              </div>
              <div className="rounded-lg bg-surface p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted">
                  Position
                </p>
                <p className="mt-1 font-mono text-sm text-text">
                  {formatPosition(printer)}
                </p>
              </div>
            </div>

            <section className="rounded-lg border border-border bg-surface p-4">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
                Active Job
              </h2>
              {activeJob ? (
                <div className="mt-3">
                  <p className="text-sm font-semibold text-text">
                    {activeJob.filename}
                  </p>
                  <p className="mt-1 font-mono text-xs text-muted">
                    {activeJob.status} ·{" "}
                    {(activeJob.print_progress ?? 0).toFixed(1)}%
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">No active job</p>
              )}
            </section>

            {readOnly ? (
              <section className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
                Status monitoring only. Printer controls and job dispatch are
                disabled.
              </section>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <PrinterExtruderPanel printer={printer} />
                </div>
                <div className="md:col-span-2">
                  <PrinterLevelingPanel printer={printer} />
                </div>
                <div className="md:col-span-2">
                  <PrinterHistoryPanel jobs={historyJobs} />
                </div>
                <div className="md:col-span-2">
                  <PrinterQueuePanel jobs={historyJobs} />
                </div>
                <div className="md:col-span-2">
                  <PrinterConsolePanel printer={printer} />
                </div>
                <PrinterPreheatPanel
                  printer={printer}
                  materialProfiles={materialProfiles}
                />
                <PrinterMotionPanel printer={printer} />
                <PrinterMacroPanel printer={printer} />
              </div>
            )}
          </div>

          <div className="grid content-start gap-4">
            <PrinterCameraPanel
              webcamUrl={printer.webcam_url}
              printerIp={undefined}
            />
            <section className="rounded-lg border border-border bg-surface p-4">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
                Operator Tabs
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted">
                <span className="rounded-md bg-bg px-2 py-1.5">Extruder</span>
                <span className="rounded-md bg-bg px-2 py-1.5">Leveling</span>
                <span className="rounded-md bg-bg px-2 py-1.5">History</span>
                <span className="rounded-md bg-bg px-2 py-1.5">Queue</span>
                <span className="rounded-md bg-bg px-2 py-1.5">Advanced</span>
              </div>
            </section>
          </div>
        </div>
      </div>
    </section>
  );

  if (!overlay) {
    return (
      <div
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        className="fixed inset-x-0 bottom-0 top-24 z-40 flex items-start justify-center overflow-auto bg-black/70 px-6 pb-10 pt-6"
      >
        {content}
      </div>
    );
  }

  return (
    <div
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="fixed inset-x-0 bottom-0 top-24 z-40 flex items-start justify-center overflow-auto bg-black/70 px-6 pb-10 pt-6"
    >
      {content}
    </div>
  );
}
