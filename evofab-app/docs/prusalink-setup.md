# P0 PrusaLink Operator Runbook

This runbook records the boundary for trustworthy slice-to-Prusa readiness. It
does not contain connection details, credentials, endpoint addresses, or
key-file locations. Keep those values only in the approved runtime secret
store.

## A. Preview verification

Before an operator can select a printer, confirm that the dashboard shows a
trusted preview: server-reported and parsed layer counts agree, the normalized
artifact hash is present, bounds and extrusion metrics are plausible, and the
bottom, middle, and top layer samples are non-empty.

For the deterministic cube fixture, expected toolpath bounds are 20 mm by
20 mm by 19.8 mm (Z 0.2–20.0 mm, ±0.05 mm); it has 21 layers, at least 100
extrusion moves, and at least 2,000 mm of extrusion path. Compare bounds,
layer count, and major support/model features with an approved independent
viewer when available. Abort if the preview is blocked, fails to render, has a
layer mismatch, or does not match the selected artifact.

The reported remote artifact is not available in this issue. Do not infer an
engine defect from a viewer symptom; record it as an evidence gap.

## B. Stage B — upload only

Stage B needs explicit approval in the active session and a printer confirmed
idle and cool with writable storage available. Confirm the selected artifact
is trusted, then upload it. Expected software evidence is: writable storage
was discovered, upload used no-start and no-overwrite semantics, the stored
file verified, and the job remains queued. A successful Stage B must not send
a start command or change the printer into a printing state.

Record only safe fields: artifact hash, byte count, layer counts, sanitized
result codes, job state, and timestamps. Abort on unavailable/read-only
storage, authorization errors, verification failure, an unknown outcome, or
any preview-trust failure.

## C. Stage C — separately approved supervised print

Stage C is not authorized by Stage B. It needs new approval and a person at
the printer. The operator explicitly starts the verified queued job, observes
the assigned job identity, then supervises start, pause, resume, and natural
completion. Do not retry an upload or start whose outcome is unknown; wait for
status reconciliation.

Cancel is not an emergency stop. Use the documented physical emergency
procedure for hazards. Stop and escalate when the observed job identity is
missing or differs from the dashboard job.

## D. Secret handling

Never place credentials, addresses, endpoint URLs, runtime paths, request
headers, or private printer data in screenshots, logs, commits, pull requests,
or issue comments. GitHub evidence must use only sanitized identifiers and
safe aggregate metrics.
