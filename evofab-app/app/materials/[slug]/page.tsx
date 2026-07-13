import { notFound } from "next/navigation";
import { MaterialDetail } from "@/app/components/materials/MaterialDetail";
import { isMaterialsAdminEnabled } from "@/app/lib/materials-admin";
import { getMaterialBySlug } from "@/app/lib/materials-source";

export default async function MaterialPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const material = await getMaterialBySlug((await params).slug);
  if (!material) notFound();
  return (
    <main className="mx-auto max-w-5xl px-6 py-8 animate-fade-up">
      <MaterialDetail
        material={material}
        adminEnabled={isMaterialsAdminEnabled()}
      />
    </main>
  );
}
