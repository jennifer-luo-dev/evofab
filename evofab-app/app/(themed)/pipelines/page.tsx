// page.tsx (pipelines)
// Pipelines page: pick which technologies an experiment needs, then build a
// numbered, optionally-synced sequence of steps using them.

'use client';

import { useEffect, useState } from 'react';
import { PipelineBuilder } from '@/app/components/pipelines/PipelineBuilder';
import { TechSelectionGrid } from '@/app/components/pipelines/TechSelectionGrid';
import {
  EMPTY_PIPELINE_CONFIG,
  PipelineConfigProvider,
  type PipelineConfig,
} from '@/app/components/pipelines/PipelineConfigContext';
import type { ActionConfig, TechKey, TechOption } from '@/app/components/pipelines/types';
import type { PrinterWithStatus } from '@/app/types/printer';
import type { MaterialProfile } from '@/app/types/job';

interface MachineTypeApiRow {
  id: string;
  key: TechKey;
  name: string;
  machines: { id: string; name: string }[];
}

/** Fetches the technology/action/machine/printer/material configuration backing the pipeline builder from the API. */
async function fetchPipelineConfig(): Promise<PipelineConfig> {
  const [typesRes, actionsRes, printersRes, printProfilesRes] = await Promise.all([
    fetch('/api/machine-types'),
    fetch('/api/action-types'),
    fetch('/api/printers'),
    fetch('/api/print-profiles'),
  ]);
  const { machineTypes = [] }: { machineTypes: MachineTypeApiRow[] } = await typesRes.json();
  const { actionsByTech = {} }: { actionsByTech: Partial<Record<TechKey, ActionConfig[]>> } =
    await actionsRes.json();
  const { printers = [] }: { printers: PrinterWithStatus[] } = await printersRes.json();
  const { printProfiles: materialProfiles = [] }: { printProfiles: MaterialProfile[] } =
    await printProfilesRes.json();

  const techs: TechOption[] = machineTypes.map((t) => ({ id: t.id, key: t.key, name: t.name }));
  const techLabel = Object.fromEntries(techs.map((t) => [t.key, t.name])) as Record<
    TechKey,
    string
  >;
  const machinesByTech = Object.fromEntries(
    machineTypes.map((t) => [t.key, t.machines.map((m) => m.name)])
  ) as Partial<Record<TechKey, string[]>>;
  const machineIdByName = Object.fromEntries(
    machineTypes.flatMap((t) => t.machines.map((m) => [m.name, m.id]))
  ) as Record<string, string>;

  return { techs, techLabel, actionsByTech, machinesByTech, machineIdByName, printers, materialProfiles };
}

/** Technology selection followed by the pipeline step builder. */
export default function PipelinesPage() {
  const [config, setConfig] = useState<PipelineConfig>(EMPTY_PIPELINE_CONFIG);
  const [view, setView] = useState<'tech-select' | 'builder'>('tech-select');
  const [selectedTechs, setSelectedTechs] = useState<Set<TechKey>>(new Set());

  useEffect(() => {
    fetchPipelineConfig().then((loaded) => {
      setConfig(loaded);
      setSelectedTechs(new Set(loaded.techs.map((t) => t.key)));
    });
  }, []);

  function toggleTech(key: TechKey) {
    setSelectedTechs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <PipelineConfigProvider value={config}>
      {view === 'builder' ? (
        <PipelineBuilder
          selectedTechs={selectedTechs}
          onBackToTechSelect={() => setView('tech-select')}
        />
      ) : (
        <div>
          <div className="mb-5">
            <h1 className="text-xl font-semibold text-text mb-1">Select technologies</h1>
            <p className="text-[13.5px] text-muted">
              Choose which machines this experiment needs, then build the pipeline.
            </p>
          </div>

          <div className="mb-6">
            <TechSelectionGrid selected={selectedTechs} onToggle={toggleTech} />
          </div>

          <button
            type="button"
            onClick={() => setView('builder')}
            disabled={selectedTechs.size === 0}
            className="px-3.75 py-2 rounded-lg text-xs font-semibold bg-teal text-bg disabled:bg-muted disabled:cursor-not-allowed hover:cursor-pointer"
          >
            Build Pipeline
          </button>
        </div>
      )}
    </PipelineConfigProvider>
  );
}
