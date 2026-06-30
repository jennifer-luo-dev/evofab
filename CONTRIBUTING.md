# Contributing to EvoFab

Thanks for helping build EvoFab! This covers the workflow, code standards, and
project-specific setup so you can contribute without having to ask about conventions.

## Workflow

1. **Don't push directly to `main`.** Create a branch off the latest `main`, make
   your changes there, and open a pull request for review and merge.
2. **Branch naming** — use the prefix that matches your change:
   - `feature/<short-description>` — new functionality
   - `fix/<short-description>` — bug fixes
   - `docs/<short-description>` — documentation only
   - `refactor/<short-description>` — restructuring without behavior change
   - `chore/<short-description>` — tooling, dependencies, config
3. **Before opening a PR**, pull the latest `main` and rebase your branch onto it
   to resolve conflicts locally. Don't leave that for the reviewer.

```bash
git fetch origin
git rebase origin/main
```

## Pull request description

Every PR must include:

- **What this adds or fixes** — a plain-English summary of what changed and why
- **How to test it** — concrete steps the reviewer can follow to verify the change works
- **Considerations / tradeoffs** — known limitations, edge cases not handled,
  performance implications, alternative approaches considered, or follow-up work needed
- **Screenshots or recordings** for any UI changes
- **Linked issue** number, if one exists

Copy this template into your PR description:

```markdown
## What
<!-- Clear summary of what changed and why -->

## How to test
<!-- Step-by-step: what to run, what to look for -->

## Considerations
<!-- Known limitations, edge cases, tradeoffs, or follow-up work -->

## Screenshots
<!-- Required for UI changes; delete if not applicable -->

Closes #<!-- issue number, if applicable -->
```

## Coding standards

Self-check before requesting review:

- [ ] **File header** — every new file starts with a header comment stating its name
      and purpose, matching the format used throughout the repo (see
      [Header comment format](#header-comment-format) below)
- [ ] **File placement** — new files follow the existing project structure
      ([`evofab-app/` architecture](evofab-app/README.md#architecture)); don't create
      new top-level folders without discussing first
- [ ] **Doc comments** — every new function and component has a JSDoc comment:
      one-sentence description, `@param` lines, and `@returns` line (see
      [Doc comment format](#doc-comment-format) below)
- [ ] **No duplicated logic** — if similar logic already exists elsewhere, extend
      or reuse it rather than copy-paste
- [ ] **Single responsibility** — each function and component does one thing;
      split if it's doing more
- [ ] **Formatted with Prettier** — run `npm run format` before committing
      (see [Prettier setup](#prettier-setup))
- [ ] **README updated** if the change affects setup steps, env vars, the features
      list, or project structure
- [ ] **No unused imports**, dead code, or commented-out code left in the PR
- [ ] **Tests** — existing tests pass; new tests added for new logic where the repo
      has test coverage for that area

### Header comment format

TypeScript / TSX:
```ts
// FileName.ts
// One sentence describing this file's purpose and role in the project.
// Additional context if needed (keep to 1–3 lines total).
```

Python:
```python
# filename.py
# One sentence describing this file's purpose and role.
```

### Doc comment format

For TypeScript functions and components, use JSDoc-style blocks:
```ts
/**
 * One-sentence description of what this does.
 * @param paramName - What this parameter represents.
 * @param another - What this one does.
 * @returns What the function returns, and when.
 */
```

For short, obviously-named functions, an inline form is fine:
```ts
/** Merges class names, filtering out falsy values. */
export function cn(...classes: Array<string | undefined | null | false>) {
```

## Prettier setup

Formatting is enforced via [Prettier](https://prettier.io). The config lives in
`evofab-app/.prettierrc`.

**Install (first time, from `evofab-app/`):**
```bash
npm install
```

**Format before committing:**
```bash
cd evofab-app
npm run format
```

**VS Code**: install the
[Prettier – Code Formatter](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
extension and enable **Format on Save** (`"editor.formatOnSave": true` in your
settings). This keeps formatting automatic and avoids formatting-only commits.

PRs with unformatted code may be asked to reformat before review.

## Commit messages

Short, present-tense, and descriptive. This repo uses
[Conventional Commits](https://www.conventionalcommits.org/) prefixes:

| Prefix | Use for |
|--------|---------|
| `feat:` | new user-facing feature |
| `fix:` | bug fix |
| `docs:` | documentation only |
| `refactor:` | restructuring without behavior change |
| `chore:` | tooling, dependencies, build config |

Examples:
- `feat: add curvature trend chart to results page`
- `fix: correct RTDE reconnect on dropped socket`
- `docs: document robot arm RTDE bridge`

Not: `fixed stuff`, `WIP`, `updates`.

## Local setup notes

### Environment variables

The web app requires a `.env.local` file in `evofab-app/`. Copy the example and
fill in your values:

```bash
cp evofab-app/.env.local.example evofab-app/.env.local
```

| Variable | Where to get it |
|----------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project → Settings → API |

If you're working on robot-arm features, the FastAPI server also reads `ROBOT_IP`
from the environment (the UR7e's IP on the lab network).

### Backend services

The web app can run without the hardware bridge (`npm run dev:web`), but some
features require:

- A **Supabase project** with the schema applied — contact the repo owner for the
  migration files
- A **Moonraker-enabled printer** on the local network for print-related features
- The **FastAPI server** (`npm run dev:api` or `npm run dev`) for robot/camera
  features — requires **Python 3.11** and the packages in
  `evofab-app/app/api/python/requirements.txt`

Note: Python 3.11 specifically is required because `pyorbbecsdk` (the depth camera
SDK) does not yet support newer Python versions.

### Running tests

[Playwright](https://playwright.dev/) is configured as the test framework. No tests
have been written yet — contributions welcome. Once tests exist, run them with:

```bash
cd evofab-app
npx playwright test
```

### Files to leave alone

- `evofab-app/app/api/python/__pycache__/` — compiled Python bytecode, never commit
  these (already gitignored)
- `evofab-app/next-env.d.ts` — auto-generated by Next.js, do not edit manually
- `evofab-app/.env.local` — your local secrets, never commit (gitignored)
- `evofab-app/supabase/` — database schema and migrations; coordinate with the repo
  owner before changing
