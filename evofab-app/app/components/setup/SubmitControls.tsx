'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePrinter } from '@/app/contexts/PrinterContext'
import { useJob } from '@/app/contexts/JobContext'

export function SubmitControls() {
  const router = useRouter()
  const {
    selectedPrinter,
    settings,
    uploadedFile,
    selectedMaterialProfile,
    selectedExperiment,
    experimentParams,
    resetSetup,
  } = usePrinter()
  const { dispatch } = useJob()
  const [loading, setLoading] = useState(false)

  const ps = selectedPrinter?.printer_status
  const isAvailable = (ps?.online ?? false) && ps?.status === 'idle'
  const canSubmit = selectedPrinter !== null && isAvailable && uploadedFile !== null

  async function handleSubmit() {
    if (!canSubmit || !selectedPrinter || !uploadedFile) return
    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', uploadedFile)
      formData.append('printer_id', selectedPrinter.id)
      formData.append('experiment_id', selectedExperiment?.id ?? '')
      formData.append('material_profile_id', selectedMaterialProfile?.id ?? '')
      formData.append('settings', JSON.stringify(settings))
      formData.append('experiment_params', JSON.stringify(experimentParams))

      const res = await fetch('/api/jobs', {
        method: 'POST',
        body: formData,
      })
      const { job } = await res.json()
      dispatch({ type: 'START_JOB', jobId: job.id })
      router.push(`/monitor/${job.id}`)
    } catch (err) {
      console.error('Failed to submit job', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleSubmit}
        disabled={!canSubmit || loading}
        className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-[var(--color-teal)] text-[var(--color-bg)] hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? <span className="animate-spin text-base">⟳</span> : <span>▶</span>}
        Submit Job
      </button>
      <button
        onClick={() => resetSetup()}
        className="px-4 py-2.5 rounded-lg text-sm font-medium border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border-2)] transition-all"
      >
        Clear
      </button>
      {!canSubmit && (
        <p className="text-xs text-[var(--color-muted)] ml-1">
          {!selectedPrinter
            ? 'Select a printer to continue'
            : !isAvailable
            ? 'Printer is offline or busy'
            : 'Upload a print file to continue'}
        </p>
      )}
    </div>
  )
}
