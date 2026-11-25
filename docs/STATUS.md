# Status / handoff

> **Every agent: read this first and update it before you stop.**
> Format: keep "Current state", "Next steps" and "Known issues" accurate; append to the log at the bottom.

## Current state (2026-11-24)
- **All code phases are implemented and tested offline** (154 vitest tests, `tsc -b` and `vite build` pass). What's left is owner-only (accounts, Meta review, billing provider) and verifying against live services.
- Backend (Convex): auth + tenancy, workspaces/invites/settings, Instagram connect (Unified login, business token, no refresh cron) and WhatsApp Cloud API connect (credentials verified with Meta before anything is stored), webhook ingest (idempotent) → `engine/runner.ts` (pure interpreter + scheduler timeouts) → `outbound.ts` (24h/7-day window, retries), inbox (takeover / human reply), AI agent node (`ai/agent.ts`, tools, quota, usage; provider, model and keys are platform-wide, set by superAdmins, D12; no per-workspace or BYO key), knowledge, usage, privacy callbacks (data deletion, deauthorize), retention cron, failed-run admin queries, plan → quota (`billing.applyPlan` + signed webhook).
- Frontend (React): sign in/up, workspace create/switch, setup checklist, Instagram accounts, automations (5 template forms), live inbox, knowledge, usage, settings (business hours, instructions, team + invite links), Plataforma console for superAdmins, errors, public privacy/terms/deletion-status pages.
- CI workflow in `.github/workflows/ci.yml`.
- **Never run against a real Convex deployment or real Meta.** Codegen is stubbed offline (see Known issues). The frontend was type-checked and built but not exercised in a browser against a backend.
- Docs: `CLAUDE.md`, `PLAN`, `ARCHITECTURE`, `DECISIONS` (D10 explains the scheduler-based runner), `META_SETUP`, `RESEARCH`.

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
1. Owner: `npx convex dev` (creates the deployment, replaces the stub `_generated`). Fix any type errors it surfaces (the components' real generated types may differ from the stubs).
2. Owner: create the Meta app (`META_SETUP.md`), set env vars (below), add your Instagram account as a tester, connect it from the Instagram page and send a DM from another account. **Verify the UNVERIFIED Graph endpoints** listed in Known issues.
3. Run the frontend with `npm run dev` and click through every page once (it has only been type-checked).
4. Before onboarding real customers: Business Verification + App Review, lawyer review of `/privacy` and `/terms`, Stripe/Polar adapter calling `billing.applyPlan`, error monitoring (Sentry), email delivery for invites.
5. "Later" list in `PLAN.md` (visual builder, catalog tools, WhatsApp, web chat, broadcasts).

## Owner actions pending
- [ ] Optional: `OPENROUTER_API_KEY` for the OpenRouter provider (or store the key from the Plataforma page).
- [x] Claude GitHub App access on `gerardod18/vendebot` (pushes work).
- [ ] Decide whether the repo should be private (it's currently public; no secrets are committed).
- [ ] Create a Convex account/deployment (`npx convex dev`).
- [ ] Create the Meta developer app (see `META_SETUP.md` §1–5).
- [ ] Get an Anthropic API key for `ANTHROPIC_API_KEY` (and/or `OPENROUTER_API_KEY`).
- [ ] Set Convex env vars: `SITE_URL` (frontend URL), `BETTER_AUTH_SECRET`, `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_GRAPH_VERSION`, `TOKEN_ENCRYPTION_KEY`, `META_CONFIG_ID` (Facebook Login for Business configuration id), optional `META_PUBLIC_URL` (public base URL of the HTTP actions behind a tunnel), `SUPERADMIN_EMAILS` (bootstrap only, see D12), `ANTHROPIC_API_KEY`, optional `OPENROUTER_API_KEY`, optional `BILLING_WEBHOOK_SECRET`. (`CONVEX_SITE_URL` is provided by Convex.)
- [ ] Meta app: register `<site>/meta/oauth/callback`, `<site>/meta/data-deletion`, `<site>/meta/deauthorize`, and the privacy/terms URLs (`<app>/privacy`, `<app>/terms`).
- [ ] Meta Business Verification + App Review (Advanced Access).
- [ ] Choose and connect a billing provider (Stripe/Polar).
- [ ] Have `/privacy` and `/terms` (drafts in `src/pages/Public.tsx`) reviewed by a lawyer.

## Known issues
- **Also UNVERIFIED (same reason):** the Unified-login OAuth calls in `instagram/oauth.ts` (code exchange on `graph.facebook.com`, `me/assigned_instagram_accounts`), WhatsApp webhook/send shapes, public comment reply `POST /{comment-id}/replies`, the `signed_request` user id semantics for deletion/deauthorize, and the 24h / 7-day window numbers.
- **Open follow-ups (deferred from review):** SSRF DNS rebinding in flow HTTP actions, transient LLM error retry and quota release, replay of privacy callbacks, workspace-creation quota farming, `acceptInvite` email check, secure first-superAdmin seed (VEN-5), AI guardrails and PII (VEN-6). WhatsApp templates outside the 24h window are not built.
- **Rate limiting:** no per-account send throttle (D10); only retry/backoff on Meta rate-limit errors.
- **Invites** are copyable links (no email sent). **Billing** has no provider adapter yet.
- `deleteSubjectData` matches contacts by Instagram-scoped id only; verify what id Meta sends in the deletion callback.
- **`convex/instagram/client.ts` endpoints are UNVERIFIED** (sandbox couldn't reach Meta docs): send path `/{ig-user-id}/messages`, `HUMAN_AGENT` via `messaging_type: MESSAGE_TAG`, `subscribed_apps`. (The classic Instagram-login endpoints, `ig_exchange_token` / `ig_refresh_token` and `graph.instagram.com`, were removed; there is no token refresh cron.) Verify against Meta docs + a real test account in Phase 2.
- **`convex/_generated/` is an offline stub** produced by `node scripts/gen-convex-stubs.mjs` (the sandbox can't reach a Convex backend). It exists so `tsc` and tests work offline. Running `npx convex dev` overwrites it with the real generated code. **Re-run the script after adding/removing files in `convex/`** if you are working offline.
- `src/main.tsx` casts the auth client to the provider's `AuthClient` type (better-auth 1.6.34 plugin-array inference doesn't narrow). Harmless; revisit on upgrade.
- Webhook payload shapes in `instagram/parse.ts` come from docs/secondary sources, not live traffic. Verify with a real DM/comment/story mention and extend the fixtures in `tests/parse.test.ts`.
- **npm crash "Cannot read properties of null (reading 'edgesOut')"** when installing vitest. Cause: `better-auth` declares an optional peer `vitest ^2–4`, which conflicts with vitest 5. Workaround in place: `.npmrc` has `legacy-peer-deps=true`. If you remove it, installs will fail.
- The cloud agent sessions that created this repo couldn't reach developers.facebook.com, tanstack.com or docs.convex.dev (network policy). Meta details in the docs come from secondary sources; verify them when you have access.

## Log
- 2026-11-20: Implemented every remaining code phase: runner (D10), outbound, AI agent + quota/usage, inbox, OAuth + token cron, accounts/knowledge/usage/settings/invites, privacy callbacks + retention + failed-run views, billing hook, full React UI, CI. 98 tests.
- 2026-11-20: Added OpenRouter support: `ai/models.ts` (pure resolution + model id validation), `ai/provider.ts` (AI SDK factory, BYO key decrypt), schema `aiProvider`/`byoOpenRouterKeyEnc`, `orgs.setAiConfig`. Dep `@openrouter/ai-sdk-provider` 3.1.0. 69 tests. `provider.ts` is not exercised by tests (needs live keys). Agent node must call `getLanguageModel`.
- 2026-11-03: Added Graph client, flow graph/interpreter/templates, automations CRUD. 63 tests. Pushed after each milestone (conventional commits).
- 2026-11-03: Phase 0 scaffold + pure core (signature, parser, crypto, router) with tests. Decision D9 (own org tables).
- 2026-11-03: Research + planning session. Chose stack and decisions D1–D8. Created repo docs and installed deps.
- 2026-11-24: Local run verified (anonymous Convex backend, real codegen). New Meta apps only offer "Unified login", so the classic Instagram login was removed: connect uses `META_CONFIG_ID` (config_id login, business token, graph.facebook.com), no token refresh cron. Added the WhatsApp Cloud API channel on the same tables (`igAccounts.channel = "whatsapp"`, `igUserId` = phone_number_id, `contacts.igsid` = wa_id): `convex/whatsapp/{parse,client}.ts`, `accounts.connectWhatsApp` (paste phone number id, WABA id, token), outbound branch, Accounts page form. 105 tests pass. Everything Meta-facing is UNVERIFIED against live traffic: IG unified send path/webhook shape, WhatsApp webhook shape and send. Templates for sends outside the 24h window are not built. Demo plan: `~/claude-plans/vendebot/demo-plan.md`.
- 2026-11-24: Instagram and WhatsApp connected locally and the first Instagram DM got a bot reply. Automations UX rebuilt to look like SendPulse: master-detail page with triggers grouped by type and channel badge, on/off switches, an edit form (name vs message separated, variable buttons for `{{first_name}}`), and a flow tab that draws the graph with React Flow and lets admins add, connect, edit and save blocks as a new version (D11). UI restyled with design tokens (Onest, cobalt accent, sidebar). 113 tests pass. Not done: WhatsApp inbound untested, template messages outside the 24h window, channel badge in the inbox, mobile layout of the canvas.
- 2026-11-24: Added a library of 5 ready-made sales flows (`convex/engine/library.ts`: price reply, welcome menu, step-by-step order capture, AI advisor with business hours, comment-to-sale with a 2h follow-up) and `automations.createFromLibrary`. The "Nueva automatización" panel opens on a gallery ("Flujos de venta listos"); all five were created on the Instagram account through the UI. Sample copy is for a fictional coffee shop. WhatsApp copies are one click each (pick the WhatsApp account in the gallery; the comment flow is Instagram-only). Not yet tested with live messages.
- 2026-11-24: Added the superAdmin role (D12). Plataforma page: choose the AI provider/model/keys for the whole service, see every workspace (members, accounts, automations, recent conversation previews, usage, failures), manage operators, audit log. The AI node now reads `platformSettings`; per-workspace AI settings were removed from Ajustes. Set `SUPERADMIN_EMAILS` and claim the role on /platform. 120 tests pass.


- 2026-11-24: Review fixes. Channel accounts are unique per (channel, id) among non-revoked rows and a revoked row is never adopted by another workspace (a new row is created; ingest, routing, delivery and inbox sends enforce same-workspace ids). WhatsApp connect is an action that verifies the token with Meta before writing; ingest routes only to `active` accounts of the payload channel. No plaintext tokens in scheduler args. AI node ignores any per-node `model`; AI turns re-check the run before sending or finishing; AI errors show tenants a generic note (raw error in `adminAudit`). `SUPERADMIN_EMAILS` only bootstraps; `platform.openOrg` audits and returns the workspace snapshot; overview is bounded. Inbox window is channel-aware (WhatsApp 24h). Delivery retries stop after a takeover, recording a sent message cannot fail the send. Automations: channel checks (no comment/story triggers or >10 options on WhatsApp), `expectedVersion` stale-edit guard, delete cancels waiting runs. New indexes: `by_org_mode_lastMessageAt`, `by_org_receivedAt`, `by_flowVersion_status`, `by_org_status`. 154 tests pass.
