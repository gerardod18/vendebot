# Roadmap

Tick items as they're finished (`[x]`) and note anything relevant in `STATUS.md`.
Work top to bottom inside a phase. Each item should be roughly one PR or commit.

## Phase 0: Foundations (repo + tooling)
- [x] Repo created (`gerardod18/vendebot`), dependencies installed (see `package.json`)
- [x] Handoff docs: `CLAUDE.md`, `docs/*`
- [x] Vite + React + Tailwind v4 skeleton (`index.html`, `src/main.tsx`, `vite.config.ts`, `tsconfig*.json`)
- [x] `convex/convex.config.ts` registering components: agent, workflow, workpool (`eventPool`), rateLimiter, betterAuth
- [ ] `npx convex dev` linked to a deployment (owner runs this locally; needs a Convex login)
- [x] vitest + convex-test configured (`vitest.config.ts`, edge-runtime)
- [ ] CI (GitHub Actions): `npm ci`, typecheck, test

## Phase 1: Auth + tenancy
- [ ] Better Auth via `@convex-dev/better-auth` (email + password; Google later) with the **organization plugin**
- [ ] `convex/lib/tenancy.ts`: `orgQuery` / `orgMutation` wrappers (resolve session → active org → member role). Tests prove cross-org access is denied.
- [ ] Frontend: sign up / sign in, create workspace, switch workspace, invite member
- [ ] `orgSettings` created with defaults on org creation

## Phase 2: Instagram connection (own accounts, Standard Access)
- [ ] Meta app created and configured (owner; follow `META_SETUP.md`)
- [ ] `convex/lib/crypto.ts` AES-GCM token encryption + tests
- [ ] OAuth connect flow: "Connect Instagram" button → Instagram Login → `/meta/oauth/callback` → exchange code → long-lived token → save `igAccounts` → subscribe the account to webhook fields (`messages`, `messaging_postbacks`, `comments`, `mentions`)
- [ ] Accounts page: list, status, disconnect, reconnect
- [ ] Cron: refresh tokens expiring within 10 days; mark `expired` on failure

## Phase 3: Webhook pipeline + inbox
- [ ] `GET /meta/webhook` verification (`hub.mode`, `hub.verify_token`, `hub.challenge`)
- [ ] `POST /meta/webhook`: signature check (`instagram/signature.ts` + tests), parse (`instagram/parse.ts` + fixture tests), ingest mutation with dedupe
- [ ] Contacts + conversations + messages upsert; contact profile fetch (name, username)
- [ ] Inbox UI: conversation list (live), thread view, send a human reply (uses `HUMAN_AGENT` tag when outside 24h), take over / give back to bot
- [ ] Rate-limited outbound send helper (per igAccount)

## Phase 4: Automation engine + templates
- [ ] `engine/graph.ts` zod schema for the graph (see ARCHITECTURE §5) + validation tests
- [ ] `engine/router.ts` trigger matching (pure) + tests
- [ ] `engine/runner.ts` Workflow interpreter: message, quickReplies, card, filter, action, wait, waitForReply, handoff
- [ ] Templates + forms UI:
  - [ ] Default reply (with business-hours filter → AI or "we'll reply soon")
  - [ ] Keyword reply
  - [ ] Welcome message
  - [ ] Comment-to-DM (private reply + optional public reply)
  - [ ] Story mention reply
- [ ] Automations page: list, enable/disable, edit via form, per-trigger stats (sent count)

## Phase 5: AI agent node
- [ ] `ai/agent.ts`: Convex Agent with Claude (`claude-haiku-5-5` default), system prompt = org instructions + node instructions + knowledge
- [ ] Tools: `handoff_to_human`, `exit_flow`, `save_lead_field`
- [ ] `aiAgent` node loop with exit / timeout / quota ports
- [ ] Quota (`ai/quota.ts`) + usage tracking + Usage page
- [ ] Knowledge page (FAQ / product text per org)
- [ ] Optional BYO Anthropic key per org (encrypted)

## Phase 6: Hardening for real customers
- [ ] Privacy policy, terms, **data deletion callback** endpoint (`/meta/data-deletion`) + deauthorize callback
- [ ] Meta Business Verification (owner) + App Review screencasts for `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`
- [ ] Error monitoring, webhook event retention cron, admin view of failed runs
- [ ] Billing (Stripe or Polar), plans → `aiMonthlyQuota`
- [ ] Onboarding wizard for non-technical small businesses (Spanish-first copy)

## Later / ideas
- Visual flow builder (React Flow / xyflow) on the existing graph format
- Catalog integration: AI tools `search_catalog`, `get_variants`, `quote` (prices computed in code), with leads/orders POSTed to the owner's catalog app
- WhatsApp channel (Cloud API) reusing the engine
- Web chat widget channel
- Broadcasts to contacts inside the 24h window, plus ice breakers / persistent menu management
