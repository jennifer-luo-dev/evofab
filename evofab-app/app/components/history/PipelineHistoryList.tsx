// PipelineHistoryList.tsx
// Clickable list of past/current pipeline runs shown on the History landing
// view.

'use client'

import { PipelineStatusBadge } from './PipelineStatusBadge'
import type { PipelineSummary } from './types'

interface PipelineHistoryListProps {
  pipelines: PipelineSummary[]
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}

/** Row-per-run list of pipeline history, each row opening that run's detail view. */
export function PipelineHistoryList({ pipelines, onSelect, onDelete }: PipelineHistoryListProps) {
  return (
    <div className="rounded-xl border border-border bg-surface p-1">
      {pipelines.map((p) => (
        <div
          key={p.id}
          className="w-full flex items-center gap-3.5 px-3 py-3 text-sm border-b border-border last:border-b-0 hover:bg-bg"
        >
          <button
            type="button"
            onClick={() => onSelect(p.id)}
            className="flex-1 flex items-center gap-3.5 text-left min-w-0"
          >
            <span className="flex-1 font-semibold text-text truncate">{p.name}</span>
            <span className="w-15 font-mono text-xs text-muted">{p.date}</span>
            <PipelineStatusBadge status={p.status} />
            <span className="w-15 text-right text-xs text-muted">{p.steps} steps</span>
          </button>
          <button
            type="button"
            title="Delete run"
            onClick={() => {
              if (confirm(`Delete "${p.name}" from History? This can't be undone.`)) {
                onDelete(p.id)
              }
            }}
            className="shrink-0 text-xs font-semibold text-muted hover:text-red px-1.5"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
