import type { PrintSettings } from "@/app/types/job";
import { getMoonrakerMode, resolveMoonrakerBaseUrl } from "./moonraker-config";
export { HARDWARE_CONFIRMATION, getMoonrakerMode } from "./moonraker-config";
export { MoonrakerError } from "./moonraker-errors";
export {
  MoonrakerStatusConnector,
  normalizeMoonrakerStatus,
  type PrinterStatusConnector,
} from "./moonraker-client";

function base(ip: string, port: number) {
  return resolveMoonrakerBaseUrl({
    printerId: `${ip}:${port}`,
    ip,
    port,
  });
}

export async function uploadGcode(
  ip: string,
  port: number,
  file: File,
): Promise<string> {
  if (getMoonrakerMode() === "mock") {
    return file.name;
  }

  const form = new FormData();
  form.append("file", file, file.name);
  form.append("path", "");

  const res = await fetch(`${base(ip, port)}/server/files/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Moonraker file upload failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  return json.item?.path ?? file.name;
}

export async function applyPrintSettings(
  ip: string,
  port: number,
  settings: PrintSettings,
): Promise<void> {
  if (getMoonrakerMode() === "mock") {
    return;
  }

  const fanValue = Math.round((settings.fan_speed / 100) * 255);
  const flowPct = Math.round(settings.flow_rate * 100);

  // SET_VELOCITY_LIMIT sets absolute mm/s; M221 sets flow % override; M106 sets fan 0-255
  const script = [
    `M104 S${settings.nozzle_temp}`,
    `M140 S${settings.bed_temp}`,
    `SET_VELOCITY_LIMIT VELOCITY=${settings.speed}`,
    `M221 S${flowPct}`,
    `M106 S${fanValue}`,
  ].join("\n");

  const res = await fetch(`${base(ip, port)}/printer/gcode/script`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ script }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Moonraker gcode script failed (${res.status}): ${text}`);
  }
}

export async function startPrint(
  ip: string,
  port: number,
  filename: string,
): Promise<void> {
  if (getMoonrakerMode() === "mock") {
    return;
  }

  const res = await fetch(`${base(ip, port)}/printer/print/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Moonraker print start failed (${res.status}): ${text}`);
  }
}
