import {
  getMoonrakerMode,
  homeToolhead,
  runGcodeScript,
} from "@/app/lib/moonraker";
import {
  getMockMoonrakerState,
  mockPrinterKey,
  readMockMoonrakerBedMesh,
  type MockBedMesh,
} from "@/app/lib/mock-moonraker";
import type { PrinterStatusType } from "@/app/types/printer";

export type BedMesh = MockBedMesh;

export interface LevelingPrinter {
  id?: string;
  ip: string;
  port: number;
}

export interface LevelingStatus {
  status: PrinterStatusType | "unknown";
}

export interface LevelingRequest {
  confirmed?: boolean;
  autoHome?: boolean;
}

export interface LevelingResult {
  script: string;
  autoHomed: boolean;
}

export class LevelingError extends Error {
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
    this.name = "LevelingError";
    this.code = input.code;
    this.status = input.status ?? 400;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
  }
}

function levelingMockKey(printer: LevelingPrinter): string {
  return mockPrinterKey({ ip: printer.ip, port: printer.port });
}

function assertIdle(status: LevelingStatus) {
  if (status.status !== "idle") {
    throw new LevelingError({
      code: "LEVELING_REQUIRES_IDLE",
      message: "Bed leveling requires an idle printer.",
      status: 409,
      details: { printer_status: status.status },
    });
  }
}

function isMockHomed(printer: LevelingPrinter): boolean {
  const state = getMockMoonrakerState(levelingMockKey(printer));
  return state.homedAxes.x && state.homedAxes.y && state.homedAxes.z;
}

export async function runBedLeveling(
  printer: LevelingPrinter,
  status: LevelingStatus,
  request: LevelingRequest,
): Promise<LevelingResult> {
  assertIdle(status);

  if (request.confirmed !== true) {
    throw new LevelingError({
      code: "LEVELING_CONFIRMATION_REQUIRED",
      message: "Confirm bed mesh calibration before starting.",
      status: 400,
    });
  }

  let autoHomed = false;
  if (getMoonrakerMode() === "mock" && !isMockHomed(printer)) {
    if (!request.autoHome) {
      throw new LevelingError({
        code: "LEVELING_REQUIRES_HOME",
        message: "Home the printer before bed leveling.",
        status: 409,
      });
    }
    await homeToolhead(printer.ip, printer.port);
    autoHomed = true;
  }

  const script = "BED_MESH_CALIBRATE";
  await runGcodeScript(printer.ip, printer.port, script);
  return { script, autoHomed };
}

export async function readBedMesh(
  printer: LevelingPrinter,
): Promise<BedMesh | null> {
  if (getMoonrakerMode() === "mock") {
    return readMockMoonrakerBedMesh(levelingMockKey(printer));
  }

  throw new LevelingError({
    code: "LEVELING_MESH_UNAVAILABLE",
    message: "Bed mesh object reads are only implemented for mock mode.",
    status: 501,
    retryable: false,
  });
}
