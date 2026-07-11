-- ============================================================
-- EvoFab SDL · Database Schema
-- Apply in Supabase SQL Editor: Database > SQL Editor > New Query
-- ============================================================


-- ============================================================
-- PRINTERS
-- Static hardware configuration. Does not change while printing.
-- Live telemetry lives in printer_status, not here.
-- ============================================================
CREATE TABLE IF NOT EXISTS printers (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL UNIQUE,          -- "FGF-01", "SV07"
  model        TEXT        NOT NULL,                 -- "Custom FGF · Klipper"
  ip           TEXT        NOT NULL UNIQUE,          -- "10.247.137.89"
  port         INTEGER     NOT NULL DEFAULT 80,
  driver_type  TEXT        NOT NULL DEFAULT 'moonraker'
                            CHECK (driver_type IN ('moonraker', 'prusalink')),
  moonraker_host TEXT,
  moonraker_port INTEGER,
  prusalink_host TEXT,
  prusalink_key_file TEXT,
  type         TEXT        NOT NULL CHECK (type IN ('FGF', 'FDM')),
  material     TEXT,                                 -- default material for this printer
  build_volume TEXT,                                 -- "300x300x400mm"
  webcam_url   TEXT,                                 -- optional browser-rendered MJPEG stream URL
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,    -- soft-delete / disable without losing history
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- PRINTER STATUS
-- Live telemetry written by the Node.js poller every ~5 seconds.
-- One row per printer (upserted on conflict).
-- Kept separate from printers so config writes and telemetry
-- writes never contend with each other.
-- ============================================================
CREATE TABLE IF NOT EXISTS printer_status (
  printer_id    UUID        PRIMARY KEY REFERENCES printers(id) ON DELETE CASCADE,
  online        BOOLEAN     NOT NULL DEFAULT FALSE,
  status        TEXT        NOT NULL DEFAULT 'offline'
                            CHECK (status IN ('idle', 'printing', 'paused', 'error', 'offline')),
  print_state   TEXT,                               -- Moonraker print_stats.state raw value
  filename      TEXT,                               -- currently printing file
  progress      NUMERIC(5,2) DEFAULT 0              -- 0.00 – 100.00 %
                             CHECK (progress BETWEEN 0 AND 100),
  layer_current INTEGER,
  layer_total   INTEGER,
  hotend_temp   NUMERIC(6,2),                       -- °C with one decimal
  hotend_target NUMERIC(6,2),
  bed_temp      NUMERIC(6,2),
  bed_target    NUMERIC(6,2),
  eta_seconds   INTEGER,                            -- estimated seconds remaining
  progress_source TEXT NOT NULL DEFAULT 'unknown'
                            CHECK (progress_source IN ('exact', 'estimated', 'unknown')),
  layer_source    TEXT NOT NULL DEFAULT 'unknown'
                            CHECK (layer_source IN ('exact', 'estimated', 'unknown')),
  fault_message TEXT,
  fault_mcu     TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- MATERIAL PROFILES
-- Material profiles used by setup defaults, preheat presets, and overrides.
-- ============================================================
CREATE TABLE IF NOT EXISTS material_profiles (
  id           TEXT        PRIMARY KEY,
  name         TEXT        NOT NULL UNIQUE,
  printer_type TEXT        NOT NULL DEFAULT 'BOTH'
                           CHECK (printer_type IN ('FGF', 'FDM', 'BOTH')),
  nozzle_temp  NUMERIC(6,2) NOT NULL,
  bed_temp     NUMERIC(6,2) NOT NULL,
  speed        NUMERIC(8,2) NOT NULL,
  flow_rate    NUMERIC(8,4) NOT NULL,
  fan_speed    NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (fan_speed BETWEEN 0 AND 100),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- EXPERIMENTS
-- Named, reusable experiment definitions.
-- Separates "what experiment is this" from "this specific run".
-- Generalizes the system: add a new experiment type by inserting
-- a row and dropping the matching Python module in /experiments/.
-- ============================================================
CREATE TABLE IF NOT EXISTS experiments (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT    NOT NULL UNIQUE,  -- "curvature_fatigue", "pneunet_deformation"
  display_name   TEXT    NOT NULL,         -- "Curvature fatigue test"
  description    TEXT,
  script_path    TEXT    NOT NULL,         -- relative path under /experiments/, e.g. "curvature_fatigue.py"
  default_params JSONB   NOT NULL DEFAULT '{}',  -- default param values shown in UI
  param_schema   JSONB   NOT NULL DEFAULT '{}',  -- JSON Schema describing configurable params
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- JOBS
-- One row per submitted job.
-- Tracks the full lifecycle from submission to results.
-- ============================================================
CREATE TABLE IF NOT EXISTS jobs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- hardware refs
  printer_id          UUID        REFERENCES printers(id) ON DELETE SET NULL,
  experiment_id       UUID        REFERENCES experiments(id) ON DELETE SET NULL,
  material_profile_id TEXT        REFERENCES material_profiles(id) ON DELETE SET NULL,

  -- file
  filename            TEXT        NOT NULL,
  file_key            TEXT,                     -- S3/R2 object key for the uploaded gcode

  -- print settings (overrides applied on top of the material profile for this job only)
  print_settings      JSONB       NOT NULL DEFAULT '{}',
  -- { nozzle_temp, bed_temp, speed, flow_rate, fan_speed }

  -- experiment parameters for this specific run
  experiment_params   JSONB       NOT NULL DEFAULT '{}',
  -- { cycles, pressure_kpa, hold_duration_s, ... }

  -- pipeline state
  status              TEXT        NOT NULL DEFAULT 'queued'
                                  CHECK (status IN (
                                    'queued',
                                    'printing',
                                    'transferring',
                                    'experimenting',
                                    'photographing',
                                    'analysing',
                                    'complete',
                                    'failed',
                                    'aborted'
                                  )),
  pipeline_step       TEXT                      -- mirrors status for the UI stepper
                                  CHECK (pipeline_step IN (
                                    'upload',
                                    'printing',
                                    'transfer',
                                    'experiment',
                                    'photobooth',
                                    'ml',
                                    'complete'
                                  )),

  -- live print progress (updated by poller while printing)
  print_progress      NUMERIC(5,2) DEFAULT 0   CHECK (print_progress BETWEEN 0 AND 100),
  layer_current       INTEGER,
  layer_total         INTEGER,
  prusalink_job_id    TEXT,
  command_outcome     TEXT CHECK (command_outcome IN (
                                  'pending', 'succeeded', 'failed', 'outcome_unknown'
                                )),
  last_command        TEXT CHECK (last_command IN (
                                  'upload', 'start', 'pause', 'resume', 'cancel'
                                )),
  last_command_code   TEXT,

  -- timestamps
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_jobs_prusalink_job_id
  ON jobs (printer_id, prusalink_job_id)
  WHERE prusalink_job_id IS NOT NULL;

-- ============================================================
-- RESULTS
-- One row per completed job with all characterization output.
-- Structured columns for the known measurements (curvature)
-- plus a jsonb column for any future ML output fields.
-- ============================================================
CREATE TABLE IF NOT EXISTS results (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,

  -- structured measurements (curvature fatigue experiment)
  curvature_before  NUMERIC(8,4),              -- mm⁻¹
  curvature_after   NUMERIC(8,4),              -- mm⁻¹
  delta             NUMERIC(8,4),              -- curvature_after - curvature_before
  delta_pct         NUMERIC(8,4),              -- percentage change
  confidence        NUMERIC(5,4)               -- 0.0000–1.0000
                    CHECK (confidence BETWEEN 0 AND 1),
  passed            BOOLEAN,                   -- null = no threshold defined, true/false = evaluated

  -- photo references (S3/R2 keys, not full URLs — generate signed URLs on demand)
  before_image_key  TEXT,
  after_image_key   TEXT,

  -- raw ML output (full dict returned by the evaluation script)
  ml_output         JSONB NOT NULL DEFAULT '{}',

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- LOGS
-- Per-job event log written by the orchestrator.
-- Powers the system log panel in the monitor screen.
-- ============================================================
CREATE TABLE IF NOT EXISTS logs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     UUID        REFERENCES jobs(id) ON DELETE CASCADE,
  message    TEXT        NOT NULL,
  type       TEXT        NOT NULL DEFAULT 'default'
                         CHECK (type IN ('default', 'info', 'success', 'warn', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_jobs_status        ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_printer_id    ON jobs(printer_id);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at    ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_results_job_id     ON results(job_id);
CREATE INDEX IF NOT EXISTS idx_results_created_at ON results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_job_id        ON logs(job_id);
CREATE INDEX IF NOT EXISTS idx_logs_created_at    ON logs(created_at DESC);

-- ============================================================
-- REALTIME
-- Phase F migrations add jobs, logs, and printer_status to the
-- supabase_realtime publication idempotently for fresh projects.
-- ============================================================

-- ============================================================
-- SEED DATA (development only — remove before production)
-- ============================================================

-- Material profiles
INSERT INTO material_profiles (
  id,
  name,
  printer_type,
  nozzle_temp,
  bed_temp,
  speed,
  flow_rate,
  fan_speed,
  notes
) VALUES
  ('pla-fgf', 'PLA FGF', 'FGF', 190, 60, 40, 1, 0, 'Baseline pellet PLA profile for the custom FGF printer.'),
  ('pla-fdm', 'PLA FDM', 'FDM', 205, 60, 55, 1, 80, 'Baseline filament PLA profile for FDM printers.'),
  ('cool-flex', 'Flexible Polymer', 'BOTH', 220, 50, 25, 0.95, 35, 'Shared conservative profile for flexible-material trials.')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  printer_type = EXCLUDED.printer_type,
  nozzle_temp = EXCLUDED.nozzle_temp,
  bed_temp = EXCLUDED.bed_temp,
  speed = EXCLUDED.speed,
  flow_rate = EXCLUDED.flow_rate,
  fan_speed = EXCLUDED.fan_speed,
  notes = EXCLUDED.notes;

-- Experiments
INSERT INTO experiments (name, display_name, description, script_path, default_params, param_schema) VALUES
  (
    'curvature_fatigue',
    'Curvature fatigue test',
    'Inflate and deflate the soft actuator for N cycles, measure curvature before and after.',
    'curvature_fatigue.py',
    '{"cycles": 50, "pressure_kpa": 30, "hold_duration_s": 5}',
    '{
      "type": "object",
      "properties": {
        "cycles":           {"type": "integer", "minimum": 1,   "maximum": 500, "title": "Cycles"},
        "pressure_kpa":     {"type": "number",  "minimum": 0,   "maximum": 100, "title": "Pressure (kPa)"},
        "hold_duration_s":  {"type": "number",  "minimum": 0.5, "maximum": 60,  "title": "Hold duration (s)"}
      },
      "required": ["cycles", "pressure_kpa", "hold_duration_s"]
    }'
  ),
  (
    'pneunet_deformation',
    'PneuNet deformation capture',
    'Inflate PneuNet actuator and record deformation at peak pressure.',
    'pneunet_deformation.py',
    '{"pressure_kpa": 25, "hold_duration_s": 3}',
    '{
      "type": "object",
      "properties": {
        "pressure_kpa":    {"type": "number", "minimum": 0, "maximum": 100, "title": "Pressure (kPa)"},
        "hold_duration_s": {"type": "number", "minimum": 1, "maximum": 30,  "title": "Hold duration (s)"}
      },
      "required": ["pressure_kpa", "hold_duration_s"]
    }'
  )
ON CONFLICT (name) DO NOTHING;

-- Printers (update IPs to match your actual lab network before running)
INSERT INTO printers (name, model, ip, port, type, material, build_volume, webcam_url) VALUES
  ('FDM Printer', 'SOVOL ZERO', '10.247.137.89', 80, 'FDM', 'Shore 20A TPE', '152.4×152.4×152.4mm', NULL),
  ('EvoFab Mock Alpha', 'Mock FDM', '127.0.0.1', 7125, 'FDM', 'PLA Standard', '220x220x250mm', NULL),
  ('EvoFab Mock Beta', 'Mock FGF', '127.0.0.2', 7125, 'FGF', 'Shore 40A TPE', '300x300x400mm', NULL),
  ('EvoFab Mock Gamma', 'Mock FDM', '127.0.0.3', 7125, 'FDM', 'PETG Standard', '250x250x300mm', NULL)
ON CONFLICT (name) DO NOTHING;

UPDATE printers
SET moonraker_host = COALESCE(moonraker_host, ip),
    moonraker_port = COALESCE(moonraker_port, port)
WHERE driver_type = 'moonraker';

INSERT INTO printers (
  name, model, ip, port, type, material, build_volume, webcam_url,
  driver_type, prusalink_host, prusalink_key_file
) VALUES (
  'Printer 9', 'Prusa MINI+', '<PRUSA_IP>', 80, 'FDM', 'PLA Standard',
  '180x180x180mm', NULL, 'prusalink', '<PRUSA_IP>', '.secrets/prusalink.key'
)
ON CONFLICT (name) DO NOTHING;

-- Initialize printer_status rows for each seeded printer
INSERT INTO printer_status (printer_id, online, status)
SELECT id, FALSE, 'offline' FROM printers
ON CONFLICT (printer_id) DO NOTHING;
