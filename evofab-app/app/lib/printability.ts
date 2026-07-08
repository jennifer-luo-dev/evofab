import type { BoundingBoxMm } from "@/app/lib/slicer-client";

export interface BuildVolumeMm {
  x: number;
  y: number;
  z: number;
}

export interface BuildVolumeBlock {
  axis: keyof BuildVolumeMm;
  overageMm: number;
}

export const DEFAULT_FGF_BUILD_VOLUME: BuildVolumeMm = {
  x: 300,
  y: 300,
  z: 400,
};

export function parseBuildVolume(
  value: string | null | undefined,
): BuildVolumeMm | null {
  if (!value) return null;
  const normalized = value
    .toLowerCase()
    .replaceAll("×", "x")
    .replaceAll("mm", "");
  const parts = normalized.split("x").map((part) => Number(part.trim()));
  if (
    parts.length !== 3 ||
    parts.some((part) => !Number.isFinite(part) || part <= 0)
  ) {
    return null;
  }
  return { x: parts[0], y: parts[1], z: parts[2] };
}

export function buildVolumeBlock(
  bounds: BoundingBoxMm | null,
  buildVolume: BuildVolumeMm | null,
): BuildVolumeBlock | null {
  if (!bounds || !buildVolume) return null;
  const axes: Array<keyof BuildVolumeMm> = ["x", "y", "z"];
  const overages = axes
    .map((axis) => ({ axis, overageMm: bounds[axis] - buildVolume[axis] }))
    .filter((item) => item.overageMm > 0)
    .sort((a, b) => b.overageMm - a.overageMm);
  return overages[0] ?? null;
}
