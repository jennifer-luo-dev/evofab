// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { MoonrakerClient, MoonrakerError } from "@/app/lib/moonraker";

describe("Moonraker safety modes", () => {
  afterEach(() => {
    process.env.MOONRAKER_MODE = "mock";
    process.env.MOCK_MOONRAKER_URL = "http://127.0.0.1:7125";
    delete process.env.HARDWARE_CONFIRMATION;
  });

  it("defaults to mock mode and rejects non-loopback mock URLs", () => {
    delete process.env.MOONRAKER_MODE;
    process.env.MOCK_MOONRAKER_URL = "http://192.168.1.50:7125";
    expect(() => new MoonrakerClient({ printerId: "printer-1" })).toThrowError(
      MoonrakerError,
    );
  });

  it("disables commands in local mode", () => {
    process.env.MOONRAKER_MODE = "local";
    expect(() => new MoonrakerClient({ printerId: "printer-1" })).toThrow(
      /disabled in local mode/i,
    );
  });

  it("requires confirmation in hardware mode", () => {
    process.env.MOONRAKER_MODE = "hardware";
    expect(
      () =>
        new MoonrakerClient({
          printerId: "printer-1",
          ip: "192.168.1.50",
          port: 80,
        }),
    ).toThrow(/explicit safety confirmation/i);
  });
});
