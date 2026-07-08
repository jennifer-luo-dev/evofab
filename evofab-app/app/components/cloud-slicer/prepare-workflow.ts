"use client";

import { useState } from "react";

export type PrepareStep = "upload" | "material" | "supports" | "slice";

export const PREPARE_STEPS: Array<{ id: PrepareStep; label: string }> = [
  { id: "upload", label: "Upload" },
  { id: "material", label: "Material" },
  { id: "supports", label: "Supports" },
  { id: "slice", label: "Slice" },
];

export const NEXT_READY_CLASS =
  "border-[var(--color-green)]/70 bg-[var(--color-green)]/10 text-[var(--color-green)] shadow-[0_0_18px_rgba(34,197,94,0.28)]";

export function usePrepareStepper() {
  const [activeStep, setActiveStep] = useState<PrepareStep>("upload");
  const [highestStepIndex, setHighestStepIndex] = useState(0);

  function goToStep(step: PrepareStep) {
    const nextIndex = PREPARE_STEPS.findIndex((item) => item.id === step);
    setActiveStep(step);
    setHighestStepIndex((current) => Math.max(current, nextIndex));
  }

  function resetPrepareSteps() {
    setActiveStep("upload");
    setHighestStepIndex(0);
  }

  return {
    activeStep,
    highestStepIndex,
    goToStep,
    resetPrepareSteps,
  };
}
