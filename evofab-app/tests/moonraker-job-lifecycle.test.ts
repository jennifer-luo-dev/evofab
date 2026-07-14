import assert from "node:assert/strict";
import test from "node:test";
import { moonrakerLifecyclePatch } from "../app/lib/moonraker-job-lifecycle";
import type { PrinterStatus } from "../app/types/printer";

function status(value: PrinterStatus["status"]): PrinterStatus {
  return {
    printer_id: "fdm",
    online: true,
    status: value,
    print_state: value,
    filename: "evofab/cube.gcode",
    progress: 45,
    layer_current: 12,
    layer_total: 30,
    hotend_temp: null,
    hotend_target: null,
    bed_temp: null,
    bed_target: null,
    eta_seconds: null,
    progress_source: "exact",
    layer_source: "exact",
    fault_message: null,
    fault_mcu: null,
    updated_at: "2026-07-14T00:00:00.000Z",
  };
}

test("Moonraker lifecycle reconciles printing and natural completion", () => {
  const now = new Date("2026-07-14T00:00:00.000Z");
  assert.deepEqual(
    moonrakerLifecyclePatch(status("printing"), { status: "queued" }, now),
    {
      status: "printing",
      pipeline_step: "printing",
      command_outcome: "succeeded",
      started_at: now.toISOString(),
      print_progress: 45,
      layer_current: 12,
      layer_total: 30,
    },
  );
  assert.equal(
    moonrakerLifecyclePatch(
      status("idle"),
      { status: "printing", last_command: "start" },
      now,
    )?.status,
    "complete",
  );
});
