# vendebot: agent instructions

vendebot is a **multi-tenant Instagram DM automation SaaS** (in the style of SendPulse and Manychat) with an **AI sales agent** node.
Stack: React + Convex. Instagram comes first; WhatsApp and web chat come later.
The owner uses it for their own projects first, and may later sell it to very small businesses.

## Read these first (in order)
1. `docs/STATUS.md`: what is done, what is next, known issues. **Start here every session.**
2. `docs/PLAN.md`: the phased roadmap with checkboxes. Pick the first unchecked item in the current phase.
3. `docs/ARCHITECTURE.md`: data model, event pipeline, flow engine, folder layout.
4. `docs/DECISIONS.md`: decisions already made. Don't reopen them unless the owner asks.
5. `docs/META_SETUP.md`: Meta app / Instagram API setup, limits and policy rules.
6. `docs/RESEARCH.md`: background research (market, pricing, LLM costs, alternatives).

## Working rules
- **Update `docs/STATUS.md` and tick `docs/PLAN.md` at the end of every work session**, so the next agent can continue.
- Small, focused commits. Conventional commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`).
- **Tenant isolation is mandatory.** Every table except auth tables and global config has `orgId`. Every public query or mutation goes through the org-scoped wrappers in `convex/lib/tenancy.ts`. Never call a raw `query` or `mutation` for tenant data.
- **Deterministic first, LLM last.** Triggers, filters, menus and keyword replies never call the LLM. The AI node only runs when a flow reaches it, and it is metered (see the quota rules in ARCHITECTURE).
- **Prices, options and any business rule are computed in code, never by the LLM.**
- Webhook handlers must be **idempotent**: dedupe by Instagram message id (`mid`) or comment id.
- Instagram access tokens are **encrypted at rest** (`convex/lib/crypto.ts`). Never log them.
- Don't add new infrastructure (queues, extra DBs) without a decision entry. Convex components cover queues (Workpool), durable flows (Workflow), rate limits (Rate Limiter) and the AI agent (Agent).
- The default AI model is `claude-haiku-5-5` (cheap). `claude-sonnet-5-5` is the optional "smart" tier per workspace. The provider stays swappable through the AI SDK (`@ai-sdk/anthropic`).
- Install with `npm install`. `.npmrc` sets `legacy-peer-deps=true` (see Known issues in STATUS).

## Commands
- `npm run dev`: Vite + `convex dev` (needs a Convex deployment: run `npx convex dev` once to log in or create one)
- `npm run typecheck`
- `npm test`: vitest + convex-test
- `npm run build`

## Environment variables
See `.env.example` (frontend) and the Convex dashboard env vars listed in `docs/META_SETUP.md` and `docs/ARCHITECTURE.md`.
