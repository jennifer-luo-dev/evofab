"use client";

import { cn } from "@/app/lib/utils";
import type { PrinterStatusType } from "@/app/types/printer";

interface StatusDotProps {
  status: PrinterStatusType;
  className?: string;
}

const statusConfig: Record<
  PrinterStatusType,
  { colorClass: string; pulse: boolean; label: string }
> = {
  idle: { colorClass: "bg-green", pulse: false, label: "Idle" },
  printing: { colorClass: "bg-amber", pulse: true, label: "Printing" },
  paused: { colorClass: "bg-amber", pulse: false, label: "Paused" },
  error: { colorClass: "bg-red", pulse: true, label: "Error" },
  offline: { colorClass: "bg-muted", pulse: false, label: "Offline" },
};

export function StatusDot({ status, className }: StatusDotProps) {
  const cfg = statusConfig[status];
  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full",
        cfg.colorClass,
        cfg.pulse && "animate-pulse-dot",
        className,
      )}
      title={cfg.label}
    />
  );
}

interface StatusBadgeProps {
  status: PrinterStatusType;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const cfg = statusConfig[status];
  const badgeColor =
    status === "idle"
      ? "bg-green/10 text-green"
      : status === "printing"
        ? "bg-amber/10 text-amber"
        : status === "paused"
          ? "bg-amber/10 text-amber"
          : status === "error"
            ? "bg-red/10 text-red"
            : "bg-white/5 text-muted";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
        badgeColor,
        className,
      )}
    >
      <StatusDot status={status} />
      {cfg.label}
    </span>
  );
}
