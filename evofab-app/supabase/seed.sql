-- Local-only permissions for the unauthenticated development app. Keep these
-- grants out of production migrations; production authorization is a separate
-- integration decision.
grant usage on schema public to anon, authenticated;
grant select on printers, printer_status, material_profiles, experiments, jobs, results, logs
  to anon, authenticated;
grant insert, update on jobs, results, logs to anon, authenticated;

insert into printers (id, name, model, ip, port, type, material, build_volume)
values (
  '00000000-0000-4000-8000-000000000001',
  'Mock Sovol Zero',
  'SOVOL ZERO (simulated)',
  '127.0.0.1',
  7125,
  'FDM',
  'PLA',
  '152.4x152.4x152.4mm'
)
on conflict (id) do update set ip = excluded.ip, port = excluded.port;

insert into printers (id, name, model, ip, port, type, material, build_volume) values
  ('00000000-0000-4000-8000-000000000002', 'Sovol SV08 · Bay 2', 'SOVOL SV08', '127.0.0.2', 7125, 'FDM', 'PETG', '350x350x345mm'),
  ('00000000-0000-4000-8000-000000000003', 'ProForge FGF · Bay 3', 'Custom pellet extruder', '127.0.0.3', 7125, 'FGF', 'SEBS 40A', '300x300x400mm')
on conflict (id) do update set ip = excluded.ip, port = excluded.port;

insert into printer_status (printer_id, online, status)
values
  ('00000000-0000-4000-8000-000000000001', false, 'offline'),
  ('00000000-0000-4000-8000-000000000002', false, 'offline'),
  ('00000000-0000-4000-8000-000000000003', false, 'offline')
on conflict (printer_id) do nothing;

insert into material_profiles (
  id, name, printer_type, nozzle_temp, bed_temp, speed, flow_rate, fan_speed, notes
)
values (
  '00000000-0000-4000-8000-000000000010',
  'PLA Basic',
  'FDM',
  210,
  60,
  50,
  1.000,
  100,
  'Deterministic local-development fixture'
)
on conflict (id) do nothing;

insert into experiments (
  id, name, display_name, description, script_path, default_params, param_schema
)
values (
  '00000000-0000-4000-8000-000000000020',
  'local_smoke_test',
  'Experiment 1',
  'Deterministic development-only experiment',
  'local_smoke_test.py',
  '{"cycles": 1}',
  '{"type":"object","properties":{"cycles":{"type":"integer","minimum":1,"maximum":5,"title":"Cycles"}},"required":["cycles"]}'
)
on conflict (id) do nothing;
