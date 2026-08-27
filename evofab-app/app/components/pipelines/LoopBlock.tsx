// LoopBlock.tsx
// One loop's header (collapse toggle, inline click-to-edit label/iteration
// count, move/delete controls) and body — recurses into ContainerView for
// its nested children at depth + 1. No per-iteration enumeration anywhere
// here: `iteration_path` is still null on every row inside until Phase 4
// unrolls the loop at queue time.

'use client'

import { useState } from 'react'
import { cn } from '@/app/lib/utils'
import { DownIcon, TrashIcon, UpIcon } from '@/app/components/ui/icons'
import { RowIconButton } from './RowIconButton'
import { ContainerView } from './ContainerView'
import { countStepsInGroup } from './pipelineUtils'
import type { LoopGroup, TechOption } from './types'
import type { usePipelineBuilder } from './usePipelineBuilder'
import type { PipelineRunStatus } from '@/app/components/history/types'

// Same teal accent at every depth (color-by-depth is explicitly deferred — pure indentation is
// legible enough through the 3-level cap); only left-margin increases to show nesting.
const DEPTH_INDENT = ['ml-0', 'ml-3', 'ml-6', 'ml-9']

interface LoopBlockProps {
  group: LoopGroup
  depth: number
  builder: ReturnType<typeof usePipelineBuilder>
  stepStatus: Record<string, PipelineRunStatus>
  currentStepIds: Set<string>
  availableTechs: TechOption[]
  onMoveUp: () => void
  onMoveDown: () => void
  onTestRunStep: (stepIds: string[]) => void
  testRunDisabled: boolean
}

/** One loop's header + body (or, when collapsed, a step-count badge and a greyed preview of the body). */
export function LoopBlock({
  group,
  depth,
  builder,
  stepStatus,
  currentStepIds,
  availableTechs,
  onMoveUp,
  onMoveDown,
  onTestRunStep,
  testRunDisabled,
}: LoopBlockProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [editingLabel, setEditingLabel] = useState(false)
  const [editingCount, setEditingCount] = useState(false)

  const stepCount = countStepsInGroup(group, builder.groups)

  return (
    <div
      className={cn(
        'my-2 rounded-lg border-l-[3px] border-teal bg-teal-dim/30 pl-3 pr-2 py-2',
        DEPTH_INDENT[Math.min(depth, DEPTH_INDENT.length - 1)]
      )}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold text-teal">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="w-4 text-center"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '▸' : '▾'}
        </button>

        {editingLabel ? (
          <input
            autoFocus
            defaultValue={group.label}
            onBlur={(e) => {
              builder.updateLoopLabel(group.id, e.target.value)
              setEditingLabel(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            placeholder="Loop"
            className="px-1.5 py-0.5 rounded border border-border bg-surface text-text text-xs w-28"
          />
        ) : (
          <button type="button" onClick={() => setEditingLabel(true)} className="hover:underline">
            {group.label || 'Loop'}
          </button>
        )}

        <span className="text-muted font-normal">×</span>

        {editingCount ? (
          // TODO: temp change for testing — loop minimum lowered from 2 to 1, revert after.
          <input
            type="number"
            min={1}
            autoFocus
            defaultValue={group.iterationCount}
            onBlur={(e) => {
              const n = parseInt(e.target.value, 10)
              if (Number.isFinite(n) && n >= 1) builder.updateLoopIterationCount(group.id, n)
              setEditingCount(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            className="w-14 px-1.5 py-0.5 rounded border border-border bg-surface text-text text-xs"
          />
        ) : (
          <button type="button" onClick={() => setEditingCount(true)} className="hover:underline">
            {group.iterationCount}
          </button>
        )}
        <span className="text-muted font-normal">iterations</span>

        <span className="flex-1" />
        {!collapsed && (
          <>
            <RowIconButton title="Move up" onClick={onMoveUp}>
              <UpIcon />
            </RowIconButton>
            <RowIconButton title="Move down" onClick={onMoveDown}>
              <DownIcon />
            </RowIconButton>
          </>
        )}
        <RowIconButton title="Delete loop" onClick={() => setConfirmingDelete(true)}>
          <TrashIcon />
        </RowIconButton>
      </div>

      {confirmingDelete && (
        <div className="mt-1.5 flex items-center gap-2 text-xs">
          <span className="text-red font-normal">Delete this loop and everything inside?</span>
          <button
            type="button"
            onClick={() => builder.deleteLoop(group.id)}
            className="px-2 py-1 rounded-md font-semibold text-red"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className="px-2 py-1 rounded-md text-muted font-normal"
          >
            Cancel
          </button>
        </div>
      )}

      {collapsed ? (
        <div className="mt-1.5 text-[11px] text-muted font-normal">
          {stepCount} step{stepCount === 1 ? '' : 's'} — collapsed
          <div className="mt-1 opacity-40 pointer-events-none">
            <ContainerView
              containerGroupId={group.id}
              depth={depth + 1}
              builder={builder}
              stepStatus={stepStatus}
              currentStepIds={currentStepIds}
              availableTechs={availableTechs}
              onTestRunStep={onTestRunStep}
              testRunDisabled={testRunDisabled}
              hideControls
            />
          </div>
        </div>
      ) : (
        <div className="mt-1.5">
          <ContainerView
            containerGroupId={group.id}
            depth={depth + 1}
            builder={builder}
            stepStatus={stepStatus}
            currentStepIds={currentStepIds}
            availableTechs={availableTechs}
            onTestRunStep={onTestRunStep}
            testRunDisabled={testRunDisabled}
          />
        </div>
      )}
    </div>
  )
}
