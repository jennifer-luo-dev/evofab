'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/app/lib/supabase'
import { cn } from '@/app/lib/utils'
import type { LogEntry } from '@/app/types/job'

const typeColor: Record<LogEntry['type'], string> = {
  default: 'text-[var(--color-text)]',
  info:    'text-[var(--color-teal)]',
  success: 'text-[var(--color-green)]',
  warn:    'text-[var(--color-amber)]',
  error:   'text-[var(--color-red)]',
}

interface SystemLogCardProps {
  jobId: string
  initialLogs: LogEntry[]
  jobActive: boolean
}

/**
 * Scrollable log panel with a live Supabase Realtime subscription for new entries.
 * Includes a job-abort button that PATCHes the job status and redirects to /setup.
 */
export function SystemLogCard({ jobId, initialLogs, jobActive }: SystemLogCardProps) {
  const router = useRouter()
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`logs:${jobId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'logs', filter: `job_id=eq.${jobId}` },
        (payload) => {
          setLogs((prev) => [...prev, payload.new as LogEntry])
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [jobId])

  /** Marks the job as aborted and navigates back to setup. */
  async function handleAbort() {
    await fetch(`/api/jobs/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'aborted', completed_at: new Date().toISOString() }),
    })
    router.push('/setup')
  }

  return (
    <div className="p-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
          System Log
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLogs([])}
            className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            Clear
          </button>
          {jobActive && (
            <button
              onClick={handleAbort}
              className="px-3 py-1 rounded-md text-xs font-semibold bg-[var(--color-red)]/10 text-[var(--color-red)] hover:bg-[var(--color-red)]/20 transition-colors"
            >
              Abort Job
            </button>
          )}
        </div>
      </div>

      <div
        ref={logRef}
        className="h-52 overflow-y-auto font-mono text-xs space-y-1 pr-1"
      >
        {logs.length === 0 ? (
          <p className="text-[var(--color-muted)]">Waiting for job to start...</p>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex gap-3">
              <span className="shrink-0 text-[var(--color-muted)]">
                {new Date(log.created_at).toLocaleTimeString([], { hour12: false })}
              </span>
              <span className={cn(typeColor[log.type])}>{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
