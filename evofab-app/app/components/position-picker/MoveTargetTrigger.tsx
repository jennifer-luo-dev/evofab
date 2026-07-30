// MoveTargetTrigger.tsx
// Icon-only button that opens MoveTargetModal, placed next to the machine
// row in StepDraftForm for a robot_arm Move step.

'use client'

import { TargetIcon } from '@/app/components/ui/icons'

interface MoveTargetTriggerProps {
  onClick: () => void
}

export function MoveTargetTrigger({ onClick }: MoveTargetTriggerProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Set move target…"
      aria-label="Set move target"
      className="shrink-0 h-[30px] w-[30px] flex items-center justify-center rounded-md border border-border bg-surface text-muted hover:text-teal hover:border-teal"
    >
      <TargetIcon />
    </button>
  )
}
