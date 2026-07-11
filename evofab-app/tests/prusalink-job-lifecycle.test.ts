import assert from "node:assert/strict";
import test from "node:test";
import { prusaLifecyclePatch } from "../app/lib/prusalink-job-lifecycle";
import type { PrinterStatus } from "../app/types/printer";

function status(
  print_state: string | null,
  state: PrinterStatus["status"] = "idle",
): PrinterStatus {
  return {
    printer_id: "p9",
    online: true,
    status: state,
    print_state,
    filename: "cube.gcode",
    progress: 42,
    layer_current: null,
    layer_total: null,
    hotend_temp: 20,
    hotend_target: 0,
    bed_temp: 20,
    bed_target: 0,
    eta_seconds: null,
    updated_at: new Date(0).toISOString(),
  };
}

test("reconciles natural completion, cancel, error, and ambiguous 204", () => {
  const job = {
    status: "printing",
    command_outcome: "pending",
    last_command: "start",
  };
  assert.equal(
    prusaLifecyclePatch(status("FINISHED"), job, new Date(0))?.status,
    "complete",
  );
  assert.equal(
    prusaLifecyclePatch(
      status("STOPPED"),
      { ...job, last_command: "cancel" },
      new Date(0),
    )?.status,
    "aborted",
  );
  assert.equal(
    prusaLifecyclePatch(status("ERROR", "error"), job, new Date(0))?.status,
    "failed",
  );
  assert.equal(
    prusaLifecyclePatch(status("IDLE"), job)?.command_outcome,
    "outcome_unknown",
  );
});

test("reboot-style idle after an unresolved cancel reconciles as cancelled", () => {
  const patch = prusaLifecyclePatch(status("IDLE"), {
    status: "printing",
    command_outcome: "pending",
    last_command: "cancel",
  });
  assert.equal(patch?.status, "aborted");
});
