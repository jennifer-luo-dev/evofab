export interface GcodePoint {
  x: number;
  y: number;
  z: number;
}

export interface GcodeSegment {
  from: GcodePoint;
  to: GcodePoint;
}

export interface GcodeLayer {
  index: number;
  z: number;
  segments: GcodeSegment[];
}

const LAYER_RE = /^;\s*LAYER[:_]\s*(\d+)/i;
const COMMAND_RE = /^(G0|G1)\b/i;
const AXIS_RE = /([XYZE])([-+]?\d*\.?\d+)/gi;

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

export function parseGcodeLayers(gcode: string): GcodeLayer[] {
  const layers: GcodeLayer[] = [];
  let current = makeLayer(0, 0);
  let hasLayerContent = false;
  let position: GcodePoint = { x: 0, y: 0, z: 0 };
  let lastE = 0;

  function commitLayer() {
    if (hasLayerContent || current.segments.length > 0) {
      layers.push(current);
    }
  }

  for (const rawLine of gcode.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const layerMatch = line.match(LAYER_RE);
    if (layerMatch) {
      commitLayer();
      current = makeLayer(Number(layerMatch[1]), position.z);
      hasLayerContent = false;
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
    const isExtruding = typeof axes.E === "number" && nextE > lastE;

    if (typeof axes.Z === "number") {
      current.z = axes.Z;
      hasLayerContent = true;
    }

    if (isExtruding) {
      current.z = nextPosition.z;
      current.segments.push({
        from: position,
        to: nextPosition,
      });
      hasLayerContent = true;
    }

    position = nextPosition;
    lastE = nextE;
  }

  commitLayer();
  return layers.filter((layer) => layer.segments.length > 0);
}

export function layerTotalFromGcode(gcode: string): number | null {
  const match = gcode.match(/SET_PRINT_STATS_INFO\b[^\n]*\bTOTAL_LAYER=(\d+)/i);
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isInteger(total) && total > 0 ? total : null;
}
