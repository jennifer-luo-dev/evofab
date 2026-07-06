import type { PrintSettings } from "@/app/types/job";
import { getMoonrakerMode, resolveMoonrakerBaseUrl } from "./moonraker-config";
import {
  applyMockMoonrakerScript,
  controlMockMoonrakerPrint,
  listMockMoonrakerFiles,
  mockPrinterKey,
  uploadMockMoonrakerFile,
  startMockMoonrakerPrint,
} from "./mock-moonraker";
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

async function moonrakerJsonRequest(
  ip: string,
  port: number,
  path: string,
  body?: unknown,
): Promise<void> {
  const res = await fetch(`${base(ip, port)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Moonraker request failed (${res.status}): ${text}`);
  }
}

function overrideScript(settings: PrintSettings): string {
  const fanValue = Math.round((settings.fan_speed / 100) * 255);
  const flowPct = Math.round(settings.flow_rate * 100);

  // SET_VELOCITY_LIMIT sets absolute mm/s; M221 sets flow % override; M106 sets fan 0-255
  return [
    `M104 S${settings.nozzle_temp}`,
    `M140 S${settings.bed_temp}`,
    `SET_VELOCITY_LIMIT VELOCITY=${settings.speed}`,
    `M221 S${flowPct}`,
    `M106 S${fanValue}`,
  ].join("\n");
}

export async function uploadGcode(
  ip: string,
  port: number,
  file: File,
): Promise<string> {
  if (getMoonrakerMode() === "mock") {
    return uploadMockMoonrakerFile({
      printerKey: mockPrinterKey({ ip, port }),
      filename: file.name,
      contents: await file.text(),
    });
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
  const script = overrideScript(settings);

  if (getMoonrakerMode() === "mock") {
    await applyMockMoonrakerScript(mockPrinterKey({ ip, port }), script);
    return;
  }

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
    await startMockMoonrakerPrint(mockPrinterKey({ ip, port }), filename);
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

export async function listFiles(ip: string, port: number): Promise<string[]> {
  if (getMoonrakerMode() === "mock") {
    return listMockMoonrakerFiles(mockPrinterKey({ ip, port }));
  }

  const res = await fetch(`${base(ip, port)}/server/files/list?root=gcodes`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Moonraker file list failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  return ((json.result ?? []) as { path?: string }[])
    .map((item) => item.path)
    .filter((path): path is string => typeof path === "string");
}

export async function pausePrint(ip: string, port: number): Promise<void> {
  if (getMoonrakerMode() === "mock") {
    await controlMockMoonrakerPrint(mockPrinterKey({ ip, port }), "pause");
    return;
  }
  await moonrakerJsonRequest(ip, port, "/printer/print/pause");
}

export async function resumePrint(ip: string, port: number): Promise<void> {
  if (getMoonrakerMode() === "mock") {
    await controlMockMoonrakerPrint(mockPrinterKey({ ip, port }), "resume");
    return;
  }
  await moonrakerJsonRequest(ip, port, "/printer/print/resume");
}

export async function cancelPrint(ip: string, port: number): Promise<void> {
  if (getMoonrakerMode() === "mock") {
    await controlMockMoonrakerPrint(mockPrinterKey({ ip, port }), "cancel");
    return;
  }
  await moonrakerJsonRequest(ip, port, "/printer/print/cancel");
}

export async function emergencyStop(ip: string, port: number): Promise<void> {
  if (getMoonrakerMode() === "mock") {
    await controlMockMoonrakerPrint(mockPrinterKey({ ip, port }), "emergency_stop");
    return;
  }
  await moonrakerJsonRequest(ip, port, "/printer/emergency_stop");
}

export async function restartKlipper(ip: string, port: number): Promise<void> {
  if (getMoonrakerMode() === "mock") {
    await controlMockMoonrakerPrint(mockPrinterKey({ ip, port }), "restart");
    return;
  }
  await moonrakerJsonRequest(ip, port, "/printer/gcode/script", { script: "RESTART" });
}

export async function firmwareRestartKlipper(
  ip: string,
  port: number,
): Promise<void> {
  if (getMoonrakerMode() === "mock") {
    await controlMockMoonrakerPrint(mockPrinterKey({ ip, port }), "firmware_restart");
    return;
  }
  await moonrakerJsonRequest(ip, port, "/printer/gcode/script", {
    script: "FIRMWARE_RESTART",
  });
}
