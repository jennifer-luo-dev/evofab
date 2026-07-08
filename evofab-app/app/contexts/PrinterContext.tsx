"use client";

import { createContext, useContext, useState, ReactNode } from "react";
import type { PrinterWithStatus } from "@/app/types/printer";
import type {
  PrintSettings,
  MaterialProfile,
  Experiment,
  ExperimentParams,
} from "@/app/types/job";
import {
  EMPTY_PRINT_SETTINGS,
  settingsFromMaterialProfile,
} from "@/app/lib/material-profiles";

interface PrinterContextValue {
  selectedPrinter: PrinterWithStatus | null;
  settings: PrintSettings;
  uploadedFile: File | null;
  selectedMaterialProfile: MaterialProfile | null;
  selectedExperiment: Experiment | null;
  experimentParams: ExperimentParams;
  setSelectedPrinter: (printer: PrinterWithStatus | null) => void;
  updateSetting: (key: keyof PrintSettings, value: number) => void;
  setSelectedMaterialProfile: (profile: MaterialProfile | null) => void;
  setSelectedExperiment: (exp: Experiment | null) => void;
  updateExperimentParam: (key: string, value: unknown) => void;
  setUploadedFile: (file: File | null) => void;
  resetSetup: () => void;
}

const PrinterContext = createContext<PrinterContextValue | null>(null);

export function PrinterProvider({ children }: { children: ReactNode }) {
  const [selectedPrinter, setSelectedPrinter] =
    useState<PrinterWithStatus | null>(null);
  const [settings, setSettings] = useState<PrintSettings>(EMPTY_PRINT_SETTINGS);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [selectedMaterialProfile, _setSelectedMaterialProfile] =
    useState<MaterialProfile | null>(null);
  const [selectedExperiment, _setSelectedExperiment] =
    useState<Experiment | null>(null);
  const [experimentParams, setExperimentParams] = useState<ExperimentParams>(
    {},
  );

  const updateSetting = (key: keyof PrintSettings, value: number) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const setSelectedMaterialProfile = (profile: MaterialProfile | null) => {
    _setSelectedMaterialProfile(profile);
    if (profile) {
      setSettings(settingsFromMaterialProfile(profile));
    }
  };

  const setSelectedExperiment = (exp: Experiment | null) => {
    _setSelectedExperiment(exp);
    setExperimentParams(exp ? { ...exp.default_params } : {});
  };

  const updateExperimentParam = (key: string, value: unknown) => {
    setExperimentParams((prev) => ({ ...prev, [key]: value }));
  };

  const resetSetup = () => {
    setSelectedPrinter(null);
    setSettings(EMPTY_PRINT_SETTINGS);
    setUploadedFile(null);
    _setSelectedMaterialProfile(null);
    _setSelectedExperiment(null);
    setExperimentParams({});
  };

  return (
    <PrinterContext.Provider
      value={{
        selectedPrinter,
        settings,
        uploadedFile,
        selectedMaterialProfile,
        selectedExperiment,
        experimentParams,
        setSelectedPrinter,
        updateSetting,
        setSelectedMaterialProfile,
        setSelectedExperiment,
        updateExperimentParam,
        setUploadedFile,
        resetSetup,
      }}
    >
      {children}
    </PrinterContext.Provider>
  );
}

export function usePrinter(): PrinterContextValue {
  const ctx = useContext(PrinterContext);
  if (!ctx) throw new Error("usePrinter must be used inside PrinterProvider");
  return ctx;
}
