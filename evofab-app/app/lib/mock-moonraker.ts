// File purpose: Stateful in-process Moonraker simulator for mock-mode tests and local demos.

import type { Printer } from "@/app/types/printer";

export type MockPrintState =
  | "standby"
  | "printing"
  | "paused"
  | "complete"
  | "cancelled"
  | "error";

export interface MockMoonrakerPrinterState {
  printerKey: string;
  files: Map<string, string>;
  filename: string | null;
  state: MockPrintState;
  progress: number;
  currentLayer: number | null;
  totalLayer: number | null;
  layerInfoExact: boolean;
  hotendTarget: number;
  bedTarget: number;
  hotendTemp: number;
  bedTemp: number;
  lastScript: string | null;
  emergencyStopped: boolean;
  faultMessage: string | null;
  faultMcu: string | null;
  startedAtTick: number | null;
  updatedAtTick: number;
}

interface MockMoonrakerUploadInput {
  printerKey: string;
  filename: string;
  contents: string;
}

const DEFAULT_TOTAL_LAYERS = 48;
const MOCK_STATES = new Map<string, MockMoonrakerPrinterState>();

function createState(printerKey: string): MockMoonrakerPrinterState {
  return {
    printerKey,
    files: new Map(),
    filename: null,
    state: "standby",
    progress: 0,
    currentLayer: null,
    totalLayer: null,
    layerInfoExact: true,
    hotendTarget: 0,
    bedTarget: 0,
    hotendTemp: 32,
    bedTemp: 26,
    lastScript: null,
    emergencyStopped: false,
    faultMessage: null,
    faultMcu: null,
    startedAtTick: null,
    updatedAtTick: 0,
  };
}

function stateFor(printerKey: string): MockMoonrakerPrinterState {
  const existing = MOCK_STATES.get(printerKey);
  if (existing) return existing;

  const next = createState(printerKey);
  MOCK_STATES.set(printerKey, next);
  return next;
}

function parseTarget(script: string, code: "M104" | "M140"): number | null {
  const match = script.match(new RegExp(`\\b${code}\\s+S([0-9.]+)`, "i"));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseTotalLayers(gcode: string): number | null {
  const statsMatch = gcode.match(/SET_PRINT_STATS_INFO\b[^\n]*\bTOTAL_LAYER=(\d+)/i);
  if (statsMatch) return Number(statsMatch[1]);

  const layerComments = [...gcode.matchAll(/^;\s*LAYER[:_]\s*(\d+)/gim)].map((match) =>
    Number(match[1]),
  );
  if (layerComments.length === 0) return null;
  return Math.max(...layerComments) + 1;
}

export function mockPrinterKey(input: Pick<Printer, "id" | "ip" | "port"> | {
  id?: string;
  ip?: string;
  port?: number;
}): string {
  return input.id ?? `${input.ip ?? "127.0.0.1"}:${input.port ?? 7125}`;
}

export function resetMockMoonrakerState(): void {
  MOCK_STATES.clear();
}

export function getMockMoonrakerState(printerKey: string): MockMoonrakerPrinterState {
  return stateFor(printerKey);
}

export function listMockMoonrakerFiles(printerKey: string): string[] {
  return [...stateFor(printerKey).files.keys()].sort();
}

export async function uploadMockMoonrakerFile(
  input: MockMoonrakerUploadInput,
): Promise<string> {
  const state = stateFor(input.printerKey);
  state.files.set(input.filename, input.contents);
  return input.filename;
}

export async function applyMockMoonrakerScript(
  printerKey: string,
  script: string,
): Promise<void> {
  const state = stateFor(printerKey);
  state.lastScript = script;

  const hotendTarget = parseTarget(script, "M104");
  const bedTarget = parseTarget(script, "M140");
  if (hotendTarget !== null) state.hotendTarget = hotendTarget;
  if (bedTarget !== null) state.bedTarget = bedTarget;
}

export async function startMockMoonrakerPrint(
  printerKey: string,
  filename: string,
): Promise<void> {
  const state = stateFor(printerKey);
  const gcode = state.files.get(filename);
  if (!gcode) {
    throw new Error(`Mock Moonraker file not found: ${filename}`);
  }

  state.filename = filename;
  state.state = "printing";
  state.progress = 0;
  state.currentLayer = 1;
  state.totalLayer = parseTotalLayers(gcode) ?? DEFAULT_TOTAL_LAYERS;
  state.layerInfoExact = /SET_PRINT_STATS_INFO\b/i.test(gcode);
  state.emergencyStopped = false;
  state.faultMessage = null;
  state.faultMcu = null;
  state.startedAtTick = 0;
  state.updatedAtTick = 0;
}

export function tickMockMoonrakerPrint(
  printerKey: string,
  tick: number,
): MockMoonrakerPrinterState {
  const state = stateFor(printerKey);
  state.updatedAtTick = tick;

  if (state.state !== "printing") return state;

  state.progress = Math.min(100, Math.max(state.progress, tick * 12.5));
  const totalLayer = state.totalLayer ?? DEFAULT_TOTAL_LAYERS;
  state.currentLayer = Math.min(
    totalLayer,
    Math.max(1, Math.ceil((state.progress / 100) * totalLayer)),
  );
  state.hotendTemp =
    state.hotendTarget > 0 ? Math.min(state.hotendTarget, state.hotendTemp + 24) : 32;
  state.bedTemp = state.bedTarget > 0 ? Math.min(state.bedTarget, state.bedTemp + 8) : 26;

  if (state.progress >= 100) {
    state.progress = 100;
    state.state = "complete";
    state.hotendTarget = 0;
    state.bedTarget = 0;
  }

  return state;
}

export async function controlMockMoonrakerPrint(
  printerKey: string,
  action:
    | "pause"
    | "resume"
    | "cancel"
    | "emergency_stop"
    | "restart"
    | "firmware_restart",
): Promise<void> {
  const state = stateFor(printerKey);

  if (action === "pause" && state.state === "printing") {
    state.state = "paused";
    return;
  }

  if (action === "resume" && state.state === "paused") {
    state.state = "printing";
    return;
  }

  if (action === "cancel") {
    state.state = "cancelled";
    state.progress = 0;
    state.currentLayer = null;
    state.totalLayer = null;
    state.hotendTarget = 0;
    state.bedTarget = 0;
    return;
  }

  if (action === "emergency_stop") {
    state.state = "error";
    state.emergencyStopped = true;
    state.hotendTarget = 0;
    state.bedTarget = 0;
    state.faultMessage = "Emergency stop triggered by EvoFab software e-stop.";
    state.faultMcu = "host";
    return;
  }

  if (action === "restart" || action === "firmware_restart") {
    state.state = "standby";
    state.emergencyStopped = false;
    state.faultMessage = null;
    state.faultMcu = null;
    state.progress = 0;
    state.currentLayer = null;
    state.totalLayer = null;
  }
}

export function injectMockMoonrakerFault(
  printerKey: string,
  message = "MCU 'mcu' shutdown: Timer too close",
  mcu = "mcu",
): void {
  const state = stateFor(printerKey);
  state.state = "error";
  state.faultMessage = message;
  state.faultMcu = mcu;
  state.hotendTarget = 0;
  state.bedTarget = 0;
}
