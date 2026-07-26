export type PreparationQuaternion = readonly [number, number, number, number];

/**
 * The preparation request and both model scenes use this same XYZW quaternion.
 * Invalid values are deliberately ignored rather than creating a second local
 * orientation convention for the source reference.
 */
export function preparationQuaternion(
  rotation: number[] | null | undefined,
): PreparationQuaternion | null {
  if (
    !rotation ||
    rotation.length !== 4 ||
    !rotation.every((value) => Number.isFinite(value))
  ) {
    return null;
  }
  return [rotation[0], rotation[1], rotation[2], rotation[3]];
}
