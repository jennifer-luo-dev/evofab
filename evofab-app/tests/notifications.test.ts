import assert from "node:assert/strict";
import test from "node:test";
import {
  notificationForJob,
  notificationForPrinterStatus,
} from "../app/lib/notifications";
import type { Job } from "../app/types/job";
import type { PrinterStatus } from "../app/types/printer";

const baseJob: Job = {
  id: "job-1",
  printer_id: "printer-1",
  experiment_id: null,
  material_profile_id: null,
  filename: "part.gcode",
  file_key: "part.gcode",
  print_settings: {
    nozzle_temp: 200,
    bed_temp: 60,
    speed: 40,
    flow_rate: 1,
    fan_speed: 0,
  },
  experiment_params: {},
  status: "printing",
  pipeline_step: "printing",
  print_progress: 0,
  layer_current: null,
  layer_total: null,
  created_at: "2026-07-07T00:00:00.000Z",
  started_at: "2026-07-07T00:00:00.000Z",
  completed_at: null,
};

const baseStatus: PrinterStatus = {
  printer_id: "printer-1",
  online: true,
  status: "idle",
  print_state: "standby",
  filename: null,
  progress: 0,
  layer_current: null,
  layer_total: null,
  hotend_temp: 30,
  hotend_target: 0,
  bed_temp: 26,
  bed_target: 0,
  eta_seconds: null,
  progress_source: "unknown",
  layer_source: "unknown",
  fault_message: null,
  fault_mcu: null,
  updated_at: "2026-07-07T00:00:00.000Z",
};

test("job notifications cover completion and failure", () => {
  assert.equal(
    notificationForJob({
      ...baseJob,
      status: "complete",
      completed_at: "2026-07-07T00:10:00.000Z",
    })?.title,
    "Print complete",
  );
  assert.equal(
    notificationForJob({ ...baseJob, status: "failed" })?.tone,
    "error",
  );
  assert.equal(notificationForJob(baseJob), null);
});

test("printer notifications cover fault and offline", () => {
  assert.equal(
    notificationForPrinterStatus({
      ...baseStatus,
      status: "error",
      fault_message: "MCU shutdown",
    })?.body,
    "MCU shutdown",
  );
  assert.equal(
    notificationForPrinterStatus({ ...baseStatus, status: "offline" })?.title,
    "Printer offline",
  );
  assert.equal(notificationForPrinterStatus(baseStatus), null);
});
