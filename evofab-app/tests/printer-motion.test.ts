import assert from "node:assert/strict";
import test from "node:test";
import {
  getMockMoonrakerState,
  mockPrinterKey,
  resetMockMoonrakerState,
} from "../app/lib/mock-moonraker";
import { HARDWARE_CONFIRMATION } from "../app/lib/moonraker";
import { MotionError, runPrinterMotion } from "../app/lib/printer-motion";

const printer = { id: "printer-1", ip: "127.0.0.1", port: 7125 };
const idleStatus = { status: "idle" as const, hotend_temp: 32 };

test("manual motion homes before jog and updates mock position", async () => {
  resetMockMoonrakerState();
  const printerKey = mockPrinterKey({ ip: printer.ip, port: printer.port });

  await assert.rejects(
    () =>
      runPrinterMotion(printer, idleStatus, {
        action: "jog",
        axis: "x",
        distanceMm: 2,
        feedrateMmMin: 1200,
      }),
    (error) =>
      error instanceof MotionError && error.code === "MOTION_REQUIRES_HOME",
  );

  await runPrinterMotion(printer, idleStatus, { action: "home" });
  await runPrinterMotion(printer, idleStatus, {
    action: "jog",
    axis: "x",
    distanceMm: 2,
    feedrateMmMin: 1200,
  });

  const state = getMockMoonrakerState(printerKey);
  assert.deepEqual(state.homedAxes, { x: true, y: true, z: true });
  assert.equal(state.position.x, 2);
  assert.match(state.lastMotionScript ?? "", /G1 X2 F1200/);
});

test("manual motion blocks jog and extrusion while printing", async () => {
  resetMockMoonrakerState();
  await runPrinterMotion(printer, idleStatus, { action: "home" });

  await assert.rejects(
    () =>
      runPrinterMotion(
        printer,
        { status: "printing", hotend_temp: 210 },
        {
          action: "jog",
          axis: "z",
          distanceMm: 1,
          feedrateMmMin: 600,
        },
      ),
    (error) =>
      error instanceof MotionError && error.code === "MOTION_BLOCKED_PRINTING",
  );
});

test("hardware jog reads Moonraker toolhead homing before motion", async () => {
  const originalMode = process.env.MOONRAKER_MODE;
  const originalConfirmation = process.env.HARDWARE_CONFIRMATION;
  const originalFetch = globalThis.fetch;
  const seenUrls: string[] = [];

  process.env.MOONRAKER_MODE = "hardware";
  process.env.HARDWARE_CONFIRMATION = HARDWARE_CONFIRMATION;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const href = String(url);
    seenUrls.push(href);
    if (href.includes("/printer/objects/query?toolhead")) {
      return new Response(
        JSON.stringify({
          result: {
            status: {
              toolhead: {
                homed_axes: "xy",
                position: [0, 0, 0, 0],
              },
            },
          },
        }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected Moonraker request: ${href}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        runPrinterMotion(printer, idleStatus, {
          action: "jog",
          axis: "z",
          distanceMm: 1,
          feedrateMmMin: 600,
        }),
      (error) =>
        error instanceof MotionError &&
        error.code === "MOTION_REQUIRES_HOME" &&
        JSON.stringify(error.details).includes('"z":false'),
    );
    assert.deepEqual(seenUrls, [
      "http://127.0.0.1:7125/printer/objects/query?toolhead",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalMode === undefined) {
      delete process.env.MOONRAKER_MODE;
    } else {
      process.env.MOONRAKER_MODE = originalMode;
    }
    if (originalConfirmation === undefined) {
      delete process.env.HARDWARE_CONFIRMATION;
    } else {
      process.env.HARDWARE_CONFIRMATION = originalConfirmation;
    }
  }
});

test("manual extrusion enforces cold-extrude guard and allows hot extrusion", async () => {
  resetMockMoonrakerState();

  await assert.rejects(
    () =>
      runPrinterMotion(printer, idleStatus, {
        action: "extrude",
        lengthMm: 5,
        feedrateMmMin: 300,
      }),
    (error) =>
      error instanceof MotionError &&
      error.code === "MOTION_COLD_EXTRUDE_BLOCKED",
  );

  await runPrinterMotion(
    printer,
    { status: "paused", hotend_temp: 180 },
    {
      action: "extrude",
      lengthMm: 5,
      feedrateMmMin: 300,
    },
  );

  const state = getMockMoonrakerState(
    mockPrinterKey({ ip: printer.ip, port: printer.port }),
  );
  assert.equal(state.position.e, 5);
  assert.match(state.lastMotionScript ?? "", /M83\nG1 E5 F300/);
});

test("extruder panel commands send extrusion factor and pressure advance", async () => {
  resetMockMoonrakerState();

  await runPrinterMotion(
    printer,
    { status: "paused", hotend_temp: 180 },
    {
      action: "extrusion_factor",
      factorPercent: 140,
    },
  );
  await runPrinterMotion(
    printer,
    { status: "paused", hotend_temp: 180 },
    {
      action: "pressure_advance",
      pressureAdvance: 0.08,
      smoothTime: 0.03,
    },
  );

  const state = getMockMoonrakerState(
    mockPrinterKey({ ip: printer.ip, port: printer.port }),
  );
  assert.equal(state.flowFactor, 140);
  assert.equal(state.pressureAdvance, 0.08);
  assert.equal(state.pressureAdvanceSmoothTime, 0.03);
  assert.match(
    state.lastScript ?? "",
    /SET_PRESSURE_ADVANCE ADVANCE=0.08 SMOOTH_TIME=0.03/,
  );
});

test("manual Z offset clamps per step and cumulative range", async () => {
  resetMockMoonrakerState();

  const first = await runPrinterMotion(printer, idleStatus, {
    action: "babystep",
    deltaMm: 0.5,
  });
  assert.match(first.script, /Z_ADJUST=0.05/);
  assert.equal(
    getMockMoonrakerState(
      mockPrinterKey({ ip: printer.ip, port: printer.port }),
    ).zOffset,
    0.05,
  );

  for (let i = 0; i < 19; i += 1) {
    await runPrinterMotion(printer, idleStatus, {
      action: "z_offset",
      deltaMm: 0.05,
    });
  }

  await assert.rejects(
    () =>
      runPrinterMotion(printer, idleStatus, {
        action: "z_offset",
        deltaMm: 0.05,
      }),
    (error) =>
      error instanceof MotionError && error.code === "MOTION_OFFSET_LIMIT",
  );
});
