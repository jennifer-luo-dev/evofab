// MonitorEmptyState.tsx
// Fallback UI shown when a monitor page is visited with a missing or
// invalid job ID.

'use client'

import Link from 'next/link'

interface MonitorEmptyStateProps {
  jobId: string
}

/** Fallback UI shown when a monitor page is visited with a missing or invalid job ID. */
export function MonitorEmptyState({ jobId }: MonitorEmptyStateProps) {
  return (
    <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-4 animate-fade-up">
      <div className="p-5 rounded-xl border border-border bg-surface">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted mb-5">
          Pipeline
        </h3>
        <div className="flex items-center justify-center py-6 text-muted text-sm">
          No pipeline data available
        </div>
      </div>

      <div className="flex flex-col items-center justify-center gap-4 p-12 rounded-xl border border-border bg-surface text-center">
        <div className="w-12 h-12 rounded-full bg-white/5 border border-border flex items-center justify-center text-xl">
          ○
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest text-muted mb-1">Job Not Found</p>
          <p className="font-mono text-sm text-text">
            {jobId
              ? <>No job with ID <span className="text-teal">{jobId.slice(0, 8)}&hellip;</span> exists.</>
              : 'No job is currently being monitored.'}
          </p>
          <p className="text-xs text-muted mt-1">
            {jobId ? 'It may have been deleted or the link is incorrect.' : 'Start a new job from setup to begin monitoring.'}
          </p>
        </div>
        <Link
          href="/setup"
          className="mt-2 px-4 py-2 rounded-lg text-xs font-medium border border-border text-muted hover:text-text hover:border-border-2 transition-all"
        >
          Start a New Job
        </Link>
      </div>
    </div>
  )
}
