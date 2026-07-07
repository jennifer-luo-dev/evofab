"use client";

import { useMemo, useState } from "react";
import type { BedMesh } from "@/app/lib/printer-leveling";
import type { PrinterWithStatus } from "@/app/types/printer";

interface PrinterLevelingPanelProps {
  printer: PrinterWithStatus;
}

type Message = { tone: "ok" | "error"; text: string };

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

function colorFor(value: number, min: number, max: number): string {
  const span = Math.max(0.001, max - min);
  const ratio = (value - min) / span;
  const hue = 205 - ratio * 165;
  return `hsl(${hue} 72% 45%)`;
}

export function PrinterLevelingPanel({ printer }: PrinterLevelingPanelProps) {
  const [busy, setBusy] = useState(false);
  const [mesh, setMesh] = useState<BedMesh | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const values = useMemo(() => mesh?.matrix.flat() ?? [], [mesh]);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const canStart = printer.printer_status?.status === "idle";

  async function loadMesh() {
    const response = await fetch(`/api/printers/${printer.id}/bed-mesh`, {
      cache: "no-store",
    });
    const body = await readJsonOrThrow<{ mesh: BedMesh | null }>(response);
    setMesh(body.mesh);
  }

  async function runLeveling(autoHome = false) {
    if (!canStart || busy) return;
    if (!window.confirm("Start bed mesh calibration?")) return;

    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/printers/${printer.id}/leveling`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true, autoHome }),
      });
      await readJsonOrThrow(response);
      await loadMesh();
      setMessage({ tone: "ok", text: "Bed mesh calibration complete." });
    } catch (error) {
      const text =
        error instanceof Error ? error.message : "Bed leveling failed.";
      if (text.includes("LEVELING_REQUIRES_HOME")) {
        setMessage({
          tone: "error",
          text: "Printer is not homed. Use Auto-home and level to continue.",
        });
      } else {
        setMessage({ tone: "error", text });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
            Bed Leveling
          </h2>
          <p className="mt-1 text-xs text-muted">
            {canStart ? "Idle printer ready" : "Requires idle printer"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={!canStart || busy}
            onClick={() => runLeveling(false)}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:border-teal disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Running..." : "Start"}
          </button>
          <button
            disabled={!canStart || busy}
            onClick={() => runLeveling(true)}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:border-teal disabled:cursor-not-allowed disabled:opacity-40"
          >
            Auto-home and level
          </button>
        </div>
      </div>

      <div className="mt-4">
        {mesh ? (
          <div
            className="grid overflow-hidden rounded-md border border-border"
            style={{
              gridTemplateColumns: `repeat(${mesh.matrix[0]?.length ?? 1}, minmax(0, 1fr))`,
            }}
          >
            {mesh.matrix.flatMap((row, rowIndex) =>
              row.map((value, columnIndex) => (
                <div
                  key={`${rowIndex}-${columnIndex}`}
                  className="flex aspect-square items-center justify-center font-mono text-[11px] text-white"
                  style={{ backgroundColor: colorFor(value, min, max) }}
                >
                  {value.toFixed(2)}
                </div>
              )),
            )}
          </div>
        ) : (
          <div className="rounded-md border border-border bg-bg px-3 py-6 text-center text-xs text-muted">
            No bed mesh available
          </div>
        )}
      </div>

      {message && (
        <p
          className={
            message.tone === "error"
              ? "mt-3 rounded-md border border-red/30 bg-red/10 px-3 py-2 text-xs text-red"
              : "mt-3 rounded-md border border-green/30 bg-green/10 px-3 py-2 text-xs text-green"
          }
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
