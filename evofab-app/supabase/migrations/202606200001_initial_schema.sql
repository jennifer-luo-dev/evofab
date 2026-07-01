create table if not exists printers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  model text not null,
  ip text not null unique,
  port integer not null default 80,
  type text not null check (type in ('FGF', 'FDM')),
  material text,
  build_volume text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists printer_status (
  printer_id uuid primary key references printers(id) on delete cascade,
  online boolean not null default false,
  status text not null default 'offline' check (status in ('idle', 'printing', 'paused', 'error', 'offline')),
  print_state text,
  filename text,
  progress numeric(5,2) default 0 check (progress between 0 and 100),
  layer_current integer,
  layer_total integer,
  hotend_temp numeric(6,2),
  hotend_target numeric(6,2),
  bed_temp numeric(6,2),
  bed_target numeric(6,2),
  eta_seconds integer,
  updated_at timestamptz not null default now()
);

create table if not exists material_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  printer_type text not null check (printer_type in ('FGF', 'FDM', 'BOTH')),
  nozzle_temp numeric(6,2) not null,
  bed_temp numeric(6,2) not null,
  speed numeric(6,2) not null,
  flow_rate numeric(5,3) not null,
  fan_speed integer not null default 0 check (fan_speed between 0 and 100),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists experiments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  display_name text not null,
  description text,
  script_path text not null,
  default_params jsonb not null default '{}',
  param_schema jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  printer_id uuid references printers(id) on delete set null,
  experiment_id uuid references experiments(id) on delete set null,
  material_profile_id uuid references material_profiles(id) on delete set null,
  filename text not null,
  file_key text,
  print_settings jsonb not null default '{}',
  experiment_params jsonb not null default '{}',
  status text not null default 'queued' check (status in (
    'queued', 'printing', 'transferring', 'experimenting', 'photographing',
    'analysing', 'complete', 'failed', 'aborted'
  )),
  pipeline_step text check (pipeline_step in (
    'upload', 'printing', 'transfer', 'experiment', 'photobooth', 'ml', 'complete'
  )),
  print_progress numeric(5,2) default 0 check (print_progress between 0 and 100),
  layer_current integer,
  layer_total integer,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create table if not exists results (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  curvature_before numeric(8,4),
  curvature_after numeric(8,4),
  delta numeric(8,4),
  delta_pct numeric(8,4),
  confidence numeric(5,4) check (confidence between 0 and 1),
  passed boolean,
  before_image_key text,
  after_image_key text,
  ml_output jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists logs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  message text not null,
  type text not null default 'default' check (type in ('default', 'info', 'success', 'warn', 'error')),
  created_at timestamptz not null default now()
);

create index if not exists idx_jobs_status on jobs(status);
create index if not exists idx_jobs_printer_id on jobs(printer_id);
create index if not exists idx_jobs_created_at on jobs(created_at desc);
create index if not exists idx_results_job_id on results(job_id);
create index if not exists idx_logs_job_id on logs(job_id);

alter publication supabase_realtime add table jobs;
alter publication supabase_realtime add table logs;
alter publication supabase_realtime add table printer_status;
