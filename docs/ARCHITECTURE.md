# Architecture

## 1. Big picture

```
Instagram user ──DM / comment / story mention──► Meta
                                                 │ webhook (POST, X-Hub-Signature-256)
                                                 ▼
┌──────────────────────────── Convex ────────────────────────────────────┐
│ http.ts  /meta/webhook   GET: verify hub.challenge                      │
│                          POST: verify signature → ingest mutation → 200 │
│                                                                          │
│ ingest (mutation): resolve igAccount → org, dedupe by mid/commentId,     │
│   insert webhookEvents, upsert contact + conversation, store inbound msg │
│   → enqueue processEvent on Workpool                                     │
│                                                                          │
│ processEvent: if conversation.mode == "human" → stop (human handles it)  │
│   if a flowRun is waiting for this contact → resume it                   │
│   else trigger router → pick a flow → start a Workflow run               │
│                                                                          │
│ Workflow runner: walks flowVersion.graph node by node                    │
│   message · quickReplies · filter · aiAgent · action · wait · handoff    │
│   each send → instagram client (rate-limited per igAccount)              │
│                                                                          │
│ Agent component: threads per conversation, tools, usage → usage table    │
│ Crons: refresh IG tokens, reset quotas, clean old events                 │
└──────────────────────────────────────────────────────────────────────────┘
                                                 ▲
React app (Vite) ── Better Auth session ──────────┘
  workspaces · connect Instagram · automations (templates) · live inbox · usage
```

## 2. Folder layout (target)

```
convex/
  convex.config.ts        # app.use(agent, workflow, workpool, rateLimiter, betterAuth)
  schema.ts
  auth.ts                 # Better Auth instance + organization plugin (createAuth)
  auth.config.ts
  http.ts                 # Better Auth routes + /meta/webhook + /meta/oauth/callback
  crons.ts
  lib/
    tenancy.ts            # orgQuery/orgMutation wrappers (session → member → orgId, role checks)
    crypto.ts             # AES-GCM encrypt/decrypt for tokens (key: TOKEN_ENCRYPTION_KEY)
    validators.ts
  instagram/
    client.ts             # Graph API calls (pure fetch, typed)
    signature.ts          # X-Hub-Signature-256 verification (HMAC SHA-256 with META_APP_SECRET)
    parse.ts              # webhook payload → normalized InboundEvent[]
    oauth.ts              # connect flow: build auth URL, exchange code, long-lived token, subscribe
    accounts.ts           # igAccounts queries/mutations
  engine/
    ingest.ts             # ingest mutation + processEvent
    router.ts             # trigger matching (pure function, unit tested)
    graph.ts              # flow graph types + validation (zod)
    runner.ts             # Workflow definition interpreting the graph
    nodes/                # one file per node type
    templates.ts          # template → graph builders (keyword reply, comment-to-DM, ...)
  ai/
    agent.ts              # Agent definition (Claude), system prompt builder, tools
    quota.ts              # per-org AI quota (rate limiter + usage table)
  inbox.ts                # conversations/messages queries, takeover/release, human send
  automations.ts          # CRUD for triggers + flows (template forms)
  usage.ts
src/
  main.tsx, App.tsx, routes/
  lib/auth-client.ts      # better-auth react client + convex plugin
  pages/ Login, Workspaces, Accounts (connect IG), Automations, Inbox, Usage, Settings
  components/
tests/                    # vitest + convex-test
docs/
```

## 3. Data model (Convex tables)

All tenant tables have `orgId` (the Better Auth organization id, string) and an index starting with `orgId`.

| Table | Key fields | Notes |
|---|---|---|
| `igAccounts` | orgId, igUserId (IG professional account id), username, tokenEnc, tokenExpiresAt, status (`active`/`expired`/`revoked`), webhookSubscribed | Index `by_igUserId` (global): routes webhooks to the org. One IG account belongs to one org. |
| `contacts` | orgId, igAccountId, igsid (Instagram-scoped user id), username, name, profilePic, tags[], fields (record), lastInboundAt | `lastInboundAt` drives the 24h window. Index `by_account_igsid`. |
| `conversations` | orgId, igAccountId, contactId, mode (`bot`/`human`), assignedTo?, lastMessageAt, unread, agentThreadId? | `mode=human` pauses automation. |
| `messages` | orgId, conversationId, direction (`in`/`out`), source (`contact`/`bot`/`human`/`ai`), kind (`text`/`quick_reply`/`postback`/`media`/`story_mention`/`comment`), text, payload, mid, sentAt, status | Index `by_conversation`, `by_mid`. |
| `webhookEvents` | orgId?, igAccountId?, dedupeKey (mid / comment id / postback id), type, raw, receivedAt, processedAt?, error? | Unique by `dedupeKey`. TTL cleanup cron. |
| `flows` | orgId, name, templateKey?, activeVersionId?, archived | |
| `flowVersions` | orgId, flowId, version, graph (JSON validated by `engine/graph.ts`), createdBy, createdAt | Immutable once published. |
| `triggers` | orgId, igAccountId, type, config, flowId, enabled, priority | See trigger types below. |
| `flowRuns` | orgId, flowVersionId, contactId, conversationId, workflowId, status (`running`/`waiting`/`done`/`failed`/`cancelled`), currentNodeId, vars, startedAt, endedAt | One active run per conversation. |
| `orgSettings` | orgId, plan, aiModel (`claude-haiku-5-5`/`claude-sonnet-5-5`), aiMonthlyQuota, byoAnthropicKeyEnc?, businessHours, timezone, defaultLanguage | |
| `usage` | orgId, month (`YYYY-MM`), aiReplies, inputTokens, outputTokens, costUsdMicros, outboundMessages | Updated by the agent usage handler. |
| `knowledge` | orgId, title, content | Simple FAQ / product text for the AI node v1. Later this becomes the catalog integration. |

Better Auth tables (user, session, organization, member, invitation) live inside the Better Auth component.

## 4. Triggers (v1)

| Type | Fires on | Config |
|---|---|---|
| `welcome` | first ever inbound message from a contact | — |
| `keyword` | DM text matches | `{ keywords: string[], match: "exact" \| "contains" }` |
| `default` | inbound DM that no other trigger matched | — |
| `comment` | comment on a post or reel | `{ mediaIds?: string[] \| "any", keywords?: string[], publicReply?: string }` → private reply DM (one per comment) |
| `storyMention` | the contact mentions the account in a story | — |
| `quickReplyPayload` / `postback` | button or quick reply tapped | `{ payload }` (usually handled inside the running flow) |

Router priority: an active `flowRun` waiting for input wins, then `quickReplyPayload`, `keyword`, `welcome`, `comment`, `storyMention`, `default`. Pure function in `engine/router.ts`, unit tested.

## 5. Flow graph (stored in `flowVersions.graph`)

```ts
type Graph = { startNodeId: string; nodes: Node[]; edges: Edge[] };
type Edge  = { from: string; port: string /* "next" | "yes" | "no" | "timeout" | "exit" | payload */; to: string };
type Node =
  | { id; type: "message";      text: string /* supports {{first_name}} etc. */ }
  | { id; type: "quickReplies"; text: string; options: { title: string; payload: string }[] } // max 13
  | { id; type: "card";         elements: GenericTemplateElement[] }                           // carousel, max 10
  | { id; type: "filter";       conditions: Condition[]; mode: "all" | "any" }                 // ports yes/no
  | { id; type: "aiAgent";      instructions: string; exitWhen: string; timeoutMinutes: number;
                                model?: string; useKnowledge: boolean }                          // ports exit/timeout/quota
  | { id; type: "action";       actions: ({ kind: "addTag"; tag } | { kind: "setField"; key; value }
                                         | { kind: "note"; text } | { kind: "http"; url; method; body })[] }
  | { id; type: "wait";         minutes: number }
  | { id; type: "waitForReply"; timeoutMinutes: number; saveAs?: string }                     // ports next/timeout
  | { id; type: "handoff";      message?: string };                                           // sets conversation.mode = "human"
type Condition =
  | { kind: "businessHours" } | { kind: "aiQuotaAvailable" } | { kind: "hasTag"; tag }
  | { kind: "field"; key; op: "eq" | "neq" | "contains"; value };
```

Rules:
- Before sending anything that isn't a reply inside the 24h window, the runner checks `contact.lastInboundAt`. Outside the window it skips the send and marks the run `failed` with reason `window_closed`. Human replies use the `HUMAN_AGENT` tag (7 days).
- `aiAgent` node: loops `contact message → agent reply` until the model calls the `exit` tool (with a reason), the timeout fires, or the quota runs out. Tools: `handoff_to_human`, `exit_flow`, `save_lead_field`, and later `search_catalog`/`quote`.
- Every node execution is idempotent with respect to Workflow retries (steps are journaled by the Workflow component).

## 6. AI quota and cost control
- `quota.ts`: `checkAndConsume(orgId)` uses the Rate Limiter (monthly bucket = `orgSettings.aiMonthlyQuota`) before each AI call. The filter condition `aiQuotaAvailable` uses the same check.
- The Agent `usageHandler` writes tokens and estimated cost to `usage` (price table in `ai/agent.ts`).
- If the org has a BYO key, its key is used and no quota applies, though usage is still recorded.

## 7. Meta specifics the code must respect
See `META_SETUP.md`. Key ones:
- Verify `X-Hub-Signature-256` on every POST (HMAC-SHA256 of the raw body with `META_APP_SECRET`).
- Respond 200 fast. Do all work async (Workpool).
- Instagram token lifetime is about 60 days → daily cron refreshes tokens expiring within 10 days.
- Rate limits: Send API ~100–300 calls/s per account (sources differ, so stay conservative), private replies 750/hour per account, Conversations API 2/s.
- No "new follower" webhook exists. Don't build a "welcome on follow" feature.

## 8. Environment variables (Convex dashboard → Settings → Environment Variables)
| Var | Purpose |
|---|---|
| `SITE_URL` | Frontend URL (Better Auth trusted origin, OAuth return) |
| `BETTER_AUTH_SECRET` | Better Auth secret |
| `META_APP_ID`, `META_APP_SECRET` | Meta app (Instagram API with Instagram Login) |
| `META_WEBHOOK_VERIFY_TOKEN` | Random string used in the webhook GET verification |
| `META_GRAPH_VERSION` | e.g. `v24.0` (check the current version in Meta's docs) |
| `TOKEN_ENCRYPTION_KEY` | 32-byte base64 key for AES-GCM |
| `ANTHROPIC_API_KEY` | Platform Anthropic key (default AI provider) |

Frontend (`.env.local`): `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`.
