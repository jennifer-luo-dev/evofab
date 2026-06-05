import { notFound } from 'next/navigation'
import { createClient } from '@/app/lib/supabase-server'
import { JobMetadataHeader } from '@/app/components/results/JobMetadataHeader'
import { CurvatureAnalysisCard } from '@/app/components/results/CurvatureAnalysisCard'
import { PhotoComparisonGrid } from '@/app/components/results/PhotoComparisonGrid'
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

interface Props {
  params: Promise<{ jobId: string }>
}

export default async function ResultsPage({ params }: Props) {
  const { jobId } = await params
  const supabase = await createClient()

  const [{ data: result }, { data: allResults }] = await Promise.all([
    supabase.from('results').select(RESULT_SELECT).eq('job_id', jobId).single(),
    supabase.from('results').select(RESULT_SELECT).order('created_at'),
  ])

  if (!result) notFound()

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-4 animate-fade-up">
      <JobMetadataHeader result={result as ResultWithContext} />
      <CurvatureAnalysisCard result={result as ResultWithContext} />
      <PhotoComparisonGrid result={result as ResultWithContext} supabaseUrl={supabaseUrl} />
      <CurvatureTrendChart results={(allResults as ResultWithContext[]) ?? []} />
    </div>
  )
}
