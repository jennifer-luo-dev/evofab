// StepDraftForm.tsx
// Inline add/edit form for a single pipeline step: technology, action,
// machine, and the action's own configurable inputs (including referencing
// another step's output).

'use client'

import { usePipelineConfig } from './PipelineConfigContext'
import type { ActionConfig, Step, StepDraft, StepInputConfig, TechKey, TechOption } from './types'

interface StepDraftFormProps {
  draft: StepDraft
  mode: 'add' | 'edit'
  error: string | null
  availableTechs: TechOption[]
  /** Existing steps, used to populate "reference another step's output" inputs. */
  steps: Step[]
  onChangeTech: (tech: TechOption['key']) => void
  onChangeAction: (action: string) => void
  onChangeMachine: (machine: string) => void
  onChangeInput: (key: string, value: string) => void
  onCancel: () => void
  onCommit: () => void
}

/** Renders one action input, dispatching to a text/number/select/step-reference control. */
function DraftInputField({
  input,
  value,
  steps,
  excludeStepId,
  actionsByTech,
  onChange,
}: {
  input: StepInputConfig
  value: string
  steps: Step[]
  excludeStepId?: number
  actionsByTech: Partial<Record<TechKey, ActionConfig[]>>
  onChange: (value: string) => void
}) {
  if (input.type === 'step_output') {
    const candidates = steps.filter((s) => {
      if (s.id === excludeStepId) return false
      if (!input.expects) return true
      const action = (actionsByTech[s.tech] ?? []).find((a) => a.key === s.action)
      return (action?.outputs ?? []).some((o) => o.type === input.expects)
    })
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
            const action = (actionsByTech[s.tech] ?? []).find((a) => a.key === s.action)
            return (
              <option key={s.id} value={s.num}>
                Step {s.num} — {action?.label ?? s.action}
              </option>
            )
          })}
        </select>
      </div>
    )
  }

  if (input.type === 'select') {
    const options = input.options ?? []
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
    )
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
  )
}

/** Inline form for adding a new pipeline step or editing an existing one. */
export function StepDraftForm({
  draft,
  mode,
  error,
  availableTechs,
  steps,
  onChangeTech,
  onChangeAction,
  onChangeMachine,
  onChangeInput,
  onCancel,
  onCommit,
}: StepDraftFormProps) {
  const { actionsByTech, machinesByTech, techLabel } = usePipelineConfig()
  const actions = actionsByTech[draft.tech] ?? []
  const action = actions.find((a) => a.key === draft.action) ?? actions[0]
  const machines = machinesByTech[draft.tech] ?? []

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
            {machines.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      {action && action.inputs.length > 0 && (
        <div className="flex gap-2.5 flex-wrap mb-2.5">
          {action.inputs.map((input) => (
            <DraftInputField
              key={input.key}
              input={input}
              value={draft.inputs[input.key]}
              steps={steps}
              excludeStepId={draft.id}
              actionsByTech={actionsByTech}
              onChange={(value) => onChangeInput(input.key, value)}
            />
          ))}
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
  )
}
