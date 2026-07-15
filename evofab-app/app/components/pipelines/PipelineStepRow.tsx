// PipelineStepRow.tsx
// Single-row layout for a pipeline step: icon, display number, action/machine
// title, an optional meta line, and caller-supplied leading/trailing slots.
// Used both by the pipeline builder (leading checkbox, trailing move/edit/
// delete actions) and the History progress tracker (trailing status badge).

import type { ReactNode } from 'react'
import { cn } from '@/app/lib/utils'

interface PipelineStepRowProps {
  icon: ReactNode
  /** The step's display number, or "↳" for a non-first member of a synced group. */
  number: string | number
  title: ReactNode
  meta?: string
  /** True when this row belongs to a synced group, drawing the accent left-border. */
  synced?: boolean
  leading?: ReactNode
  trailing?: ReactNode
}

/** One step row shared by the pipeline builder and the read-only History progress tracker. */
export function PipelineStepRow({
  icon,
  number,
  title,
  meta,
  synced,
  leading,
  trailing,
}: PipelineStepRowProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 px-2.5 py-2.25 border bg-surface',
        synced ? 'border-l-[3px] border-teal rounded-l-sm rounded-r-lg' : 'border-border rounded-lg'
      )}
    >
      {leading}
      <span className="w-4.5 shrink-0 text-center font-mono text-xs text-muted">{number}</span>
      <span className="shrink-0 text-teal">{icon}</span>
      <div className="flex-1 min-w-0 text-sm">
        <div className="font-semibold text-text truncate">{title}</div>
        {meta && <div className="text-[11.5px] text-muted mt-px truncate">{meta}</div>}
      </div>
      {trailing && <div className="flex items-center gap-0.5 shrink-0">{trailing}</div>}
    </div>
  )
}
