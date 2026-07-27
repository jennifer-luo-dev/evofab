export interface GcodePoint {
  x: number;
  y: number;
  z: number;
}

export type GcodeLineType =
  | "external_perimeter"
  | "perimeter"
  | "outer_wall"
  | "inner_wall"
  | "infill"
  | "sparse_infill"
  | "support"
  | "top_surface"
  | "skirt"
  | "brim"
  | "travel"
  | "unknown";

export interface GcodeSegment {
  from: GcodePoint;
  to: GcodePoint;
  type: GcodeLineType;
  sourceLine: string;
  lineNumber: number;
}

export interface GcodeLayer {
  index: number;
  z: number;
  segments: GcodeSegment[];
}

const LAYER_RE = /^;\s*LAYER[:_]\s*(\d+)/i;
const LAYER_CHANGE_RE = /^;\s*LAYER_CHANGE\b/i;
const Z_COMMENT_RE = /^;\s*Z:\s*([-+]?\d*\.?\d+)/i;
const TYPE_RE = /^;\s*TYPE[:_]\s*(.+)$/i;
const COMMAND_RE = /^(G0|G1)\b/i;
const AXIS_RE = /([XYZE])([-+]?\d*\.?\d+)/gi;
const G92_E_RE = /^G92\b(?=.*\bE([-+]?\d*\.?\d+))/i;

function parseAxes(
  line: string,
): Partial<Record<"X" | "Y" | "Z" | "E", number>> {
  const axes: Partial<Record<"X" | "Y" | "Z" | "E", number>> = {};
  for (const match of line.matchAll(AXIS_RE)) {
    const value = Number(match[2]);
    if (Number.isFinite(value))
      axes[match[1].toUpperCase() as keyof typeof axes] = value;
  }
  return axes;
}

function makeLayer(index: number, z: number): GcodeLayer {
  return { index, z, segments: [] };
}

function normalizeLineType(value: string): GcodeLineType {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[\s/-]+/g, "_");
  if (normalized.includes("skirt")) return "skirt";
  if (normalized.includes("brim")) return "brim";
  if (normalized.includes("support")) return "support";
  if (normalized.includes("top") || normalized.includes("surface"))
    return "top_surface";
  if (normalized.includes("external")) return "external_perimeter";
  if (normalized.includes("outer") || normalized.includes("wall_outer"))
    return "outer_wall";
  if (normalized === "perimeter" || normalized.includes("perimeter"))
    return "perimeter";
  if (normalized.includes("inner") || normalized.includes("wall"))
    return "inner_wall";
  if (normalized === "infill" || normalized.includes("solid_infill"))
    return "infill";
  if (normalized.includes("infill")) return "sparse_infill";
  if (normalized.includes("travel")) return "travel";
  return "unknown";
}

export function parseGcodeLayers(gcode: string): GcodeLayer[] {
  const layers: GcodeLayer[] = [];
  let current = makeLayer(0, 0);
  let hasLayerContent = false;
  let position: GcodePoint = { x: 0, y: 0, z: 0 };
  let lastE = 0;
  let currentType: GcodeLineType = "unknown";
  let relativeExtrusion = false;
  let nextImplicitLayerIndex = 0;

  function commitLayer() {
    if (hasLayerContent || current.segments.length > 0) {
      layers.push(current);
    }
  }

  const lines = gcode.split(/\r?\n/);
  for (const [lineIndex, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line) continue;

    const typeMatch = line.match(TYPE_RE);
    if (typeMatch) {
      currentType = normalizeLineType(typeMatch[1]);
      continue;
    }

    const layerMatch = line.match(LAYER_RE);
    if (layerMatch) {
      commitLayer();
      current = makeLayer(Number(layerMatch[1]), position.z);
      hasLayerContent = false;
      nextImplicitLayerIndex = current.index + 1;
      continue;
    }

    if (LAYER_CHANGE_RE.test(line)) {
      commitLayer();
      current = makeLayer(nextImplicitLayerIndex, position.z);
      hasLayerContent = false;
      nextImplicitLayerIndex += 1;
      continue;
    }

    const zCommentMatch = line.match(Z_COMMENT_RE);
    if (zCommentMatch) {
      const z = Number(zCommentMatch[1]);
      if (Number.isFinite(z)) current.z = z;
      continue;
    }

    if (/^M83\b/i.test(line)) {
      relativeExtrusion = true;
      continue;
    }

    if (/^M82\b/i.test(line)) {
      relativeExtrusion = false;
      continue;
    }

    const g92Match = line.match(G92_E_RE);
    if (g92Match) {
      const e = Number(g92Match[1]);
      if (Number.isFinite(e)) lastE = e;
      continue;
    }

    if (!COMMAND_RE.test(line)) continue;
    const axes = parseAxes(line);
    const nextPosition = {
      x: axes.X ?? position.x,
      y: axes.Y ?? position.y,
      z: axes.Z ?? position.z,
    };
    const nextE = axes.E ?? lastE;
    const isExtruding =
      typeof axes.E === "number" &&
      (relativeExtrusion ? axes.E > 0 : nextE > lastE);

    if (typeof axes.Z === "number") {
      current.z = axes.Z;
      hasLayerContent = true;
    }

    if (isExtruding) {
      current.z = nextPosition.z;
      current.segments.push({
        from: position,
        to: nextPosition,
        type: currentType,
        sourceLine: line,
        lineNumber: lineIndex + 1,
      });
      hasLayerContent = true;
    } else if (
      (axes.X !== undefined || axes.Y !== undefined) &&
      (nextPosition.x !== position.x || nextPosition.y !== position.y)
    ) {
      current.segments.push({
        from: position,
        to: nextPosition,
        type: "travel",
        sourceLine: line,
        lineNumber: lineIndex + 1,
      });
    }

    position = nextPosition;
    if (!relativeExtrusion) lastE = nextE;
  }

  commitLayer();
  return layers.filter((layer) => layer.segments.length > 0);
}

export function layerTotalFromGcode(gcode: string): number | null {
  const match =
    gcode.match(/SET_PRINT_STATS_INFO\b[^\n]*\bTOTAL_LAYER=(\d+)/i) ??
    gcode.match(/^;\s*total layer number:\s*(\d+)/im);
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isInteger(total) && total > 0 ? total : null;
}
