import { notFound } from "next/navigation";
import { MaterialsManager } from "@/app/components/materials/MaterialsManager";
import { isMaterialsAdminEnabled } from "@/app/lib/materials-admin";
import { getMaterialsSnapshot } from "@/app/lib/materials-source";

export default async function MaterialsAdminPage() {
  if (!isMaterialsAdminEnabled()) notFound();
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="mb-6 text-lg font-semibold">Materials admin</h1>
      <MaterialsManager initial={await getMaterialsSnapshot()} />
    </main>
  );
}
