-- llm_model_rows.sql
-- Registers the `llm_model` machine type (a Claude-backed pipeline node) and
-- its one action, "Analyze": take an earlier step's outputs (and any photos
-- among them), plus a prompt, and return Claude's text response. See
-- app/api/llm-analyze/route.ts and stepExecutors.ts's runLlmStep.
--
-- Run once against the project's Supabase instance (SQL editor or
-- `supabase db execute`). The last statement adds one example machine,
-- "Claude" — ip/port stay null, since the route calls the Claude API directly
-- rather than a hardware bridge. The API key is NOT stored here — it lives in
-- `.env.local`'s ANTHROPIC_API_KEY, server-only.

create table if not exists public.machine_llm_model (
  machine_id uuid not null,
  -- Claude model id; null falls back to the route's default (claude-opus-5-5).
  model text,
  -- low | medium | high | xhigh | max; null falls back to the route's default (medium).
  effort text check (effort is null or effort = any (array['low', 'medium', 'high', 'xhigh', 'max'])),
  system_prompt text,
  constraint machine_llm_model_pkey primary key (machine_id),
  -- ON DELETE CASCADE matches every other machine_* detail table (and create_machine_type).
  constraint machine_llm_model_machine_id_fkey foreign key (machine_id) references public.machines(id) on delete cascade
);

insert into public.machine_types (type_key, display_name, table_name)
values ('llm_model', 'LLM (Claude)', 'machine_llm_model')
on conflict (type_key) do nothing;

insert into public.machine_type_fields (machine_type_id, field_key, label, input_type, ordinal)
select mt.id, f.field_key, f.label, f.input_type, f.ordinal
from public.machine_types mt,
  (values
    ('model', 'Model', 'text', 0),
    ('effort', 'Effort', 'text', 1),
    ('system_prompt', 'System Prompt', 'textarea', 2)
  ) as f(field_key, label, input_type, ordinal)
where mt.type_key = 'llm_model'
  and not exists (
    select 1 from public.machine_type_fields x
    where x.machine_type_id = mt.id and x.field_key = f.field_key
  );

-- `source` has no `expects`, so the step picker offers any earlier step (in
-- the same or an ancestor loop) — the LLM reads whatever that step produced.
insert into public.action_types
  (machine_type_id, type_key, display_name, description, input_schema, output_schema, default_inputs, is_implemented)
select
  mt.id,
  'llm_analyze',
  'Analyze',
  'Send an earlier step''s outputs (and photos) to Claude with a prompt',
  '[
    {"key": "source", "label": "Source Step", "type": "step_output"},
    {"key": "prompt", "label": "Prompt", "type": "textarea"}
  ]'::jsonb,
  '[
    {"key": "response_text", "label": "Response", "type": "text"},
    {"key": "model", "label": "Model", "type": "string"},
    {"key": "usage", "label": "Token Usage", "type": "object"}
  ]'::jsonb,
  '{}'::jsonb,
  true
from public.machine_types mt
where mt.type_key = 'llm_model'
on conflict (type_key) do nothing;

-- One example machine. Rename it or add more (e.g. one per system prompt).
with m as (
  insert into public.machines (machine_type_id, name)
  select id, 'Claude' from public.machine_types where type_key = 'llm_model'
  on conflict (name) do nothing
  returning id
)
insert into public.machine_llm_model (machine_id, model, effort, system_prompt)
select id, 'claude-opus-5-5', 'medium',
  'You are assisting a soft-robotics lab. You will receive the outputs of an automated '
  || 'fabrication/characterization step, sometimes with photos of a pneumatic actuator. '
  || 'Answer the user''s request concisely and say plainly when the data is insufficient.'
from m;
