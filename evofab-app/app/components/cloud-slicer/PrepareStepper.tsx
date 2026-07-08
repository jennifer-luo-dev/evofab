"use client";

import { cn } from "@/app/lib/utils";
import {
  PREPARE_STEPS,
  type PrepareStep,
} from "@/app/components/cloud-slicer/prepare-workflow";

interface PrepareStepperProps {
  activeStep: PrepareStep;
  highestStepIndex: number;
  onStepSelect: (step: PrepareStep) => void;
}

export function PrepareStepper({
  activeStep,
  highestStepIndex,
  onStepSelect,
}: PrepareStepperProps) {
  return (
    <div className="mt-5 grid grid-cols-4 gap-2">
      {PREPARE_STEPS.map((step, index) => (
        <button
          key={step.id}
          type="button"
          disabled={index > highestStepIndex}
          onClick={() => onStepSelect(step.id)}
          className={cn(
            "min-h-12 rounded-md border px-2 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            activeStep === step.id
              ? "border-[var(--color-teal)] bg-[var(--color-teal)]/10 text-[var(--color-text)]"
              : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:border-[var(--color-border-2)]",
          )}
        >
          <span className="block font-mono text-[10px]">{index + 1}</span>
          <span>{step.label}</span>
        </button>
      ))}
    </div>
  );
}
