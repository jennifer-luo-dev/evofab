// stopHandling.ts
// Per-tech "can this step's hardware be halted mid-action, and how" config
// for ContainerView's row-level Stop button. Consolidates what used to be a
// bare endpoint-only map (in ContainerView.tsx) plus a separate
// `step.tech === 'printer'` special case for the tooltip text into one
// place, so a new stoppable tech needs one entry here instead of both — and
// so a third stoppable tech doesn't silently inherit robot_arm's tooltip
// wording the way that special case would have.

import type { TechKey } from './types'

export interface StoppableTechConfig {
  /** API route to POST `{ machineId }` to halt this tech's hardware mid-action. */
  endpoint: string
  /** Tooltip shown on the row's Stop button while this tech's step is running. */
  label: string
}

/**
 * Techs whose in-flight step can be halted from the row, and how: robot_arm -> emergency stop
 * (protective stop on the controller); printer -> pause the print. A tech with no entry here
 * still has its run/wait aborted (see PipelineBuilder.requestStopRun) — it just has no separate
 * hardware-halt call, since its action isn't safely interruptible mid-flight (an actuation pulse,
 * a camera/classification request) — see NOT_STOPPABLE_LABEL for that case's tooltip.
 */
export const STOPPABLE_TECHS: Partial<Record<TechKey, StoppableTechConfig>> = {
  robot_arm: { endpoint: '/api/robot-stop', label: 'Emergency-stop the arm and stop the run' },
  printer: { endpoint: '/api/print/pause', label: 'Pause this print and stop the run' },
}

/** Tooltip for a step whose tech has no STOPPABLE_TECHS entry — the hardware isn't safely
 * interruptible mid-action, but stopping still aborts the run so nothing after this step executes
 * (and any client-side wait on this one ends now). */
export const NOT_STOPPABLE_LABEL = 'Stop the run (this step’s hardware can’t be interrupted)'
