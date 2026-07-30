// PipelineBuilder.tsx
// Numbered step-by-step pipeline editor: name the pipeline, add/edit/reorder/
// delete steps, group two or more steps to run at the same instant, and nest
// steps inside loops.

'use client';

import { useState } from 'react';
import { cn } from '@/app/lib/utils';
import { ContainerView } from './ContainerView';
import { InlineCountPrompt } from './InlineCountPrompt';
import {
  StepMonitorCard,
  type RunningCameraState,
  type RunningClassificationState,
  type RunningPrinterState,
  type RunningRobotState,
} from './StepMonitorCard';
import { usePipelineConfig } from './PipelineConfigContext';
import { unrollForExecution } from './pipelineUtils';
import { usePipelineBuilder } from './usePipelineBuilder';
import { STEP_EXECUTORS, StepNotImplementedError, type StepExecutorContext } from './stepExecutors';
import type { PipelineRunStatus } from '@/app/components/history/types';
import type { TechKey, UnrolledStep } from './types';

interface PipelineBuilderProps {
  selectedTechs: Set<TechKey>;
  onBackToTechSelect: () => void;
}

/** Pipeline name input, sync/repeat toolbar, step+loop tree, and add-step/add-loop controls. */
export function PipelineBuilder({ selectedTechs, onBackToTechSelect }: PipelineBuilderProps) {
  const { techs, actionsByTech, printers, machineIdByName } = usePipelineConfig();
  const [name, setName] = useState('');
  const [stepStatus, setStepStatus] = useState<Record<string, PipelineRunStatus>>({});
  const [running, setRunning] = useState(false);
  const [runningPrinter, setRunningPrinter] = useState<RunningPrinterState | null>(null);
  const [runningRobot, setRunningRobot] = useState<RunningRobotState | null>(null);
  const [runningCamera, setRunningCamera] = useState<RunningCameraState | null>(null);
  const [runningClassification, setRunningClassification] =
    useState<RunningClassificationState | null>(null);
  const [currentStepId, setCurrentStepId] = useState<string | null>(null);
  const [pipelineRunId, setPipelineRunId] = useState<string | null>(null);
  const [addingRepeat, setAddingRepeat] = useState(false);
  const availableTechs = techs.filter((t) => selectedTechs.has(t.key));
  const builder = usePipelineBuilder(availableTechs.map((t) => t.key));
  const { steps, groups, rootOrder, checkedIds, syncSelected, syncError, repeatSelected, repeatError } = builder;

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
   * Runs the pipeline: unrolls the tree (see pipelineUtils.unrollForExecution — every loop's
   * body cloned `iterationCount` times with fresh per-iteration `syncGroupId`s and remapped
   * `step_output` references, plus one inert, never-dispatched definition row per loop-body
   * step), persists both the definitions and the real executable rows to
   * `pipelines`/`pipeline_steps`/`pipeline_step_groups` first so the run survives a reload and
   * shows up in Activity History immediately, then runs each *executable* row in order through
   * its technology's executor (see stepExecutors.ts — STEP_EXECUTORS), reporting status back to
   * the persisted run as it goes. A technology with no registered executor (or whose executor
   * throws StepNotImplementedError, e.g. robot_arm's Gripper Cycle today) is marked `skipped`
   * rather than failing the run. Stops on the first real failure.
   */
  async function runPipeline() {
    const { executable, definitions } = unrollForExecution(rootOrder, groups, steps, actionsByTech);

    setRunning(true);
    setStepStatus({});
    setRunningPrinter(null);
    setRunningRobot(null);
    setRunningCamera(null);
    setRunningClassification(null);
    setCurrentStepId(null);
    setPipelineRunId(null);

    function toStepPayload(s: UnrolledStep) {
      return {
        id: s.id,
        machineTypeId: techs.find((t) => t.key === s.tech)?.id ?? null,
        machineId: machineIdByName[s.machine] ?? null,
        actionTypeId: (actionsByTech[s.tech] ?? []).find((a) => a.key === s.action)?.id ?? null,
        syncGroupId: s.syncGroupId,
        groupId: s.groupId,
        iterationPath: s.iterationPath,
        dependsOnStepId: s.dependsOnStepId,
        inputs: s.inputs,
      };
    }

    const createRes = await fetch('/api/pipelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name || 'Untitled Pipeline',
        groups: groups.map((g) => ({
          id: g.id,
          parentGroupId: g.parentGroupId,
          label: g.label,
          iterationCount: g.iterationCount,
        })),
        // Definitions after executables: they're inert (never dispatched — see the
        // `iteration_path IS NOT NULL OR group_id IS NULL` filter everywhere execution/History
        // reads steps), so their exact step_order position doesn't matter, only that it's valid.
        steps: [...executable, ...definitions].map(toStepPayload),
      }),
    });
    if (!createRes.ok) {
      console.error('Failed to persist pipeline run', await createRes.text().catch(() => ''));
      setRunning(false);
      return;
    }
    const { pipeline } = await createRes.json();
    setPipelineRunId(pipeline.id);
    // The client generates each step's id up front and the API persists it verbatim as
    // `pipeline_steps.id`, so a local step's id already is its db id — no lookup needed.

    // Mutated in place as each step completes, not React state — an executor needs the latest
    // entries synchronously (mid-loop), before React would have re-rendered with a state update.
    const stepOutputsById: Record<string, Record<string, unknown>> = {};

    const executorContext: StepExecutorContext = {
      machineIdByName,
      actionsByTech,
      printers,
      setRunningPrinter,
      setRunningRobot,
      setRunningCamera,
      setRunningClassification,
      stepOutputsById,
    };

    let allSucceeded = true;

    for (const step of executable) {
      const dbStepId = step.id;
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
        stepOutputsById[step.id] = outputs;
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
            Add steps one at a time. Select steps to sync them or repeat them in a loop.
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
          <div className="flex items-center gap-2.5 mb-2.5 min-h-7.5 text-xs text-muted flex-wrap">
            {checkedCount >= 2 && (
              <>
                <button
                  type="button"
                  onClick={syncSelected}
                  disabled={!!syncError}
                  title={syncError ?? undefined}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3.75 py-2 rounded-lg text-xs font-semibold border',
                    syncError
                      ? 'bg-surface text-muted border-border cursor-not-allowed'
                      : 'bg-teal-dim text-teal border-teal'
                  )}
                >
                  ⚡ Sync Selected
                </button>
                {syncError && <span className="text-red">{syncError}</span>}
              </>
            )}
            {checkedCount >= 1 &&
              (addingRepeat ? (
                <InlineCountPrompt
                  label="Repeat Selected ×"
                  onConfirm={(n) => {
                    repeatSelected(n);
                    setAddingRepeat(false);
                  }}
                  onCancel={() => setAddingRepeat(false)}
                />
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setAddingRepeat(true)}
                    disabled={!!repeatError}
                    title={repeatError ?? undefined}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-3.75 py-2 rounded-lg text-xs font-semibold border',
                      repeatError
                        ? 'bg-surface text-muted border-border cursor-not-allowed'
                        : 'bg-teal-dim text-teal border-teal'
                    )}
                  >
                    🔁 Repeat Selected
                  </button>
                  {repeatError && <span className="text-red">{repeatError}</span>}
                </>
              ))}
            {checkedCount === 0 && (
              <span>Select steps to sync them, or repeat them in a loop</span>
            )}
          </div>

          <ContainerView
            containerGroupId={null}
            depth={0}
            builder={builder}
            stepStatus={stepStatus}
            currentStepId={currentStepId}
            availableTechs={availableTechs}
          />
        </div>

        {runningPrinter && <StepMonitorCard running={runningPrinter} />}
        {runningRobot && <StepMonitorCard running={runningRobot} />}
        {runningCamera && <StepMonitorCard running={runningCamera} />}
        {runningClassification && <StepMonitorCard running={runningClassification} />}
      </div>
    </div>
  );
}
