import {
  parseGcodeLayers,
  type GcodeLayer,
} from "@/app/lib/gcode-layer-parser";

export interface SlicePreviewAdapter {
  parse(gcode: string): GcodeLayer[];
  render(): void;
}

// v0.6 swaps this adapter for gcode-preview; keep Phase J parser internals unchanged here.
export const phaseJPreviewAdapter: SlicePreviewAdapter = {
  parse: parseGcodeLayers,
  render() {
    return undefined;
  },
};
