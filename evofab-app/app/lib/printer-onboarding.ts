import type { PrinterType } from "@/app/types/printer";
import type { Printer } from "@/app/types/printer";

export interface PrinterOnboardingInput {
  name?: unknown;
  model?: unknown;
  ip?: unknown;
  port?: unknown;
  type?: unknown;
  material?: unknown;
  build_volume?: unknown;
  webcam_url?: unknown;
}

export interface PrinterInsert {
  name: string;
  model: string;
  ip: string;
  port: number;
  driver_type: "moonraker";
  moonraker_host: string;
  moonraker_port: number;
  prusalink_host: null;
  prusalink_key_file: null;
  type: PrinterType;
  material: string | null;
  build_volume: string | null;
  webcam_url: string | null;
  is_active: true;
}

export class PrinterOnboardingError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(input: {
    code: string;
    message: string;
    status?: number;
    details?: unknown;
  }) {
    super(input.message);
    this.name = "PrinterOnboardingError";
    this.code = input.code;
    this.status = input.status ?? 400;
    this.details = input.details;
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PrinterOnboardingError({
      code: "PRINTER_INVALID_INPUT",
      message: `${field} is required.`,
      details: { field },
    });
  }
  return value.trim();
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizePort(value: unknown): number {
  const port = Number(value ?? 7125);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PrinterOnboardingError({
      code: "PRINTER_INVALID_PORT",
      message: "Port must be an integer from 1 to 65535.",
      details: { port: value },
    });
  }
  return port;
}

function normalizeType(value: unknown): PrinterType {
  if (value === "FGF" || value === "FDM") return value;
  throw new PrinterOnboardingError({
    code: "PRINTER_INVALID_TYPE",
    message: "Printer type must be FGF or FDM.",
    details: { type: value },
  });
}

export function normalizePrinterOnboardingInput(
  input: PrinterOnboardingInput,
): PrinterInsert {
  const ip = requiredText(input.ip, "ip");
  const port = normalizePort(input.port);
  return {
    name: requiredText(input.name, "name"),
    model: requiredText(input.model, "model"),
    ip,
    port,
    driver_type: "moonraker",
    moonraker_host: ip,
    moonraker_port: port,
    prusalink_host: null,
    prusalink_key_file: null,
    type: normalizeType(input.type),
    material: optionalText(input.material),
    build_volume: optionalText(input.build_volume),
    webcam_url: optionalText(input.webcam_url),
    is_active: true,
  };
}

export function normalizePrinterConnectionTestInput(
  input: PrinterOnboardingInput,
): Printer {
  const normalized = normalizePrinterOnboardingInput(input);

  return {
    id: "connection-test",
    ...normalized,
    created_at: new Date(0).toISOString(),
  };
}

export function initialPrinterStatus(printerId: string) {
  return {
    printer_id: printerId,
    online: false,
    status: "offline",
    print_state: null,
    filename: null,
    progress: 0,
    layer_current: null,
    layer_total: null,
    hotend_temp: null,
    hotend_target: null,
    bed_temp: null,
    bed_target: null,
    eta_seconds: null,
    progress_source: "unknown",
    layer_source: "unknown",
    fault_message: null,
    fault_mcu: null,
    updated_at: new Date().toISOString(),
  };
}
