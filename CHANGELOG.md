# Changelog

## v0.4.0 - Milestone 1 Baseline

- Merged the Phase A-J dashboard work for multiprinter operation, safe Moonraker control, mock/local/hardware mode gating, status-worker telemetry, material/profile handling, prepared-print handoff, and the Phase J seamless slicing prepare tab.
- Baseline merge point: dashboard PR #11 at `02dc40f`, followed by v0.5 demo-day fixes through `7d1b06e`.
- Carry-forward debt for v0.5+: harden the slicer service against restarts, cut v0.6 preview seams without improving the temporary parser, and add CI gates before new feature work.
