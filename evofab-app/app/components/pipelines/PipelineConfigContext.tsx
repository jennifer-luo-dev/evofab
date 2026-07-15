// PipelineConfigContext.tsx
// Supplies the Pipelines builder's technology/action/machine configuration
// (fetched from /api/machine-types and /api/action-types) to the whole
// builder subtree, replacing the former mockData.ts TECHS/ACTIONS/MACHINES/
// TECH_LABEL constants without prop-drilling them through every component.

'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { ActionConfig, TechKey, TechOption } from './types'

export interface PipelineConfig {
  techs: TechOption[]
  techLabel: Record<TechKey, string>
  actionsByTech: Partial<Record<TechKey, ActionConfig[]>>
  machinesByTech: Partial<Record<TechKey, string[]>>
}

export const EMPTY_PIPELINE_CONFIG: PipelineConfig = {
  techs: [],
  techLabel: {} as Record<TechKey, string>,
  actionsByTech: {},
  machinesByTech: {},
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
