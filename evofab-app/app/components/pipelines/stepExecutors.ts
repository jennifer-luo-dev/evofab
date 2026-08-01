// stepExecutors.ts
// One executor per pipeline-step technology (`Step.tech`), looked up from
// STEP_EXECUTORS and run by PipelineBuilder.runPipeline(). Splitting these out
// of runPipeline's loop keeps each technology's hardware-specific logic
// self-contained and lets a not-yet-wired technology (currently only
// robot_arm's Gripper Cycle) live as a clearly-marked stub instead of an
// inline branch — see the //TODO executor further down.
//
// Every executor has the same shape: given a step and just enough pipeline
// context to run in isolation, it either returns the outputs to persist to
// that step's `pipeline_steps.outputs`, or throws. `runPipeline` is the only
// place that turns a thrown error into `status: 'failed'` (or, for
// StepNotImplementedError, `status: 'skipped'`) — executors don't touch step
// status themselves.

import type { Dispatch, SetStateAction } from 'react'
import type { ActionConfig, Step, TechKey } from './types'
import type {
  RunningCameraState,
  RunningClassificationState,
  RunningPrinterState,
  RunningRobotState,
} from './StepMonitorCard'
import type { PrinterWithStatus } from '@/app/types/printer'
import { DEFAULT_SETTINGS } from '@/app/contexts/PrinterContext'
import { getWebcamStreamUrl, getGcodeMetadata } from '@/app/lib/moonraker'
import type { JointName, MoveTargetBody } from '@/app/lib/robot'

/** Thrown by an executor whose hardware integration doesn't exist yet — see the //TODO executors below. `runPipeline` treats this as `status: 'skipped'` rather than `'failed'`, matching today's behavior for any tech with no executor at all. */
export class StepNotImplementedError extends Error {}

export type StepOutputs = Record<string, unknown>

export interface StepExecutorContext {
  /** `machines.id` by name — see PipelineConfigContext. */
  machineIdByName: Record<string, string>
  actionsByTech: Partial<Record<TechKey, ActionConfig[]>>
  /** Active printers with live status, for the `printer` executor's machine lookup. */
  printers: PrinterWithStatus[]
  /** Printer-only: reflects the in-progress print into the "Now Running" side panel (StepMonitorCard). */
  setRunningPrinter: Dispatch<SetStateAction<RunningPrinterState | null>>
  /** Robot-arm-only: reflects the in-progress move into the "Now Running" side panel (StepMonitorCard). */
  setRunningRobot: Dispatch<SetStateAction<RunningRobotState | null>>
  /** Camera-only: reflects the in-progress capture into the "Now Running" side panel (StepMonitorCard). */
  setRunningCamera: Dispatch<SetStateAction<RunningCameraState | null>>
  /** Classification-model-only: reflects the in-progress classification into the "Now Running" side panel (StepMonitorCard). */
  setRunningClassification: Dispatch<SetStateAction<RunningClassificationState | null>>
  /**
   * Outputs already produced earlier in this same run, keyed by `Step.id` — lets a step whose
   * input is `type: 'step_output'` (e.g. classification_model's `photo_source`) resolve the
   * referenced step's outputs. Mutated in place by `runPipeline` as each step completes, so later
   * executors in the same run always see the latest entries.
   */
  stepOutputsById: Record<string, StepOutputs>
}

export type StepExecutor = (step: Step, ctx: StepExecutorContext) => Promise<StepOutputs>

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// arduino_board — implemented. Mirrors actuation-test's firePulse contract:
// the bridge only confirms the serial write succeeded, so completion is
// tracked client-side on the same timer rather than waiting for STATUS:DONE.
// ---------------------------------------------------------------------------

async function runArduinoBoardStep(step: Step, ctx: StepExecutorContext): Promise<StepOutputs> {
  const machineId = ctx.machineIdByName[step.machine]
  if (!machineId) throw new Error(`Arduino board "${step.machine}" not found`)

  const channel = parseInt(step.inputs.channel, 10)
  const duration_ms = parseInt(step.inputs.duration_ms, 10)
  if (!Number.isFinite(channel) || !Number.isFinite(duration_ms)) {
    throw new Error('Channel and duration are required for this step')
  }

  const res = await fetch('/api/actuate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machineId, channel, duration_ms }),
  })
  const resBody = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(resBody.error ?? `Actuation request failed (${res.status})`)

  await sleep(duration_ms)

  return { channel, duration_ms, summary: `CH${channel} fired for ${duration_ms}ms` }
}

// ---------------------------------------------------------------------------
// printer — implemented.
// ---------------------------------------------------------------------------

/** Safety cap so a stuck/unreachable printer can't hang Run Pipeline forever (~30 min at 2s/poll). */
const POLL_INTERVAL_MS = 2000
const MAX_POLLS = 900
/**
 * Consecutive bad polls (offline/error/unreachable) required before treating the printer as
 * genuinely down. `/api/printers` only gives Moonraker a 3s timeout per poll, so a single wifi
 * blip or momentarily-slow Moonraker response is expected noise, not a failure — without this
 * tolerance one bad poll out of hundreds during a long print kills the whole run even though the
 * printer never actually stopped (it keeps printing regardless of whether our poller can reach it).
 */
const OFFLINE_TOLERANCE_POLLS = 4
/** Moonraker's metadata scan can briefly lag behind the upload finishing — a few short retries covers it. */
const METADATA_RETRY_MS = 1000
const METADATA_MAX_RETRIES = 5

/**
 * Polls /api/printers until the printer that just started printing finishes, updating
 * `runningPrinter`'s live status/progress and the extrapolated-time fallback along the way.
 * Requires having observed the printer actually enter `printing`/`paused` at least once before
 * an `idle` reading counts as completion — otherwise a stale "still idle" poll right after
 * start would look like it's done. Similarly requires several *consecutive* offline/error
 * readings (see OFFLINE_TOLERANCE_POLLS) before declaring the print failed, so a single
 * transient poll failure doesn't kill an otherwise-healthy print.
 */
async function waitForPrintCompletion(
  machineId: string,
  startedAt: number,
  setRunningPrinter: StepExecutorContext['setRunningPrinter']
) {
  let sawPrinting = false
  let consecutiveBadPolls = 0
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS)

    const res = await fetch('/api/printers')
    if (!res.ok) {
      consecutiveBadPolls++
      if (consecutiveBadPolls >= OFFLINE_TOLERANCE_POLLS) throw new Error('Lost contact with the printer list')
      continue
    }
    const { printers: live = [] }: { printers: PrinterWithStatus[] } = await res.json()
    const printer = live.find((p) => p.id === machineId)
    const st = printer?.printer_status
    if (!printer || !st) {
      consecutiveBadPolls++
      if (consecutiveBadPolls >= OFFLINE_TOLERANCE_POLLS) throw new Error('Printer disappeared mid-print')
      continue
    }

    if (!st.online || st.status === 'error') {
      consecutiveBadPolls++
      if (consecutiveBadPolls >= OFFLINE_TOLERANCE_POLLS) {
        throw new Error(st.online ? 'Printer reported an error' : 'Printer went offline mid-print')
      }
      continue
    }
    consecutiveBadPolls = 0

    const elapsedSeconds = (Date.now() - startedAt) / 1000
    const extrapolatedSeconds = st.progress > 0 ? elapsedSeconds / (st.progress / 100) : null
    setRunningPrinter((prev) => (prev ? { ...prev, printer, extrapolatedSeconds } : prev))

    if (st.status === 'printing' || st.status === 'paused') {
      sawPrinting = true
      continue
    }
    if (sawPrinting && st.status === 'idle') return
  }
  throw new Error('Timed out waiting for print to complete')
}

/**
 * Fetches the slicer's own print-time estimate from Moonraker's file metadata and applies it
 * to `runningPrinter` once known. Moonraker's metadata scan can briefly lag the upload, so this
 * retries a few times; gives up silently (falling back to the extrapolated estimate) if the
 * slicer never embedded a time or the scan doesn't finish in time.
 */
async function applySlicerEstimate(
  printer: PrinterWithStatus,
  filename: string,
  startedAt: number,
  setRunningPrinter: StepExecutorContext['setRunningPrinter']
) {
  for (let i = 0; i < METADATA_MAX_RETRIES; i++) {
    const meta = await getGcodeMetadata(printer.ip, printer.port, filename)
    if (meta.estimated_time !== null) {
      setRunningPrinter((prev) =>
        prev && prev.startedAt === startedAt
          ? { ...prev, slicerEstimatedSeconds: meta.estimated_time }
          : prev
      )
      return
    }
    await sleep(METADATA_RETRY_MS)
  }
}

async function runPrinterStep(step: Step, ctx: StepExecutorContext): Promise<StepOutputs> {
  const printer = ctx.printers.find((p) => p.name === step.machine)
  if (!printer) throw new Error(`Printer "${step.machine}" not found`)

  const action = (ctx.actionsByTech[step.tech] ?? []).find((a) => a.key === step.action)
  const fileKey = action?.inputs.find((i) => i.type === 'file')?.key
  const file = fileKey ? step.files?.[fileKey] : undefined
  if (!file) throw new Error('No print file uploaded for this step')

  const streamUrl = await getWebcamStreamUrl(printer.ip, printer.port).catch(() => null)
  const startedAt = Date.now()
  ctx.setRunningPrinter({
    kind: 'printer',
    printer,
    fileName: file.name,
    streamUrl,
    startedAt,
    slicerEstimatedSeconds: null,
    extrapolatedSeconds: null,
  })

  const formData = new FormData()
  formData.append('file', file)
  formData.append('machine_id', printer.id)
  formData.append('print_profile_id', step.materialProfileId ?? '')
  formData.append('settings', JSON.stringify(step.printSettings ?? DEFAULT_SETTINGS))

  const res = await fetch('/api/print', { method: 'POST', body: formData })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Print request failed (${res.status})`)

  // Fire-and-forget: fills in the slicer's own estimate once Moonraker's metadata
  // scan catches up, without blocking the wait for actual completion below.
  void applySlicerEstimate(printer, body.fileKey ?? file.name, startedAt, ctx.setRunningPrinter)

  await waitForPrintCompletion(printer.id, startedAt, ctx.setRunningPrinter)

  const total_time = Math.round((Date.now() - startedAt) / 1000)
  return { total_time }
}

// ---------------------------------------------------------------------------
// robot_arm — Move is implemented (both Cartesian and joint-space targets,
// discriminated by `step.inputs.target_type` — see MoveTargetModal); Gripper
// Cycle is still a stub (see below). Resolves `step.machine` ->
// `machines.ip/port` via /api/robot-move (mirrors /api/actuate ->
// app/lib/arduino.ts), which forwards to the FastAPI bridge's POST
// /robot/move. That endpoint blocks server-side until the move settles, and
// always responds 200 with a MoveResult body (status: success/failed/
// protective_stop/limit_violation) rather than using HTTP error codes for a
// runtime outcome — see app/api/python/main.py's _execute_cartesian_move /
// _execute_joint_move — so there's no client-side wait-for-completion step
// here, unlike printer steps, and any non-'success' status is thrown as an
// Error below to fail the pipeline step, matching every other executor's
// convention. Requires an `action_types` row for robot_arm's `move` action
// key (see supabase/action_types_rows.sql) — see app/robot-test/page.tsx's
// `sendMove` for the original manual proof-of-concept this mirrors.
// ---------------------------------------------------------------------------

async function moveRobotArm(step: Step, ctx: StepExecutorContext): Promise<StepOutputs> {
  const machineId = ctx.machineIdByName[step.machine]
  if (!machineId) throw new Error(`Robot arm "${step.machine}" not found`)

  const speed_pct = parseFloat(step.inputs.speed_pct) || 25
  const acceleration_pct = parseFloat(step.inputs.acceleration_pct) || 25

  let body: MoveTargetBody
  if (step.inputs.target_type === 'joint') {
    let joints: { joint: JointName; angle_deg: number }[] = []
    try {
      const parsed = JSON.parse(step.inputs.joints || '[]')
      if (Array.isArray(parsed)) joints = parsed
    } catch {
      joints = []
    }
    if (joints.length === 0) throw new Error('Select at least one joint to rotate')
    body = {
      target_type: 'joint',
      mode: step.inputs.mode === 'relative' ? 'relative' : 'absolute',
      joints,
      speed_pct,
      acceleration_pct,
    }
  } else {
    const x = parseFloat(step.inputs.x)
    const y = parseFloat(step.inputs.y)
    const z = parseFloat(step.inputs.z)
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error('Target x, y, and z coordinates are required for this step')
    }
    body = { target_type: 'cartesian', position: { x, y, z }, speed_pct, acceleration_pct }
  }

  ctx.setRunningRobot({ kind: 'robot', machineName: step.machine, target: body, startedAt: Date.now(), result: null })

  const res = await fetch('/api/robot-move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machineId, ...body }),
  })
  const result = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(result.error ?? `Robot move failed (${res.status})`)

  ctx.setRunningRobot((prev) => (prev ? { ...prev, result } : prev))

  if (result.status !== 'success') throw new Error(result.error ?? `Move ${result.status}`)

  return {
    status: result.status,
    final_joint_positions_deg: result.final_joint_positions_deg,
    final_tcp_pose: result.final_tcp_pose,
    duration_ms: result.duration_ms,
    summary:
      body.target_type === 'cartesian'
        ? `Moved to (${body.position.x}, ${body.position.y}, ${body.position.z})`
        : `Rotated ${body.joints.map((j) => j.joint).join(', ')}`,
  }
}

/**
 * TEMPORARY: Robot Arm — Gripper Cycle isn't wired to hardware yet, so this
 * just waits 2 minutes to stand in for the real cycle time. See
 * app/robot-test/page.tsx `GripperControl.handleRunGripper` for the
 * proof-of-concept this will eventually call: POST { position, speed, force }
 * to `${bridge}/robot/gripper`, which runs `gripper_basic.urp` (activate,
 * open, close).
 */
async function cycleGripper(_step: Step, _ctx: StepExecutorContext): Promise<StepOutputs> {
  await new Promise((resolve) => setTimeout(resolve, 2 * 60 * 1000))
  return { summary: 'Gripper cycle complete (simulated — hardware integration pending)' }
}

/** Dispatches to the robot_arm action's specific executor once seeded action keys exist. */
async function runRobotArmStep(step: Step, ctx: StepExecutorContext): Promise<StepOutputs> {
  if (step.action === 'gripper_cycle') return cycleGripper(step, ctx)
  return moveRobotArm(step, ctx)
}

// ---------------------------------------------------------------------------
// camera — implemented. Triggers an on-demand capture (POST /api/camera-capture
// -> the standalone Orbbec bridge's GET /capture, see camera_orbbec_service.py)
// and stores the resulting photo as a data URL in `outputs.image_keys` — a
// one-element array (type `image_array` in action_types.output_schema) rather
// than a bare string, so a future multi-frame/multi-camera capture can return
// more than one photo without a schema change. A later classification_model
// step's `photo_source` input (`expects: 'image_array'`) resolves this via
// `stepOutputsById`. Deliberately not run through the curvature-vision
// pipeline here — that's classifyPhoto's job, on its own step.
//
// Note per the context doc: a camera capture synced to an actuation pulse is
// represented as two ordinary single-machine steps sharing `sync_group_id`,
// not as one action spanning both machines — so this executor only needs to
// handle "capture a photo," not "capture in sync with X." The `delay` input
// (seeded on the camera/capture action_types row, seconds, default 0.5)
// covers that case within a single step: a pause before the shutter fires so
// a preceding synced step's physical effect (e.g. an actuation pulse) has
// time to visibly settle first.
// ---------------------------------------------------------------------------

async function runCameraStep(step: Step, ctx: StepExecutorContext): Promise<StepOutputs> {
  const machineId = ctx.machineIdByName[step.machine]
  if (!machineId) throw new Error(`Camera "${step.machine}" not found`)

  const delay = parseFloat(step.inputs.delay)

  ctx.setRunningCamera({ kind: 'camera', machineName: step.machine, startedAt: Date.now(), imageUrl: null })

  if (Number.isFinite(delay) && delay > 0) await sleep(delay * 1000)

  const res = await fetch('/api/camera-capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machineId }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Camera capture failed (${res.status})`)

  ctx.setRunningCamera((prev) => (prev ? { ...prev, imageUrl: body.image_url } : prev))

  return {
    image_keys: [body.image_url],
    // Carried alongside the photo so a later classification_model step
    // (classifyPhoto) can forward real per-pixel depth to /classify instead
    // of falling back to brightness-only masking — see camera-capture's
    // route.ts header comment.
    depth_b64: body.depth_b64,
    depth_width: body.depth_width,
    depth_height: body.depth_height,
    depth_scale: body.depth_scale,
    summary: 'Photo captured',
  }
}

// ---------------------------------------------------------------------------
// classification_model — implemented. Runs the deterministic curvature-vision
// pipeline (analyzer.py mask -> skeleton, geometry.py circle fit) on a photo
// produced by an earlier camera step, via /api/classify -> the classification
// bridge's POST /classify (see app/api/python/main.py). The `status` field
// CurvatureResult already returns (TRACKING / NO_TARGET / MATH_ERROR) *is*
// the classification result — machine_classification_model's threshold/
// z_min_m/z_max_m columns are just that pipeline's mask-generation tuning
// (ActuatorAnalyzer's constructor args), not a separate pass/fail cutoff.
// ---------------------------------------------------------------------------

/**
 * Classification Model — Classify. Resolves `photo_source` (a `step_output`
 * input holding the referenced step's real `Step.id`, per DraftInputField) to
 * that step's `outputs.image_keys` — an `image_array` output, per the
 * action_types schema, so a camera step could return more than one photo in
 * future; today it's always a one-element array, so `[0]` is the whole photo
 * — then sends it to the machine's classification bridge for analysis.
 */
async function classifyPhoto(step: Step, ctx: StepExecutorContext): Promise<StepOutputs> {
  const machineId = ctx.machineIdByName[step.machine]
  if (!machineId) throw new Error(`Classification model "${step.machine}" not found`)

  const sourceStepId = step.inputs.photo_source
  const sourceOutputs = sourceStepId ? ctx.stepOutputsById[sourceStepId] : undefined
  const imageKeys = sourceOutputs?.image_keys
  const imageUrl = Array.isArray(imageKeys) ? imageKeys[0] : undefined
  if (typeof imageUrl !== 'string' || !imageUrl) {
    throw new Error('No source photo — select a camera step for Photo Source')
  }

  // Depth captured alongside the source photo, if the camera step got it
  // (see runCameraStep) — passed through to /api/classify so masking can
  // depth-gate contours instead of falling back to brightness-only
  // (picking the largest bright blob, which this rig's reflective
  // enclosure walls can fool — see main.py's _annotate_curvature).
  const depthB64 = sourceOutputs?.depth_b64
  const depthWidth = sourceOutputs?.depth_width
  const depthHeight = sourceOutputs?.depth_height
  const depthScale = sourceOutputs?.depth_scale
  const hasDepth =
    typeof depthB64 === 'string' &&
    typeof depthWidth === 'number' &&
    typeof depthHeight === 'number' &&
    typeof depthScale === 'number'

  ctx.setRunningClassification({
    kind: 'classification',
    machineName: step.machine,
    sourceImageUrl: imageUrl,
    startedAt: Date.now(),
    result: null,
  })

  const res = await fetch('/api/classify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      hasDepth
        ? {
            machineId,
            imageUrl,
            depth_b64: depthB64,
            depth_width: depthWidth,
            depth_height: depthHeight,
            depth_scale: depthScale,
          }
        : { machineId, imageUrl }
    ),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Classification request failed (${res.status})`)

  ctx.setRunningClassification((prev) => (prev ? { ...prev, result: body } : prev))

  return {
    // Matches action_types.output_schema for classification_model's "classify" action.
    analysis_status: body.analysis_status,
    mean_curvature: body.mean_curvature,
    bend_angle_deg: body.bend_angle_deg,
    radius_mm: body.radius_mm,
    ppm_used: body.ppm_used,
    actuator_length_mm: body.actuator_length_mm,
    image_url: body.image_url,
    summary:
      body.analysis_status === 'TRACKING' && body.bend_angle_deg != null
        ? `${body.analysis_status} — ${body.bend_angle_deg.toFixed(1)}°`
        : body.analysis_status,
  }
}

async function runClassificationModelStep(
  step: Step,
  ctx: StepExecutorContext
): Promise<StepOutputs> {
  return classifyPhoto(step, ctx)
}

// ---------------------------------------------------------------------------

/** Executor lookup by `Step.tech`. A tech with no entry here falls back to `status: 'skipped'` in runPipeline, same as today. */
export const STEP_EXECUTORS: Partial<Record<TechKey, StepExecutor>> = {
  arduino_board: runArduinoBoardStep,
  printer: runPrinterStep,
  robot_arm: runRobotArmStep,
  camera: runCameraStep,
  classification_model: runClassificationModelStep,
}
