"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/app/lib/utils";
import type { ResultWithContext } from "@/app/types/result";

interface ResultsTableProps {
  results: ResultWithContext[];
}

export function ResultsTable({ results }: ResultsTableProps) {
  const router = useRouter();

  function exportAllCSV() {
    if (!results.length) return;
    const headers = [
      "job_id",
      "printer",
      "material",
      "nozzle_temp",
      "cycles",
      "pressure_kpa",
      "curvature_before",
      "curvature_after",
      "delta",
      "delta_pct",
      "confidence",
      "passed",
      "created_at",
    ];
    const rows = results.map((r) => [
      r.job_id,
      r.job?.printer?.name ?? "",
      r.job?.material_profile?.name ?? "",
      r.job?.print_settings?.nozzle_temp ?? "",
      r.job?.experiment_params?.cycles ?? "",
      r.job?.experiment_params?.pressure_kpa ?? "",
      r.curvature_before ?? "",
      r.curvature_after ?? "",
      r.delta ?? "",
      r.delta_pct ?? "",
      r.confidence ?? "",
      r.passed ?? "",
      r.created_at,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "evofab-all-results.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-5 rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">
          All Results
        </h3>
        <button
          onClick={exportAllCSV}
          disabled={!results.length}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted hover:text-text hover:border-border-2 transition-all disabled:opacity-30"
        >
          Export All CSV
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              {[
                "#",
                "Printer",
                "Material",
                "Nozzle (°C)",
                "Before (mm⁻¹)",
                "After (mm⁻¹)",
                "Δ",
                "Δ %",
                "Confidence",
                "Timestamp",
              ].map((col) => (
                <th
                  key={col}
                  className="pb-2 pr-4 text-left text-[10px] uppercase tracking-wider text-muted font-medium whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-8 text-center text-muted">
                  No results yet
                </td>
              </tr>
            ) : (
              results.map((r, i) => {
                const delta = r.delta ?? 0;
                const isPositive = delta >= 0;
                const pct =
                  r.delta_pct !== null
                    ? `${r.delta_pct >= 0 ? "+" : ""}${Number(r.delta_pct).toFixed(1)}%`
                    : "—";

                return (
                  <tr
                    key={r.id}
                    onClick={() => router.push(`/results/${r.job_id}`)}
                    className="border-b border-border hover:bg-white/2 cursor-pointer transition-colors"
                  >
                    <td className="py-2.5 pr-4 font-mono text-muted">
                      {i + 1}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-text">
                      {r.job?.printer?.name ?? "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-muted">
                      {r.job?.material_profile?.name ?? "—"}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-text">
                      {r.job?.print_settings?.nozzle_temp ?? "—"}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-blue">
                      {r.curvature_before?.toFixed(4) ?? "—"}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-teal">
                      {r.curvature_after?.toFixed(4) ?? "—"}
                    </td>
                    <td
                      className={cn(
                        "py-2.5 pr-4 font-mono",
                        isPositive ? "text-green" : "text-red",
                      )}
                    >
                      {isPositive ? "+" : ""}
                      {delta.toFixed(4)}
                    </td>
                    <td
                      className={cn(
                        "py-2.5 pr-4 font-mono",
                        isPositive ? "text-green" : "text-red",
                      )}
                    >
                      {pct}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-muted">
                      {r.confidence !== null
                        ? `${(Number(r.confidence) * 100).toFixed(0)}%`
                        : "—"}
                    </td>
                    <td className="py-2.5 font-mono text-muted whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
