// PipelineHistoryList.tsx
// Clickable list of past/current pipeline runs shown on the History landing
// view.

'use client'

import { PipelineStatusBadge } from './PipelineStatusBadge'
import type { PipelineSummary } from './types'

interface PipelineHistoryListProps {
  pipelines: PipelineSummary[]
  onSelect: (id: string) => void
}

/** Row-per-run list of pipeline history, each row opening that run's detail view. */
export function PipelineHistoryList({ pipelines, onSelect }: PipelineHistoryListProps) {
  return (
    <div className="rounded-xl border border-border bg-surface p-1">
      {pipelines.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onSelect(p.id)}
          className="w-full flex items-center gap-3.5 px-3 py-3 text-sm text-left border-b border-border last:border-b-0 hover:bg-bg"
        >
          <span className="flex-1 font-semibold text-text truncate">{p.name}</span>
          <span className="w-15 font-mono text-xs text-muted">{p.date}</span>
          <PipelineStatusBadge status={p.status} />
          <span className="w-15 text-right text-xs text-muted">{p.steps} steps</span>
        </button>
      ))}
    </div>
  )
}
