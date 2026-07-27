import type { WebGLPreview } from "gcode-preview";
import type { GcodeArtifactAnalysis } from "@/app/lib/gcode-artifact-analysis";
import {
  parseGcodeLayers,
  type GcodeLayer,
} from "@/app/lib/gcode-layer-parser";
import {
  GCODE_PREVIEW_TUBE_OPTIONS,
  loadGcodePreview,
} from "@/app/lib/gcode-preview-adapter";
import type { BuildVolumeMm } from "@/app/lib/printability";

const TOOL_COLORS = {
  0: "#ff8a3d",
  1: "#ffde59",
  2: "#c53030",
  3: "#22c55e",
  4: "#ff4141",
  5: "#e5e7eb",
};

export interface PreviewRenderOptions {
  startLayer: number;
  endLayer: number;
  showTravel: boolean;
}

export interface PreviewGeometryMetadata {
  extrusionWidthMm?: number | null;
  layerHeightMm?: number | null;
}

export interface ResolvedPreviewGeometry {
  extrusionWidthMm: number;
  layerHeightMm: number;
}

export interface SlicePreviewRenderer {
  update(options: PreviewRenderOptions): void;
  dispose(): void;
}

export interface SlicePreviewAdapter {
  parse(gcode: string): GcodeLayer[];
  createRenderer(input: {
    canvas: HTMLCanvasElement;
    gcode: string;
    layers: GcodeLayer[];
    analysis: GcodeArtifactAnalysis;
    buildVolume: BuildVolumeMm;
    geometry: PreviewGeometryMetadata;
    options: PreviewRenderOptions;
  }): Promise<SlicePreviewRenderer>;
}

function positive(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function commentMeasurement(
  gcode: string,
  names: string[],
): number | undefined {
  const expression = new RegExp(
    String.raw`^;.*?(?:${names
      .map((name) => name.replaceAll("_", String.raw`[_\s]+`))
      .join("|")})\s*(?:=|:)\s*([-+]?\d*\.?\d+)`,
    "im",
  );
  const value = Number(gcode.match(expression)?.[1]);
  return positive(value);
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Use authoritative result metadata first, then Orca's own profile comments.
 * If neither is present, gcode-preview uses its package default rather than an
 * EvoFab-specific pellet width or layer-height guess.
 */
export function previewGeometryForArtifact(
  gcode: string,
  layers: GcodeLayer[],
  metadata: PreviewGeometryMetadata,
): ResolvedPreviewGeometry {
  const inferredLayerHeight = median(
    layers
      .slice(1)
      .map((layer, index) => Math.abs(layer.z - layers[index].z))
      .filter((height) => height > 0.01 && height < 5),
  );
  return {
    extrusionWidthMm:
      positive(metadata.extrusionWidthMm) ??
      commentMeasurement(gcode, [
        "extrusion_width",
        "line_width",
        "outer_wall_line_width",
      ]) ??
      0,
    layerHeightMm:
      positive(metadata.layerHeightMm) ??
      commentMeasurement(gcode, ["layer_height", "first_layer_height"]) ??
      inferredLayerHeight ??
      0,
  };
}

export function previewFitBounds(
  layers: GcodeLayer[],
  fallback: GcodeArtifactAnalysis["bounds"],
) {
  // Skirt and brim can be intentionally much larger than the model. Excluding
  // only those priming features keeps supports and the printable geometry in
  // frame while avoiding a tiny model in the default camera view.
  const points = layers.flatMap((layer) =>
    layer.segments.flatMap((segment, index, segments) => {
      if (
        segment.type === "travel" ||
        segment.type === "skirt" ||
        segment.type === "brim"
      ) {
        return [];
      }
      const previous = segments[index - 1];
      // The first model segment after priming starts at the skirt/brim end.
      // Keep its printable endpoint but do not let that priming coordinate
      // expand the model-focused default camera.
      return previous?.type === "skirt" || previous?.type === "brim"
        ? [segment.to]
        : [segment.from, segment.to];
    }),
  );
  if (points.length === 0) return fallback;
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
    minZ: Math.min(...points.map((point) => point.z)),
    maxZ: Math.max(...points.map((point) => point.z)),
  };
}

function fitCamera(
  preview: WebGLPreview,
  bounds: ReturnType<typeof previewFitBounds>,
  volume: BuildVolumeMm,
) {
  if (!bounds) return;
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const depth = Math.max(1, bounds.maxY - bounds.minY);
  const height = Math.max(1, bounds.maxZ - bounds.minZ);
  const radius = Math.max(width, depth, height) * 0.8 + 12;
  const target = preview.controls.target;
  target.set(
    (bounds.minX + bounds.maxX) / 2 - volume.x / 2,
    (bounds.minZ + bounds.maxZ) / 2,
    volume.y / 2 - (bounds.minY + bounds.maxY) / 2,
  );
  preview.camera.position.copy(target).addScalar(radius);
  preview.controls.minDistance = Math.max(2, radius * 0.15);
  preview.controls.maxDistance = radius * 8;
  preview.controls.update();
}

interface PreviewAdapterDependencies {
  loadPreview?: typeof loadGcodePreview;
  schedule?: () => Promise<void>;
}

export function createSlicePreviewAdapter(
  dependencies: PreviewAdapterDependencies = {},
): SlicePreviewAdapter {
  const schedule =
    dependencies.schedule ??
    (() =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const loadPreview = dependencies.loadPreview ?? loadGcodePreview;

  return {
    parse: parseGcodeLayers,
    async createRenderer({
      canvas,
      gcode,
      layers,
      analysis,
      buildVolume,
      geometry,
      options,
    }) {
      await schedule();
      const { init } = await loadPreview();
      const resolvedGeometry = previewGeometryForArtifact(
        gcode,
        layers,
        geometry,
      );
      const preview = init({
        canvas,
        buildVolume: { x: buildVolume.x, y: buildVolume.y, z: buildVolume.z },
        toolColors: TOOL_COLORS,
        backgroundColor: "#111927",
        ...GCODE_PREVIEW_TUBE_OPTIONS,
        ...(resolvedGeometry.extrusionWidthMm > 0
          ? { extrusionWidth: resolvedGeometry.extrusionWidthMm }
          : {}),
        ...(resolvedGeometry.layerHeightMm > 0
          ? { lineHeight: resolvedGeometry.layerHeightMm }
          : {}),
      });
      preview.resize();
      // The visible renderer always receives the canonical slicer artifact.
      // Classification remains analysis/trust metadata and never reconstructs
      // or changes the displayed toolpath.
      preview.processGCode(gcode);
      fitCamera(
        preview,
        previewFitBounds(layers, analysis.bounds),
        buildVolume,
      );

      const update = (next: PreviewRenderOptions) => {
        preview.startLayer = Math.max(0, next.startLayer) + 1;
        preview.endLayer = Math.max(preview.startLayer, next.endLayer + 1);
        preview.singleLayerMode = next.startLayer === next.endLayer;
        preview.renderTravel = next.showTravel;
        preview.resize();
        preview.render();
      };
      update(options);
      return { update, dispose: () => preview.dispose() };
    },
  };
}

export const phaseJPreviewAdapter = createSlicePreviewAdapter();
