# Demo Branch Reference Policy

The current demo branch is a working reference, not the branch shape we should
merge.

Use it to recover proven pieces of behavior:

- Mock-first printer development
- Local Supabase schema and seed data
- Moonraker safety modes
- G-code upload and settings parsing
- Monitor controls and recovery demo
- Tests that prove the local loop

Do not turn the whole branch into one pull request. Future work should start
from clean branches created from the latest `main`, with one Notion task mapped
to one branch and one PR.

## Clean Branch Rule

For each feature:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c feature/<short-description>
```

Then copy or reimplement only the relevant pieces from the demo branch. Keep the
demo branch available as reference until all useful pieces have been rebuilt in
reviewable branches.

## Deferred Decision

The live printer-status architecture is intentionally undecided here. Decide it
in its own Notion task/conversation before implementing status synchronization.
