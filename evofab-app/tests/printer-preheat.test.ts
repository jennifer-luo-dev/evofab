import assert from "node:assert/strict";
import test from "node:test";
import {
  getMockMoonrakerState,
  mockPrinterKey,
  resetMockMoonrakerState,
} from "../app/lib/mock-moonraker";
import {
  PreheatError,
  listPreheatPresets,
  runPreheatPreset,
} from "../app/lib/printer-preheat";
import type { MaterialProfile } from "../app/types/job";

const printer = { ip: "127.0.0.1", port: 7125, type: "FGF" as const };
const profiles: MaterialProfile[] = [
  {
    id: "pla-fgf",
    name: "PLA FGF",
    printer_type: "FGF",
    nozzle_temp: 190,
    bed_temp: 60,
    speed: 40,
    flow_rate: 1,
    fan_speed: 0,
    notes: null,
    created_at: "2026-07-06T00:00:00.000Z",
  },
  {
    id: "pla-fdm",
    name: "PLA FDM",
    printer_type: "FDM",
    nozzle_temp: 205,
    bed_temp: 60,
    speed: 55,
    flow_rate: 1,
    fan_speed: 80,
    notes: null,
    created_at: "2026-07-06T00:00:00.000Z",
  },
];

test("preheat presets derive from compatible material profiles plus cooldown", () => {
  const presets = listPreheatPresets(profiles, "FGF", { status: "idle" });

  assert.deepEqual(
    presets.map((preset) => preset.id),
    ["profile:pla-fgf", "cooldown"],
  );
  assert.equal(presets[0].nozzle_temp, 190);
  assert.equal(presets[0].bed_temp, 60);
  assert.equal(presets[1].nozzle_temp, 0);
  assert.equal(presets[1].bed_temp, 0);
});

test("preheat preset drives mock heater targets", async () => {
  resetMockMoonrakerState();

  await runPreheatPreset(
    printer,
    { status: "idle" },
    profiles,
    "profile:pla-fgf",
  );

  const state = getMockMoonrakerState(mockPrinterKey(printer));
  assert.equal(state.hotendTarget, 190);
  assert.equal(state.bedTarget, 60);
  assert.equal(state.lastScript, "M104 S190\nM140 S60");
});

test("cooldown zeroes mock heater targets", async () => {
  resetMockMoonrakerState();

  await runPreheatPreset(
    printer,
    { status: "idle" },
    profiles,
    "profile:pla-fgf",
  );
  await runPreheatPreset(printer, { status: "paused" }, profiles, "cooldown");

  const state = getMockMoonrakerState(mockPrinterKey(printer));
  assert.equal(state.hotendTarget, 0);
  assert.equal(state.bedTarget, 0);
});

test("preheat presets are unavailable while printing", async () => {
  const presets = listPreheatPresets(profiles, "FGF", { status: "printing" });
  assert.equal(presets[0].enabled, false);
  assert.equal(presets[0].reason, "Unavailable while printing.");

  await assert.rejects(
    () =>
      runPreheatPreset(
        printer,
        { status: "printing" },
        profiles,
        "profile:pla-fgf",
      ),
    (error) =>
      error instanceof PreheatError && error.code === "PREHEAT_UNAVAILABLE",
  );
});
