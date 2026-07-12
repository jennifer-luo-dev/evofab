/**
 * Deployment-level gate for the Materials admin surface.
 * When MATERIALS_ADMIN_ENABLED is not "true", the /materials page returns 404
 * and all mutation API handlers return 404. Read-only catalog/stock queries
 * remain ungated so the Step 4 picker can consume them.
 *
 * This is NOT user auth — auth/roles/RLS are parked (DECIDED-4).
 */
export function isMaterialsAdminEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.MATERIALS_ADMIN_ENABLED === "true";
}
