"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PrinterCameraPanel } from "@/app/components/printers/PrinterCameraPanel";
import { PrinterExtruderPanel } from "@/app/components/printers/PrinterExtruderPanel";
import { PrinterHistoryPanel } from "@/app/components/printers/PrinterHistoryPanel";
import { PrinterLevelingPanel } from "@/app/components/printers/PrinterLevelingPanel";
import { PrinterMacroPanel } from "@/app/components/printers/PrinterMacroPanel";
import { PrinterMotionPanel } from "@/app/components/printers/PrinterMotionPanel";
import { PrinterPreheatPanel } from "@/app/components/printers/PrinterPreheatPanel";
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
  const router = useRouter();
  const status = printer.printer_status;

  const close = useCallback(() => {
    router.push("/printers");
  }, [router]);

  useEffect(() => {
    if (!overlay) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, overlay]);

  const content = (
    <section className="flex max-h-[calc(100vh-5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-bg shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-border bg-surface px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-text">{printer.name}</h1>
            <StatusDot status={status?.status ?? "offline"} />
          </div>
          <p className="mt-1 font-mono text-xs text-muted">
            {printer.model} · {printer.ip}:{printer.port}
          </p>
        </div>
        <button
          onClick={close}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:border-teal"
        >
          Close
        </button>
      </header>

      <div className="overflow-auto p-5">
        <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
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
                  {status?.hotend_target ? ` / ${status.hotend_target.toFixed(0)} C` : ""}
                </p>
              </div>
              <div className="rounded-lg bg-surface p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted">
                  Bed
                </p>
                <p className="mt-1 font-mono text-sm text-text">
                  {formatTemp(status?.bed_temp)}
                  {status?.bed_target ? ` / ${status.bed_target.toFixed(0)} C` : ""}
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
                    {activeJob.status} · {(activeJob.print_progress ?? 0).toFixed(1)}%
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">No active job</p>
              )}
            </section>

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
              <PrinterPreheatPanel
                printer={printer}
                materialProfiles={materialProfiles}
              />
              <PrinterMotionPanel printer={printer} />
              <PrinterMacroPanel printer={printer} />
            </div>
          </div>

          <div className="grid content-start gap-4">
            <PrinterCameraPanel webcamUrl={printer.webcam_url} />
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
    return <div className="mx-auto max-w-6xl px-6 py-8">{content}</div>;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-black/70 px-4 py-8">
      {content}
    </div>
  );
}
