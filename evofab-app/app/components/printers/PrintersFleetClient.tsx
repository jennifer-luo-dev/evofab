"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { StatusDot } from "@/app/components/ui/StatusDot";
import { PrinterMacroPanel } from "@/app/components/printers/PrinterMacroPanel";
import { PrinterMotionPanel } from "@/app/components/printers/PrinterMotionPanel";
import { PrinterPreheatPanel } from "@/app/components/printers/PrinterPreheatPanel";
import {
  preparedPrintStorageKey,
  type PreparedPrintDraft,
} from "@/app/lib/prepared-print";
import type { MaterialProfile } from "@/app/types/job";
import type { PrinterWithStatus } from "@/app/types/printer";

interface PrintersFleetClientProps {
  printers: PrinterWithStatus[];
  materialProfiles: MaterialProfile[];
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

export function PrintersFleetClient({
  printers,
  materialProfiles,
}: PrintersFleetClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftId = searchParams.get("preparedJob");
  const [message, setMessage] = useState<{
    tone: "info" | "error";
    text: string;
  } | null>(null);
  const [busyPrinterId, setBusyPrinterId] = useState<string | null>(null);

  const draftState = useMemo<{
    draft: PreparedPrintDraft | null;
    loadMessage: { tone: "info" | "error"; text: string } | null;
  }>(() => {
    if (!draftId) return { draft: null, loadMessage: null };
    if (typeof window === "undefined") {
      return { draft: null, loadMessage: null };
    }

    const raw = window.sessionStorage.getItem(preparedPrintStorageKey(draftId));
    if (!raw) {
      return {
        draft: null,
        loadMessage: {
          tone: "error",
          text: "Prepared print expired. Slice again to select a printer.",
        },
      };
    }

    try {
      return {
        draft: JSON.parse(raw) as PreparedPrintDraft,
        loadMessage: {
          tone: "info",
          text: "Prepared print is ready. Choose a printer to start it.",
        },
      };
    } catch {
      return {
        draft: null,
        loadMessage: {
          tone: "error",
          text: "Prepared print could not be loaded. Slice again to continue.",
        },
      };
    }
  }, [draftId]);

  const draft = draftState.draft;
  const visibleMessage = message ?? draftState.loadMessage;
  const preparedFilename = draft?.filename ?? null;

  async function startPreparedPrint(printer: PrinterWithStatus) {
    if (!draft || !draftId || busyPrinterId) return;

    setBusyPrinterId(printer.id);
    setMessage(null);
    try {
      const file = new File([draft.gcode], draft.filename, {
        type: "text/plain",
      });
      const form = new FormData();
      form.append("file", file);
      form.append("printer_id", printer.id);
      form.append("experiment_id", "");
      form.append("material_profile_id", draft.materialProfileId ?? "");
      form.append("settings", JSON.stringify(draft.settings));
      form.append(
        "prepare_settings",
        JSON.stringify(draft.prepareSettings),
      );
      form.append(
        "experiment_params",
        JSON.stringify(draft.experimentParams),
      );

      const response = await fetch("/api/jobs", {
        method: "POST",
        body: form,
      });
      const body = await readJsonOrThrow<{ job: { id: string } }>(response);
      window.sessionStorage.removeItem(preparedPrintStorageKey(draftId));
      router.push(`/monitor/${body.job.id}`);
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to start prepared print.",
      });
    } finally {
      setBusyPrinterId(null);
    }
  }

  return (
    <>
      {(draft || visibleMessage) && (
        <div
          className={
            visibleMessage?.tone === "error"
              ? "mt-6 rounded-lg border border-[var(--color-red)]/30 bg-[var(--color-red)]/10 p-4"
              : "mt-6 rounded-lg border border-[var(--color-teal)]/30 bg-[var(--color-teal)]/10 p-4"
          }
        >
          <p className="text-sm font-semibold text-[var(--color-text)]">
            {preparedFilename ?? "Prepared print"}
          </p>
          {visibleMessage && (
            <p
              className={
                visibleMessage.tone === "error"
                  ? "mt-1 text-xs text-[var(--color-red)]"
                  : "mt-1 text-xs text-[var(--color-muted)]"
              }
            >
              {visibleMessage.text}
            </p>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {printers.map((printer) => {
          const status = printer.printer_status;

          return (
            <section
              key={printer.id}
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/printers/${printer.id}`)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  router.push(`/printers/${printer.id}`);
                }
              }}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--color-text)]">
                    {printer.name}
                  </h2>
                  <p className="mt-1 text-xs font-mono text-[var(--color-muted)]">
                    {printer.model}
                  </p>
                </div>
                <StatusDot status={status?.status ?? "offline"} />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                    Hotend
                  </p>
                  <p className="mt-1 font-mono text-sm text-[var(--color-text)]">
                    {status?.hotend_temp != null
                      ? `${status.hotend_temp.toFixed(1)}°C`
                      : "—"}
                  </p>
                </div>
                <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                    Bed
                  </p>
                  <p className="mt-1 font-mono text-sm text-[var(--color-text)]">
                    {status?.bed_temp != null
                      ? `${status.bed_temp.toFixed(1)}°C`
                      : "—"}
                  </p>
                </div>
                <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                    Progress
                  </p>
                  <p className="mt-1 font-mono text-sm text-[var(--color-text)]">
                    {status ? `${status.progress.toFixed(1)}%` : "—"}
                  </p>
                  {status?.progress_source === "estimated" && (
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                      estimated
                    </p>
                  )}
                </div>
                <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                    Address
                  </p>
                  <p className="mt-1 truncate font-mono text-sm text-[var(--color-text)]">
                    {printer.ip}:{printer.port}
                  </p>
                </div>
              </div>
              {status?.fault_message && (
                <div className="mt-3 rounded-lg border border-[var(--color-red)]/30 bg-[var(--color-red)]/10 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--color-red)]">
                    Klipper fault
                    {status.fault_mcu ? ` · ${status.fault_mcu}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-red)]">
                    {status.fault_message}
                  </p>
                </div>
              )}
              <div onClick={(event) => event.stopPropagation()}>
                {draft && (
                  <button
                    disabled={busyPrinterId !== null}
                    onClick={() => startPreparedPrint(printer)}
                    className="mt-4 w-full rounded-lg bg-[var(--color-teal)] px-4 py-2 text-sm font-semibold text-[var(--color-bg)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busyPrinterId === printer.id
                      ? "Starting..."
                      : "Start prepared print"}
                  </button>
                )}
                <PrinterPreheatPanel
                  printer={printer}
                  materialProfiles={materialProfiles}
                />
                <PrinterMotionPanel printer={printer} />
                <PrinterMacroPanel printer={printer} />
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
