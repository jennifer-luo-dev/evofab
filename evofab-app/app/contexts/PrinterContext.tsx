'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import type { PrinterWithStatus } from '@/app/types/printer'
import type { PrintSettings, MaterialProfile, Experiment, ExperimentParams } from '@/app/types/job'

const DEFAULT_SETTINGS: PrintSettings = {
  nozzle_temp: 200,
  bed_temp: 60,
  speed: 40,
  flow_rate: 0.940,
  fan_speed: 0,
}

interface PrinterContextValue {
  selectedPrinter: PrinterWithStatus | null
  settings: PrintSettings
  uploadedFile: File | null
  selectedMaterialProfile: MaterialProfile | null
  selectedExperiment: Experiment | null
  experimentParams: ExperimentParams
  setSelectedPrinter: (printer: PrinterWithStatus | null) => void
  updateSetting: (key: keyof PrintSettings, value: number) => void
  applySettings: (overrides: Partial<PrintSettings>) => void
  setSelectedMaterialProfile: (profile: MaterialProfile | null) => void
  setSelectedExperiment: (exp: Experiment | null) => void
  updateExperimentParam: (key: string, value: unknown) => void
  setUploadedFile: (file: File | null) => void
  resetSetup: () => void
}

const PrinterContext = createContext<PrinterContextValue | null>(null)

/** Provides printer selection, print settings, and experiment configuration to the component tree. */
export function PrinterProvider({ children }: { children: ReactNode }) {
  const [selectedPrinter, setSelectedPrinter] = useState<PrinterWithStatus | null>(null)
  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_SETTINGS)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [selectedMaterialProfile, _setSelectedMaterialProfile] = useState<MaterialProfile | null>(null)
  const [selectedExperiment, _setSelectedExperiment] = useState<Experiment | null>(null)
  const [experimentParams, setExperimentParams] = useState<ExperimentParams>({})

  const updateSetting = (key: keyof PrintSettings, value: number) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  /** Merges a partial PrintSettings override into the current settings. */
  const applySettings = useCallback((overrides: Partial<PrintSettings>) => {
    setSettings((prev) => ({ ...prev, ...overrides }))
  }, [])

  /** Selects a material profile and overwrites all PrintSettings with its values. */
  const setSelectedMaterialProfile = (profile: MaterialProfile | null) => {
    _setSelectedMaterialProfile(profile)
    if (profile) {
      setSettings({
        nozzle_temp: profile.nozzle_temp,
        bed_temp: profile.bed_temp,
        speed: profile.speed,
        flow_rate: profile.flow_rate,
        fan_speed: profile.fan_speed,
      })
    }
  }

  /** Selects an experiment and resets experimentParams to that experiment's defaults. */
  const setSelectedExperiment = (exp: Experiment | null) => {
    _setSelectedExperiment(exp)
    setExperimentParams(exp ? { ...exp.default_params } : {})
  }

  const updateExperimentParam = (key: string, value: unknown) => {
    setExperimentParams((prev) => ({ ...prev, [key]: value }))
  }

  /** Resets all setup state (printer, settings, file, material, experiment) back to defaults. */
  const resetSetup = () => {
    setSelectedPrinter(null)
    setSettings(DEFAULT_SETTINGS)
    setUploadedFile(null)
    _setSelectedMaterialProfile(null)
    _setSelectedExperiment(null)
    setExperimentParams({})
  }

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
        applySettings,
        setSelectedMaterialProfile,
        setSelectedExperiment,
        updateExperimentParam,
        setUploadedFile,
        resetSetup,
      }}
    >
      {children}
    </PrinterContext.Provider>
  )
}

/** Returns the printer setup context from the nearest PrinterProvider. Throws outside one. */
export function usePrinter(): PrinterContextValue {
  const ctx = useContext(PrinterContext)
  if (!ctx) throw new Error('usePrinter must be used inside PrinterProvider')
  return ctx
}
