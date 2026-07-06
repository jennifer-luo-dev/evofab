import assert from "node:assert/strict";
import test from "node:test";
import {
  getMockMoonrakerState,
  mockPrinterKey,
  resetMockMoonrakerState,
} from "../app/lib/mock-moonraker";
import {
  listCuratedMacros,
  MacroError,
  runCuratedMacro,
} from "../app/lib/printer-macros";

const printer = { ip: "127.0.0.1", port: 7125 };

test("curated macros expose availability and disabled reasons", () => {
  const printing = listCuratedMacros({ status: "printing" });
  const idle = listCuratedMacros({ status: "idle" });
  const paused = listCuratedMacros({ status: "paused" });

  assert.equal(idle.find((macro) => macro.id === "start_print")?.enabled, true);
  assert.equal(
    paused.find((macro) => macro.id === "start_print")?.enabled,
    false,
  );
  assert.equal(paused.find((macro) => macro.id === "purge")?.enabled, true);
  assert.equal(
    printing.find((macro) => macro.id === "tool_dock")?.reason,
    "Unavailable while printing.",
  );
});

test("curated macro invocation sends mapped G-code to mock Moonraker", async () => {
  resetMockMoonrakerState();

  const macro = await runCuratedMacro(printer, { status: "idle" }, "purge");
  const state = getMockMoonrakerState(mockPrinterKey(printer));

  assert.equal(macro.script, "PURGE");
  assert.equal(state.lastScript, "PURGE");
});

test("curated macro invocation blocks unavailable macro", async () => {
  await assert.rejects(
    () => runCuratedMacro(printer, { status: "printing" }, "purge"),
    (error) =>
      error instanceof MacroError && error.code === "MACRO_UNAVAILABLE",
  );
});
