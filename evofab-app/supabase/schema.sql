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
  type         TEXT        NOT NULL CHECK (type IN ('FGF', 'FDM')),
  material     TEXT,                                 -- default material for this printer
  build_volume TEXT,                                 -- "300x300x400mm"
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
-- FGF material profiles used by the cloud slicer and setup defaults.
-- ============================================================
CREATE TABLE IF NOT EXISTS material_profiles (
  id                              TEXT        PRIMARY KEY,
  name                            TEXT        NOT NULL UNIQUE,
  polymer                         TEXT        NOT NULL,
  nozzle_diameter_mm              NUMERIC(8,3) NOT NULL,
  layer_height_mm                 NUMERIC(8,3) NOT NULL,
  line_width_mm                   NUMERIC(8,3) NOT NULL,
  temps_json                      JSONB       NOT NULL DEFAULT '{}',
  rotation_volume_mm3             NUMERIC(10,3) NOT NULL,
  pellet_flow_coefficient         NUMERIC(8,4) NOT NULL,
  pressure_advance                NUMERIC(8,4) NOT NULL,
  pressure_advance_smooth_time    NUMERIC(8,4) NOT NULL,
  max_volumetric_speed_mm3_s      NUMERIC(10,3) NOT NULL,
  min_layer_time_s                NUMERIC(10,3) NOT NULL,
  cooling_json                    JSONB       NOT NULL DEFAULT '{}',
  overrides_json                  JSONB       NOT NULL DEFAULT '{}',
  density_g_cm3                   NUMERIC(8,4) NOT NULL,
  notes                           TEXT,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
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

  -- timestamps
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ
);

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
-- Uncomment in Supabase Dashboard:
-- Database > Replication > Tables > toggle each table ON
-- Or run these statements:
-- ALTER PUBLICATION supabase_realtime ADD TABLE jobs;
-- ALTER PUBLICATION supabase_realtime ADD TABLE logs;
-- ALTER PUBLICATION supabase_realtime ADD TABLE printer_status;
-- ============================================================

-- ============================================================
-- SEED DATA (development only — remove before production)
-- ============================================================

-- Material profiles
INSERT INTO material_profiles (
  id,
  name,
  polymer,
  nozzle_diameter_mm,
  layer_height_mm,
  line_width_mm,
  temps_json,
  rotation_volume_mm3,
  pellet_flow_coefficient,
  pressure_advance,
  pressure_advance_smooth_time,
  max_volumetric_speed_mm3_s,
  min_layer_time_s,
  cooling_json,
  overrides_json,
  density_g_cm3,
  notes
) VALUES (
  'pla-virgin-3mm',
  'Virgin PLA — 3 mm nozzle',
  'PLA',
  3.0,
  1.2,
  4.0,
  '{"feeding": 190, "melting": 190, "nozzle": 190, "bed": 60}',
  210,
  1,
  0.3,
  0.5,
  250,
  60,
  '{"fan_min_pct": 0, "fan_max_pct": 0, "no_cooling_first_layers": 4}',
  '{"retraction_length_mm": 2.0, "extra_length_on_restart_mm": 0.0, "wipe_distance_mm": 2.0, "z_hop_mm": 1.0}',
  1.24,
  ''
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  polymer = EXCLUDED.polymer,
  nozzle_diameter_mm = EXCLUDED.nozzle_diameter_mm,
  layer_height_mm = EXCLUDED.layer_height_mm,
  line_width_mm = EXCLUDED.line_width_mm,
  temps_json = EXCLUDED.temps_json,
  rotation_volume_mm3 = EXCLUDED.rotation_volume_mm3,
  pellet_flow_coefficient = EXCLUDED.pellet_flow_coefficient,
  pressure_advance = EXCLUDED.pressure_advance,
  pressure_advance_smooth_time = EXCLUDED.pressure_advance_smooth_time,
  max_volumetric_speed_mm3_s = EXCLUDED.max_volumetric_speed_mm3_s,
  min_layer_time_s = EXCLUDED.min_layer_time_s,
  cooling_json = EXCLUDED.cooling_json,
  overrides_json = EXCLUDED.overrides_json,
  density_g_cm3 = EXCLUDED.density_g_cm3,
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
INSERT INTO printers (name, model, ip, port, type, material, build_volume) VALUES
  ('EvoFab Sovol Zero', 'SOVOL ZERO', '10.247.137.89', 80, 'FDM', 'Shore 20A TPE', '152.4×152.4×152.4mm'),
  ('EvoFab Mock Alpha', 'Mock FDM', '127.0.0.1', 7125, 'FDM', 'PLA Standard', '220x220x250mm'),
  ('EvoFab Mock Beta', 'Mock FGF', '127.0.0.2', 7125, 'FGF', 'Shore 40A TPE', '300x300x400mm'),
  ('EvoFab Mock Gamma', 'Mock FDM', '127.0.0.3', 7125, 'FDM', 'PETG Standard', '250x250x300mm')
ON CONFLICT (name) DO NOTHING;

-- Initialize printer_status rows for each seeded printer
INSERT INTO printer_status (printer_id, online, status)
SELECT id, FALSE, 'offline' FROM printers
ON CONFLICT (printer_id) DO NOTHING;
