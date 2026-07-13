"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { MaterialDashboardItem } from "@/app/types/material";

const states = ["all", "in_stock", "low", "depleted"] as const;

export function MaterialsDashboard({
  items,
}: {
  items: MaterialDashboardItem[];
}) {
  const [query, setQuery] = useState("");
  const [technology, setTechnology] = useState("all");
  const [hardness, setHardness] = useState("all");
  const [availability, setAvailability] =
    useState<(typeof states)[number]>("all");
  const hardnesses = [
    ...new Set(items.map((item) => item.nominal_hardness).filter(Boolean)),
  ];
  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          item.name.toLowerCase().includes(query.toLowerCase()) &&
          (technology === "all" || item.technology === technology) &&
          (hardness === "all" || item.nominal_hardness === hardness) &&
          (availability === "all" || item.availability === availability),
      ),
    [availability, hardness, items, query, technology],
  );
  return (
    <div className="space-y-5">
      <div className="grid gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 md:grid-cols-4">
        <input
          aria-label="Search materials"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search materials"
          className="rounded bg-white/5 px-3 py-2 text-sm"
        />
        <select
          aria-label="Technology"
          value={technology}
          onChange={(event) => setTechnology(event.target.value)}
          className="rounded bg-[var(--color-surface-2)] px-3 py-2 text-sm"
        >
          <option value="all">All technologies</option>
          {["FDM", "FGF", "SLA"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Hardness"
          value={hardness}
          onChange={(event) => setHardness(event.target.value)}
          className="rounded bg-[var(--color-surface-2)] px-3 py-2 text-sm"
        >
          <option value="all">All hardnesses</option>
          {hardnesses.map((value) => (
            <option key={value!}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Availability"
          value={availability}
          onChange={(event) =>
            setAvailability(event.target.value as (typeof states)[number])
          }
          className="rounded bg-[var(--color-surface-2)] px-3 py-2 text-sm"
        >
          <option value="all">All availability</option>
          {states.slice(1).map((value) => (
            <option key={value}>{value.replace("_", " ")}</option>
          ))}
        </select>
      </div>
      <p className="text-sm text-[var(--color-muted)]">
        {filtered.length} materials
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((item) => (
          <Link
            key={item.id}
            href={`/materials/${item.slug}`}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition hover:border-[var(--color-teal)]"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-semibold">{item.name}</h2>
              <span className="rounded bg-[var(--color-surface-2)] px-2 py-1 text-xs">
                {item.technology}
              </span>
            </div>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              {item.form} · {item.nominal_hardness ?? "Hardness not listed"}
            </p>
            <p
              className={`mt-3 text-sm ${item.availability === "depleted" ? "text-[var(--color-red)]" : item.availability === "low" ? "text-[var(--color-amber)]" : "text-[var(--color-green)]"}`}
            >
              {item.availability.replace("_", " ")}
            </p>
            <div aria-label="Lot colors" className="mt-3 flex gap-1">
              {item.colors.length ? (
                item.colors.map((color) => (
                  <span
                    key={color}
                    title={color}
                    className="h-4 w-4 rounded-full border border-white/20"
                    style={{ backgroundColor: color }}
                  />
                ))
              ) : (
                <span className="text-xs text-[var(--color-muted)]">
                  No lot colors
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
