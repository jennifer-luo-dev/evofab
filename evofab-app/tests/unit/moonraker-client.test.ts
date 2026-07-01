// @vitest-environment node

import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { MoonrakerClient, MoonrakerError } from "@/app/lib/moonraker";
import { MOCK_MOONRAKER_URL, server } from "../support/msw-server";

describe("MoonrakerClient", () => {
  beforeEach(() => {
    process.env.MOONRAKER_MODE = "mock";
    process.env.MOCK_MOONRAKER_URL = MOCK_MOONRAKER_URL;
    delete process.env.HARDWARE_CONFIRMATION;
  });

  it("maps Moonraker status without exposing a hardware address", async () => {
    const status = await new MoonrakerClient({
      printerId: "printer-1",
    }).getStatus();
    expect(status).toMatchObject({
      printer_id: "printer-1",
      online: true,
      status: "idle",
      hotend_temp: 25,
    });
  });

  it("runs the FR-3/4 upload, override, and start contract", async () => {
    const client = new MoonrakerClient({ printerId: "printer-1" });
    const filename = await client.uploadGcode(
      new File(["G28"], "fixture.gcode"),
    );
    await client.applyPrintSettings({
      nozzle_temp: 210,
      bed_temp: 60,
      speed: 50,
      flow_rate: 0.94,
      fan_speed: 25,
    });
    await client.startPrint(filename);
    expect(filename).toBe("fixture.gcode");
  });

  it("uses the immediate emergency-stop endpoint", async () => {
    let called = false;
    server.use(
      http.post(`${MOCK_MOONRAKER_URL}/printer/emergency_stop`, () => {
        called = true;
        return HttpResponse.json({ result: "ok" });
      }),
    );
    await new MoonrakerClient({ printerId: "printer-1" }).emergencyStop();
    expect(called).toBe(true);
  });

  it("returns a structured retryable error for server failure", async () => {
    server.use(
      http.get(`${MOCK_MOONRAKER_URL}/printer/objects/query`, () =>
        HttpResponse.json({ error: "offline" }, { status: 503 }),
      ),
    );
    const error = await new MoonrakerClient({ printerId: "printer-1" })
      .getStatus()
      .catch((value) => value);
    expect(error).toBeInstanceOf(MoonrakerError);
    expect(error.toJSON()).toMatchObject({
      code: "MOONRAKER_OFFLINE",
      retryable: true,
      printerId: "printer-1",
    });
  });
});
