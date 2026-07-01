import type { PrintSettings } from "@/app/types/job";

export interface GCodeAnalysis {
  settings: Partial<PrintSettings>;
  slicer: string;
  linesScanned: number;
}

function number(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
}

export function analyzeGCode(text: string): GCodeAnalysis {
  const header = text.slice(0, 65_536);
  const lower = header.toLowerCase();
  const slicer = lower.includes("prusaslicer")
    ? "PrusaSlicer"
    : lower.includes("orcaslicer")
      ? "OrcaSlicer"
      : lower.includes("cura")
        ? "Cura"
        : "Generic G-code";
  const fanRaw = number(header, [
    /;\s*fan_speed\s*=\s*([\d.]+)/i,
    /M106\s+S([\d.]+)/i,
  ]);
  const flowRaw = number(header, [
    /;\s*extrusion_multiplier\s*=\s*([\d.]+)/i,
    /M221\s+S([\d.]+)/i,
  ]);

  return {
    slicer,
    linesScanned: header.split("\n").length,
    settings: {
      nozzle_temp: number(header, [
        /;\s*nozzle_temperature\s*=\s*([\d.]+)/i,
        /M10[49]\s+S([\d.]+)/i,
      ]),
      bed_temp: number(header, [
        /;\s*bed_temperature\s*=\s*([\d.]+)/i,
        /M1[49]0\s+S([\d.]+)/i,
      ]),
      speed: number(header, [
        /;\s*(?:speed_print|perimeter_speed)\s*=\s*([\d.]+)/i,
      ]),
      flow_rate:
        flowRaw === undefined
          ? undefined
          : flowRaw > 2
            ? flowRaw / 100
            : flowRaw,
      fan_speed:
        fanRaw === undefined
          ? undefined
          : fanRaw > 100
            ? Math.round((fanRaw / 255) * 100)
            : fanRaw,
    },
  };
}
