-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.machine_types (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  type_key text NOT NULL UNIQUE CHECK (type_key ~ '^[a-z][a-z0-9_]*$'::text),
  display_name text NOT NULL,
  table_name text NOT NULL UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT machine_types_pkey PRIMARY KEY (id)
);
CREATE TABLE public.machines (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  machine_type_id uuid NOT NULL,
  name text NOT NULL UNIQUE,
  ip text UNIQUE,
  port integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT machines_pkey PRIMARY KEY (id),
  CONSTRAINT machines_machine_type_id_fkey FOREIGN KEY (machine_type_id) REFERENCES public.machine_types(id)
);
CREATE TABLE public.machine_type_fields (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  machine_type_id uuid NOT NULL,
  field_key text NOT NULL CHECK (field_key ~ '^[a-z][a-z0-9_]*$'::text),
  label text NOT NULL,
  input_type text NOT NULL CHECK (input_type = ANY (ARRAY['text'::text, 'number'::text, 'select'::text, 'checkbox'::text, 'textarea'::text])),
  options jsonb,
  ordinal integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT machine_type_fields_pkey PRIMARY KEY (id),
  CONSTRAINT machine_type_fields_machine_type_id_fkey FOREIGN KEY (machine_type_id) REFERENCES public.machine_types(id)
);
CREATE TABLE public.machine_printer (
  machine_id uuid NOT NULL,
  model text NOT NULL,
  printer_type text NOT NULL,
  material text,
  build_volume text,
  CONSTRAINT machine_printer_pkey PRIMARY KEY (machine_id),
  CONSTRAINT machine_printer_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(id)
);
CREATE TABLE public.machine_robot_arm (
  machine_id uuid NOT NULL,
  model text NOT NULL,
  gripper_model text,
  payload_kg numeric,
  cog_x_mm numeric,
  cog_y_mm numeric,
  cog_z_mm numeric,
  CONSTRAINT machine_robot_arm_pkey PRIMARY KEY (machine_id),
  CONSTRAINT machine_robot_arm_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(id)
);
CREATE TABLE public.machine_arduino_board (
  machine_id uuid NOT NULL,
  board_model text NOT NULL,
  serial_port text,
  baud_rate integer,
  channel_count integer,
  CONSTRAINT machine_arduino_board_pkey PRIMARY KEY (machine_id),
  CONSTRAINT machine_arduino_board_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(id)
);
CREATE TABLE public.machine_camera (
  machine_id uuid NOT NULL,
  model text NOT NULL,
  capture_method text NOT NULL,
  resolution text,
  ppm numeric,
  CONSTRAINT machine_camera_pkey PRIMARY KEY (machine_id),
  CONSTRAINT machine_camera_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(id)
);
CREATE TABLE public.machine_classification_model (
  machine_id uuid NOT NULL,
  model_name text NOT NULL,
  function_name text NOT NULL,
  threshold numeric,
  z_min_m numeric,
  z_max_m numeric,
  CONSTRAINT machine_classification_model_pkey PRIMARY KEY (machine_id),
  CONSTRAINT machine_classification_model_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(id)
);
CREATE TABLE public.machine_status (
  machine_id uuid NOT NULL,
  online boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'offline'::text CHECK (status = ANY (ARRAY['idle'::text, 'busy'::text, 'paused'::text, 'error'::text, 'offline'::text])),
  current_step_id uuid,
  telemetry jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT machine_status_pkey PRIMARY KEY (machine_id),
  CONSTRAINT machine_status_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(id),
  CONSTRAINT machine_status_current_step_id_fkey FOREIGN KEY (current_step_id) REFERENCES public.pipeline_steps(id)
);
CREATE TABLE public.action_types (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  machine_type_id uuid NOT NULL,
  type_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text,
  script_path text,
  input_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_implemented boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT action_types_pkey PRIMARY KEY (id),
  CONSTRAINT action_types_machine_type_id_fkey FOREIGN KEY (machine_type_id) REFERENCES public.machine_types(id)
);
CREATE TABLE public.pipelines (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft'::text CHECK (status = ANY (ARRAY['draft'::text, 'queued'::text, 'running'::text, 'complete'::text, 'failed'::text, 'aborted'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  CONSTRAINT pipelines_pkey PRIMARY KEY (id)
);
CREATE TABLE public.pipeline_steps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL,
  step_order integer NOT NULL,
  machine_type_id uuid NOT NULL,
  machine_id uuid,
  action_type_id uuid NOT NULL,
  depends_on_step_id uuid,
  sync_group_id text,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  outputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'queued'::text, 'waiting_dependency'::text, 'running'::text, 'complete'::text, 'failed'::text, 'skipped'::text])),
  progress numeric DEFAULT 0 CHECK (progress >= 0::numeric AND progress <= 100::numeric),
  queued_at timestamp with time zone,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  CONSTRAINT pipeline_steps_pkey PRIMARY KEY (id),
  CONSTRAINT pipeline_steps_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id),
  CONSTRAINT pipeline_steps_machine_type_id_fkey FOREIGN KEY (machine_type_id) REFERENCES public.machine_types(id),
  CONSTRAINT pipeline_steps_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(id),
  CONSTRAINT pipeline_steps_action_type_id_fkey FOREIGN KEY (action_type_id) REFERENCES public.action_types(id),
  CONSTRAINT pipeline_steps_depends_on_step_id_fkey FOREIGN KEY (depends_on_step_id) REFERENCES public.pipeline_steps(id)
);
CREATE TABLE public.pipeline_step_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL,
  pipeline_step_id uuid,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'default'::text CHECK (type = ANY (ARRAY['default'::text, 'info'::text, 'success'::text, 'warn'::text, 'error'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_step_logs_pkey PRIMARY KEY (id),
  CONSTRAINT pipeline_step_logs_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id),
  CONSTRAINT pipeline_step_logs_step_id_fkey FOREIGN KEY (pipeline_step_id) REFERENCES public.pipeline_steps(id)
);
CREATE TABLE public.print_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  printer_type text NOT NULL CHECK (printer_type = ANY (ARRAY['FGF'::text, 'FDM'::text, 'BOTH'::text])),
  nozzle_temp numeric NOT NULL,
  bed_temp numeric NOT NULL,
  speed numeric NOT NULL,
  flow_rate numeric NOT NULL,
  fan_speed integer NOT NULL DEFAULT 0 CHECK (fan_speed >= 0 AND fan_speed <= 100),
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT print_profiles_pkey PRIMARY KEY (id)
);