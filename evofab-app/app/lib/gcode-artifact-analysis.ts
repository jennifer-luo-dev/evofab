import {
  parseGcodeLayers,
  type GcodeLayer,
  type GcodeLineType,
} from "./gcode-layer-parser";

export interface GcodeBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface GcodeArtifactAnalysis {
  byteCount: number;
  lineCount: number;
  normalizedHash: string | null;
  parsedLayerCount: number;
  bounds: GcodeBounds | null;
  extrusionMoveCount: number;
  extrusionPathLengthMm: number;
  features: GcodeLineType[];
  occupancy: { bottom: number; middle: number; top: number };
}

export interface PreviewTrust {
  status: "pending" | "trusted" | "blocked";
  reasons: string[];
  reportedLayerCount: number | null;
  analysis: GcodeArtifactAnalysis;
}

function segmentLength(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
) {
  return Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
}

export function normalizeGcode(gcode: string): string {
  return `${gcode
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n+$/g, "")}\n`;
}

export async function normalizedGcodeHash(gcode: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeGcode(gcode));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function extrusionLayers(layers: GcodeLayer[]) {
  return layers.map((layer) =>
    layer.segments.filter((segment) => segment.type !== "travel"),
  );
}

export async function analyzeGcodeArtifact(
  gcode: string,
  options: { includeHash?: boolean } = {},
): Promise<GcodeArtifactAnalysis> {
  const normalized = normalizeGcode(gcode);
  const layers = parseGcodeLayers(normalized);
  const extrusion = extrusionLayers(layers).flat();
  const points = extrusion.flatMap((segment) => [segment.from, segment.to]);
  const counts = extrusionLayers(layers);
  const middle = Math.floor(counts.length / 2);

  return {
    byteCount: new TextEncoder().encode(normalized).byteLength,
    lineCount: normalized.split("\n").length - 1,
    normalizedHash:
      options.includeHash === false
        ? null
        : await normalizedGcodeHash(normalized),
    parsedLayerCount: layers.length,
    bounds:
      points.length === 0
        ? null
        : {
            minX: Math.min(...points.map((point) => point.x)),
            maxX: Math.max(...points.map((point) => point.x)),
            minY: Math.min(...points.map((point) => point.y)),
            maxY: Math.max(...points.map((point) => point.y)),
            minZ: Math.min(...points.map((point) => point.z)),
            maxZ: Math.max(...points.map((point) => point.z)),
          },
    extrusionMoveCount: extrusion.length,
    extrusionPathLengthMm: extrusion.reduce(
      (total, segment) => total + segmentLength(segment.from, segment.to),
      0,
    ),
    features: [...new Set(extrusion.map((segment) => segment.type))].sort(),
    occupancy: {
      bottom: counts[0]?.length ?? 0,
      middle: counts[middle]?.length ?? 0,
      top: counts.at(-1)?.length ?? 0,
    },
  };
}

export async function assessPreviewTrust(
  gcode: string,
  reportedLayerCount: number | null | undefined,
): Promise<PreviewTrust> {
  const analysis = await analyzeGcodeArtifact(gcode);
  const reasons: string[] = [];
  if (!Number.isInteger(reportedLayerCount) || (reportedLayerCount ?? 0) < 2) {
    reasons.push("The slicer did not report a usable layer count.");
  } else if (reportedLayerCount !== analysis.parsedLayerCount) {
    reasons.push(
      `Reported ${reportedLayerCount} layers, but the validated parser found ${analysis.parsedLayerCount}.`,
    );
  }
  if (!analysis.bounds || analysis.extrusionMoveCount < 2) {
    reasons.push(
      "The G-code does not contain a renderable extrusion toolpath.",
    );
  }
  if (analysis.extrusionPathLengthMm < 10) {
    reasons.push(
      "The extrusion path is too short to trust as a printable artifact.",
    );
  }
  if (Object.values(analysis.occupancy).some((count) => count === 0)) {
    reasons.push(
      "Bottom, middle, and top layer occupancy must all be non-empty.",
    );
  }
  return {
    status: reasons.length === 0 ? "trusted" : "blocked",
    reasons,
    reportedLayerCount: reportedLayerCount ?? null,
    analysis,
  };
}
