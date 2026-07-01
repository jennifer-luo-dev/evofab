# EvoFab Notion to Codex to GitHub Workflow

This workflow keeps research intent, implementation, and code review traceable.

## 1. Write Requirements In Notion

Use the EvoFab Tasks database as the implementation source of truth. Each task
should include:

- Goal: the outcome the lab needs
- Scope: what is in and out for this task
- Acceptance criteria: observable behavior that proves the task is done
- Test plan: commands, manual checks, hardware checks, or screenshots required
- Context links: related system design, requirements, lab notes, and diagrams
- Branch name: the intended Git branch for the work

Large requirement documents, such as printer-wrapper requirements, should live
as Notion pages and be broken into smaller Tasks before implementation.

## 2. Start A Codex Session

Give Codex the Notion task link and ask it to inspect the repo before editing.
Codex should:

- Check `git status --short --branch`
- Read relevant code and docs
- Identify existing patterns before adding new abstractions
- Implement only the linked task
- Run the task's acceptance checks
- Produce a PR summary that follows the template

## 3. Create The Git Branch

Branch from latest `main` unless the task explicitly depends on another
unmerged branch.

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c feature/<short-description>
```

If you have uncommitted work, preserve it before switching branches with a WIP
commit or stash. Do not mix unrelated Notion tasks in one branch.

When a working demo branch exists, keep it as a reference and rebuild the useful
parts on clean branches. See [Demo Branch Reference Policy](./demo-branch-reference.md).

## 4. Implement And Verify

From `evofab-app`, run the checks that match the change:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

Use `npm run test:e2e` when the flow touches browser behavior and local Supabase
is running. Use hardware commands only for supervised lab work.

## 5. Open The Pull Request

Push the branch and open a PR:

```bash
git push -u origin <branch-name>
gh pr create --fill
```

Fill in the PR template manually if `--fill` does not include enough detail.
Always link the Notion task and include screenshots for UI changes.

## 6. Close The Loop

After review:

- Update the Notion task status
- Add the merged PR link to the task
- Record any follow-up work as new Notion tasks
- Keep research notes and implementation decisions linked from the original task
