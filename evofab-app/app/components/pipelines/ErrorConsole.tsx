// ErrorConsole.tsx
// Right-side panel that appears once Run Pipeline stops on a failure — one
// entry per step whose executor threw (printer not connected, robot arm in
// protective/emergency stop, classification bridge unreachable, etc.), so the
// operator can see *why* the run stopped without opening devtools.

'use client'

export interface PipelineErrorEntry {
  stepId: string
  /** e.g. "UR5e — Move" — the same "action — machine" shape as the step row's title. */
  label: string
  message: string
  timestamp: number
}

interface ErrorConsoleProps {
  errors: PipelineErrorEntry[]
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour12: false })
}

/** Console-style log of the step failure(s) that stopped the current (or most recent) run. */
export function ErrorConsole({ errors }: ErrorConsoleProps) {
  if (errors.length === 0) return null

  return (
    <div className="flex flex-col gap-2 lg:sticky lg:top-6">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-red mb-1">Run Failed</h2>
      <div className="rounded-lg border border-red/40 bg-black/90 p-3 font-mono text-[12.5px] leading-relaxed max-h-100 overflow-y-auto">
        {errors.map((e, i) => (
          <div key={`${e.stepId}-${i}`} className={i > 0 ? 'mt-2.5' : undefined}>
            <div className="text-muted">
              [{formatTime(e.timestamp)}] <span className="text-amber">{e.label}</span>
            </div>
            <div className="text-red pl-2 whitespace-pre-wrap break-words">{e.message}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
