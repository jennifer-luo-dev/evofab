import assert from "node:assert/strict";
import test from "node:test";
import {
  getMockMoonrakerState,
  mockPrinterKey,
  resetMockMoonrakerState,
} from "../app/lib/mock-moonraker";
import {
  PrintOverrideError,
  overrideUnavailableReason,
  runPrintOverride,
} from "../app/lib/printer-overrides";

const printer = { ip: "127.0.0.1", port: 7125 };

test("runtime overrides reach mock Moonraker with requested values", async () => {
  resetMockMoonrakerState();
  const printerKey = mockPrinterKey(printer);

  await runPrintOverride(
    printer,
    { status: "printing" },
    {
      action: "speed_factor",
      value: 125,
    },
  );
  assert.equal(getMockMoonrakerState(printerKey).speedFactor, 125);
  assert.equal(getMockMoonrakerState(printerKey).lastScript, "M220 S125");

  await runPrintOverride(
    printer,
    { status: "printing" },
    {
      action: "flow_factor",
      value: 92,
    },
  );
  assert.equal(getMockMoonrakerState(printerKey).flowFactor, 92);

  await runPrintOverride(
    printer,
    { status: "printing" },
    {
      action: "fan_speed",
      value: 50,
    },
  );
  assert.equal(getMockMoonrakerState(printerKey).fanSpeed, 50);

  await runPrintOverride(
    printer,
    { status: "printing" },
    {
      action: "nozzle_target",
      value: 215,
    },
  );
  await runPrintOverride(
    printer,
    { status: "printing" },
    {
      action: "bed_target",
      value: 65,
    },
  );
  assert.equal(getMockMoonrakerState(printerKey).hotendTarget, 215);
  assert.equal(getMockMoonrakerState(printerKey).bedTarget, 65);
});

test("runtime babystep reuses per-step and cumulative clamp", async () => {
  resetMockMoonrakerState();
  const printerKey = mockPrinterKey(printer);

  const first = await runPrintOverride(
    printer,
    { status: "printing" },
    {
      action: "babystep_z",
      value: 0.5,
    },
  );
  assert.equal(first.value, 0.05);
  assert.equal(getMockMoonrakerState(printerKey).zOffset, 0.05);

  for (let i = 0; i < 19; i += 1) {
    await runPrintOverride(
      printer,
      { status: "paused" },
      {
        action: "babystep_z",
        value: 0.05,
      },
    );
  }

  await assert.rejects(
    () =>
      runPrintOverride(
        printer,
        { status: "printing" },
        {
          action: "babystep_z",
          value: 0.05,
        },
      ),
    (error) =>
      error instanceof PrintOverrideError &&
      error.code === "PRINT_OVERRIDE_OFFSET_LIMIT",
  );
});

test("runtime overrides are unavailable without an active print", async () => {
  assert.equal(
    overrideUnavailableReason({ status: "idle" }),
    "No active print.",
  );

  await assert.rejects(
    () =>
      runPrintOverride(
        printer,
        { status: "idle" },
        {
          action: "speed_factor",
          value: 100,
        },
      ),
    (error) =>
      error instanceof PrintOverrideError &&
      error.code === "PRINT_OVERRIDE_UNAVAILABLE",
  );
});
