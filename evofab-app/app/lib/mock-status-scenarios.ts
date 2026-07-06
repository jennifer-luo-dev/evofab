// File purpose: Generates deterministic mock printer telemetry scenarios.

import { normalizeMoonrakerStatus } from "@/app/lib/moonraker-client";
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
      };
      print_stats?: {
        state?: string;
        filename?: string;
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
