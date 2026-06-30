'use client'

import Link from 'next/link'

interface ResultsEmptyStateProps {
  jobId: string
}

/** Fallback UI shown when a results page has no result record for the given job. */
export function ResultsEmptyState({ jobId }: ResultsEmptyStateProps) {
  return (
    <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-4 animate-fade-up">
      <div className="flex flex-col items-center justify-center gap-4 p-12 rounded-xl border border-border bg-surface text-center">
        <div className="w-12 h-12 rounded-full bg-white/5 border border-border flex items-center justify-center text-xl">
          ◇
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest text-muted mb-1">No Results Yet</p>
          <p className="font-mono text-sm text-text">
            {jobId
              ? <>Results for job <span className="text-teal">{jobId.slice(0, 8)}&hellip;</span> are not available.</>
              : 'No results to display.'}
          </p>
          <p className="text-xs text-muted mt-1">
            {jobId ? 'The job may still be running, or no result record was generated.' : 'Complete a job to see its results here.'}
          </p>
        </div>
        <div className="flex gap-2 mt-2">
          {jobId && (
            <Link
              href={`/monitor/${jobId}`}
              className="px-4 py-2 rounded-lg text-xs font-medium border border-border text-muted hover:text-text hover:border-border-2 transition-all"
            >
              View Monitor
            </Link>
          )}
          <Link
            href="/setup"
            className="px-4 py-2 rounded-lg text-xs font-medium border border-border text-muted hover:text-text hover:border-border-2 transition-all"
          >
            Start a New Job
          </Link>
        </div>
      </div>
    </div>
  )
}
