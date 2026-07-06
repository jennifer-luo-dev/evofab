import assert from "node:assert/strict";
import test from "node:test";
import {
  appendTemperaturePoint,
  decimateTemperatureSeries,
  temperaturePointFromStatus,
  type TemperaturePoint,
} from "../app/lib/temperature-series";
import type { PrinterStatus } from "../app/types/printer";

function status(input: Partial<PrinterStatus>): PrinterStatus {
  return {
    printer_id: "printer-1",
    online: true,
    status: "printing",
    print_state: "printing",
    filename: "part.gcode",
    progress: 10,
    layer_current: 1,
    layer_total: 10,
    hotend_temp: 190,
    hotend_target: 210,
    bed_temp: 55,
    bed_target: 60,
    eta_seconds: null,
    updated_at: "2026-07-06T12:00:00.000Z",
    ...input,
  };
}

test("temperature point maps actual and target values from printer_status", () => {
  const point = temperaturePointFromStatus(status({}));

  assert.equal(point?.hotend_actual, 190);
  assert.equal(point?.hotend_target, 210);
  assert.equal(point?.bed_actual, 55);
  assert.equal(point?.bed_target, 60);
});

test("temperature series is session-local, rolling, and replaces duplicate timestamps", () => {
  const first = appendTemperaturePoint([], status({}));
  const replaced = appendTemperaturePoint(first, status({ hotend_temp: 195 }));
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].hotend_actual, 195);

  const fresh = appendTemperaturePoint(
    replaced,
    status({ updated_at: "2026-07-06T12:31:00.000Z" }),
  );
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].timestamp, Date.parse("2026-07-06T12:31:00.000Z"));
});

test("temperature series decimates for rendering while keeping last point", () => {
  const series: TemperaturePoint[] = Array.from({ length: 10 }, (_, index) => ({
    timestamp: index,
    label: String(index),
    hotend_actual: index,
    hotend_target: index,
    bed_actual: index,
    bed_target: index,
  }));

  const decimated = decimateTemperatureSeries(series, 4);

  assert.deepEqual(
    decimated.map((point) => point.timestamp),
    [0, 3, 6, 9],
  );
});
