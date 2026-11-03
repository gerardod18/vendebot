# Decisions log

Short ADR-style entries. Add new ones at the bottom. Don't rewrite old ones; supersede them instead.

---

## D1: Product scope: multi-tenant Instagram-first automation SaaS
- **Date:** 2026-11-03
- **Decision:** Build a SendPulse/Manychat-style platform, **Instagram DMs only** for v1. WhatsApp and web chat come later as extra channels on the same engine.
- **Why:** The owner wants it for their own projects first, then possibly to sell to very small businesses. This is not about competing with incumbents. Instagram's API is free to use, while WhatsApp charges per message and has stricter AI policies.
- **Implication:** Design for multi-tenancy from day one (orgs, members, per-org Instagram accounts) even while only the owner's accounts are connected.

## D2: Stack: React + Convex
- **Decision:** Vite + React 19 frontend. Convex for the database, functions, realtime, scheduler and HTTP actions.
- **Why:** The live inbox and flow-run status are realtime for free. HTTP actions receive Meta webhooks. Components cover durable workflows, queues, rate limits and the AI agent, so there is no second system to run.
- **Alternatives considered:** Supabase + Inngest/Trigger.dev (3 systems instead of 1); Next.js + Postgres + Redis/BullMQ.

## D3: Auth: Better Auth + `@convex-dev/better-auth` with the organization plugin
- **Decision:** Better Auth (open source) through its Convex component. The Better Auth **organization plugin** provides workspaces, members, roles and invitations.
- **Why:** The owner chose it: no vendor lock-in, and orgs are built in. Clerk was the faster option; Convex Auth has no org model.
- **Constraint:** `@convex-dev/better-auth@0.12.x` requires `better-auth >=1.6.11 <1.7.0`. **Pin better-auth to 1.6.x** until the component supports 1.7.

## D4: Flow building: templates/forms first, visual canvas later
- **Decision:** v1 ships automation **templates** configured with forms (keyword reply, default reply, comment-to-DM, story-mention reply, AI agent with handoff). The engine stores flows as a **graph (nodes + edges JSON)** from day one, so a React Flow (xyflow) canvas can be added later without a migration.
- **Why:** The visual builder is the most expensive piece and isn't needed to be useful.

## D5: AI: Anthropic Claude through the Convex Agent component
- **Decision:** `@convex-dev/agent` + AI SDK + `@ai-sdk/anthropic`. Default model `claude-haiku-5-5`; optional `claude-sonnet-5-5` per workspace.
- **Cost reference** (Nov 2026, per 1M tokens):

  | Model | Input | Output |
  |---|---|---|
  | Haiku 5.5 | $0.10 | $0.50 |
  | Sonnet 5.5 | $2 | $10 (cache reads $0.20) |
  | Opus 5.5 | $4 | $20 |

  A typical reply of about 3k input + 250 output tokens costs roughly $0.0005–0.001 on Haiku 5.5 and $0.01–0.02 on Sonnet 5.5.
- **Guardrails:** per-org monthly AI quota (Rate Limiter + `usage` table), with a fallback branch when it's exceeded (as SendPulse does). Optional bring-your-own Anthropic key per org (stored encrypted). Prompt caching for system prompt and knowledge. Short history window.

## D6: Durable execution and fairness: Convex Workflow + Workpool + Rate Limiter
- **Decision:** Flow runs are Convex Workflows that interpret the flow graph. Webhook processing goes through a Workpool (bounded concurrency, so one viral tenant can't starve the others). Meta send limits are enforced per Instagram account with the Rate Limiter.
- **Why:** Durable sleeps and timeouts ("AI step exits after 1h", follow-ups), retries, and no external queue.

## D7: Instagram integration: thin hand-written Graph API client
- **Decision:** A small typed client in `convex/instagram/` (send message, quick replies, generic template, private reply, user profile, token refresh, subscribe webhooks). We don't use Chat SDK's Instagram adapter.
- **Why:** Chat SDK brings its own runtime and state model. Inside Convex a ~300-line client is simpler and fully under our control.

## D8: Meta access strategy
- **Decision:** Develop on **Standard Access** with the owner's own Instagram professional accounts, added as testers or roles on the Meta app. No App Review is needed for that.
- **Later:** Business Verification + App Review for Advanced Access, needed only before onboarding accounts the owner doesn't control (selling to SMBs). See `META_SETUP.md`.
