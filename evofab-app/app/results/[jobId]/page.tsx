import { createClient } from '@/app/lib/supabase-server'
import { ResultsEmptyState } from '@/app/components/results/ResultsEmptyState'
import { JobMetadataHeader } from '@/app/components/results/JobMetadataHeader'
import { CurvatureAnalysisCard } from '@/app/components/results/CurvatureAnalysisCard'
import { PhotoComparisonGrid } from '@/app/components/results/PhotoComparisonGrid'
import { CurvatureTrendChart } from '@/app/components/results/CurvatureTrendChart'
import { RESULT_SELECT } from '@/app/types/result'
import type { ResultWithContext } from '@/app/types/result'

interface Props {
  params: Promise<{ jobId: string }>
}

/** Server-rendered results page: loads a job's result plus all results (for trend context) and renders the analysis views. */
export default async function ResultsPage({ params }: Props) {
  const { jobId } = await params
  const supabase = await createClient()

  const [{ data: result }, { data: allResults }] = await Promise.all([
    supabase.from('results').select(RESULT_SELECT).eq('job_id', jobId).single(),
    supabase.from('results').select(RESULT_SELECT).order('created_at'),
  ])

  if (!result) return <ResultsEmptyState jobId={jobId} />

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
