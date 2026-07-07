import type { PrinterStatus } from "@/app/types/printer";

export interface TemperaturePoint {
  timestamp: number;
  label: string;
  hotend_actual: number | null;
  hotend_target: number | null;
  bed_actual: number | null;
  bed_target: number | null;
}

const WINDOW_MS = 30 * 60 * 1000;
const MAX_RENDER_POINTS = 360;

function formatLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function temperaturePointFromStatus(
  status: PrinterStatus | null,
  now = Date.now(),
): TemperaturePoint | null {
  if (!status) return null;
  if (
    status.hotend_temp == null &&
    status.hotend_target == null &&
    status.bed_temp == null &&
    status.bed_target == null
  ) {
    return null;
  }

  const timestamp = Number.isFinite(Date.parse(status.updated_at))
    ? Date.parse(status.updated_at)
    : now;

  return {
    timestamp,
    label: formatLabel(timestamp),
    hotend_actual: status.hotend_temp,
    hotend_target: status.hotend_target,
    bed_actual: status.bed_temp,
    bed_target: status.bed_target,
  };
}

export function appendTemperaturePoint(
  series: TemperaturePoint[],
  status: PrinterStatus | null,
  now = Date.now(),
): TemperaturePoint[] {
  const point = temperaturePointFromStatus(status, now);
  if (!point) return series;
  const cutoff = point.timestamp - WINDOW_MS;
  const trimmed = series.filter((item) => item.timestamp >= cutoff);
  const last = trimmed.at(-1);
  if (last?.timestamp === point.timestamp) {
    return [...trimmed.slice(0, -1), point];
  }
  return [...trimmed, point];
}

export function decimateTemperatureSeries(
  series: TemperaturePoint[],
  maxPoints = MAX_RENDER_POINTS,
): TemperaturePoint[] {
  if (series.length <= maxPoints) return series;
  const stride = Math.ceil(series.length / maxPoints);
  return series.filter(
    (_point, index) => index % stride === 0 || index === series.length - 1,
  );
}
