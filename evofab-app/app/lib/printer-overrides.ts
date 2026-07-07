import { adjustZOffset, runGcodeScript } from "@/app/lib/moonraker";
import {
  MotionError,
  resolveClampedZOffsetDelta,
  type MotionPrinter,
} from "@/app/lib/printer-motion";
import type { PrinterStatusType } from "@/app/types/printer";

export type PrintOverrideAction =
  | "speed_factor"
  | "flow_factor"
  | "fan_speed"
  | "nozzle_target"
  | "bed_target"
  | "babystep_z";

export type PrintOverridePrinter = MotionPrinter;

export interface PrintOverrideStatus {
  status: PrinterStatusType | "unknown";
}

export interface PrintOverrideRequest {
  action: PrintOverrideAction;
  value?: number;
}

export interface PrintOverrideResult {
  action: PrintOverrideAction;
  value: number;
  script: string;
}

export class PrintOverrideError extends Error {
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
    this.name = "PrintOverrideError";
    this.code = input.code;
    this.status = input.status ?? 400;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
  }
}

const ACTIVE_PRINT_STATUSES = new Set<PrinterStatusType>([
  "printing",
  "paused",
]);

export function overrideUnavailableReason(
  status: PrintOverrideStatus,
): string | null {
  if (ACTIVE_PRINT_STATUSES.has(status.status as PrinterStatusType))
    return null;
  if (status.status === "offline") return "Printer is offline.";
  if (status.status === "error") return "Clear the printer fault first.";
  return "No active print.";
}

function finiteNumber(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new PrintOverrideError({
      code: "PRINT_OVERRIDE_INVALID_INPUT",
      message: "Override command includes an invalid numeric value.",
      details: { value },
    });
  }
  return number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export async function runPrintOverride(
  printer: PrintOverridePrinter,
  status: PrintOverrideStatus,
  request: PrintOverrideRequest,
): Promise<PrintOverrideResult> {
  const reason = overrideUnavailableReason(status);
  if (reason) {
    throw new PrintOverrideError({
      code: "PRINT_OVERRIDE_UNAVAILABLE",
      message: reason,
      status: 409,
      details: { printer_status: status.status },
    });
  }

  const value = finiteNumber(request.value);
  let script: string;

  if (request.action === "speed_factor") {
    const pct = clamp(value, 1, 300);
    script = `M220 S${pct}`;
    await runGcodeScript(printer.ip, printer.port, script);
    return { action: request.action, value: pct, script };
  }

  if (request.action === "flow_factor") {
    const pct = clamp(value, 1, 300);
    script = `M221 S${pct}`;
    await runGcodeScript(printer.ip, printer.port, script);
    return { action: request.action, value: pct, script };
  }

  if (request.action === "fan_speed") {
    const pct = clamp(value, 0, 100);
    script = `M106 S${Math.round((pct / 100) * 255)}`;
    await runGcodeScript(printer.ip, printer.port, script);
    return { action: request.action, value: pct, script };
  }

  if (request.action === "nozzle_target") {
    const temp = clamp(value, 0, 320);
    script = `M104 S${temp}`;
    await runGcodeScript(printer.ip, printer.port, script);
    return { action: request.action, value: temp, script };
  }

  if (request.action === "bed_target") {
    const temp = clamp(value, 0, 140);
    script = `M140 S${temp}`;
    await runGcodeScript(printer.ip, printer.port, script);
    return { action: request.action, value: temp, script };
  }

  if (request.action === "babystep_z") {
    let deltaMm: number;
    try {
      deltaMm = resolveClampedZOffsetDelta(printer, value);
    } catch (error) {
      throw normalizePrintOverrideError(error);
    }
    await adjustZOffset(printer.ip, printer.port, deltaMm);
    return {
      action: request.action,
      value: deltaMm,
      script: `SET_GCODE_OFFSET Z_ADJUST=${deltaMm} MOVE=1`,
    };
  }

  throw new PrintOverrideError({
    code: "PRINT_OVERRIDE_INVALID_ACTION",
    message: "Unsupported print override action.",
    details: { action: request.action },
  });
}

export function normalizePrintOverrideError(
  error: unknown,
): PrintOverrideError {
  if (error instanceof PrintOverrideError) return error;
  if (error instanceof MotionError) {
    return new PrintOverrideError({
      code: error.code.replace(/^MOTION_/, "PRINT_OVERRIDE_"),
      message: error.message,
      status: error.status,
      retryable: error.retryable,
      details: error.details,
    });
  }
  return new PrintOverrideError({
    code: "PRINT_OVERRIDE_FAILED",
    message:
      error instanceof Error ? error.message : "Print override command failed.",
    status: 502,
    retryable: true,
  });
}
