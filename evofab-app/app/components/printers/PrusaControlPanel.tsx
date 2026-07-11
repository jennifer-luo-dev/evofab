"use client";

import { useState } from "react";
import type { Job } from "@/app/types/job";
import type { PrinterStatus } from "@/app/types/printer";

export function PrusaControlPanel({
  job,
  status,
}: {
  job: Job | null;
  status: PrinterStatus | null;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const active = job?.status === "printing";

  async function command(action: "pause" | "resume" | "cancel") {
    if (!job || pending) return;
    setPending(action);
    setMessage(null);
    try {
      const response = await fetch(`/api/jobs/${job.id}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirmed: action === "cancel" }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          body?.error?.message ?? `Command failed (${response.status}).`,
        );
      setMessage(`${action} accepted; awaiting status reconciliation.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Command failed.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
        PrusaLink controls
      </h2>
      <p className="mt-2 text-xs text-muted">
        Cancel is not an emergency stop. Use the physical procedure for
        emergencies.
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button
          disabled={
            !active || status?.status !== "printing" || pending !== null
          }
          onClick={() => command("pause")}
          className="rounded-md border border-border px-2 py-1.5 text-xs disabled:opacity-40"
        >
          Pause
        </button>
        <button
          disabled={!active || status?.status !== "paused" || pending !== null}
          onClick={() => command("resume")}
          className="rounded-md border border-border px-2 py-1.5 text-xs disabled:opacity-40"
        >
          Resume
        </button>
        <button
          disabled={!active || pending !== null}
          onClick={() => command("cancel")}
          className="rounded-md border border-red-500/40 px-2 py-1.5 text-xs disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
      {pending && <p className="mt-2 text-xs text-muted">{pending} pending…</p>}
      {message && <p className="mt-2 text-xs text-muted">{message}</p>}
      {job?.command_outcome === "outcome_unknown" && (
        <p className="mt-2 text-xs text-amber-500">
          Outcome unknown; do not retry until status reconciles.
        </p>
      )}
      <p className="mt-3 text-xs text-muted">
        Jog, console, direct temperature, macros, bed leveling, and software
        emergency stop are unsupported.
      </p>
    </section>
  );
}
