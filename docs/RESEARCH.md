# Research notes (Nov 2026)

A summary of the research done before starting. It's background only; decisions live in `DECISIONS.md`.

## How SendPulse / Manychat-style bots work
- **Flow builder + AI block + human inbox.** Most messages are deterministic (keywords, menus, templates) and cost almost nothing. The AI step is metered: SendPulse uses a "subscriber AI limit not reached" filter and lets users plug in their own OpenAI key.
- SendPulse flow seen in the owner's account: trigger "default reply" → Filter (AI quota available? weekdays 08:00–17:00?) → AI Agent node (prompt with `{{full_name}}`, exit condition, 1h timeout) → Action (add note) / Message "we'll reply in a few minutes".
- Free tiers are funnels: subscriber limits, branding, and WhatsApp excluded.
- Blip (LATAM): Builder flows + an agent Studio with LLM, knowledge base and guardrails, plus Blip Desk (human queues). Blip Go for SMBs is a fixed monthly fee with AI replies included.

## Industry pattern for agentic chatbots
Hybrid: **the LLM understands, the code decides** (Rasa CALM, Google Conversational Agents flows + playbooks, Blip Studio). Business rules, prices and transactions are deterministic. The LLM handles language, routing and detours. This is what our graph engine + `aiAgent` node implements.

## LLM cost per reply (Anthropic, Nov 2026, per 1M tokens)
| Model | Input | Output | ~per reply (3k in / 250 out) |
|---|---|---|---|
| claude-haiku-5-5 | $0.10 | $0.50 | ~$0.0005–0.001 |
| claude-sonnet-5-5 | $2 | $10 | ~$0.01–0.02 |
| claude-opus-5-5 | $4 | $20 | ~$0.02–0.04 |

A small business with ~1,800 AI replies/month costs about $1–3 on Haiku 5.5.

## Instagram platform facts
- The API is free (no per-message fee, unlike WhatsApp).
- Standard Access covers accounts you own or that have a role on the app. Advanced Access needs Business Verification + App Review.
- 24h window; HUMAN_AGENT tag for 7 days (humans only); private replies limited to 750/hour; no follower webhook.

## WhatsApp notes (future channel)
- Meta charges per message (since July 2025). The "Meta Business Agent" category has been billed per token since Aug 2026. Utility/service pricing changed Oct 2026, so check the rate card.
- General-purpose AI assistants are banned on the WhatsApp Business API since Jan 15, 2026 (business-specific bots are allowed; the EU forced access to be restored in 2026).
- Use the official Cloud API (direct, 360dialog, or Kapso). Avoid Baileys / Evolution API (ban risk).
- WhatsApp Flows is the best way to configure product variants (forms inside WhatsApp).

## Open-source references worth reading
- InstaAuto: https://github.com/ayuuxh2/insta-p8 (Next.js + Supabase; keyword DMs, comment-to-DM, story replies, AI fallback, inbox)
- OpenReply: https://github.com/diwenne/openreply (comment-to-DM)
- Nudgra (TanStack Start + Hono + Postgres; launch post on dev.to)
- Chatwoot (Instagram channel implementation, Ruby; MIT core)

## Frameworks considered for the agent runtime
- **Convex Agent** (chosen): threads, tools, usage tracking, durable Workflow component, reactive DB.
- TanStack AI 1.0 (Oct 2026): good loop and approvals, but most of its value is the client side.
- Vercel AI SDK + Chat SDK: official WhatsApp adapter, and an Instagram adapter now listed.
- Mastra (workflows with suspend/resume), Cloudflare Agents SDK (a Durable Object per conversation), Inngest AgentKit, LangGraph.
