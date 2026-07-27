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

/** Support requests are intent; only the slicer declaring generated support is
 * authoritative enough to require support feature paths in canonical G-code. */
export function requiredFeaturesFromSlicerMetadata(metadata: {
  supports_generated?: boolean | null;
}): GcodeLineType[] {
  return metadata.supports_generated === true ? ["support"] : [];
}

export interface SourceOutputCorrelationInput {
  preparedSourceBounds: { x: number; y: number; z: number } | null | undefined;
  transformedResultBounds:
    { x: number; y: number; z: number } | null | undefined;
  rotation: number[] | null | undefined;
}

/**
 * Source/output correlation is intentionally one-sided for XY: a slicer may
 * add a brim, skirt, or support, but a parsed extrusion footprint that is more
 * than 20% smaller than the prepared source is not credible. The 0.5 mm floor
 * permits small-part rounding. Z uses the same ratio/floor because a prepared
 * part should not silently lose a substantial portion of its height.
 */
const CORRELATION_MINIMUM_RATIO = 0.8;
const CORRELATION_ABSOLUTE_TOLERANCE_MM = 0.5;

function isUsableBounds(
  bounds: { x: number; y: number; z: number } | null | undefined,
): bounds is { x: number; y: number; z: number } {
  return Boolean(
    bounds &&
    [bounds.x, bounds.y, bounds.z].every(
      (value) => Number.isFinite(value) && value > 0,
    ),
  );
}

function materiallySmaller(output: number, expected: number): boolean {
  return (
    output + CORRELATION_ABSOLUTE_TOLERANCE_MM <
    expected * CORRELATION_MINIMUM_RATIO
  );
}

function hasUsableQuaternion(rotation: number[] | null | undefined): boolean {
  return (
    rotation == null ||
    (rotation.length === 4 && rotation.every((value) => Number.isFinite(value)))
  );
}

/**
 * Checks only server-returned preparation and slicer-result dimensions against
 * parsed extrusion bounds. It never treats a browser's model data as evidence.
 */
export function assessSourceOutputCorrelation(
  analysis: GcodeArtifactAnalysis,
  input: SourceOutputCorrelationInput,
): string[] {
  const reasons: string[] = [];
  if (!isUsableBounds(input.preparedSourceBounds)) {
    reasons.push(
      "Prepared source bounds are unavailable; source-to-toolpath correlation cannot be established.",
    );
  }
  if (!isUsableBounds(input.transformedResultBounds)) {
    reasons.push(
      "Transformed slicer-result bounds are unavailable; source-to-toolpath correlation cannot be established.",
    );
  }
  if (!hasUsableQuaternion(input.rotation)) {
    reasons.push(
      "The slicer returned an invalid preparation orientation state.",
    );
  }
  if (!analysis.bounds || reasons.length > 0) return reasons;

  const output = {
    x: analysis.bounds.maxX - analysis.bounds.minX,
    y: analysis.bounds.maxY - analysis.bounds.minY,
    z: analysis.bounds.maxZ - analysis.bounds.minZ,
  };
  const expected = input.transformedResultBounds;
  if (!expected) return reasons;
  const outputXY = [output.x, output.y].sort((left, right) => left - right);
  const expectedXY = [expected.x, expected.y].sort(
    (left, right) => left - right,
  );
  if (
    materiallySmaller(outputXY[0], expectedXY[0]) ||
    materiallySmaller(outputXY[1], expectedXY[1]) ||
    materiallySmaller(output.z, expected.z)
  ) {
    reasons.push(
      "Parsed extrusion bounds are materially smaller than the server-reported prepared result bounds.",
    );
  }

  const source = input.preparedSourceBounds;
  if (!source) return reasons;
  const sourceXY = [source.x, source.y].sort((left, right) => left - right);
  if (
    materiallySmaller(expectedXY[0], sourceXY[0]) ||
    materiallySmaller(expectedXY[1], sourceXY[1]) ||
    materiallySmaller(expected.z, source.z)
  ) {
    reasons.push(
      "The slicer-result bounds do not preserve the prepared source dimensions.",
    );
  }
  return reasons;
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
  if (
    !wallFeatures.some(
      (feature) => (analysis.featureMoveCounts[feature] ?? 0) > 0,
    )
  ) {
    reasons.push(
      "Trusted model G-code requires recognized wall or perimeter extrusion evidence.",
    );
  }
  for (const feature of options.requiredFeatures ?? []) {
    if ((analysis.featureMoveCounts[feature] ?? 0) === 0) {
      reasons.push(
        `Expected ${feature.replaceAll("_", " ")} evidence is missing.`,
      );
    }
  }
  return {
    status: reasons.length === 0 ? "trusted" : "blocked",
    reasons,
    reportedLayerCount: reportedLayerCount ?? null,
    analysis,
  };
}
