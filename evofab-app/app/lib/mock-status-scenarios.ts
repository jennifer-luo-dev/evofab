// File purpose: Generates deterministic mock printer telemetry scenarios.

import { normalizeMoonrakerStatus } from "@/app/lib/moonraker-client";
import {
  getMockMoonrakerState,
  mockPrinterKey,
  tickMockMoonrakerPrint,
} from "@/app/lib/mock-moonraker";
import { createOfflinePrinterStatus } from "@/app/lib/printer-status-source";
import type { Printer, PrinterStatus } from "@/app/types/printer";

export type MockScenarioKind = "idle" | "printing" | "offline" | "error";

export interface MockStatusScenario {
  kind: MockScenarioKind;
  status: PrinterStatus;
}

interface MockMoonrakerStatusResponse {
  result?: {
    status?: {
      webhooks?: {
        state?: string;
        state_message?: string;
      };
      print_stats?: {
        state?: string;
        filename?: string;
        message?: string;
        print_duration?: number;
        info?: {
          current_layer?: number | null;
          total_layer?: number | null;
        };
      };
      virtual_sdcard?: {
        progress?: number;
      };
      extruder?: {
        temperature?: number;
        target?: number;
      };
      heater_bed?: {
        temperature?: number;
        target?: number;
      };
    };
  };
}

function moonrakerPayloadForMockState(input: {
  printer: Printer;
  tick: number;
}): MockMoonrakerStatusResponse | null {
  const printerKey = mockPrinterKey(input.printer);
  const state = tickMockMoonrakerPrint(printerKey, input.tick);

  if (
    state.files.size === 0 &&
    state.state === "standby" &&
    !state.faultMessage
  ) {
    return null;
  }

  const isFaulted = state.state === "error";
  const info =
    state.layerInfoExact &&
    state.currentLayer !== null &&
    state.totalLayer !== null
      ? {
          current_layer: state.currentLayer,
          total_layer: state.totalLayer,
        }
      : state.totalLayer !== null
        ? {
            current_layer: null,
            total_layer: state.totalLayer,
          }
        : undefined;

  return {
    result: {
      status: {
        webhooks: {
          state: isFaulted ? "shutdown" : "ready",
          state_message: state.faultMessage ?? undefined,
        },
        print_stats: {
          state: state.state,
          filename: state.filename ?? undefined,
          message: state.faultMessage ?? undefined,
          print_duration: Math.max(1, input.tick * 2),
          info,
        },
        virtual_sdcard: {
          progress: state.progress / 100,
        },
        extruder: {
          temperature: state.hotendTemp,
          target: state.hotendTarget,
        },
        heater_bed: {
          temperature: state.bedTemp,
          target: state.bedTarget,
        },
      },
    },
  };
}

const SCENARIO_ORDER: MockScenarioKind[] = [
  "printing",
  "idle",
  "error",
  "offline",
  "printing",
  "idle",
];

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function scenarioIndexForPrinter(
  printerId: string,
  seed: string,
): number {
  return hashSeed(`${seed}:${printerId}`) % SCENARIO_ORDER.length;
}

function moonrakerPayloadForScenario(input: {
  kind: Exclude<MockScenarioKind, "offline">;
  printer: Printer;
  tick: number;
  offset: number;
}): MockMoonrakerStatusResponse {
  const printProgress = ((input.tick * 9 + input.offset * 13) % 100) / 100;
  const currentLayer = Math.max(1, Math.floor(printProgress * 48));
  const isPrinting = input.kind === "printing";
  const isError = input.kind === "error";

  return {
    result: {
      status: {
        webhooks: {
          state: isError ? "shutdown" : "ready",
        },
        print_stats: {
          state: isError ? "error" : isPrinting ? "printing" : "standby",
          filename: isPrinting
            ? `${input.printer.name.toLowerCase().replaceAll(" ", "-")}.gcode`
            : undefined,
          info: isPrinting
            ? {
                current_layer: currentLayer,
                total_layer: 48,
              }
            : undefined,
        },
        virtual_sdcard: {
          progress: isPrinting ? printProgress : 0,
        },
        extruder: {
          temperature: round(
            isPrinting ? 204 + Math.sin(input.tick + input.offset) * 2 : 32,
          ),
          target: isPrinting ? 210 : 0,
        },
        heater_bed: {
          temperature: round(
            isPrinting ? 59 + Math.cos(input.tick + input.offset) : 26,
          ),
          target: isPrinting ? 60 : 0,
        },
      },
    },
  };
}

export function buildMockPrinterStatus(input: {
  printer: Printer;
  tick: number;
  seed?: string;
  now?: Date;
}): MockStatusScenario {
  const seed = input.seed ?? "evofab-mock-status";
  const offset = scenarioIndexForPrinter(input.printer.id, seed);
  const kind = SCENARIO_ORDER[(input.tick + offset) % SCENARIO_ORDER.length];
  const now = input.now ?? new Date();
  const mockStatePayload = moonrakerPayloadForMockState({
    printer: input.printer,
    tick: input.tick,
  });

  if (mockStatePayload) {
    const state = getMockMoonrakerState(mockPrinterKey(input.printer));
    return {
      kind:
        state.state === "error"
          ? "error"
          : state.state === "printing"
            ? "printing"
            : "idle",
      status: normalizeMoonrakerStatus(input.printer.id, mockStatePayload, now),
    };
  }

  if (kind === "offline") {
    return {
      kind,
      status: {
        ...createOfflinePrinterStatus(input.printer.id),
        updated_at: now.toISOString(),
      },
    };
  }

  return {
    kind,
    status: normalizeMoonrakerStatus(
      input.printer.id,
      moonrakerPayloadForScenario({
        kind,
        printer: input.printer,
        tick: input.tick,
        offset,
      }),
      now,
    ),
  };
}
