import { createClient } from '@/app/lib/supabase-server'
import { getActivePrintersWithStatus } from '@/app/lib/printer-status-source'
import { PrinterGrid } from '@/app/components/setup/PrinterGrid'
import { PrintSettingsPanel } from '@/app/components/setup/PrintSettingsPanel'
import { ExperimentPanel } from '@/app/components/setup/ExperimentPanel'
import { FileUploadZone } from '@/app/components/setup/FileUploadZone'
import { SubmitControls } from '@/app/components/setup/SubmitControls'
import type { MaterialProfile, Experiment } from '@/app/types/job'

export default async function SetupPage() {
  const supabase = await createClient()

  const [printersWithStatus, { data: materialProfiles }, { data: experiments }] =
    await Promise.all([
      getActivePrintersWithStatus(),
      supabase.from('material_profiles').select('*').order('name'),
      supabase.from('experiments').select('*').order('name'),
    ])

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-8 animate-fade-up">
      <PrinterGrid printers={printersWithStatus} />
      <ExperimentPanel experiments={(experiments as Experiment[]) ?? []} />
      <PrintSettingsPanel materialProfiles={(materialProfiles as MaterialProfile[]) ?? []} />
      <FileUploadZone />
      <SubmitControls />
    </div>
  )
}
