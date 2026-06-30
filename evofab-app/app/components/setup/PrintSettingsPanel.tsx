// PrintSettingsPanel.tsx
// Collapsible setup-flow panel for selecting a material profile and
// overriding individual print settings.

"use client";

import { useState } from "react";
import { cn } from "@/app/lib/utils";
import { usePrinter } from "@/app/contexts/PrinterContext";
import type { MaterialProfile, PrintSettings } from "@/app/types/job";
import { ChevronDown } from "lucide-react";

const FIELDS: {
  key: keyof PrintSettings;
  label: string;
  unit: string;
  step: string;
}[] = [
  { key: "nozzle_temp", label: "Nozzle Temp", unit: "°C", step: "1" },
  { key: "bed_temp", label: "Bed Temp", unit: "°C", step: "1" },
  { key: "speed", label: "Print Speed", unit: "mm/s", step: "1" },
  { key: "flow_rate", label: "Flow Rate", unit: "", step: "0.001" },
  { key: "fan_speed", label: "Fan Speed", unit: "%", step: "1" },
];

interface PrintSettingsPanelProps {
  materialProfiles: MaterialProfile[];
}

/** Collapsible panel for selecting a material profile and overriding print settings. */
export function PrintSettingsPanel({
  materialProfiles,
}: PrintSettingsPanelProps) {
  const [open, setOpen] = useState(false);
  const {
    settings,
    updateSetting,
    selectedMaterialProfile,
    setSelectedMaterialProfile,
  } = usePrinter();

  return (
    <section>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full text-left group"
      >
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)] group-hover:text-[var(--color-text)] transition-colors">
          Print Settings
        </h2>
        {selectedMaterialProfile && (
          <span className="text-xs text-[var(--color-teal)]">
            · {selectedMaterialProfile.name}
          </span>
        )}
        <span
          className={cn(
            "ml-auto text-[var(--color-muted)] transition-transform duration-200 text-sm",
            open && "rotate-180",
          )}
        >
          <ChevronDown />
        </span>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-4 p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] animate-fade-up">
          {materialProfiles.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] mb-2">
                Material Profile
              </p>
              <div className="flex flex-wrap gap-2">
                {materialProfiles.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedMaterialProfile(p)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                      selectedMaterialProfile?.id === p.id
                        ? "bg-[var(--color-teal-dim)] border-[var(--color-teal)] text-[var(--color-teal)]"
                        : "bg-white/5 border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border-2)]",
                    )}
                  >
                    {p.name}
                    <span className="ml-1.5 opacity-50">{p.printer_type}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] mb-2">
              Override Settings
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {FIELDS.map((field) => (
                <div key={field.key} className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                    {field.label}
                    {field.unit && (
                      <span className="ml-1 normal-case">({field.unit})</span>
                    )}
                  </label>
                  <input
                    type="number"
                    step={field.step}
                    value={settings[field.key]}
                    onChange={(e) =>
                      updateSetting(field.key, Number(e.target.value))
                    }
                    className="font-mono text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-teal)] transition-colors"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
