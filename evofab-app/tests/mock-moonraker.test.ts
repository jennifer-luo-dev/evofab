import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMockMoonrakerScript,
  controlMockMoonrakerPrint,
  getMockMoonrakerState,
  listMockMoonrakerFiles,
  mockPrinterKey,
  resetMockMoonrakerState,
  startMockMoonrakerPrint,
  tickMockMoonrakerPrint,
  uploadMockMoonrakerFile,
} from "../app/lib/mock-moonraker";

test("mock Moonraker uploads, lists, applies overrides, and starts printing", async () => {
  resetMockMoonrakerState();
  const printerKey = mockPrinterKey({ ip: "127.0.0.1", port: 7125 });

  const filename = await uploadMockMoonrakerFile({
    printerKey,
    filename: "override-test.gcode",
    contents: [
      "START_PRINT BED_TEMPERATURE=60 EXTRUDER_TEMPERATURE=190",
      "SET_PRINT_STATS_INFO TOTAL_LAYER=9",
      "G1 X1 Y1 E1",
    ].join("\n"),
  });
  await applyMockMoonrakerScript(printerKey, "M104 S215\nM140 S67");
  await startMockMoonrakerPrint(printerKey, filename);
  tickMockMoonrakerPrint(printerKey, 2);

  const state = getMockMoonrakerState(printerKey);
  assert.deepEqual(listMockMoonrakerFiles(printerKey), ["override-test.gcode"]);
  assert.equal(state.state, "printing");
  assert.equal(state.hotendTarget, 215);
  assert.equal(state.bedTarget, 67);
  assert.equal(state.totalLayer, 9);
  assert.ok(state.progress > 0);
});

test("mock Moonraker handles pause, resume, cancel, e-stop, and recovery", async () => {
  resetMockMoonrakerState();
  const printerKey = mockPrinterKey({ ip: "127.0.0.1", port: 7125 });

  await uploadMockMoonrakerFile({
    printerKey,
    filename: "control-test.gcode",
    contents: "SET_PRINT_STATS_INFO TOTAL_LAYER=4\nG1 X1 Y1 E1",
  });
  await startMockMoonrakerPrint(printerKey, "control-test.gcode");
  tickMockMoonrakerPrint(printerKey, 2);
  const progressBeforePause = getMockMoonrakerState(printerKey).progress;

  await controlMockMoonrakerPrint(printerKey, "pause");
  tickMockMoonrakerPrint(printerKey, 5);
  assert.equal(getMockMoonrakerState(printerKey).state, "paused");
  assert.equal(getMockMoonrakerState(printerKey).progress, progressBeforePause);

  await controlMockMoonrakerPrint(printerKey, "resume");
  tickMockMoonrakerPrint(printerKey, 5);
  assert.equal(getMockMoonrakerState(printerKey).state, "printing");
  assert.ok(getMockMoonrakerState(printerKey).progress > progressBeforePause);

  await controlMockMoonrakerPrint(printerKey, "emergency_stop");
  assert.equal(getMockMoonrakerState(printerKey).state, "error");
  assert.equal(getMockMoonrakerState(printerKey).emergencyStopped, true);

  await controlMockMoonrakerPrint(printerKey, "firmware_restart");
  assert.equal(getMockMoonrakerState(printerKey).state, "standby");
  assert.equal(getMockMoonrakerState(printerKey).faultMessage, null);

  await startMockMoonrakerPrint(printerKey, "control-test.gcode");
  await controlMockMoonrakerPrint(printerKey, "cancel");
  assert.equal(getMockMoonrakerState(printerKey).state, "cancelled");
  assert.equal(getMockMoonrakerState(printerKey).progress, 0);
});
