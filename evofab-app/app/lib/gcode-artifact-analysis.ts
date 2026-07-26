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
  featureMoveCounts: Partial<Record<GcodeLineType, number>>;
  hasStartPrintMarker: boolean;
  occupancy: { bottom: number; middle: number; top: number };
  representativePathLengthMm: { bottom: number; middle: number; top: number };
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

function layerPathLength(segments: GcodeLayer["segments"]) {
  return segments.reduce(
    (total, segment) => total + segmentLength(segment.from, segment.to),
    0,
  );
}

function hasCanonicalStartPrintMarker(gcode: string) {
  return gcode.split("\n").some((line) => /^START_PRINT\b/i.test(line));
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
  const sampled = {
    bottom: counts[0] ?? [],
    middle: counts[middle] ?? [],
    top: counts.at(-1) ?? [],
  };
  const featureMoveCounts = extrusion.reduce<
    Partial<Record<GcodeLineType, number>>
  >((result, segment) => {
    result[segment.type] = (result[segment.type] ?? 0) + 1;
    return result;
  }, {});

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
    featureMoveCounts,
    hasStartPrintMarker: hasCanonicalStartPrintMarker(normalized),
    occupancy: {
      bottom: sampled.bottom.length,
      middle: sampled.middle.length,
      top: sampled.top.length,
    },
    representativePathLengthMm: {
      bottom: layerPathLength(sampled.bottom),
      middle: layerPathLength(sampled.middle),
      top: layerPathLength(sampled.top),
    },
  };
}

export async function assessPreviewTrust(
  gcode: string,
  reportedLayerCount: number | null | undefined,
  options: { requiredFeatures?: GcodeLineType[] } = {},
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
  if (!analysis.hasStartPrintMarker) {
    reasons.push(
      "The G-code is missing the required START_PRINT slicer contract marker.",
    );
  }
  if (!analysis.bounds) {
    reasons.push(
      "The G-code does not contain a renderable extrusion toolpath.",
    );
  } else {
    const spanX = analysis.bounds.maxX - analysis.bounds.minX;
    const spanY = analysis.bounds.maxY - analysis.bounds.minY;
    const spanZ = analysis.bounds.maxZ - analysis.bounds.minZ;
    // 0.05 mm axis and 0.01 mm² area accept small parts while rejecting a
    // line-only path. The path/move minima below scale with parsed layers and
    // XY span so a few long strings cannot impersonate a model.
    if (
      ![spanX, spanY, spanZ].every(Number.isFinite) ||
      spanX < 0.05 ||
      spanY < 0.05 ||
      spanZ < 0.01 ||
      spanX * spanY < 0.01
    ) {
      reasons.push(
        "Extrusion bounds are degenerate; trusted artifacts require finite nonzero XY area and Z height.",
      );
    }

    const layers = Math.max(1, analysis.parsedLayerCount);
    const xyScale = Math.max(4, Math.min((spanX + spanY) / 2, 25));
    const minimumMoves = Math.max(12, layers * 3);
    const minimumPathLength = Math.max(25, layers * xyScale);
    const minimumSampleMoves = Math.max(
      3,
      Math.min(10, Math.ceil(analysis.extrusionMoveCount / layers / 3)),
    );
    const minimumSamplePath = Math.max(2, Math.min(xyScale / 2, 12));

    if (analysis.extrusionMoveCount < minimumMoves) {
      reasons.push(
        `Toolpath density is too low (${analysis.extrusionMoveCount} moves; need at least ${minimumMoves} for ${layers} layers).`,
      );
    }
    if (analysis.extrusionPathLengthMm < minimumPathLength) {
      reasons.push(
        `Extrusion path is too short (${analysis.extrusionPathLengthMm.toFixed(1)} mm; need at least ${minimumPathLength.toFixed(1)} mm for this span and layer count).`,
      );
    }
    for (const sample of ["bottom", "middle", "top"] as const) {
      if (
        analysis.occupancy[sample] < minimumSampleMoves ||
        analysis.representativePathLengthMm[sample] < minimumSamplePath
      ) {
        reasons.push(
          `Representative ${sample} layer lacks meaningful occupancy (${analysis.occupancy[sample]} moves, ${analysis.representativePathLengthMm[sample].toFixed(1)} mm).`,
        );
      }
    }
  }
  const wallFeatures: GcodeLineType[] = [
    "external_perimeter",
    "outer_wall",
    "perimeter",
    "inner_wall",
  ];
  if (!wallFeatures.some((feature) => (analysis.featureMoveCounts[feature] ?? 0) > 0)) {
    reasons.push(
      "Trusted model G-code requires recognized wall or perimeter extrusion evidence.",
    );
  }
  for (const feature of options.requiredFeatures ?? []) {
    if ((analysis.featureMoveCounts[feature] ?? 0) === 0) {
      reasons.push(`Expected ${feature.replaceAll("_", " ")} evidence is missing.`);
    }
  }
  return {
    status: reasons.length === 0 ? "trusted" : "blocked",
    reasons,
    reportedLayerCount: reportedLayerCount ?? null,
    analysis,
  };
}
