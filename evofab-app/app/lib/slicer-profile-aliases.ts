const DASHBOARD_TO_SLICER_PROFILE_ID: Record<string, string> = {
  "pla-fgf": "pla-virgin-3mm",
};

export function resolveSlicerProfileId(profileId: string): string {
  return DASHBOARD_TO_SLICER_PROFILE_ID[profileId] ?? profileId;
}
