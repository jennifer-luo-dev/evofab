import { ProgressBar } from "@/app/components/ui/ProgressBar";
import { MetricBox } from "@/app/components/ui/MetricBox";
import type { PrinterStatus } from "@/app/types/printer";

interface PrinterMetricsCardProps {
  printerName: string;
  jobProgress: number;
  layerCurrent: number | null;
  layerTotal: number | null;
  printerStatus: PrinterStatus | null;
}

function formatEta(seconds: number | null): string {
  if (seconds === null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function PrinterMetricsCard({
  printerName,
  jobProgress,
  layerCurrent,
  layerTotal,
  printerStatus,
}: PrinterMetricsCardProps) {
  return (
    <div className="p-5 rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">
          Printer
        </h3>
        <span className="font-mono text-xs text-teal">{printerName}</span>
      </div>

      <div className="mb-5 flex items-center gap-5">
        <div className="relative w-24 h-24 shrink-0">
          <svg className="-rotate-90" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="rgba(255,255,255,.06)"
              strokeWidth="8"
            />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="#00D4B4"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${Math.min(jobProgress, 100) * 2.638} 264`}
            />
          </svg>
          <span className="absolute inset-0 grid place-items-center font-mono text-xl font-semibold">
            {jobProgress.toFixed(0)}%
          </span>
        </div>
        <div className="flex-1">
          <p className="text-xs text-muted">Active fabrication</p>
          {layerCurrent !== null && layerTotal !== null && (
            <p className="text-lg font-mono mt-1">
              Layer {layerCurrent}{" "}
              <span className="text-muted text-sm">/ {layerTotal}</span>
            </p>
          )}
          <div className="mt-3">
            <ProgressBar value={jobProgress} height="md" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <MetricBox
          label="Hotend"
          value={printerStatus?.hotend_temp?.toFixed(1) ?? "—"}
          unit="°C"
        />
        <MetricBox
          label="Bed"
          value={printerStatus?.bed_temp?.toFixed(1) ?? "—"}
          unit="°C"
        />
        <MetricBox
          label="ETA"
          value={formatEta(printerStatus?.eta_seconds ?? null)}
        />
      </div>
    </div>
  );
}
