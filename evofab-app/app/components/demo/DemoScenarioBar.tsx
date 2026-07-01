"use client";

import { useState } from "react";

const SCENARIOS = [
  { id: "ready", label: "Ready", dot: "bg-green" },
  { id: "printing", label: "Printing", dot: "bg-amber" },
  { id: "paused", label: "Paused", dot: "bg-amber" },
  { id: "offline", label: "Offline", dot: "bg-muted" },
  { id: "shutdown", label: "MCU Fault", dot: "bg-red" },
];

export function DemoScenarioBar({ compact = false }: { compact?: boolean }) {
  const [active, setActive] = useState("ready");
  const [loading, setLoading] = useState(false);

  async function choose(scenario: string) {
    setLoading(true);
    const response = await fetch("/api/demo/scenario", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario }),
    });
    if (response.ok) setActive(scenario);
    setLoading(false);
  }

  return (
    <div
      className={`rounded-2xl border border-teal/20 bg-gradient-to-r from-teal/10 via-surface to-blue/5 ${compact ? "p-3" : "p-4"}`}
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-teal font-semibold">
            Demo control
          </p>
          {!compact && (
            <p className="text-xs text-muted mt-1">
              Switch printer state instantly—no hardware required.
            </p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {SCENARIOS.map((scenario) => (
            <button
              key={scenario.id}
              disabled={loading}
              onClick={() => choose(scenario.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs border transition-all ${active === scenario.id ? "border-teal/60 bg-teal/15 text-text shadow-[0_0_20px_rgba(0,212,180,.08)]" : "border-border bg-black/10 text-muted hover:text-text hover:border-border-2"}`}
            >
              <span className={`w-2 h-2 rounded-full ${scenario.dot}`} />
              {scenario.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
