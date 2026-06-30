import type { PrintSettings } from '@/app/types/job'

export type GCodeBounds = { x: number; y: number; z: number }
export type GCodeInfo = { bounds: GCodeBounds | null; settings: Partial<PrintSettings> }

/**
 * Parses a "WxDxH" build-volume string (e.g. "220x220x250") into millimetre dimensions.
 * Returns null if the string cannot be parsed.
 */
function parseBuildVolume(str: string): GCodeBounds | null {
  const m = str.match(/([\d.]+)[x×]([\d.]+)[x×]([\d.]+)/i)
  if (!m) return null
  return { x: parseFloat(m[1]), y: parseFloat(m[2]), z: parseFloat(m[3]) }
}

/** Returns the first numeric capture from `text` matched against the given patterns in order. */
function firstNum(text: string, ...patterns: RegExp[]): number | undefined {
  for (const p of patterns) {
    const m = text.match(p)
    if (m?.[1]) return parseFloat(m[1])
  }
}

export { parseBuildVolume }

/**
 * Parses a G-code file's header (and full body as fallback) to extract print bounds and settings.
 * Tries Cura, PrusaSlicer, and OrcaSlicer slicer comment formats before scanning all G0/G1 moves.
 * @returns Bounding box in mm and any PrintSettings extracted from slicer comments or M-code fallbacks.
 */
export async function analyzeGCode(file: File): Promise<GCodeInfo> {
  const header = await file.slice(0, 64 * 1024).text()

  // ── BOUNDS ────────────────────────────────────────────────────────────────

  let bounds: GCodeBounds | null = null

  // Cura: ;MINX:0  ;MAXX:150
  const cMaxX = header.match(/;MAXX:([\d.]+)/i)?.[1]
  const cMaxY = header.match(/;MAXY:([\d.]+)/i)?.[1]
  const cMaxZ = header.match(/;MAXZ:([\d.]+)/i)?.[1]
  if (cMaxX && cMaxY && cMaxZ) {
    bounds = {
      x: parseFloat(cMaxX) - parseFloat(header.match(/;MINX:([\d.]+)/i)?.[1] ?? '0'),
      y: parseFloat(cMaxY) - parseFloat(header.match(/;MINY:([\d.]+)/i)?.[1] ?? '0'),
      z: parseFloat(cMaxZ) - parseFloat(header.match(/;MINZ:([\d.]+)/i)?.[1] ?? '0'),
    }
  }

  // PrusaSlicer / OrcaSlicer: ; MAXX = 150
  if (!bounds) {
    const pMaxX = header.match(/;\s*MAXX\s*=\s*([\d.]+)/i)?.[1]
    const pMaxY = header.match(/;\s*MAXY\s*=\s*([\d.]+)/i)?.[1]
    const pMaxZ = header.match(/;\s*MAXZ\s*=\s*([\d.]+)/i)?.[1]
    if (pMaxX && pMaxY && pMaxZ) {
      bounds = {
        x: parseFloat(pMaxX) - parseFloat(header.match(/;\s*MINX\s*=\s*([\d.]+)/i)?.[1] ?? '0'),
        y: parseFloat(pMaxY) - parseFloat(header.match(/;\s*MINY\s*=\s*([\d.]+)/i)?.[1] ?? '0'),
        z: parseFloat(pMaxZ) - parseFloat(header.match(/;\s*MINZ\s*=\s*([\d.]+)/i)?.[1] ?? '0'),
      }
    }
  }

  // Fallback: scan every G0/G1 move in the full file.
  if (!bounds) {
    const text = await file.text()
    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity
    let minZ = Infinity, maxZ = -Infinity
    let found = false
    for (const raw of text.split('\n')) {
      const line = raw.trimStart().toUpperCase()
      if (!line.startsWith('G0') && !line.startsWith('G1')) continue
      const x = line.match(/X(-?[\d.]+)/)?.[1]
      const y = line.match(/Y(-?[\d.]+)/)?.[1]
      const z = line.match(/Z(-?[\d.]+)/)?.[1]
      if (x) { const v = parseFloat(x); minX = Math.min(minX, v); maxX = Math.max(maxX, v); found = true }
      if (y) { const v = parseFloat(y); minY = Math.min(minY, v); maxY = Math.max(maxY, v); found = true }
      if (z) { const v = parseFloat(z); minZ = Math.min(minZ, v); maxZ = Math.max(maxZ, v); found = true }
    }
    if (found) bounds = { x: maxX - minX, y: maxY - minY, z: maxZ - minZ }
  }

  // ── PRINT SETTINGS ────────────────────────────────────────────────────────

  const settings: Partial<PrintSettings> = {}

  const nozzle = firstNum(
    header,
    /;\s*nozzle_temperature\s*[=:]\s*([\d.]+)/i,
    /;\s*temperature\s*[=:]\s*([\d.]+)/i,
    /M(?:104|109)\s+[^;\n]*S(\d+)/i,
  )
  if (nozzle !== undefined) settings.nozzle_temp = nozzle

  const bed = firstNum(
    header,
    /;\s*(?:bed_temperature|first_layer_bed_temperature|material_bed_temperature)\s*[=:]\s*([\d.]+)/i,
    /M(?:140|190)\s+[^;\n]*S(\d+)/i,
  )
  if (bed !== undefined) settings.bed_temp = bed

  const speed = firstNum(
    header,
    /;\s*(?:speed_print|perimeter_speed|print_speed)\s*[=:]\s*([\d.]+)/i,
  )
  if (speed !== undefined) settings.speed = speed

  // extrusion_multiplier is already a ratio (e.g. 0.94); M221 S is a percentage (95 → 0.95).
  const flowRaw = firstNum(
    header,
    /;\s*(?:extrusion_multiplier|flow_ratio)\s*[=:]\s*([\d.]+)/i,
    /M221\s+[^;\n]*S(\d+)/i,
  )
  if (flowRaw !== undefined) settings.flow_rate = flowRaw > 2 ? flowRaw / 100 : flowRaw

  // Fan comments are 0–100 %; M106 S is 0–255 PWM.
  const fanRaw = firstNum(
    header,
    /;\s*(?:fan_speed|cooling_fan_speed|part_cooling_fan_speed|max_fan_speed)\s*[=:]\s*([\d.]+)/i,
    /M106\s+[^;\n]*S(\d+)/i,
  )
  if (fanRaw !== undefined) settings.fan_speed = fanRaw > 100 ? Math.round((fanRaw / 255) * 100) : Math.round(fanRaw)

  return { bounds, settings }
}
