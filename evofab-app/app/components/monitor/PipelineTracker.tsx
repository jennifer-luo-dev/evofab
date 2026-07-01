"use client";

import { cn } from "@/app/lib/utils";
import { PIPE_STEPS } from "@/app/types/job";
import type { PipelineStepId } from "@/app/types/job";

interface PipelineTrackerProps {
  currentStep: PipelineStepId | null;
}

export function PipelineTracker({ currentStep }: PipelineTrackerProps) {
  const currentIndex = currentStep
    ? PIPE_STEPS.findIndex((s) => s.id === currentStep)
    : -1;

  return (
    <div className="p-5 rounded-xl border border-border bg-surface">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted mb-5">
        Pipeline
      </h3>
      <div className="flex items-center">
        {PIPE_STEPS.map((step, i) => {
          const done = i < currentIndex;
          const running = i === currentIndex;
          const pending = i > currentIndex;

          return (
            <div
              key={step.id}
              className="flex items-center flex-1 last:flex-none"
            >
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300",
                    done && "bg-teal text-bg",
                    running &&
                      "bg-teal/20 text-teal border-2 border-teal animate-pulse-ring",
                    pending && "bg-white/5 text-muted border border-border",
                  )}
                >
                  {done ? "✓" : running ? "●" : i + 1}
                </div>
                <div className="text-center">
                  <p
                    className={cn(
                      "text-[10px] font-medium",
                      done || running ? "text-text" : "text-muted",
                    )}
                  >
                    {step.label}
                  </p>
                  <p className="text-[9px] text-muted">{step.sub}</p>
                </div>
              </div>
              {i < PIPE_STEPS.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-px mx-1 transition-colors duration-500",
                    i < currentIndex ? "bg-teal" : "bg-border",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
