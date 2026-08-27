-- action_types_rows.sql
-- Seed data for action_types (not captured by supabase/schema.sql, which only
-- dumps table shape — see app/api/action-types/route.ts's header comment).
-- Existing rows already live directly in Supabase and aren't reproduced here
-- wholesale; this file only carries the statements needed to bring the
-- robot_arm "move" action_types row up to date with the merged
-- Cartesian/joint-space schema (see app/components/pipelines/StepDraftForm.tsx's
-- MoveTargetModal, app/lib/robot.ts, and app/api/python/main.py's POST
-- /robot/move). Run once against the project's Supabase instance (SQL editor
-- or `supabase db execute`).
--
-- input_schema/output_schema below are informational (StepDraftForm filters
-- all of these keys out of the generic input-field list — see
-- ROBOT_MOVE_INPUT_KEYS — since MoveTargetModal owns the real UI), but keep
-- them accurate: they're what GET /api/action-types returns to the builder,
-- and what a future generic renderer would fall back to.

update public.action_types
set
  input_schema = '[
    {"key": "target_type", "label": "Target Type", "type": "select", "options": ["cartesian", "joint"], "default": "cartesian"},
    {"key": "x", "label": "X", "type": "number"},
    {"key": "y", "label": "Y", "type": "number"},
    {"key": "z", "label": "Z", "type": "number"},
    {"key": "mode", "label": "Mode", "type": "select", "options": ["absolute", "relative"], "default": "absolute"},
    {"key": "joints", "label": "Joints", "type": "text"},
    {"key": "speed_pct", "label": "Speed %", "type": "number", "default": 100},
    {"key": "acceleration_pct", "label": "Acceleration %", "type": "number", "default": 25}
  ]'::jsonb,
  output_schema = '[
    {"key": "status", "label": "Status", "type": "string"},
    {"key": "final_joint_positions_deg", "label": "Final Joint Positions", "type": "object"},
    {"key": "final_tcp_pose", "label": "Final TCP Pose", "type": "object"},
    {"key": "duration_ms", "label": "Duration", "type": "number"},
    {"key": "error", "label": "Error", "type": "string"}
  ]'::jsonb,
  default_inputs = '{"target_type": "cartesian", "speed_pct": 100, "acceleration_pct": 25}'::jsonb
where type_key = 'move'
  and machine_type_id = (select id from public.machine_types where type_key = 'robot_arm');
