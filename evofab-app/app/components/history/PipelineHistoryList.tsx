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
  /** `'saved'` (a never-run `draft`) relabels the edit link and delete confirmation — the row's own click already opens the builder, since a saved pipeline has no run detail worth showing. Defaults to `'runs'`. */
  variant?: 'runs' | 'saved'
}

/** Row-per-run (or row-per-saved-pipeline) list, each row opening that run's detail view — or, for a saved pipeline, the builder. */
export function PipelineHistoryList({ pipelines, onSelect, onDelete, variant = 'runs' }: PipelineHistoryListProps) {
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
            {variant === 'runs' && <PipelineStatusBadge status={p.status} />}
            <span className="w-15 text-right text-xs text-muted">{p.steps} steps</span>
          </button>
          {variant === 'runs' && (
            <a
              href={`/pipelines?edit=${p.id}`}
              title="Copy this run into the builder to edit and run again"
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 text-xs font-semibold text-muted hover:text-teal px-1.5"
            >
              Edit &amp; Rerun
            </a>
          )}
          <button
            type="button"
            title={variant === 'saved' ? 'Delete saved pipeline' : 'Delete run'}
            onClick={() => {
              const confirmMsg =
                variant === 'saved'
                  ? `Delete saved pipeline "${p.name}"? This can't be undone.`
                  : `Delete "${p.name}" from History? This can't be undone.`
              if (confirm(confirmMsg)) onDelete(p.id)
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
