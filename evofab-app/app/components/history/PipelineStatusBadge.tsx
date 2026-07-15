// PipelineStatusBadge.tsx
// Filled pill badge for a pipeline (or pipeline step)'s run status. Used on
// both the run list and the per-step progress tracker.

import { cn } from '@/app/lib/utils'
import type { PipelineRunStatus } from './types'

interface PipelineStatusBadgeProps {
  status: PipelineRunStatus
  className?: string
}

const STATUS_CONFIG: Record<PipelineRunStatus, { label: string; colorClass: string }> = {
  draft: { label: 'Draft', colorClass: 'bg-muted' },
  pending: { label: 'Pending', colorClass: 'bg-muted' },
  queued: { label: 'Queued', colorClass: 'bg-muted' },
  waiting_dependency: { label: 'Waiting', colorClass: 'bg-amber' },
  running: { label: 'Running', colorClass: 'bg-teal' },
  complete: { label: 'Complete', colorClass: 'bg-green' },
  failed: { label: 'Failed', colorClass: 'bg-red' },
  skipped: { label: 'Skipped', colorClass: 'bg-muted' },
  aborted: { label: 'Aborted', colorClass: 'bg-red' },
}

/** Filled status pill for a pipeline run or step, colored per `PipelineRunStatus`. */
export function PipelineStatusBadge({ status, className }: PipelineStatusBadgeProps) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.25 py-0.75 rounded-full text-[11px] font-semibold text-white whitespace-nowrap',
        cfg.colorClass,
        className
      )}
    >
      {cfg.label}
    </span>
  )
}
