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
   * Outputs already produced earlier in this same run, keyed by `Step.num` — lets a step whose
   * input is `type: 'step_output'` (e.g. classification_model's `photo_source`) resolve the
   * referenced step's outputs. Mutated in place by `runPipeline` as each step completes, so later
   * executors in the same run always see the latest entries.
   */
  stepOutputsByNum: Record<number, StepOutputs>
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
/** Moonraker's metadata scan can briefly lag behind the upload finishing — a few short retries covers it. */
const METADATA_RETRY_MS = 1000
const METADATA_MAX_RETRIES = 5

/**
 * Polls /api/printers until the printer that just started printing finishes, updating
 * `runningPrinter`'s live status/progress and the extrapolated-time fallback along the way.
 * Requires having observed the printer actually enter `printing`/`paused` at least once before
 * an `idle` reading counts as completion — otherwise a stale "still idle" poll right after
 * start would look like it's done.
 */
async function waitForPrintCompletion(
  machineId: string,
  startedAt: number,
  setRunningPrinter: StepExecutorContext['setRunningPrinter']
) {
  let sawPrinting = false
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS)

    const res = await fetch('/api/printers')
    if (!res.ok) continue
    const { printers: live = [] }: { printers: PrinterWithStatus[] } = await res.json()
    const printer = live.find((p) => p.id === machineId)
    const st = printer?.printer_status
    if (!printer || !st) continue

    if (!st.online) throw new Error('Printer went offline mid-print')
    if (st.status === 'error') throw new Error('Printer reported an error')

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
  ctx.setRunningRobot(null)
  ctx.setRunningCamera(null)
  ctx.setRunningClassification(null)
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
// robot_arm — Move is implemented; Gripper Cycle is still a stub (see below).
// Resolves `step.machine` -> `machines.ip/port` via /api/robot-move (mirrors
// /api/actuate -> app/lib/arduino.ts), which forwards to the FastAPI bridge's
// POST /robot/move. Unlike the Arduino bridge, that endpoint blocks
// server-side until the move settles (or a safety/timeout check fails, in
// which case it 422s) — see app/api/python/main.py's _execute_move — so
// there's no client-side wait-for-completion step here, unlike printer steps.
// Requires an `action_types` row for robot_arm's `move` action key with
// `input_schema` inputs `x`/`y`/`z` (type: 'number', metres, robot base
// frame) to appear in the step-builder form — see app/robot-test/page.tsx's
// `sendMove` for the original manual proof-of-concept this mirrors.
// ---------------------------------------------------------------------------

async function moveRobotArm(step: Step, ctx: StepExecutorContext): Promise<StepOutputs> {
  const machineId = ctx.machineIdByName[step.machine]
  if (!machineId) throw new Error(`Robot arm "${step.machine}" not found`)

  const x = parseFloat(step.inputs.x)
  const y = parseFloat(step.inputs.y)
  const z = parseFloat(step.inputs.z)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new Error('Target x, y, and z coordinates are required for this step')
  }

  ctx.setRunningPrinter(null)
  ctx.setRunningCamera(null)
  ctx.setRunningClassification(null)
  ctx.setRunningRobot({ kind: 'robot', machineName: step.machine, target: { x, y, z }, startedAt: Date.now() })

  const res = await fetch('/api/robot-move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machineId, x, y, z }),
  })
  const resBody = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(resBody.error ?? `Robot move failed (${res.status})`)

  return { x, y, z, summary: resBody.message ?? `Moved to (${x}, ${y}, ${z})` }
}

/**
 * TODO: Robot Arm — Gripper Cycle. See app/robot-test/page.tsx
 * `GripperControl.handleRunGripper` for the proof-of-concept: POST
 * { position, speed, force } to `${bridge}/robot/gripper`, which runs
 * `gripper_basic.urp` (activate, open, close).
 */
async function cycleGripper(_step: Step, _ctx: StepExecutorContext): Promise<StepOutputs> {
  throw new StepNotImplementedError('Robot Arm Gripper Cycle is not implemented yet')
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
// `stepOutputsByNum`. Deliberately not run through the curvature-vision
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

  ctx.setRunningPrinter(null)
  ctx.setRunningRobot(null)
  ctx.setRunningClassification(null)
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

  return { image_keys: [body.image_url], summary: 'Photo captured' }
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
 * input holding the referenced step's `Step.num`, per DraftInputField) to
 * that step's `outputs.image_keys` — an `image_array` output, per the
 * action_types schema, so a camera step could return more than one photo in
 * future; today it's always a one-element array, so `[0]` is the whole photo
 * — then sends it to the machine's classification bridge for analysis.
 */
async function classifyPhoto(step: Step, ctx: StepExecutorContext): Promise<StepOutputs> {
  const machineId = ctx.machineIdByName[step.machine]
  if (!machineId) throw new Error(`Classification model "${step.machine}" not found`)

  const sourceStepNum = parseInt(step.inputs.photo_source, 10)
  const sourceOutputs = Number.isFinite(sourceStepNum)
    ? ctx.stepOutputsByNum[sourceStepNum]
    : undefined
  const imageKeys = sourceOutputs?.image_keys
  const imageUrl = Array.isArray(imageKeys) ? imageKeys[0] : undefined
  if (typeof imageUrl !== 'string' || !imageUrl) {
    throw new Error('No source photo — select a camera step for Photo Source')
  }

  ctx.setRunningPrinter(null)
  ctx.setRunningRobot(null)
  ctx.setRunningCamera(null)
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
    body: JSON.stringify({ machineId, imageUrl }),
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
