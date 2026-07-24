// PipelineConfigContext.tsx
// Supplies the Pipelines builder's technology/action/machine configuration
// (fetched from /api/machine-types and /api/action-types) to the whole
// builder subtree, replacing the former mockData.ts TECHS/ACTIONS/MACHINES/
// TECH_LABEL constants without prop-drilling them through every component.

'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { ActionConfig, TechKey, TechOption } from './types'
import type { PrinterWithStatus } from '@/app/types/printer'
import type { MaterialProfile } from '@/app/types/job'

export interface PipelineConfig {
  techs: TechOption[]
  techLabel: Record<TechKey, string>
  actionsByTech: Partial<Record<TechKey, ActionConfig[]>>
  machinesByTech: Partial<Record<TechKey, string[]>>
  /** `machines.id` by name (names are unique — see evofab-app/supabase/schema.sql) — needed to persist a step's `pipeline_steps.machine_id`. */
  machineIdByName: Record<string, string>
  /** Active printers (with live status), used in place of `machinesByTech` for the `printer` tech's machine picker. */
  printers: PrinterWithStatus[]
  /** Material profiles, used by the embedded PrintSettingsPanel on `printer` steps. */
  materialProfiles: MaterialProfile[]
}

export const EMPTY_PIPELINE_CONFIG: PipelineConfig = {
  techs: [],
  techLabel: {} as Record<TechKey, string>,
  actionsByTech: {},
  machinesByTech: {},
  machineIdByName: {},
  printers: [],
  materialProfiles: [],
}

const PipelineConfigContext = createContext<PipelineConfig | null>(null)

/** Provides the fetched pipeline configuration to the builder subtree. */
export function PipelineConfigProvider({
  value,
  children,
}: {
  value: PipelineConfig
  children: ReactNode
}) {
  return (
    <PipelineConfigContext.Provider value={value}>{children}</PipelineConfigContext.Provider>
  )
}

/** Reads the pipeline configuration provided by the nearest `PipelineConfigProvider`. */
export function usePipelineConfig(): PipelineConfig {
  const ctx = useContext(PipelineConfigContext)
  if (!ctx) throw new Error('usePipelineConfig must be used within a PipelineConfigProvider')
  return ctx
}

/** Returns the actions available for a technology, or an empty list if none are configured. */
export function actionsForTech(config: PipelineConfig, tech: TechKey): ActionConfig[] {
  return config.actionsByTech[tech] ?? []
}
