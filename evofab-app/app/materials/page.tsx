import { notFound } from "next/navigation";
import { MaterialsManager } from "@/app/components/materials/MaterialsManager";
import { isMaterialsAdminEnabled } from "@/app/lib/materials-admin";
import { getMaterialsSnapshot } from "@/app/lib/materials-source";
import type { MaterialsSnapshot } from "@/app/types/material";

const empty: MaterialsSnapshot = {
  materials: [],
  stock: [],
  events: [],
  profiles: [],
};
export default async function MaterialsPage() {
  if (!isMaterialsAdminEnabled()) notFound();
  let snapshot = empty;
  let error: string | undefined;
  try {
    snapshot = await getMaterialsSnapshot();
  } catch (caught) {
    error =
      caught instanceof Error ? caught.message : "Unable to load materials";
  }
  return (
    <main className="mx-auto max-w-6xl px-6 py-8 animate-fade-up">
      <div className="mb-7">
        <h1 className="text-lg font-semibold">Materials</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Catalog, physical stock, audit history, and operational profile
          bindings
        </p>
        <p className="mt-2 text-xs text-[var(--color-amber)]">
          Temporary access boundary: private dashboard deployment. User-level
          authorization is not implemented.
        </p>
      </div>
      <MaterialsManager initial={snapshot} loadError={error} />
    </main>
  );
}
