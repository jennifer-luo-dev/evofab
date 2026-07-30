// InlineCountPrompt.tsx
// Small inline "enter a repeat count, confirm/cancel" control — used by both
// "+ Add Loop" and "Repeat Selected" to set `iteration_count`. Replaces a
// browser prompt() dialog, per the convention established for Add Step:
// native dialogs are unreliable in an embedded/sandboxed context and don't
// fit the visual language.

'use client'

import { useState } from 'react'

interface InlineCountPromptProps {
  label: string
  onConfirm: (count: number) => void
  onCancel: () => void
}

export function InlineCountPrompt({ label, onConfirm, onCancel }: InlineCountPromptProps) {
  const [value, setValue] = useState('2')
  const n = parseInt(value, 10)
  const valid = Number.isFinite(n) && n >= 2

  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-teal bg-teal-dim text-xs">
      <span className="text-muted">{label}</span>
      <input
        type="number"
        min={2}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        className="w-14 px-1.5 py-0.5 rounded border border-border bg-surface text-text text-xs"
      />
      <button
        type="button"
        disabled={!valid}
        onClick={() => valid && onConfirm(n)}
        className="px-2 py-1 rounded-md font-semibold text-teal disabled:text-muted disabled:cursor-not-allowed"
      >
        Confirm
      </button>
      <button type="button" onClick={onCancel} className="px-2 py-1 rounded-md text-muted">
        Cancel
      </button>
    </div>
  )
}
