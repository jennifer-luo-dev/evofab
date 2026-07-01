import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeGCode } from "@/app/lib/gcode/analyze";

describe("analyzeGCode", () => {
  it("detects Prusa settings", () => {
    const result = analyzeGCode(
      readFileSync("tests/fixtures/prusa-header.gcode", "utf8"),
    );
    expect(result.slicer).toBe("PrusaSlicer");
    expect(result.settings).toMatchObject({
      nozzle_temp: 210,
      bed_temp: 60,
      speed: 45,
      flow_rate: 0.94,
    });
  });

  it("uses command fallbacks and normalizes percentages", () => {
    const result = analyzeGCode(
      readFileSync("tests/fixtures/cura-fallback.gcode", "utf8"),
    );
    expect(result.settings).toMatchObject({
      nozzle_temp: 205,
      bed_temp: 55,
      flow_rate: 1,
      fan_speed: 50,
    });
  });
});
