"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Job } from "@/app/types/job";

interface PrinterHistoryPanelProps {
  jobs: Job[];
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(job: Job): string {
  if (!job.started_at || !job.completed_at) return "--";
  const seconds = Math.max(
    0,
    Math.round(
      (Date.parse(job.completed_at) - Date.parse(job.started_at)) / 1000,
    ),
  );
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function settingSummary(job: Job): string {
  const settings = job.print_settings;
  return [
    settings.nozzle_temp ? `${settings.nozzle_temp} C nozzle` : null,
    settings.bed_temp ? `${settings.bed_temp} C bed` : null,
    settings.speed ? `${settings.speed} mm/s` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function PrinterHistoryPanel({ jobs }: PrinterHistoryPanelProps) {
  const router = useRouter();
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function reprint(job: Job) {
    setBusyJobId(job.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/jobs/${job.id}/reprint`, {
        method: "POST",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const code = body?.error?.code;
        const text =
          body?.error?.message ?? `Re-print failed (${response.status}).`;
        throw new Error(code ? `${code}: ${text}` : text);
      }
      router.push(`/monitor/${body.job.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Re-print failed.");
    } finally {
      setBusyJobId(null);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
        Job History
      </h2>
      {jobs.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No jobs for this printer</p>
      ) : (
        <div className="mt-3 divide-y divide-border">
          {jobs.map((job) => (
            <div key={job.id} className="grid gap-2 py-3 md:grid-cols-[1fr_auto]">
              <div>
                <p className="text-sm font-semibold text-text">{job.filename}</p>
                <p className="mt-1 font-mono text-xs text-muted">
                  {formatDate(job.created_at)} · {job.status} ·{" "}
                  {formatDuration(job)}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {settingSummary(job) || "No print settings"}
                </p>
              </div>
              <button
                disabled={busyJobId !== null || !job.file_key || !job.printer_id}
                onClick={() => reprint(job)}
                className="self-start rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:border-teal disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyJobId === job.id ? "Starting..." : "Re-print"}
              </button>
            </div>
          ))}
        </div>
      )}
      {message && (
        <p className="mt-3 rounded-md border border-red/30 bg-red/10 px-3 py-2 text-xs text-red">
          {message}
        </p>
      )}
    </section>
  );
}
