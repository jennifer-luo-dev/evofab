"use client";

import { useMemo, useState } from "react";
import { listPreheatPresets } from "@/app/lib/printer-preheat";
import type { MaterialProfile } from "@/app/types/job";
import type { PrinterWithStatus } from "@/app/types/printer";

interface PrinterPreheatPanelProps {
  printer: PrinterWithStatus;
  materialProfiles: MaterialProfile[];
}

async function postPreheat(printerId: string, presetId: string) {
  const response = await fetch(`/api/printers/${printerId}/preheat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preset_id: presetId }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      json?.error?.message ?? `Preheat command failed (${response.status}).`;
    const code = json?.error?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
  return json;
}

export function PrinterPreheatPanel({
  printer,
  materialProfiles,
}: PrinterPreheatPanelProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const status = printer.printer_status?.status ?? "unknown";
  const presets = useMemo(
    () => listPreheatPresets(materialProfiles, printer.type, { status }),
    [materialProfiles, printer.type, status],
  );

  async function runPreset(presetId: string, label: string) {
    setBusy(presetId);
    setMessage(null);
    try {
      await postPreheat(printer.id, presetId);
      setMessage({ tone: "ok", text: `${label} sent.` });
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error ? error.message : "Preheat command failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 border-t border-[var(--color-border)] pt-3">
      <p className="mb-2 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
        Preheat
      </p>
      <div className="grid grid-cols-2 gap-2">
        {presets.map((preset) => (
          <button
            key={preset.id}
            disabled={busy !== null || !preset.enabled}
            title={
              preset.reason ??
              `${preset.nozzle_temp.toFixed(0)}° / ${preset.bed_temp.toFixed(0)}°`
            }
            onClick={() => runPreset(preset.id, preset.label)}
            className="rounded-md border border-[var(--color-border)] px-2 py-1.5 text-xs font-semibold text-[var(--color-text)] transition-colors hover:border-[var(--color-teal)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {preset.label}
          </button>
        ))}
      </div>
      {message && (
        <p
          className={
            message.tone === "error"
              ? "mt-2 text-xs text-[var(--color-red)]"
              : "mt-2 text-xs text-[var(--color-green)]"
          }
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
