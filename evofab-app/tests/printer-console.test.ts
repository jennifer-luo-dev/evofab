import assert from "node:assert/strict";
import test from "node:test";
import {
  getMockMoonrakerState,
  mockPrinterKey,
  resetMockMoonrakerState,
} from "../app/lib/mock-moonraker";
import {
  ConsoleError,
  sendConsoleCommand,
} from "../app/lib/printer-console";

const printer = { ip: "127.0.0.1", port: 7125 };

test("console sends allowed G-code to mock and homes on G28", async () => {
  resetMockMoonrakerState();

  const result = await sendConsoleCommand(printer, "G28");
  const state = getMockMoonrakerState(
    mockPrinterKey({ ip: printer.ip, port: printer.port }),
  );

  assert.equal(result.command, "G28");
  assert.equal(state.lastScript, "G28");
  assert.deepEqual(state.homedAxes, { x: true, y: true, z: true });
});

test("console rejects guarded and malformed commands", async () => {
  await assert.rejects(
    () => sendConsoleCommand(printer, "M112"),
    (error) =>
      error instanceof ConsoleError &&
      error.code === "CONSOLE_DENIED_COMMAND",
  );

  await assert.rejects(
    () => sendConsoleCommand(printer, "123 bad"),
    (error) =>
      error instanceof ConsoleError &&
      error.code === "CONSOLE_INVALID_COMMAND",
  );
});
