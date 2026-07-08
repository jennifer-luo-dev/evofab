import {
  adjustZOffset,
  extrudePellet,
  getMoonrakerMode,
  homeToolhead,
  jogToolhead,
  readToolheadState,
  runGcodeScript,
} from "@/app/lib/moonraker";
import {
  getMockMoonrakerState,
  mockPrinterKey,
} from "@/app/lib/mock-moonraker";
import type { PrinterStatusType } from "@/app/types/printer";

export type MotionAction =
  | "home"
  | "jog"
  | "babystep"
  | "z_offset"
  | "extrude"
  | "retract"
  | "extrusion_factor"
  | "pressure_advance";

export type MotionAxis = "x" | "y" | "z";

export interface MotionPrinter {
  id?: string;
  ip: string;
  port: number;
}

export interface MotionStatus {
  status: PrinterStatusType | "unknown";
  hotend_temp: number | null;
}

export interface MotionRequest {
  action: MotionAction;
  axis?: MotionAxis;
  distanceMm?: number;
  feedrateMmMin?: number;
  deltaMm?: number;
  lengthMm?: number;
  factorPercent?: number;
  pressureAdvance?: number;
  smoothTime?: number;
}

export interface MotionResult {
  action: MotionAction;
  script: string;
}

export class MotionError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(input: {
    code: string;
    message: string;
    status?: number;
    retryable?: boolean;
    details?: unknown;
  }) {
    super(input.message);
    this.name = "MotionError";
    this.code = input.code;
    this.status = input.status ?? 400;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
  }
}

const IDLE_OR_PAUSED = new Set(["idle", "paused"]);
const MIN_EXTRUDE_TEMP_C = 170;
const MAX_JOG_MM = 10;
const MAX_EXTRUDE_MM = 20;
const MAX_OFFSET_STEP_MM = 0.05;
const MAX_CUMULATIVE_OFFSET_MM = 1;
const MAX_EXTRUSION_FACTOR_PCT = 300;
const MAX_PRESSURE_ADVANCE = 2;
const MAX_PRESSURE_SMOOTH_TIME = 1;
const FLOAT_EPSILON = 0.000001;

function motionMockKey(printer: MotionPrinter): string {
  return mockPrinterKey({ ip: printer.ip, port: printer.port });
}

function finiteNumber(value: unknown, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new MotionError({
      code: "MOTION_INVALID_INPUT",
      message: "Motion command includes an invalid numeric value.",
      details: { value },
    });
  }
  return number;
}

function assertNotPrinting(status: MotionStatus) {
  if (status.status === "printing") {
    throw new MotionError({
      code: "MOTION_BLOCKED_PRINTING",
      message: "Manual motion is blocked while the printer is printing.",
      status: 409,
    });
  }
}

function assertIdleOrPaused(status: MotionStatus) {
  if (!IDLE_OR_PAUSED.has(status.status)) {
    throw new MotionError({
      code: "MOTION_REQUIRES_IDLE_OR_PAUSED",
      message: "Jogging and extrusion require an idle or paused printer.",
      status: 409,
      details: { status: status.status },
    });
  }
}

async function assertHomed(printer: MotionPrinter) {
  const homedAxes =
    getMoonrakerMode() === "mock"
      ? getMockMoonrakerState(motionMockKey(printer)).homedAxes
      : (await readToolheadState(printer.ip, printer.port)).homedAxes;

  if (!homedAxes.x || !homedAxes.y || !homedAxes.z) {
    throw new MotionError({
      code: "MOTION_REQUIRES_HOME",
      message: "Home the printer before jogging.",
      status: 409,
      details: { homed_axes: homedAxes },
    });
  }
}

function clampMagnitude(value: number, max: number): number {
  return Math.max(-max, Math.min(max, value));
}

export function resolveClampedZOffsetDelta(
  printer: MotionPrinter,
  requestedDelta: number,
): number {
  const deltaMm = clampMagnitude(requestedDelta, MAX_OFFSET_STEP_MM);
  if (getMoonrakerMode() === "mock") {
    const current = getMockMoonrakerState(motionMockKey(printer)).zOffset;
    const next = current + deltaMm;
    if (Math.abs(next) > MAX_CUMULATIVE_OFFSET_MM + FLOAT_EPSILON) {
      throw new MotionError({
        code: "MOTION_OFFSET_LIMIT",
        message: "Z offset limit reached.",
        status: 409,
        details: {
          current_offset_mm: current,
          requested_delta_mm: requestedDelta,
          max_cumulative_mm: MAX_CUMULATIVE_OFFSET_MM,
        },
      });
    }
  }
  return deltaMm;
}

export async function runPrinterMotion(
  printer: MotionPrinter,
  status: MotionStatus,
  request: MotionRequest,
): Promise<MotionResult> {
  assertNotPrinting(status);

  if (request.action === "home") {
    await homeToolhead(printer.ip, printer.port);
    return { action: request.action, script: "G28" };
  }

  if (request.action === "jog") {
    assertIdleOrPaused(status);
    await assertHomed(printer);
    const axis = request.axis;
    if (axis !== "x" && axis !== "y" && axis !== "z") {
      throw new MotionError({
        code: "MOTION_INVALID_AXIS",
        message: "Jog axis must be x, y, or z.",
      });
    }
    const distanceMm = clampMagnitude(
      finiteNumber(request.distanceMm),
      MAX_JOG_MM,
    );
    const feedrateMmMin = Math.max(
      1,
      finiteNumber(request.feedrateMmMin, 1200),
    );
    await jogToolhead(
      printer.ip,
      printer.port,
      axis,
      distanceMm,
      feedrateMmMin,
    );
    return {
      action: request.action,
      script: `G91\nG1 ${axis.toUpperCase()}${distanceMm} F${feedrateMmMin}\nG90`,
    };
  }

  if (request.action === "babystep" || request.action === "z_offset") {
    const requestedDelta = finiteNumber(request.deltaMm);
    const deltaMm = resolveClampedZOffsetDelta(printer, requestedDelta);
    await adjustZOffset(printer.ip, printer.port, deltaMm);
    return {
      action: request.action,
      script: `SET_GCODE_OFFSET Z_ADJUST=${deltaMm} MOVE=1`,
    };
  }

  if (request.action === "extrude" || request.action === "retract") {
    assertIdleOrPaused(status);
    const hotendTemp = status.hotend_temp ?? 0;
    if (hotendTemp < MIN_EXTRUDE_TEMP_C) {
      throw new MotionError({
        code: "MOTION_COLD_EXTRUDE_BLOCKED",
        message:
          "Extrude and retract require a hotend temperature of at least 170 C.",
        status: 409,
        details: { hotend_temp: status.hotend_temp },
      });
    }
    const length = Math.abs(finiteNumber(request.lengthMm));
    const signedLength =
      request.action === "retract"
        ? -Math.min(length, MAX_EXTRUDE_MM)
        : Math.min(length, MAX_EXTRUDE_MM);
    const feedrateMmMin = Math.max(1, finiteNumber(request.feedrateMmMin, 300));
    await extrudePellet(printer.ip, printer.port, signedLength, feedrateMmMin);
    return {
      action: request.action,
      script: `M83\nG1 E${signedLength} F${feedrateMmMin}`,
    };
  }

  if (request.action === "extrusion_factor") {
    assertIdleOrPaused(status);
    const factorPercent = Math.max(
      1,
      Math.min(
        MAX_EXTRUSION_FACTOR_PCT,
        finiteNumber(request.factorPercent, 100),
      ),
    );
    const script = `M221 S${factorPercent}`;
    await runGcodeScript(printer.ip, printer.port, script);
    return { action: request.action, script };
  }

  if (request.action === "pressure_advance") {
    assertIdleOrPaused(status);
    const pressureAdvance = Math.max(
      0,
      Math.min(MAX_PRESSURE_ADVANCE, finiteNumber(request.pressureAdvance, 0)),
    );
    const smoothTime = Math.max(
      0,
      Math.min(MAX_PRESSURE_SMOOTH_TIME, finiteNumber(request.smoothTime, 0)),
    );
    const script = `SET_PRESSURE_ADVANCE ADVANCE=${pressureAdvance} SMOOTH_TIME=${smoothTime}`;
    await runGcodeScript(printer.ip, printer.port, script);
    return { action: request.action, script };
  }

  throw new MotionError({
    code: "MOTION_INVALID_ACTION",
    message: "Unsupported motion action.",
    details: { action: request.action },
  });
}
