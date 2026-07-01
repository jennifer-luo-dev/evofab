"use client";

import { useState } from "react";
import type { PrinterStatusType } from "@/app/types/printer";

interface Props {
  printerId: string;
  jobId: string;
  status: PrinterStatusType;
  onRefresh: () => void;
}

export function PrinterControlBar({
  printerId,
  jobId,
  status,
  onRefresh,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function act(action: string) {
    setBusy(action);
    setError(null);
    const response = await fetch(`/api/printers/${printerId}/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, jobId }),
    });
    const payload = await response.json();
    if (!response.ok)
      setError(payload.error?.message ?? payload.error ?? "Command failed");
    setBusy(null);
    setTimeout(onRefresh, 150);
  }
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-[.22em] text-muted">
            Live controls
          </p>
          <p className="text-xs text-text mt-1">
            Commands are routed through the local mock printer.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {status === "paused" ? (
            <button
              onClick={() => act("resume")}
              className="demo-button bg-green/10 text-green border-green/20"
            >
              ▶ Resume
            </button>
          ) : (
            <button
              disabled={status !== "printing"}
              onClick={() => act("pause")}
              className="demo-button"
            >
              Ⅱ Pause
            </button>
          )}
          <button onClick={() => act("cancel")} className="demo-button">
            ■ Cancel
          </button>
          <button
            onClick={() => act("emergency-stop")}
            className="demo-button bg-red/10 text-red border-red/30 hover:bg-red/20"
          >
            ⚠ Emergency stop
          </button>
        </div>
      </div>
      {busy && (
        <p className="text-xs text-teal mt-3 animate-pulse">Sending {busy}…</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red mt-3">
          {error}
        </p>
      )}
    </div>
  );
}
