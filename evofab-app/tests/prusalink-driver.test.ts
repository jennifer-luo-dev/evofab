import assert from "node:assert/strict";
import test from "node:test";
import {
  PrusaLinkDriver,
  normalizePrusaLinkStatus,
} from "../app/lib/prusalink-driver";
import type { Printer } from "../app/types/printer";

const printer: Printer = {
  id: "printer-9",
  name: "Printer 9",
  model: "Prusa MINI+",
  ip: "192.168.1.100",
  port: 80,
  type: "FDM",
  material: "PLA",
  build_volume: "180x180x180mm",
  webcam_url: null,
  is_active: true,
  created_at: "2026-07-10T00:00:00.000Z",
  driver_type: "prusalink",
  prusalink_host: "192.168.1.100",
  prusalink_key_file: ".secrets/test.key",
};

test("normalizes PrusaLink status and job telemetry", () => {
  const row = normalizePrusaLinkStatus(
    printer.id,
    {
      printer: { state: "PRINTING" },
      temp: { nozzle: 205, target_nozzle: 210, bed: 60, target_bed: 65 },
    },
    { state: "PRINTING", progress: 42, file: { display_name: "cube.gcode" } },
    new Date(0),
  );
  assert.equal(row.status, "printing");
  assert.equal(row.progress, 42);
  assert.equal(row.filename, "cube.gcode");
  assert.equal(row.hotend_temp, 205);
  assert.equal(row.hotend_target, 210);
  assert.equal(row.bed_temp, 60);
  assert.equal(row.bed_target, 65);
});

test("204 job response is valid idle telemetry", async () => {
  const responses = [
    new Response(
      JSON.stringify({
        printer: { state: "IDLE" },
        temp: { nozzle: 25, bed: 24 },
      }),
    ),
    new Response(null, { status: 204 }),
  ];
  const driver = new PrusaLinkDriver({
    readKey: async () => "fixture-key",
    fetchImpl: async () => responses.shift()!,
  });
  const row = await driver.readStatus(printer);
  assert.equal(row.status, "idle");
  assert.equal(row.online, true);
});

test("auth and server failures become sanitized offline rows", async () => {
  for (const status of [401, 500]) {
    const driver = new PrusaLinkDriver({
      readKey: async () => "fixture-key",
      fetchImpl: async () => new Response("sensitive body", { status }),
    });
    const row = await driver.readStatus(printer);
    assert.equal(row.status, "offline");
    assert.match(row.fault_message ?? "", /^PRUSALINK_/);
    assert.ok(!JSON.stringify(row).includes("sensitive body"));
  }
});

test("missing key configuration becomes offline", async () => {
  const driver = new PrusaLinkDriver();
  const row = await driver.readStatus({ ...printer, prusalink_key_file: null });
  assert.equal(row.fault_message, "PRUSALINK_CONFIG");
});

test("discovers storage, uploads without printing, verifies, and explicitly starts", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [
    new Response(
      JSON.stringify({ storage_list: [{ path: "usb", available: true }] }),
    ),
    new Response(null, { status: 201 }),
    new Response(null, { status: 200 }),
    new Response(null, { status: 204 }),
  ];
  const driver = new PrusaLinkDriver({
    readKey: async () => "fixture-key",
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), init });
      return responses.shift()!;
    },
  });
  const storage = await driver.discoverStorage(printer);
  const file = new File(["G1 X1"], "cube.gcode", { type: "text/plain" });
  assert.equal(
    (await driver.uploadFile(printer, storage, file)).outcome,
    "succeeded",
  );
  assert.equal(
    (await driver.verifyStoredFile(printer, storage, file.name)).outcome,
    "succeeded",
  );
  assert.equal(
    (await driver.startPrint(printer, storage, file.name)).outcome,
    "succeeded",
  );
  assert.equal(requests[1].init?.method, "PUT");
  assert.equal(
    (requests[1].init?.headers as Record<string, string>)["Print-After-Upload"],
    "?0",
  );
  assert.equal(
    (requests[1].init?.headers as Record<string, string>).Overwrite,
    "?0",
  );
  assert.equal(requests[3].init?.method, "POST");
});

test("normalizes conflict, stale job, and non-idempotent timeout outcomes", async () => {
  const conflict = new PrusaLinkDriver({
    readKey: async () => "key",
    fetchImpl: async () => new Response(null, { status: 409 }),
  });
  const file = new File(["x"], "cube.gcode");
  const conflictResult = await conflict.uploadFile(printer, "usb", file);
  assert.equal(conflictResult.code, "PRUSALINK_CONFLICT");
  assert.equal(conflictResult.outcome, "failed");

  const stale = new PrusaLinkDriver({
    readKey: async () => "key",
    fetchImpl: async () => new Response(null, { status: 404 }),
  });
  assert.equal(
    (await stale.pause(printer, "old-id")).code,
    "PRUSALINK_NOT_FOUND",
  );

  const timeout = new PrusaLinkDriver({
    readKey: async () => "key",
    fetchImpl: async () => {
      throw new DOMException("timeout", "TimeoutError");
    },
  });
  const timedOut = await timeout.startPrint(printer, "usb", "cube.gcode");
  assert.equal(timedOut.outcome, "outcome_unknown");
  assert.equal(timedOut.retryable, false);
});
