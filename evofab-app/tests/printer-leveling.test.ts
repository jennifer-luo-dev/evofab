import assert from "node:assert/strict";
import test from "node:test";
import {
  getMockMoonrakerState,
  mockPrinterKey,
  resetMockMoonrakerState,
} from "../app/lib/mock-moonraker";
import {
  LevelingError,
  readBedMesh,
  runBedLeveling,
} from "../app/lib/printer-leveling";

const printer = { id: "printer-1", ip: "127.0.0.1", port: 7125 };
const idleStatus = { status: "idle" as const };

test("bed leveling requires idle, confirmation, and homed axes", async () => {
  resetMockMoonrakerState();

  await assert.rejects(
    () =>
      runBedLeveling(
        printer,
        { status: "printing" },
        { confirmed: true, autoHome: true },
      ),
    (error) =>
      error instanceof LevelingError &&
      error.code === "LEVELING_REQUIRES_IDLE",
  );

  await assert.rejects(
    () => runBedLeveling(printer, idleStatus, { confirmed: false }),
    (error) =>
      error instanceof LevelingError &&
      error.code === "LEVELING_CONFIRMATION_REQUIRED",
  );

  await assert.rejects(
    () => runBedLeveling(printer, idleStatus, { confirmed: true }),
    (error) =>
      error instanceof LevelingError &&
      error.code === "LEVELING_REQUIRES_HOME",
  );
});

test("bed leveling can auto-home and returns deterministic mock mesh", async () => {
  resetMockMoonrakerState();

  const result = await runBedLeveling(printer, idleStatus, {
    confirmed: true,
    autoHome: true,
  });
  const state = getMockMoonrakerState(
    mockPrinterKey({ ip: printer.ip, port: printer.port }),
  );
  const mesh = await readBedMesh(printer);

  assert.equal(result.script, "BED_MESH_CALIBRATE");
  assert.equal(result.autoHomed, true);
  assert.deepEqual(state.homedAxes, { x: true, y: true, z: true });
  assert.deepEqual(mesh?.matrix, [
    [-0.04, -0.01, 0.02],
    [-0.02, 0, 0.03],
    [0.01, 0.04, 0.06],
  ]);
});
