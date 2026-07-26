import type { WebGLPreview } from "gcode-preview";
import type { GcodeArtifactAnalysis } from "@/app/lib/gcode-artifact-analysis";
import {
  parseGcodeLayers,
  type GcodeLayer,
  type GcodeLineType,
} from "@/app/lib/gcode-layer-parser";
import {
  GCODE_PREVIEW_TUBE_OPTIONS,
  loadGcodePreview,
} from "@/app/lib/gcode-preview-adapter";
import type { BuildVolumeMm } from "@/app/lib/printability";

const TOOL_FOR_TYPE: Record<GcodeLineType, number> = {
  external_perimeter: 0,
  outer_wall: 0,
  perimeter: 1,
  inner_wall: 1,
  infill: 2,
  sparse_infill: 2,
  support: 3,
  top_surface: 4,
  unknown: 5,
  travel: 6,
};

const TOOL_COLORS = {
  0: "#ff8a3d",
  1: "#ffde59",
  2: "#c53030",
  3: "#22c55e",
  4: "#ff4141",
  5: "#e5e7eb",
  6: "#64748b",
};

export interface PreviewRenderOptions {
  startLayer: number;
  endLayer: number;
  showTravel: boolean;
}

export interface SlicePreviewRenderer {
  update(options: PreviewRenderOptions): void;
  dispose(): void;
}

export interface SlicePreviewAdapter {
  parse(gcode: string): GcodeLayer[];
  createRenderer(input: {
    canvas: HTMLCanvasElement;
    layers: GcodeLayer[];
    analysis: GcodeArtifactAnalysis;
    buildVolume: BuildVolumeMm;
    options: PreviewRenderOptions;
  }): Promise<SlicePreviewRenderer>;
}

/**
 * gcode-preview does the production WebGL/tube work. The Phase J parser only
 * provides stable feature classification and an equivalent renderer input; it
 * is never used as a source of slice metadata.
 */
export function visualizationGcode(layers: GcodeLayer[]): string {
  const lines = ["; EvoFab Preview V2 visualization", "M83"];
  let activeTool = -1;
  for (const layer of layers) {
    lines.push(`;LAYER:${layer.index}`, `G0 Z${layer.z.toFixed(4)}`);
    for (const segment of layer.segments) {
      if (segment.type === "travel") {
        lines.push(
          `G0 X${segment.to.x.toFixed(4)} Y${segment.to.y.toFixed(4)} Z${segment.to.z.toFixed(4)}`,
        );
        continue;
      }
      const tool = TOOL_FOR_TYPE[segment.type];
      if (tool !== activeTool) {
        lines.push(`T${tool}`);
        activeTool = tool;
      }
      lines.push(
        `G0 X${segment.from.x.toFixed(4)} Y${segment.from.y.toFixed(4)} Z${segment.from.z.toFixed(4)}`,
        `G1 X${segment.to.x.toFixed(4)} Y${segment.to.y.toFixed(4)} Z${segment.to.z.toFixed(4)} E0.1000`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function fitCamera(
  preview: WebGLPreview,
  analysis: GcodeArtifactAnalysis,
  volume: BuildVolumeMm,
) {
  const bounds = analysis.bounds;
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

export const phaseJPreviewAdapter: SlicePreviewAdapter = {
  parse: parseGcodeLayers,
  async createRenderer({ canvas, layers, analysis, buildVolume, options }) {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    const { init } = await loadGcodePreview();
    const preview = init({
      canvas,
      buildVolume: { x: buildVolume.x, y: buildVolume.y, z: buildVolume.z },
      toolColors: TOOL_COLORS,
      extrusionWidth: 0.45,
      lineHeight: 0.2,
      backgroundColor: "#111927",
      ...GCODE_PREVIEW_TUBE_OPTIONS,
    });
    preview.resize();
    preview.processGCode(visualizationGcode(layers));
    fitCamera(preview, analysis, buildVolume);

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
