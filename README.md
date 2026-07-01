# EvoFab

EvoFab is the Nemitz Robotics Lab self-driving fabrication application. The
active web application lives in [`evofab-app`](./evofab-app).

Start contribution work from a Notion task, implement it on one Git branch, and
open a GitHub pull request for review. See [CONTRIBUTING.md](./CONTRIBUTING.md)
and [docs/workflow.md](./docs/workflow.md) for the full workflow.

Local development is mock-first: ordinary startup cannot contact a physical
printer. See the [local development guide](./evofab-app/docs/local-development.md)
for setup, tests, simulator scenarios, and the supervised hardware workflow.

```bash
cd evofab-app
nvm use
npm ci
cp .env.example .env.local
npx supabase start
npm run dev
```
