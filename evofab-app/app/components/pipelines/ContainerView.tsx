// ContainerView.tsx
// Renders one container's ordered entries — the top-level pipeline (`containerGroupId: null`),
// or a single loop's body. Recursive: a loop entry renders as a LoopBlock, which renders its
// own body via another ContainerView at depth + 1. This is what makes "+ Add Step"/"+ Add Loop"
// work identically at every nesting level, and what makes a loop's own atomic reorder trivial —
// its whole nested body lives inside its own container, invisible to the parent's order array.

'use client'

import { Fragment, useState } from 'react'
import { cn } from '@/app/lib/utils'
import { MACHINE_TYPE_ICONS, DownIcon, EditIcon, PlayIcon, StopIcon, TrashIcon, UpIcon } from '@/app/components/ui/icons'
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
  /** Stops the in-flight run/test run — aborts the current step and halts before the next (see PipelineBuilder.requestStopRun). */
  onStopRun: () => void
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
  onStopRun,
  testRunDisabled,
}: ContainerViewProps) {
  const { actionsByTech, techLabel, machineIdByName } = usePipelineConfig()
  const [addingLoop, setAddingLoop] = useState(false)
  const [stoppingStepId, setStoppingStepId] = useState<string | null>(null)
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
  const editingStepId = draftMode === 'edit' ? draftState?.id : undefined
  const showEditDraftHere = draftMode === 'edit' && editingContainerId === containerGroupId
  const showAddDraftHere = draftMode === 'add' && draftTargetGroupId === containerGroupId
  const showDraftHere = showAddDraftHere || showEditDraftHere

  /** Techs whose in-flight step can be halted from the row, and the endpoint that does it.
   * robot_arm → emergency stop (protective stop on the controller); printer → pause the print. */
  const STOPPABLE_TECHS: Record<string, string> = {
    robot_arm: '/api/robot-stop',
    printer: '/api/print/pause',
  }

  /** Stops a running step: aborts the run so the executor unwinds now and nothing after it starts
   * (see PipelineBuilder.requestStopRun), and — for a tech whose hardware can be halted mid-action
   * (see STOPPABLE_TECHS) — also POSTs the halt endpoint so the machine itself stops, not just our
   * wait on it. The step ends up `failed` with a "Stopped" note, same as any interrupted step. */
  async function stopStep(step: Step) {
    onStopRun()
    const endpoint = STOPPABLE_TECHS[step.tech]
    const machineId = machineIdByName[step.machine]
    if (!endpoint || !machineId) return
    setStoppingStepId(step.id)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machineId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        console.error(`Stop failed for step ${step.num}:`, body.error ?? res.statusText)
      }
    } catch (err) {
      console.error(`Stop failed for step ${step.num}:`, err)
    } finally {
      setStoppingStepId(null)
    }
  }

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
            {currentStepIds.has(step.id) ? (
              <RowIconButton
                title={
                  STOPPABLE_TECHS[step.tech]
                    ? step.tech === 'printer'
                      ? 'Pause this print and stop the run'
                      : 'Emergency-stop the arm and stop the run'
                    : // capture / actuation pulse: the hardware isn't safely interruptible
                      // mid-action, but stopping still aborts the run so nothing after this
                      // step executes (and any client-side wait on this one ends now).
                      'Stop the run (this step’s hardware can’t be interrupted)'
                }
                onClick={() => stoppingStepId !== step.id && stopStep(step)}
              >
                <StopIcon className={stoppingStepId === step.id ? 'opacity-40' : undefined} />
              </RowIconButton>
            ) : (
              <RowIconButton
                title="Test run this step now"
                onClick={() => !testRunDisabled && onTestRunStep([step.id])}
              >
                <PlayIcon className={testRunDisabled ? 'opacity-40' : undefined} />
              </RowIconButton>
            )}
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

  const editDraftForm = showEditDraftHere && draftState && (
    <StepDraftForm
      draft={draftState}
      mode="edit"
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
  )

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
              onStopRun={onStopRun}
              testRunDisabled={testRunDisabled}
            />
          ) : (
            renderStepRow(stepsById.get(unit[0].id)!, uIdx, false)
          )}
          {unit.some((entry) => entry.id === editingStepId) && editDraftForm}
          {uIdx < units.length - 1 && <StepConnector />}
        </Fragment>
      ))}

      {units.length === 0 && !showDraftHere && (
        <div className="text-center py-6.5 px-2.5 text-muted text-[12.5px]">
          No steps yet — click &ldquo;+ Add Step&rdquo; to begin.
        </div>
      )}

      {showAddDraftHere && draftState && (
        <StepDraftForm
          draft={draftState}
          mode="add"
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
