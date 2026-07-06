import { StatusDot } from "@/app/components/ui/StatusDot";
import { getActivePrintersWithStatus } from "@/app/lib/printer-status-source";

export default async function PrintersPage() {
  const printers = await getActivePrintersWithStatus();

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 animate-fade-up">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text)]">
            Printers
          </h1>
          <p className="text-sm text-[var(--color-muted)] mt-1">
            Fleet status from Supabase telemetry
          </p>
        </div>
        <span className="rounded-md bg-white/5 px-2.5 py-1 text-xs font-mono text-[var(--color-muted)]">
          {printers.length} active
        </span>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {printers.map((printer) => {
          const status = printer.printer_status;

          return (
            <section
              key={printer.id}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--color-text)]">
                    {printer.name}
                  </h2>
                  <p className="mt-1 text-xs font-mono text-[var(--color-muted)]">
                    {printer.model}
                  </p>
                </div>
                <StatusDot status={status?.status ?? "offline"} />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                    Hotend
                  </p>
                  <p className="mt-1 font-mono text-sm text-[var(--color-text)]">
                    {status?.hotend_temp != null
                      ? `${status.hotend_temp.toFixed(1)}°C`
                      : "—"}
                  </p>
                </div>
                <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                    Bed
                  </p>
                  <p className="mt-1 font-mono text-sm text-[var(--color-text)]">
                    {status?.bed_temp != null
                      ? `${status.bed_temp.toFixed(1)}°C`
                      : "—"}
                  </p>
                </div>
                <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                    Progress
                  </p>
                  <p className="mt-1 font-mono text-sm text-[var(--color-text)]">
                    {status ? `${status.progress.toFixed(1)}%` : "—"}
                  </p>
                </div>
                <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                    Address
                  </p>
                  <p className="mt-1 truncate font-mono text-sm text-[var(--color-text)]">
                    {printer.ip}:{printer.port}
                  </p>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
