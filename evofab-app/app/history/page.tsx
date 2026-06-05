import { createClient } from '@/app/lib/supabase-server'
import { ResultsTable } from '@/app/components/history/ResultsTable'
import { CurvatureTrendChart } from '@/app/components/results/CurvatureTrendChart'
import type { ResultWithContext } from '@/app/types/result'

const RESULT_SELECT = `
  *,
  job:jobs(
    filename,
    print_settings,
    experiment_params,
    printer:printers(name, model),
    material_profile:material_profiles(name, nozzle_temp),
    experiment:experiments(display_name)
  )
`

export default async function HistoryPage() {
  const supabase = await createClient()
  const { data: results } = await supabase
    .from('results')
    .select(RESULT_SELECT)
    .order('created_at', { ascending: false })

  const allResults = (results as ResultWithContext[]) ?? []

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-4 animate-fade-up">
      <ResultsTable results={allResults} />
      <CurvatureTrendChart results={allResults} />
    </div>
  )
}
