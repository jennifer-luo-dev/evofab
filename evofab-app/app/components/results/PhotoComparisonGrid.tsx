import type { ResultRecord } from "@/app/types/result";

interface PhotoComparisonGridProps {
  result: ResultRecord;
  supabaseUrl?: string;
}

function resolveImageUrl(
  key: string | null,
  supabaseUrl?: string,
): string | null {
  if (!key) return null;
  if (key.startsWith("http")) return key;
  // Treat as Supabase Storage path in the "results" bucket
  return supabaseUrl
    ? `${supabaseUrl}/storage/v1/object/public/results/${key}`
    : null;
}

export function PhotoComparisonGrid({
  result,
  supabaseUrl,
}: PhotoComparisonGridProps) {
  const beforeUrl = resolveImageUrl(result.before_image_key, supabaseUrl);
  const afterUrl = resolveImageUrl(result.after_image_key, supabaseUrl);
  const before = result.curvature_before ?? 0;
  const after = result.curvature_after ?? 0;

  return (
    <div className="p-5 rounded-xl border border-border bg-surface">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted mb-4">
        Photo Comparison
      </h3>
      <div className="grid grid-cols-2 gap-4">
        {[
          {
            label: "Before",
            url: beforeUrl,
            curvature: before,
            colorVar: "var(--color-blue)",
          },
          {
            label: "After",
            url: afterUrl,
            curvature: after,
            colorVar: "var(--color-teal)",
          },
        ].map((item) => (
          <div key={item.label} className="flex flex-col gap-2">
            <div
              className="relative w-full bg-surface-2 rounded-lg overflow-hidden border border-border"
              style={{ aspectRatio: "4/3" }}
            >
              {item.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.url}
                  alt={`${item.label} characterization`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs text-muted font-mono">No image</span>
                </div>
              )}
              <div
                className="absolute bottom-2 right-2 px-2 py-0.5 rounded text-[10px] font-mono font-bold"
                style={{
                  backgroundColor: `color-mix(in srgb, ${item.colorVar} 20%, transparent)`,
                  color: item.colorVar,
                }}
              >
                κ = {item.curvature.toFixed(4)}
              </div>
            </div>
            <p className="text-xs text-muted text-center uppercase tracking-wider">
              {item.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
