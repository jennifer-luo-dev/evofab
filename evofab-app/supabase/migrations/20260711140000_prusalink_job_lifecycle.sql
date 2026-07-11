ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS prusalink_job_id TEXT,
  ADD COLUMN IF NOT EXISTS command_outcome TEXT
    CHECK (command_outcome IN ('pending', 'succeeded', 'failed', 'outcome_unknown')),
  ADD COLUMN IF NOT EXISTS last_command TEXT
    CHECK (last_command IN ('upload', 'start', 'pause', 'resume', 'cancel')),
  ADD COLUMN IF NOT EXISTS last_command_code TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_prusalink_job_id
  ON jobs (printer_id, prusalink_job_id)
  WHERE prusalink_job_id IS NOT NULL;
