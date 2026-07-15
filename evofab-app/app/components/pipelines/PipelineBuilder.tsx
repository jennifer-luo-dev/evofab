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
import { SyncedStepGroup } from './SyncedStepGroup';
import { usePipelineConfig } from './PipelineConfigContext';
import { summarizeStepInputs } from './pipelineUtils';
import { usePipelineBuilder } from './usePipelineBuilder';
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
  const { techs, techLabel, actionsByTech } = usePipelineConfig();
  const [name, setName] = useState('');
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
    commitDraft,
  } = usePipelineBuilder(availableTechs.map((t) => t.key));

  const checkedCount = checkedIds.size;

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
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onBackToTechSelect}
            className="px-3.75 py-2 rounded-lg text-xs font-semibold bg-surface text-text border border-border"
          >
            ← Technologies
          </button>
          <button
            type="button"
            disabled={steps.length === 0}
            className="px-3.75 py-2 rounded-lg text-xs font-semibold bg-teal text-bg disabled:bg-muted disabled:cursor-not-allowed"
          >
            Run Pipeline
          </button>
        </div>
      </div>

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
    </div>
  );
}
