// ContainerView.tsx
// Renders one container's ordered entries — the top-level pipeline (`containerGroupId: null`),
// or a single loop's body. Recursive: a loop entry renders as a LoopBlock, which renders its
// own body via another ContainerView at depth + 1. This is what makes "+ Add Step"/"+ Add Loop"
// work identically at every nesting level, and what makes a loop's own atomic reorder trivial —
// its whole nested body lives inside its own container, invisible to the parent's order array.

'use client'

import { Fragment, useState } from 'react'
import { cn } from '@/app/lib/utils'
import { MACHINE_TYPE_ICONS, DownIcon, EditIcon, PlayIcon, TrashIcon, UpIcon } from '@/app/components/ui/icons'
import { PipelineStepRow } from './PipelineStepRow'
import { RowIconButton } from './RowIconButton'
import { StepConnector } from './StepConnector'
import { StepDraftForm } from './StepDraftForm'
import { SyncedStepGroup } from './SyncedStepGroup'
import { InlineCountPrompt } from './InlineCountPrompt'
import { LoopBlock } from './LoopBlock'
import { usePipelineConfig } from './PipelineConfigContext'
import { computeContainerUnits, findEntryContainer, summarizeStepInputs } from './pipelineUtils'
import { MAX_LOOP_DEPTH } from './types'
import { PipelineStatusBadge } from '@/app/components/history/PipelineStatusBadge'
import type { PipelineRunStatus } from '@/app/components/history/types'
import type { Step, TechOption } from './types'
import type { usePipelineBuilder } from './usePipelineBuilder'

interface ContainerViewProps {
  /** `null` for the top-level pipeline, otherwise the loop whose body this renders. */
  containerGroupId: string | null
  depth: number
  builder: ReturnType<typeof usePipelineBuilder>
  stepStatus: Record<string, PipelineRunStatus>
  /** Every step id currently dispatched — a synced batch runs its members at once, so more than one id can be "current" simultaneously. */
  currentStepIds: Set<string>
  /** Techs selected in Technology Selection — passed through to the draft form when adding here. */
  availableTechs: TechOption[]
  /** Suppresses "+ Add Step"/"+ Add Loop" — used for a collapsed loop's greyed preview. */
  hideControls?: boolean
  /** Test-runs a single step immediately (see PipelineBuilder.testRunSteps), outside a full pipeline run. */
  onTestRunStep: (stepIds: string[]) => void
  /** True while a real run or another test run is in flight — disables every row's "Test Run" button. */
  testRunDisabled: boolean
}

/** One container's step list, sync groups, nested loops, and its own scoped add-step/add-loop controls. */
export function ContainerView({
  containerGroupId,
  depth,
  builder,
  stepStatus,
  currentStepIds,
  availableTechs,
  hideControls,
  onTestRunStep,
  testRunDisabled,
}: ContainerViewProps) {
  const { actionsByTech, techLabel } = usePipelineConfig()
  const [addingLoop, setAddingLoop] = useState(false)
  const {
    steps,
    groups,
    rootOrder,
    checkedIds,
    toggleChecked,
    moveEntry,
    deleteStep,
    unsyncGroup,
    addLoop,
    openDraft,
    draftMode,
    draftState,
    draftError,
    draftTargetGroupId,
    changeDraftTech,
    changeDraftAction,
    changeDraftMachine,
    setDraftInput,
    setDraftFile,
    setDraftPrintSetting,
    setDraftMaterialProfile,
    closeDraft,
    commitDraft,
  } = builder

  const order = containerGroupId === null ? rootOrder : (groups.find((g) => g.id === containerGroupId)?.children ?? [])
  const stepsById = new Map(steps.map((s) => [s.id, s]))
  const units = computeContainerUnits(order, stepsById)

  const editingContainerId =
    draftMode === 'edit' && draftState?.id ? (findEntryContainer(draftState.id, rootOrder, groups)?.containerId ?? null) : null
  const showDraftHere =
    (draftMode === 'add' && draftTargetGroupId === containerGroupId) ||
    (draftMode === 'edit' && editingContainerId === containerGroupId)

  function renderStepRow(step: Step, unitIdx: number, synced: boolean) {
    const Icon = MACHINE_TYPE_ICONS[step.tech] ?? MACHINE_TYPE_ICONS.DEFAULT
    const action = (actionsByTech[step.tech] ?? []).find((a) => a.key === step.action)
    return (
      <PipelineStepRow
        key={step.id}
        icon={<Icon className="w-4 h-4" />}
        number={step.num}
        title={
          <>
            <span>{action?.label ?? step.action}</span> — {step.machine}
          </>
        }
        meta={summarizeStepInputs(step, actionsByTech, steps) || techLabel[step.tech]}
        synced={synced}
        highlighted={currentStepIds.has(step.id)}
        leading={
          <input
            type="checkbox"
            checked={checkedIds.has(step.id)}
            onChange={() => toggleChecked(step.id)}
            className="w-3.75 h-3.75 accent-teal shrink-0"
          />
        }
        trailing={
          <>
            {stepStatus[step.id] && <PipelineStatusBadge status={stepStatus[step.id]} className="mr-1" />}
            <RowIconButton
              title="Test run this step now"
              onClick={() => !testRunDisabled && onTestRunStep([step.id])}
            >
              <PlayIcon className={testRunDisabled ? 'opacity-40' : undefined} />
            </RowIconButton>
            <RowIconButton title="Move up" onClick={() => moveEntry(containerGroupId, unitIdx, -1)}>
              <UpIcon />
            </RowIconButton>
            <RowIconButton title="Move down" onClick={() => moveEntry(containerGroupId, unitIdx, 1)}>
              <DownIcon />
            </RowIconButton>
            <RowIconButton title="Edit" onClick={() => openDraft(step.id)}>
              <EditIcon />
            </RowIconButton>
            <RowIconButton title="Delete" onClick={() => deleteStep(step.id)}>
              <TrashIcon />
            </RowIconButton>
          </>
        }
      />
    )
  }

  return (
    <div>
      {units.map((unit, uIdx) => (
        <Fragment key={unit[0].id}>
          {unit.length > 1 ? (
            <SyncedStepGroup
              onUnsync={() => unsyncGroup(stepsById.get(unit[0].id)?.syncGroupId as string)}
            >
              {unit.map((entry) => renderStepRow(stepsById.get(entry.id)!, uIdx, true))}
            </SyncedStepGroup>
          ) : unit[0].kind === 'loop' ? (
            <LoopBlock
              group={groups.find((g) => g.id === unit[0].id)!}
              depth={depth}
              builder={builder}
              stepStatus={stepStatus}
              currentStepIds={currentStepIds}
              availableTechs={availableTechs}
              onMoveUp={() => moveEntry(containerGroupId, uIdx, -1)}
              onMoveDown={() => moveEntry(containerGroupId, uIdx, 1)}
              onTestRunStep={onTestRunStep}
              testRunDisabled={testRunDisabled}
            />
          ) : (
            renderStepRow(stepsById.get(unit[0].id)!, uIdx, false)
          )}
          {uIdx < units.length - 1 && <StepConnector />}
        </Fragment>
      ))}

      {units.length === 0 && !showDraftHere && (
        <div className="text-center py-6.5 px-2.5 text-muted text-[12.5px]">
          No steps yet — click &ldquo;+ Add Step&rdquo; to begin.
        </div>
      )}

      {showDraftHere && draftState && (
        <StepDraftForm
          draft={draftState}
          mode={draftMode === 'edit' ? 'edit' : 'add'}
          error={draftError}
          availableTechs={availableTechs}
          steps={steps}
          groups={groups}
          currentContainerId={containerGroupId}
          onChangeTech={changeDraftTech}
          onChangeAction={changeDraftAction}
          onChangeMachine={changeDraftMachine}
          onChangeInput={setDraftInput}
          onChangeFile={setDraftFile}
          onChangePrintSetting={setDraftPrintSetting}
          onChangeMaterialProfile={setDraftMaterialProfile}
          onCancel={closeDraft}
          onCommit={commitDraft}
        />
      )}

      {!hideControls && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => openDraft(undefined, containerGroupId)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold',
              'text-teal border border-dashed border-border'
            )}
          >
            + Add Step
          </button>
          {depth < MAX_LOOP_DEPTH &&
            (addingLoop ? (
              <InlineCountPrompt
                label="Repeat"
                onConfirm={(n) => {
                  addLoop(containerGroupId, n)
                  setAddingLoop(false)
                }}
                onCancel={() => setAddingLoop(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setAddingLoop(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-teal border border-dashed border-border"
              >
                + Add Loop
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
