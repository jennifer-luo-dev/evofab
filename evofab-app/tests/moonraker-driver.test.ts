import assert from "node:assert/strict";
import test from "node:test";
import { MoonrakerDriver } from "../app/lib/moonraker-driver";
import { HARDWARE_CONFIRMATION } from "../app/lib/moonraker-config";
import type { Printer } from "../app/types/printer";

const printer: Printer = {
  id: "printer-fdm",
  name: "FDM Printer",
  model: "Sovol Zero",
  ip: "10.247.137.89",
  port: 7125,
  type: "FDM",
  material: "PLA",
  build_volume: null,
  webcam_url: null,
  is_active: true,
  created_at: "2026-07-13T00:00:00.000Z",
  driver_type: "moonraker",
};

function driver(fetchImpl: typeof fetch) {
  return new MoonrakerDriver({
    fetchImpl,
    env: {
      MOONRAKER_MODE: "hardware",
      HARDWARE_CONFIRMATION,
    } as unknown as NodeJS.ProcessEnv,
  });
}

test("Moonraker upload sends checksum, disables print, and verifies stored path", async () => {
  const seen: Array<{ url: string; init?: RequestInit }> = [];
  const client = driver(async (url, init) => {
    seen.push({ url: String(url), init });
    if (String(url).endsWith("/server/files/upload")) {
      const form = init?.body as FormData;
      assert.equal(form.get("root"), "gcodes");
      assert.equal(form.get("path"), "slice-job.gcode");
      assert.equal(form.get("print"), "false");
      assert.match(String(form.get("checksum")), /^[a-f0-9]{64}$/);
      return new Response(
        JSON.stringify({
          item: { path: "slice-job.gcode" },
          print_started: false,
          print_queued: false,
        }),
        { status: 201 },
      );
    }
    return new Response(
      JSON.stringify({ result: [{ path: "slice-job.gcode" }] }),
      { status: 200 },
    );
  });
  const upload = await client.uploadFile(
    printer,
    new File(["G1 X1"], "slice-job.gcode"),
    "slice-job.gcode",
  );
  assert.deepEqual(upload, {
    outcome: "succeeded",
    status: 201,
    retryable: false,
    path: "slice-job.gcode",
  });
  assert.equal(
    (await client.verifyStoredFile(printer, upload.path!)).outcome,
    "succeeded",
  );
  assert.equal(
    seen.some(({ url }) => url.includes("/printer/print/start")),
    false,
  );
});

test("Moonraker upload reports checksum mismatch and a missing verified path", async () => {
  const mismatch = driver(
    async () =>
      new Response(JSON.stringify({ error: { message: "checksum" } }), {
        status: 422,
      }),
  );
  const upload = await mismatch.uploadFile(
    printer,
    new File(["G1"], "x.gcode"),
    "x.gcode",
  );
  assert.equal(upload.code, "MOONRAKER_CHECKSUM_MISMATCH");
  assert.equal(upload.outcome, "failed");

  const missing = driver(
    async () => new Response(JSON.stringify({ result: [] }), { status: 200 }),
  );
  const verified = await missing.verifyStoredFile(printer, "missing.gcode");
  assert.equal(verified.outcome, "failed");
  assert.equal(verified.code, "MOONRAKER_NOT_FOUND");
});

test("Moonraker upload timeout is outcome_unknown and is not retried", async () => {
  let calls = 0;
  const client = driver(async () => {
    calls += 1;
    throw new DOMException("timed out", "TimeoutError");
  });
  const result = await client.uploadFile(
    printer,
    new File(["G1"], "x.gcode"),
    "x.gcode",
  );
  assert.equal(result.outcome, "outcome_unknown");
  assert.equal(result.code, "MOONRAKER_TIMEOUT");
  assert.equal(calls, 1);
});
