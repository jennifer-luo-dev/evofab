// @vitest-environment node

import { describe, expect, it } from "vitest";
import { MoonrakerClient } from "@/app/lib/moonraker";

describe("supervised hardware connectivity", () => {
  it("reads status from the explicitly configured printer", async () => {
    const printerId = process.env.HARDWARE_PRINTER_ID;
    const ip = process.env.HARDWARE_PRINTER_IP;
    const port = Number(process.env.HARDWARE_PRINTER_PORT ?? 80);
    if (!printerId || !ip) {
      throw new Error(
        "Set HARDWARE_PRINTER_ID and HARDWARE_PRINTER_IP for the supervised test.",
      );
    }

    const status = await new MoonrakerClient({
      printerId,
      ip,
      port,
    }).getStatus();
    expect(status.online).toBe(true);
    expect(status.printer_id).toBe(printerId);
  });
});
