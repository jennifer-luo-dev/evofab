import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMockMoonrakerScript,
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
