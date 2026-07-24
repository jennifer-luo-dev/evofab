// PositionPickerTrigger.tsx
// Icon-only button that opens PositionPickerModal, placed at the end of the
// X/Y/Z input row in StepDraftForm. The three direct-entry inputs stay put —
// this is an alternate way to fill them, not a replacement.

'use client'

import { TargetIcon } from '@/app/components/ui/icons'

interface PositionPickerTriggerProps {
  onClick: () => void
}

export function PositionPickerTrigger({ onClick }: PositionPickerTriggerProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Set target position…"
      aria-label="Set target position"
      className="shrink-0 h-[30px] w-[30px] mt-[19px] flex items-center justify-center rounded-md border border-border bg-surface text-muted hover:text-teal hover:border-teal"
    >
      <TargetIcon />
    </button>
  )
}
