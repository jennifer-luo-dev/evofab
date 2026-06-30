// moonraker.ts
// Client for Klipper's Moonraker HTTP API: status parsing, G-code upload,
// print settings, and print start/stream URL helpers.

import type { PrintSettings } from '@/app/types/job'
import type { PrinterStatus, PrinterStatusType } from '@/app/types/printer'

/**
 * Maps Moonraker print_stats.state strings to the app's PrinterStatusType.
 * 'complete' and 'cancelled' both map to 'idle' — the printer is available again.
 */
export const MOONRAKER_STATE_MAP: Record<string, PrinterStatusType> = {
  standby: 'idle',
  printing: 'printing',
  paused: 'paused',
  error: 'error',
  complete: 'idle',
  cancelled: 'idle',
}

/**
 * Converts a Moonraker /printer/objects/query response into a PrinterStatus.
 * @param printerId - Supabase printer row ID to attach to the returned record.
 * @param result - The `result.status` object from the Moonraker query JSON.
 */
export function parseMoonrakerStatus(
  printerId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: Record<string, any>,
): PrinterStatus {
  const ps = result.print_stats ?? {}
  const ext = result.extruder ?? {}
  const bed = result.heater_bed ?? {}
  const vsd = result.virtual_sdcard ?? {}
  return {
    printer_id: printerId,
    online: true,
    status: MOONRAKER_STATE_MAP[ps.state] ?? 'idle',
    print_state: ps.state ?? null,
    filename: ps.filename || null,
    progress: typeof vsd.progress === 'number' ? vsd.progress * 100 : 0,
    layer_current: ps.info?.current_layer ?? null,
    layer_total: ps.info?.total_layer ?? null,
    hotend_temp: ext.temperature ?? null,
    hotend_target: ext.target ?? null,
    bed_temp: bed.temperature ?? null,
    bed_target: bed.target ?? null,
    eta_seconds: null,
    updated_at: new Date().toISOString(),
  }
}

/**
 * Returns an all-null PrinterStatus representing an unreachable printer.
 * @param printerId - Supabase printer row ID to attach to the returned record.
 */
export function offlinePrinterStatus(printerId: string): PrinterStatus {
  return {
    printer_id: printerId,
    online: false,
    status: 'offline',
    print_state: null,
    filename: null,
    progress: 0,
    layer_current: null,
    layer_total: null,
    hotend_temp: null,
    hotend_target: null,
    bed_temp: null,
    bed_target: null,
    eta_seconds: null,
    updated_at: new Date().toISOString(),
  }
}

function base(ip: string, port: number) {
  return `http://${ip}:${port}`
}

/**
 * Uploads a G-code file to Moonraker's file manager and returns the server-side path.
 * @returns The file path as confirmed by Moonraker, used as the argument to startPrint.
 */
export async function uploadGcode(ip: string, port: number, file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('path', '')

  const res = await fetch(`${base(ip, port)}/server/files/upload`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Moonraker file upload failed (${res.status}): ${text}`)
  }
  const json = await res.json()
  return json.item?.path ?? file.name
}

/**
 * Pushes all PrintSettings to the printer as a single gcode script.
 * Fan speed is converted from 0–100% to 0–255 PWM; flow rate from ratio to percent.
 */
export async function applyPrintSettings(ip: string, port: number, settings: PrintSettings): Promise<void> {
  const fanValue = Math.round((settings.fan_speed / 100) * 255)
  const flowPct = Math.round(settings.flow_rate * 100)

  // SET_VELOCITY_LIMIT sets absolute mm/s; M221 sets flow % override; M106 sets fan 0-255
  const script = [
    `M104 S${settings.nozzle_temp}`,
    `M140 S${settings.bed_temp}`,
    `SET_VELOCITY_LIMIT VELOCITY=${settings.speed}`,
    `M221 S${flowPct}`,
    `M106 S${fanValue}`,
  ].join('\n')

  const res = await fetch(`${base(ip, port)}/printer/gcode/script`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Moonraker gcode script failed (${res.status}): ${text}`)
  }
}

/** Returns the Moonraker WebSocket URL for direct sub-second telemetry. */
export function getMoonrakerWsUrl(ip: string, port: number): string {
  return `ws://${ip}:${port}/websocket`
}

/**
 * Queries the Moonraker webcam list and returns the first stream URL, or null if unavailable.
 * Relative URLs (e.g. "/webcam?action=stream") are prefixed with the printer's IP
 * because they assume Moonraker's nginx proxy is serving at port 80.
 */
export async function getWebcamStreamUrl(ip: string, port: number): Promise<string | null> {
  try {
    const res = await fetch(`http://${ip}:${port}/server/webcams/list`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return null
    const json = await res.json()
    const webcams: { stream_url?: string }[] = json?.result?.webcams ?? []
    if (webcams.length === 0) return null
    const streamUrl = webcams[0].stream_url
    if (!streamUrl) return null
    // Relative URLs are served from the printer's port-80 nginx proxy
    return streamUrl.startsWith('/') ? `http://${ip}${streamUrl}` : streamUrl
  } catch {
    return null
  }
}

/**
 * Sends the print start command to Moonraker.
 * @param filename - The server-side path returned by uploadGcode.
 */
export async function startPrint(ip: string, port: number, filename: string): Promise<void> {
  const res = await fetch(`${base(ip, port)}/printer/print/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Moonraker print start failed (${res.status}): ${text}`)
  }
}
