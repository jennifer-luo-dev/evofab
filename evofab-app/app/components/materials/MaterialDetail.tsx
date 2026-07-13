"use client";

import { useState } from "react";
import type {
  Material,
  MaterialEvent,
  MaterialStock,
} from "@/app/types/material";

type Detail = Material & {
  stock: MaterialStock[];
  events: MaterialEvent[];
  availability: string;
};

export function MaterialDetail({
  material,
  adminEnabled,
}: {
  material: Detail;
  adminEnabled: boolean;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const body = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    );
    try {
      const response = await fetch("/api/materials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Save failed");
      setMessage("Saved. Refreshing…");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }
  const unit = material.form === "resin" ? "L" : "g";
  return (
    <div className="space-y-6">
      {message && (
        <p
          role="status"
          className="rounded border border-[var(--color-border-2)] p-3 text-sm"
        >
          {message}
        </p>
      )}
      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="flex justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{material.name}</h1>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              {material.technology} · {material.form} ·{" "}
              {material.availability.replace("_", " ")}
            </p>
          </div>
          <span>{material.source_status}</span>
        </div>
        <dl className="mt-5 grid gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="text-[var(--color-muted)]">Provider</dt>
            <dd>{material.provider ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-muted)]">Chemistry</dt>
            <dd>{material.base_chemistry ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-muted)]">Hardness</dt>
            <dd>{material.nominal_hardness ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-muted)]">SDS</dt>
            <dd>
              {material.sds_url ? (
                <a className="text-[var(--color-teal)]" href={material.sds_url}>
                  Open SDS
                </a>
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>
        <pre className="mt-4 overflow-auto rounded bg-black/20 p-3 text-xs text-[var(--color-muted)]">
          {JSON.stringify(material.science, null, 2)}
        </pre>
      </section>
      <section>
        <h2 className="font-semibold">Lots</h2>
        <div className="mt-3 space-y-2">
          {material.stock.map((lot) => (
            <div
              key={lot.id}
              className="flex flex-wrap items-center gap-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm"
            >
              <span
                title={lot.color}
                className="h-4 w-4 rounded-full border border-white/20"
                style={{ backgroundColor: lot.color }}
              />
              <strong>{lot.lot_label ?? "Unlabelled lot"}</strong>
              <span>
                {lot.quantity} {lot.unit}
              </span>
              <span className="text-[var(--color-muted)]">{lot.status}</span>
              {adminEnabled && (
                <form onSubmit={submit} className="ml-auto flex gap-2">
                  <input type="hidden" name="action" value="stock" />
                  <input type="hidden" name="id" value={lot.id} />
                  <input
                    name="delta"
                    type="number"
                    step="0.001"
                    required
                    aria-label={`Adjustment for ${lot.id}`}
                    placeholder={`± ${unit}`}
                    className="w-24 rounded bg-white/5 px-2 py-1"
                  />
                  <input
                    name="note"
                    required
                    placeholder="Required note"
                    className="rounded bg-white/5 px-2 py-1"
                  />
                  <button disabled={busy} className="text-[var(--color-teal)]">
                    Adjust
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 className="font-semibold">Audit history</h2>
        <ol className="mt-3 space-y-2">
          {material.events.map((event) => (
            <li
              key={event.id}
              className="rounded border border-[var(--color-border)] p-3 text-sm"
            >
              {new Date(event.created_at).toLocaleString()} · {event.event_type}{" "}
              · {event.delta ?? "—"} {unit}
              {event.actor ? ` · ${event.actor}` : ""}
              {event.note ? ` · ${event.note}` : ""}
            </li>
          ))}
        </ol>
      </section>
      {adminEnabled && (
        <section className="grid gap-4 lg:grid-cols-2">
          <form
            onSubmit={submit}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-2"
          >
            <h2 className="font-semibold">Log intake</h2>
            <input type="hidden" name="action" value="intake" />
            <input type="hidden" name="material_id" value={material.id} />
            <input
              type="hidden"
              name="unit"
              value={
                material.form === "pellet"
                  ? "kg"
                  : material.form === "filament"
                    ? "spool"
                    : "l"
              }
            />
            <input
              name="quantity"
              type="number"
              min="0.001"
              step="0.001"
              required
              placeholder={
                material.form === "pellet"
                  ? "Bags (kg each)"
                  : material.form === "filament"
                    ? "Spools"
                    : "Liters"
              }
              className="w-full rounded bg-white/5 px-2 py-1"
            />
            {material.form === "filament" && (
              <input
                name="net_weight_grams"
                type="number"
                defaultValue="1000"
                min="0.001"
                step="0.001"
                className="w-full rounded bg-white/5 px-2 py-1"
              />
            )}
            <input
              name="color"
              required
              placeholder="Color"
              className="w-full rounded bg-white/5 px-2 py-1"
            />
            <input
              name="lot_label"
              placeholder="Lot label"
              className="w-full rounded bg-white/5 px-2 py-1"
            />
            <input
              name="location"
              placeholder="Location"
              className="w-full rounded bg-white/5 px-2 py-1"
            />
            <input
              name="actor"
              placeholder="Actor"
              className="w-full rounded bg-white/5 px-2 py-1"
            />
            <input
              name="note"
              placeholder="Note"
              className="w-full rounded bg-white/5 px-2 py-1"
            />
            <button disabled={busy} className="text-[var(--color-teal)]">
              Receive lot
            </button>
          </form>
          <form
            onSubmit={submit}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-2"
          >
            <h2 className="font-semibold">Catalog actions</h2>
            <input type="hidden" name="action" value="material" />
            <input type="hidden" name="id" value={material.id} />
            <input
              name="name"
              defaultValue={material.name}
              required
              className="w-full rounded bg-white/5 px-2 py-1"
            />
            <input
              name="provider"
              defaultValue={material.provider ?? ""}
              placeholder="Provider"
              className="w-full rounded bg-white/5 px-2 py-1"
            />
            <input
              name="sds_url"
              defaultValue={material.sds_url ?? ""}
              placeholder="SDS URL"
              className="w-full rounded bg-white/5 px-2 py-1"
            />
            <input
              type="hidden"
              name="source_status"
              value={material.source_status}
            />
            <input type="hidden" name="is_active" value="true" />
            <button disabled={busy} className="text-[var(--color-teal)]">
              Save edits
            </button>
          </form>
          <form onSubmit={submit} className="lg:col-span-2">
            <input type="hidden" name="action" value="retire" />
            <input type="hidden" name="id" value={material.id} />
            <button disabled={busy} className="text-sm text-[var(--color-red)]">
              Retire material
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
