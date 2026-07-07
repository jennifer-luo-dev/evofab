import { PrintersFleetClient } from "@/app/components/printers/PrintersFleetClient";
import { PrinterOnboardingForm } from "@/app/components/printers/PrinterOnboardingForm";
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

      <PrintersFleetClient printers={printers} />

      <div className="mt-6">
        <PrinterOnboardingForm />
      </div>
    </div>
  );
}
