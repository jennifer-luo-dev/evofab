// StepDraftForm.tsx
// Inline add/edit form for a single pipeline step: technology, action,
// machine, and the action's own configurable inputs (including referencing
// another step's output).

'use client';

import { useState } from 'react';
import { usePipelineConfig } from './PipelineConfigContext';
import { FileUploadZone } from '@/app/components/setup/FileUploadZone';
import { PrintSettingsPanel } from '@/app/components/setup/PrintSettingsPanel';
import { MoveTargetTrigger } from '@/app/components/position-picker/MoveTargetTrigger';
import { MoveTargetModal, type MoveTargetResult } from '@/app/components/position-picker/MoveTargetModal';
import { JOINT_LABELS, type JointName } from '@/app/lib/robot';
import { isAncestorOrSameContainer } from './pipelineUtils';
import type { ActionConfig, LoopGroup, Step, StepDraft, StepInputConfig, TechKey, TechOption } from './types';
import type { MaterialProfile, PrintSettings } from '@/app/types/job';

/** `robot_arm`'s "move" action's own input keys — handled entirely by MoveTargetModal, so they're
 * filtered out of the generic input-field list below (same treatment as `isPrinter`'s
 * `print_profile_id`, which has its own dedicated panel too). */
const ROBOT_MOVE_INPUT_KEYS = ['target_type', 'x', 'y', 'z', 'rx', 'ry', 'rz', 'mode', 'joints', 'speed_pct', 'acceleration_pct'];

/** Reconstructs MoveTargetModal's `initial` prop from a draft/step's flat `inputs` record —
 * the inverse of the `onChangeInput(...)` calls in MoveTargetModal's `onConfirm` below.
 * `rx`/`ry`/`rz` only count as a pinned orientation when all three parse — a step saved
 * before orientation pinning existed (or with it left unpinned) has none of them set, and
 * should keep inheriting orientation at move time rather than defaulting to (0, 0, 0). */
function parseMoveTargetFromInputs(inputs: Record<string, string>): MoveTargetResult {
  let joints: { joint: JointName; angle_deg: number }[] = [];
  try {
    const parsed = JSON.parse(inputs.joints || '[]');
    if (Array.isArray(parsed)) joints = parsed;
  } catch {
    joints = [];
  }
  const rx = parseFloat(inputs.rx);
  const ry = parseFloat(inputs.ry);
  const rz = parseFloat(inputs.rz);
  const orientation = Number.isFinite(rx) && Number.isFinite(ry) && Number.isFinite(rz) ? { rx, ry, rz } : null;
  return {
    targetType: inputs.target_type === 'joint' ? 'joint' : 'cartesian',
    position: {
      x: parseFloat(inputs.x) || 0,
      y: parseFloat(inputs.y) || 0,
      z: parseFloat(inputs.z) || 0,
    },
    orientation,
    jointMode: inputs.mode === 'relative' ? 'relative' : 'absolute',
    joints,
    speedPct: parseFloat(inputs.speed_pct) || 100,
    accelerationPct: parseFloat(inputs.acceleration_pct) || 25,
  };
}

/** One-line human-readable summary of the current move target, shown next to the trigger button. */
function summarizeMoveTarget(inputs: Record<string, string>): string {
  const target = parseMoveTargetFromInputs(inputs);
  if (target.targetType === 'cartesian') {
    const base = `Cartesian → (${target.position.x.toFixed(3)}, ${target.position.y.toFixed(3)}, ${target.position.z.toFixed(3)}) m`;
    return target.orientation ? `${base}, orientation pinned` : base;
  }
  if (target.joints.length === 0) return 'Joint — no joints selected yet';
  const deltaPrefix = target.jointMode === 'relative' ? 'Δ' : '';
  const joints = target.joints
    .map((j) => `${JOINT_LABELS[j.joint]}: ${deltaPrefix}${j.angle_deg}°`)
    .join(', ');
  return `Joint (${target.jointMode}) → ${joints}`;
}

interface StepDraftFormProps {
  draft: StepDraft;
  mode: 'add' | 'edit';
  error: string | null;
  availableTechs: TechOption[];
  /** Existing steps, used to populate "reference another step's output" inputs. */
  steps: Step[];
  /** All loop definitions, used to restrict "reference another step's output" candidates to the same container or an ancestor loop. */
  groups: LoopGroup[];
  /** The container this draft belongs to (`null` = top-level) — the step_output picker only offers steps here or in an ancestor. */
  currentContainerId: string | null;
  onChangeTech: (tech: TechOption['key']) => void;
  onChangeAction: (action: string) => void;
  onChangeMachine: (machine: string) => void;
  onChangeInput: (key: string, value: string) => void;
  onChangeFile: (key: string, file: File | null) => void;
  onChangePrintSetting: (key: keyof PrintSettings, value: number) => void;
  onChangeMaterialProfile: (profile: MaterialProfile | null) => void;
  onCancel: () => void;
  onCommit: () => void;
}

/** Renders one action input, dispatching to a text/number/select/file/step-reference control. */
function DraftInputField({
  input,
  value,
  file,
  buildVolume,
  steps,
  excludeStepId,
  actionsByTech,
  groups,
  currentContainerId,
  onChange,
  onFileChange,
}: {
  input: StepInputConfig;
  value: string;
  file: File | null;
  buildVolume?: string | null;
  steps: Step[];
  excludeStepId?: string;
  actionsByTech: Partial<Record<TechKey, ActionConfig[]>>;
  groups: LoopGroup[];
  currentContainerId: string | null;
  onChange: (value: string) => void;
  onFileChange: (file: File | null) => void;
}) {
  if (input.type === 'file') {
    return (
      <div className="flex-1 min-w-60">
        <FileUploadZone
          heading={input.label}
          file={file}
          buildVolume={buildVolume}
          onFileChange={(f) => {
            onFileChange(f);
            onChange(f?.name ?? '');
          }}
        />
      </div>
    );
  }

  if (input.type === 'step_output') {
    const candidates = steps.filter((s) => {
      if (s.id === excludeStepId) return false;
      if (!input.expects) {
        // no-op, falls through to the ancestor-or-same-container check below
      } else {
        const action = (actionsByTech[s.tech] ?? []).find((a) => a.key === s.action);
        if (!(action?.outputs ?? []).some((o) => o.type === input.expects)) return false;
      }
      // Only a step in this same container or an ancestor loop has exactly one coherent
      // clone once iterations are unrolled (see unrollForExecution's truncate-to-common-
      // ancestor remap) — a step in an unrelated branch (a sibling loop, or nested under a
      // different ancestor) has no single right target, so it's not offered at all.
      return isAncestorOrSameContainer(s.groupId, currentContainerId, groups);
    });
    return (
      <div className="flex-1 min-w-37.5">
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">
          {input.label}
        </label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-2.25 py-1.75 rounded-md border border-border bg-surface text-text text-xs"
        >
          <option value="">None</option>
          {candidates.map((s) => {
            const action = (actionsByTech[s.tech] ?? []).find((a) => a.key === s.action);
            return (
              <option key={s.id} value={s.id}>
                Step {s.num} — {action?.label ?? s.action}
              </option>
            );
          })}
        </select>
      </div>
    );
  }

  if (input.type === 'select') {
    const options = input.options ?? [];
    return (
      <div className="flex-1 min-w-37.5">
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">
          {input.label}
        </label>
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={options.length === 0}
          className="w-full px-2.25 py-1.75 rounded-md border border-border bg-surface text-text text-xs disabled:opacity-60"
        >
          {options.length === 0 ? (
            <option value="">No options available</option>
          ) : (
            options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))
          )}
        </select>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-37.5">
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">
        {input.label}
      </label>
      <input
        type={input.type === 'number' ? 'number' : 'text'}
        value={value ?? input.default ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2.25 py-1.75 rounded-md border border-border bg-surface text-text text-xs"
      />
    </div>
  );
}

/** Inline form for adding a new pipeline step or editing an existing one. */
export function StepDraftForm({
  draft,
  mode,
  error,
  availableTechs,
  steps,
  groups,
  currentContainerId,
  onChangeTech,
  onChangeAction,
  onChangeMachine,
  onChangeInput,
  onChangeFile,
  onChangePrintSetting,
  onChangeMaterialProfile,
  onCancel,
  onCommit,
}: StepDraftFormProps) {
  const { actionsByTech, machinesByTech, techLabel, printers, materialProfiles, machineIdByName } =
    usePipelineConfig();
  const [pickerOpen, setPickerOpen] = useState(false);
  const actions = actionsByTech[draft.tech] ?? [];
  const action = actions.find((a) => a.key === draft.action) ?? actions[0];
  const isPrinter = draft.tech === 'printer';
  const isRobotMove = draft.tech === 'robot_arm' && draft.action === 'move';
  const machines = isPrinter ? printers.map((p) => p.name) : (machinesByTech[draft.tech] ?? []);
  const selectedPrinter = isPrinter ? printers.find((p) => p.name === draft.machine) : undefined;
  const selectedMaterialProfile =
    materialProfiles.find((p) => p.id === draft.materialProfileId) ?? null;
  // The embedded PrintSettingsPanel below already covers `print_profile_id` with a
  // proper picker; the generic select control has no resolved options for it (its
  // `source` isn't a static option list), so it would only render disabled.
  const visibleInputs = (action?.inputs ?? []).filter(
    (input) =>
      !(isPrinter && input.key === 'print_profile_id') &&
      !(isRobotMove && ROBOT_MOVE_INPUT_KEYS.includes(input.key))
  );

  return (
    <div className="border-[1.5px] border-dashed border-teal rounded-lg p-3.5 bg-teal-dim my-2.5">
      <div className="text-[11px] font-bold uppercase tracking-wide text-teal mb-2.5">
        {mode === 'edit' ? 'Editing step' : 'New step'}
      </div>

      <div className="flex gap-2.5 flex-wrap mb-2.5">
        <div className="flex-1 min-w-37.5">
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">
            Technology
          </label>
          <select
            value={draft.tech}
            onChange={(e) => onChangeTech(e.target.value as TechOption['key'])}
            className="w-full px-2.25 py-1.75 rounded-md border border-border bg-surface text-text text-xs"
          >
            {availableTechs.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 min-w-37.5">
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">
            Action
          </label>
          <select
            value={draft.action}
            onChange={(e) => onChangeAction(e.target.value)}
            disabled={actions.length <= 1}
            className="w-full px-2.25 py-1.75 rounded-md border border-border bg-surface text-text text-xs disabled:opacity-60"
          >
            {actions.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 min-w-37.5">
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">
            {techLabel[draft.tech]}
          </label>
          <select
            value={draft.machine}
            onChange={(e) => onChangeMachine(e.target.value)}
            className="w-full px-2.25 py-1.75 rounded-md border border-border bg-surface text-text text-xs"
          >
            <option value="">Select…</option>
            {isPrinter
              ? printers.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                    {p.printer_status?.online ? '' : ' (offline)'}
                  </option>
                ))
              : machines.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
          </select>
        </div>
      </div>

      {action && visibleInputs.length > 0 && (
        <div className="flex gap-2.5 flex-wrap mb-2.5">
          {visibleInputs.map((input) => (
            <DraftInputField
              key={input.key}
              input={input}
              value={draft.inputs[input.key]}
              file={draft.files?.[input.key] ?? null}
              buildVolume={selectedPrinter?.build_volume}
              steps={steps}
              excludeStepId={draft.id}
              actionsByTech={actionsByTech}
              groups={groups}
              currentContainerId={currentContainerId}
              onChange={(value) => onChangeInput(input.key, value)}
              onFileChange={(file) => onChangeFile(input.key, file)}
            />
          ))}
        </div>
      )}

      {isRobotMove && (
        <div className="flex items-center gap-2.5 mb-2.5">
          <MoveTargetTrigger onClick={() => setPickerOpen(true)} />
          <p className="text-xs text-muted">{summarizeMoveTarget(draft.inputs)}</p>
        </div>
      )}

      {isRobotMove && pickerOpen && (
        <MoveTargetModal
          initial={parseMoveTargetFromInputs(draft.inputs)}
          machineId={machineIdByName[draft.machine]}
          onCancel={() => setPickerOpen(false)}
          onConfirm={(result) => {
            onChangeInput('target_type', result.targetType);
            onChangeInput('x', String(result.position.x));
            onChangeInput('y', String(result.position.y));
            onChangeInput('z', String(result.position.z));
            onChangeInput('rx', result.orientation ? String(result.orientation.rx) : '');
            onChangeInput('ry', result.orientation ? String(result.orientation.ry) : '');
            onChangeInput('rz', result.orientation ? String(result.orientation.rz) : '');
            onChangeInput('mode', result.jointMode);
            onChangeInput('joints', JSON.stringify(result.joints));
            onChangeInput('speed_pct', String(result.speedPct));
            onChangeInput('acceleration_pct', String(result.accelerationPct));
            setPickerOpen(false);
          }}
        />
      )}

      {isPrinter && (
        <div className="mb-2.5">
          <PrintSettingsPanel
            materialProfiles={materialProfiles}
            settings={draft.printSettings}
            onUpdateSetting={onChangePrintSetting}
            selectedMaterialProfile={selectedMaterialProfile}
            onSelectMaterialProfile={(profile) => {
              onChangeMaterialProfile(profile);
              // Keep the generic input record in sync for step summaries, storing the
              // readable name (like the machine field) rather than the raw profile id.
              onChangeInput('print_profile_id', profile?.name ?? '');
            }}
          />
        </div>
      )}

      {error && <p className="text-xs text-red mb-2.5">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3.75 py-2 rounded-lg text-xs font-semibold bg-surface text-text border border-border"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onCommit}
          className="px-3.75 py-2 rounded-lg text-xs font-semibold bg-teal text-bg"
        >
          {mode === 'edit' ? 'Save' : 'Add'}
        </button>
      </div>
    </div>
  );
}
