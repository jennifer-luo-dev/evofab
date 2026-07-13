import { MaterialsDashboard } from "@/app/components/materials/MaterialsDashboard";
import { getMaterialDashboardItems } from "@/app/lib/materials-source";

export default async function MaterialsPage() {
  const items = await getMaterialDashboardItems();
  return (
    <main className="mx-auto max-w-6xl px-6 py-8 animate-fade-up">
      <div className="mb-7">
        <h1 className="text-lg font-semibold">Materials</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Verified materials and physical inventory
        </p>
      </div>
      <MaterialsDashboard items={items} />
    </main>
  );
}
