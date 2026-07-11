"use client";
import { useState } from "react";
import type { MaterialsSnapshot } from "@/app/types/material";

export function MaterialsManager({
  initial,
  loadError,
}: {
  initial: MaterialsSnapshot;
  loadError?: string;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [message, setMessage] = useState(loadError ?? "");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    try {
      const response = await fetch("/api/materials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const refresh = await fetch("/api/materials");
      if (!refresh.ok) throw new Error("Saved, but refresh failed");
      setSnapshot(await refresh.json());
      setMessage("Saved");
      event.currentTarget.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }
  const materialName = new Map(
    snapshot.materials.map((material) => [material.id, material.name]),
  );
  return (
    <div className="space-y-8">
      {message && (
        <div
          role="status"
          className="rounded-md border border-[var(--color-border-2)] bg-white/5 px-4 py-3 text-sm"
        >
          {message}
        </div>
      )}
      <section>
        <h2 className="text-base font-semibold">Catalog</h2>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {snapshot.materials.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">
              No catalog materials yet.
            </p>
          ) : (
            snapshot.materials.map((material) => (
              <form
                onSubmit={submit}
                key={material.id}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3"
              >
                <input type="hidden" name="action" value="material" />
                <input type="hidden" name="id" value={material.id} />
                <div className="flex justify-between gap-3">
                  <input
                    name="name"
                    defaultValue={material.name}
                    required
                    className="bg-transparent font-medium outline-none"
                  />
                  <span className="text-xs text-[var(--color-muted)]">
                    {material.technology} · {material.form}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    name="provider"
                    defaultValue={material.provider ?? ""}
                    placeholder="Provider"
                    className="rounded bg-white/5 px-2 py-1 text-sm"
                  />
                  <select
                    name="source_status"
                    defaultValue={material.source_status}
                    className="rounded bg-[var(--color-surface-2)] px-2 py-1 text-sm"
                  >
                    {["verified", "supplier", "literature", "excluded"].map(
                      (v) => (
                        <option key={v}>{v}</option>
                      ),
                    )}
                  </select>
                </div>
                <input
                  name="sds_url"
                  defaultValue={material.sds_url ?? ""}
                  placeholder="SDS URL"
                  className="w-full rounded bg-white/5 px-2 py-1 text-sm"
                />
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="is_active"
                    value="true"
                    defaultChecked={material.is_active}
                  />
                  Active
                </label>
                <button
                  disabled={busy}
                  className="text-sm text-[var(--color-teal)]"
                >
                  Save catalog row
                </button>
              </form>
            ))
          )}
        </div>
      </section>
      <section>
        <h2 className="text-base font-semibold">Stock and event history</h2>
        <div className="mt-3 space-y-3">
          {snapshot.stock.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">
              No stock recorded.
            </p>
          ) : (
            snapshot.stock.map((stock) => (
              <form
                onSubmit={submit}
                key={stock.id}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
              >
                <input type="hidden" name="action" value="stock" />
                <input type="hidden" name="id" value={stock.id} />
                <div className="flex flex-wrap items-center gap-3">
                  <strong>
                    {materialName.get(stock.material_id) ?? "Unknown"}
                  </strong>
                  <input
                    name="quantity"
                    type="number"
                    min="0"
                    step="0.001"
                    defaultValue={stock.quantity}
                    className="w-24 rounded bg-white/5 px-2 py-1"
                  />
                  <span>{stock.unit}</span>
                  <select
                    name="status"
                    defaultValue={stock.status}
                    className="rounded bg-[var(--color-surface-2)] px-2 py-1"
                  >
                    {["in_stock", "low", "depleted"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                  <input
                    name="actor"
                    placeholder="Actor"
                    className="rounded bg-white/5 px-2 py-1"
                  />
                  <input
                    name="note"
                    placeholder="Adjustment note"
                    className="min-w-52 flex-1 rounded bg-white/5 px-2 py-1"
                  />
                  <button
                    disabled={busy}
                    className="text-sm text-[var(--color-teal)]"
                  >
                    Adjust
                  </button>
                </div>
                <ul className="mt-3 space-y-1 text-xs text-[var(--color-muted)]">
                  {snapshot.events
                    .filter((e) => e.stock_id === stock.id)
                    .map((e) => (
                      <li key={e.id}>
                        {new Date(e.created_at).toLocaleString()} ·{" "}
                        {e.event_type} · {e.delta ?? "—"} ·{" "}
                        {e.actor ?? "system"}
                        {e.note ? ` · ${e.note}` : ""}
                      </li>
                    ))}
                </ul>
              </form>
            ))
          )}
        </div>
      </section>
      <section className="grid gap-6 lg:grid-cols-2">
        <form
          onSubmit={submit}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3"
        >
          <h2 className="font-semibold">Log intake</h2>
          <input type="hidden" name="action" value="intake" />
          <select
            name="material_id"
            required
            className="w-full rounded bg-[var(--color-surface-2)] px-2 py-2"
          >
            <option value="">Choose material</option>
            {snapshot.materials
              .filter((m) => m.is_active)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
          <div className="flex gap-2">
            <input
              name="quantity"
              type="number"
              min="0.001"
              step="0.001"
              required
              placeholder="Quantity"
              className="w-full rounded bg-white/5 px-2 py-2"
            />
            <select
              name="unit"
              className="rounded bg-[var(--color-surface-2)] px-2"
            >
              {["spool", "kg", "l", "unit"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
          {["lot_label", "location", "actor", "note"].map((v) => (
            <input
              key={v}
              name={v}
              placeholder={v.replace("_", " ")}
              className="w-full rounded bg-white/5 px-2 py-2"
            />
          ))}
          <button disabled={busy} className="text-sm text-[var(--color-teal)]">
            Create stock and audit event
          </button>
        </form>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h2 className="font-semibold">Profile bindings</h2>
          <div className="mt-3 space-y-3">
            {snapshot.profiles.map((profile) => (
              <form
                onSubmit={submit}
                key={profile.id}
                className="flex items-center gap-2"
              >
                <input type="hidden" name="action" value="profile" />
                <input type="hidden" name="id" value={profile.id} />
                <span className="w-40 text-sm">{profile.name}</span>
                <select
                  name="material_id"
                  defaultValue={profile.material_id ?? ""}
                  className="min-w-0 flex-1 rounded bg-[var(--color-surface-2)] px-2 py-1"
                >
                  <option value="">Unbound</option>
                  {snapshot.materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <button
                  disabled={busy}
                  className="text-sm text-[var(--color-teal)]"
                >
                  Bind
                </button>
              </form>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
