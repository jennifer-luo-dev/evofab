import type { GCodePreviewOptions } from "gcode-preview";

export const GCODE_PREVIEW_TUBE_OPTIONS: Pick<
  GCodePreviewOptions,
  "renderTubes" | "renderTravel" | "disableGradient"
> = {
  renderTubes: true,
  renderTravel: false,
  disableGradient: true,
};

export async function loadGcodePreview() {
  return import("gcode-preview");
}
