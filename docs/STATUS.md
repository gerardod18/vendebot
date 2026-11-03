# Status / handoff

> **Every agent: read this first and update it before you stop.**
> Format: keep "Current state", "Next steps" and "Known issues" accurate; append to the log at the bottom.

## Current state (2026-11-03)
- Repo initialized with `package.json` and dependencies installed. **No application code yet.**
- Handoff docs written: `CLAUDE.md`, `docs/PLAN.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/META_SETUP.md`, `docs/RESEARCH.md`.
- Phase 0 is partly done (see PLAN).

### Installed versions (pinned by package-lock)
convex 1.49, @convex-dev/agent 0.7.9, @convex-dev/workflow 0.4.10, @convex-dev/workpool 0.4.15,
@convex-dev/rate-limiter 0.4.3, @convex-dev/better-auth 0.12.7, better-auth **1.6.34** (pinned < 1.7),
convex-helpers 0.1.133, ai 7.x, @ai-sdk/anthropic 4.x, react 19, react-router 8, zod 4,
vite 8, typescript 6, tailwindcss 4, vitest 5, convex-test 0.0.67.

> These versions are newer than many agents' training data. **Read the package READMEs and type
> definitions in `node_modules/`** (e.g. `node_modules/@convex-dev/agent/README.md`,
> `node_modules/@convex-dev/better-auth/README.md`) before writing integration code. Don't
> write APIs from memory.

## Next steps (in order)
1. Phase 0: Vite + React + Tailwind skeleton, `tsconfig`, `convex/convex.config.ts` with all components, `vitest.config.ts`.
2. Owner: run `npx convex dev` once to create or link the Convex deployment (writes `.env.local`).
3. Phase 1: Better Auth + organization plugin + `lib/tenancy.ts` with tests.
4. Owner (in parallel): create the Meta app following `docs/META_SETUP.md` and add their Instagram account as a tester.
5. Phase 2 → 3 → 4 → 5 as in `PLAN.md`.

## Owner actions pending
- [ ] **Install the Claude GitHub App on `gerardod18/vendebot`** (or reconnect GitHub in claude.ai → Connectors) so agents can push. Until then, commits are only local to the agent session.
- [ ] Decide whether the repo should be private (it's currently public; no secrets are committed).
- [ ] Create a Convex account/deployment (`npx convex dev`).
- [ ] Create the Meta developer app (see `META_SETUP.md` §1–5).
- [ ] Get an Anthropic API key for `ANTHROPIC_API_KEY`.

## Known issues
- **npm crash "Cannot read properties of null (reading 'edgesOut')"** when installing vitest. Cause: `better-auth` declares an optional peer `vitest ^2–4`, which conflicts with vitest 5. Workaround in place: `.npmrc` has `legacy-peer-deps=true`. If you remove it, installs will fail.
- The cloud agent sessions that created this repo couldn't reach developers.facebook.com, tanstack.com or docs.convex.dev (network policy). Meta details in the docs come from secondary sources; verify them when you have access.

## Log
- 2026-11-03: Research + planning session. Chose stack and decisions D1–D8. Created repo docs and installed deps.
