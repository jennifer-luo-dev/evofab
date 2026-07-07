"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Job } from "@/app/types/job";

interface PrinterQueuePanelProps {
  jobs: Job[];
}

export function PrinterQueuePanel({ jobs }: PrinterQueuePanelProps) {
  const router = useRouter();
  const queuedJobs = useMemo(
    () =>
      jobs
        .filter((job) => job.status === "queued")
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)),
    [jobs],
  );
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function cancel(job: Job) {
    setBusyJobId(job.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/jobs/${job.id}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", confirmed: true }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error?.message ?? "Unable to cancel queued job.");
      }
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to cancel queued job.",
      );
    } finally {
      setBusyJobId(null);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
        Queue
      </h2>
      {queuedJobs.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No queued jobs</p>
      ) : (
        <div className="mt-3 divide-y divide-border">
          {queuedJobs.map((job, index) => (
            <div key={job.id} className="grid gap-2 py-3 md:grid-cols-[auto_1fr_auto]">
              <span className="font-mono text-xs text-muted">
                #{index + 1}
              </span>
              <div>
                <p className="text-sm font-semibold text-text">{job.filename}</p>
                <p className="mt-1 font-mono text-xs text-muted">
                  queued · {new Date(job.created_at).toLocaleString()}
                </p>
              </div>
              <button
                disabled={busyJobId !== null}
                onClick={() => cancel(job)}
                className="self-start rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-text transition-colors hover:border-teal disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyJobId === job.id ? "Canceling..." : "Cancel"}
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
