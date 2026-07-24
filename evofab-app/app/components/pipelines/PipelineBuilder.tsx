// PipelineBuilder.tsx
// Numbered step-by-step pipeline editor: name the pipeline, add/edit/reorder/
// delete steps, and group two or more steps to run at the same instant.

'use client';

import { Fragment, type ReactNode } from 'react';
import { useState } from 'react';
import { cn } from '@/app/lib/utils';
import {
  MACHINE_TYPE_ICONS,
  DownIcon,
  EditIcon,
  TrashIcon,
  UpIcon,
} from '@/app/components/ui/icons';
import { PipelineStepRow } from './PipelineStepRow';
import { StepConnector } from './StepConnector';
import { StepDraftForm } from './StepDraftForm';
import {
  StepMonitorCard,
  type RunningCameraState,
  type RunningClassificationState,
  type RunningPrinterState,
  type RunningRobotState,
} from './StepMonitorCard';
import { SyncedStepGroup } from './SyncedStepGroup';
import { usePipelineConfig } from './PipelineConfigContext';
import { summarizeStepInputs } from './pipelineUtils';
import { usePipelineBuilder } from './usePipelineBuilder';
import { STEP_EXECUTORS, StepNotImplementedError, type StepExecutorContext } from './stepExecutors';
import { PipelineStatusBadge } from '@/app/components/history/PipelineStatusBadge';
import type { PipelineRunStatus } from '@/app/components/history/types';
import type { Step, TechKey } from './types';

interface PipelineBuilderProps {
  selectedTechs: Set<TechKey>;
  onBackToTechSelect: () => void;
}

/** Small icon-only action button used in a step row's trailing controls. */
function RowIconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="p-1.25 rounded-md text-muted hover:bg-bg hover:text-text"
    >
      {children}
    </button>
  );
}

/** Pipeline name input, sync toolbar, step list, and add/edit-step controls. */
export function PipelineBuilder({ selectedTechs, onBackToTechSelect }: PipelineBuilderProps) {
  const { techs, techLabel, actionsByTech, printers, machineIdByName } = usePipelineConfig();
  const [name, setName] = useState('');
  const [stepStatus, setStepStatus] = useState<Record<number, PipelineRunStatus>>({});
  const [running, setRunning] = useState(false);
  const [runningPrinter, setRunningPrinter] = useState<RunningPrinterState | null>(null);
  const [runningRobot, setRunningRobot] = useState<RunningRobotState | null>(null);
  const [runningCamera, setRunningCamera] = useState<RunningCameraState | null>(null);
  const [runningClassification, setRunningClassification] =
    useState<RunningClassificationState | null>(null);
  const [currentStepId, setCurrentStepId] = useState<number | null>(null);
  const [pipelineRunId, setPipelineRunId] = useState<string | null>(null);
  const availableTechs = techs.filter((t) => selectedTechs.has(t.key));
  const {
    steps,
    units,
    checkedIds,
    toggleChecked,
    syncSelected,
    unsyncGroup,
    moveUnit,
    deleteStep,
    draftMode,
    draftState,
    draftError,
    openDraft,
    closeDraft,
    changeDraftTech,
    changeDraftAction,
    changeDraftMachine,
    setDraftInput,
    setDraftFile,
    setDraftPrintSetting,
    setDraftMaterialProfile,
    commitDraft,
  } = usePipelineBuilder(availableTechs.map((t) => t.key));

  const checkedCount = checkedIds.size;

  /** Reports a pipeline step's status (and optional outputs) to the persisted run so it survives a reload. Best-effort — logs but doesn't throw, since a logging failure shouldn't abort the actual print. */
  async function reportStepStatus(dbStepId: string, status: PipelineRunStatus, outputs?: Record<string, unknown>) {
    try {
      await fetch(`/api/pipeline-steps/${dbStepId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, outputs }),
      });
    } catch (err) {
      console.error('Failed to report step status', err);
    }
  }

  /**
   * Runs the pipeline: persists it (and its steps) to `pipelines`/`pipeline_steps` first so the
   * run survives a reload and shows up in Activity History immediately, then runs each step in
   * order through its technology's executor (see stepExecutors.ts — STEP_EXECUTORS), reporting
   * status back to the persisted run as it goes. A technology with no registered executor (or
   * whose executor throws StepNotImplementedError, e.g. robot_arm's Gripper Cycle today) is
   * marked `skipped` rather than failing the run. Stops on the first real failure.
   */
  async function runPipeline() {
    setRunning(true);
    setStepStatus({});
    setRunningPrinter(null);
    setRunningRobot(null);
    setRunningCamera(null);
    setRunningClassification(null);
    setCurrentStepId(null);
    setPipelineRunId(null);

    const createRes = await fetch('/api/pipelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name || 'Untitled Pipeline',
        steps: steps.map((s) => ({
          machineTypeId: techs.find((t) => t.key === s.tech)?.id ?? null,
          machineId: machineIdByName[s.machine] ?? null,
          actionTypeId: (actionsByTech[s.tech] ?? []).find((a) => a.key === s.action)?.id ?? null,
          syncGroupId: s.syncGroupId,
          inputs: s.inputs,
        })),
      }),
    });
    if (!createRes.ok) {
      console.error('Failed to persist pipeline run', await createRes.text().catch(() => ''));
      setRunning(false);
      return;
    }
    const { pipeline, steps: dbSteps } = await createRes.json();
    setPipelineRunId(pipeline.id);
    // steps[i] <-> dbSteps[i]: both built from the same ordered `steps` array.
    const dbStepIdByLocalId = new Map(steps.map((s, i) => [s.id, dbSteps[i]?.id as string | undefined]));

    // Mutated in place as each step completes, not React state — an executor needs the latest
    // entries synchronously (mid-loop), before React would have re-rendered with a state update.
    const stepOutputsByNum: Record<number, Record<string, unknown>> = {};

    const executorContext: StepExecutorContext = {
      machineIdByName,
      actionsByTech,
      printers,
      setRunningPrinter,
      setRunningRobot,
      setRunningCamera,
      setRunningClassification,
      stepOutputsByNum,
    };

    let allSucceeded = true;

    for (const step of steps) {
      const dbStepId = dbStepIdByLocalId.get(step.id);
      setCurrentStepId(step.id);
      setStepStatus((prev) => ({ ...prev, [step.id]: 'running' }));
      if (dbStepId) void reportStepStatus(dbStepId, 'running');

      const executor = STEP_EXECUTORS[step.tech];
      if (!executor) {
        setStepStatus((prev) => ({ ...prev, [step.id]: 'skipped' }));
        if (dbStepId) void reportStepStatus(dbStepId, 'skipped');
        continue;
      }

      try {
        const outputs = await executor(step, executorContext);
        stepOutputsByNum[step.num] = outputs;
        setStepStatus((prev) => ({ ...prev, [step.id]: 'complete' }));
        if (dbStepId) void reportStepStatus(dbStepId, 'complete', outputs);
      } catch (err) {
        if (err instanceof StepNotImplementedError) {
          setStepStatus((prev) => ({ ...prev, [step.id]: 'skipped' }));
          if (dbStepId) void reportStepStatus(dbStepId, 'skipped');
          continue;
        }
        console.error('Pipeline step failed', err);
        setStepStatus((prev) => ({ ...prev, [step.id]: 'failed' }));
        if (dbStepId) void reportStepStatus(dbStepId, 'failed');
        allSucceeded = false;
        break;
      }
    }

    await fetch(`/api/pipelines/${pipeline.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: allSucceeded ? 'complete' : 'failed' }),
    }).catch((err) => console.error('Failed to finalize pipeline status', err));

    setCurrentStepId(null);
    setRunningPrinter(null);
    setRunningRobot(null);
    setRunningCamera(null);
    setRunningClassification(null);
    setRunning(false);
  }

  function renderRow(step: Step, unitIdx: number, numberLabel: string | number, synced: boolean) {
    const Icon = MACHINE_TYPE_ICONS[step.tech] ?? MACHINE_TYPE_ICONS.DEFAULT;
    const action = (actionsByTech[step.tech] ?? []).find((a) => a.key === step.action);

    return (
      <PipelineStepRow
        key={step.id}
        icon={<Icon className="w-4 h-4" />}
        number={numberLabel}
        title={
          <>
            <span>{action?.label ?? step.action}</span> — {step.machine}
          </>
        }
        meta={summarizeStepInputs(step, actionsByTech) || techLabel[step.tech]}
        synced={synced}
        highlighted={step.id === currentStepId}
        leading={
          <input
            type="checkbox"
            checked={checkedIds.has(step.id)}
            onChange={() => toggleChecked(step.id)}
            className="w-3.75 h-3.75 accent-teal shrink-0"
          />
        }
        // Edit Actions: Reorder, Edit, Delete
        trailing={
          <>
            {stepStatus[step.id] && (
              <PipelineStatusBadge status={stepStatus[step.id]} className="mr-1" />
            )}
            <RowIconButton title="Move up" onClick={() => moveUnit(unitIdx, -1)}>
              <UpIcon />
            </RowIconButton>
            <RowIconButton title="Move down" onClick={() => moveUnit(unitIdx, 1)}>
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
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this pipeline…"
            className="text-[15px] font-semibold bg-transparent border-b-[1.5px] border-transparent focus:border-teal focus:outline-none text-text py-1 w-65"
          />
          <p className="text-[13.5px] text-muted mt-1.5">
            Add steps one at a time. Select two or more to run them at the same instant.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pipelineRunId && (
            <a
              href={`/history?pipeline=${pipelineRunId}`}
              className="px-3.75 py-2 rounded-lg text-xs font-semibold text-teal border border-teal hover:bg-teal-dim"
            >
              View in Activity History →
            </a>
          )}
          <button
            type="button"
            onClick={onBackToTechSelect}
            className="px-3.75 py-2 rounded-lg text-xs font-semibold bg-surface text-text border border-border"
          >
            ← Technologies
          </button>
          <button
            type="button"
            onClick={runPipeline}
            disabled={steps.length === 0 || running}
            className="px-3.75 py-2 rounded-lg text-xs font-semibold bg-teal text-bg disabled:bg-muted disabled:cursor-not-allowed"
          >
            {running ? 'Running…' : 'Run Pipeline'}
          </button>
        </div>
      </div>

      <div
        className={cn(
          'grid gap-6',
          (runningPrinter || runningRobot || runningCamera || runningClassification) &&
            'lg:grid-cols-[1fr_320px]'
        )}
      >
        <div className="max-w-170">
          <div className="flex items-center gap-2.5 mb-2.5 min-h-7.5 text-xs text-muted">
            {checkedCount >= 2 ? (
              <button
                type="button"
                onClick={syncSelected}
                className="inline-flex items-center gap-1.5 px-3.75 py-2 rounded-lg text-xs font-semibold bg-teal-dim text-teal border border-teal"
              >
                ⚡ Sync Selected
              </button>
            ) : (
              <span>Select two or more steps to run them at the same time</span>
            )}
          </div>

          <div>
            {units.map((unit, uIdx) => (
              <Fragment key={unit[0].id}>
                {unit.length > 1 ? (
                  <SyncedStepGroup
                    stepNumber={unit[0].num}
                    onUnsync={() => unsyncGroup(unit[0].syncGroupId as string)}
                  >
                    {unit.map((step, sIdx) =>
                      renderRow(step, uIdx, sIdx === 0 ? step.num : '↳', true)
                    )}
                  </SyncedStepGroup>
                ) : (
                  renderRow(unit[0], uIdx, unit[0].num, false)
                )}
                {uIdx < units.length - 1 && <StepConnector />}
              </Fragment>
            ))}
            {units.length === 0 && (
              <div className="text-center py-6.5 px-2.5 text-muted text-[12.5px]">
                No steps yet — click &ldquo;+ Add Step&rdquo; to begin.
              </div>
            )}
          </div>

          {draftMode && draftState && (
            <StepDraftForm
              draft={draftState}
              mode={draftMode}
              error={draftError}
              availableTechs={availableTechs}
              steps={steps}
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

          <button
            type="button"
            onClick={() => openDraft()}
            className={cn(
              'mt-2 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold',
              'text-teal border border-dashed border-border'
            )}
          >
            + Add Step
          </button>
        </div>

        {runningPrinter && <StepMonitorCard running={runningPrinter} />}
        {runningRobot && <StepMonitorCard running={runningRobot} />}
        {runningCamera && <StepMonitorCard running={runningCamera} />}
        {runningClassification && <StepMonitorCard running={runningClassification} />}
      </div>
    </div>
  );
}
