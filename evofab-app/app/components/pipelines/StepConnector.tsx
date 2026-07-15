// StepConnector.tsx
// Small curved connector drawn between consecutive step rows (or synced
// groups) in both the pipeline builder and the History progress tracker.

import { StepConnectorGlyph } from '@/app/components/ui/icons'

/** Decorative connector shown between two consecutive pipeline step rows. */
export function StepConnector() {
  return (
    <div className="flex justify-start pl-2 h-[18px]">
      <StepConnectorGlyph />
    </div>
  )
}
