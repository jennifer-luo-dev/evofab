import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_PRINT_SETTINGS,
  filterMaterialProfilesForPrinterType,
  mergePrintSettings,
  normalizePrintSettings,
  profileSupportsPrinterType,
  settingsFromMaterialProfile,
} from "../app/lib/material-profiles";
import type { MaterialProfile } from "../app/types/job";

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
  {
    id: "cool-flex",
    name: "Flexible Polymer",
    printer_type: "BOTH",
    nozzle_temp: 220,
    bed_temp: 50,
    speed: 25,
    flow_rate: 0.95,
    fan_speed: 35,
    notes: null,
    created_at: "2026-07-06T00:00:00.000Z",
  },
];

test("material profiles map direct columns into print settings", () => {
  assert.deepEqual(settingsFromMaterialProfile(profiles[0]), {
    nozzle_temp: 190,
    bed_temp: 60,
    speed: 40,
    flow_rate: 1,
    fan_speed: 0,
  });
});

test("material profiles filter by printer type and BOTH", () => {
  assert.equal(profileSupportsPrinterType(profiles[0], "FGF"), true);
  assert.equal(profileSupportsPrinterType(profiles[1], "FGF"), false);
  assert.deepEqual(
    filterMaterialProfilesForPrinterType(profiles, "FGF").map(
      (profile) => profile.id,
    ),
    ["pla-fgf", "cool-flex"],
  );
});

test("print settings overrides merge on top of selected profile defaults", () => {
  const base = settingsFromMaterialProfile(profiles[2]);
  const overrides = normalizePrintSettings({
    nozzle_temp: "225",
    speed: 31,
    surprise: 99,
  });

  assert.deepEqual(mergePrintSettings(base, overrides), {
    nozzle_temp: 225,
    bed_temp: 50,
    speed: 31,
    flow_rate: 0.95,
    fan_speed: 35,
  });
  assert.deepEqual(mergePrintSettings(EMPTY_PRINT_SETTINGS, {}), {
    nozzle_temp: 0,
    bed_temp: 0,
    speed: 0,
    flow_rate: 0,
    fan_speed: 0,
  });
});
