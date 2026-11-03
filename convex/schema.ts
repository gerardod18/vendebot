import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Data model. See docs/ARCHITECTURE.md §3.
 * Every tenant table carries `orgId` and is indexed by it first.
 * Better Auth's own tables (user, session, account, ...) live inside the betterAuth component.
 */

export const roleValidator = v.union(v.literal("owner"), v.literal("admin"), v.literal("agent"));

export const conversationMode = v.union(v.literal("bot"), v.literal("human"));

export const messageDirection = v.union(v.literal("in"), v.literal("out"));
export const messageSource = v.union(
  v.literal("contact"),
  v.literal("bot"),
  v.literal("ai"),
  v.literal("human"),
);
export const messageKind = v.union(
  v.literal("text"),
  v.literal("quick_reply"),
  v.literal("postback"),
  v.literal("media"),
  v.literal("story_mention"),
  v.literal("story_reply"),
  v.literal("comment"),
  v.literal("template"),
);

export const triggerType = v.union(
  v.literal("welcome"),
  v.literal("keyword"),
  v.literal("default"),
  v.literal("comment"),
  v.literal("storyMention"),
  v.literal("postback"),
);

export default defineSchema({
  // ---- Tenancy (D9: own tables instead of the Better Auth organization plugin) ----
  orgs: defineTable({
    name: v.string(),
    slug: v.string(),
    createdBy: v.string(), // Better Auth user id
  }).index("by_slug", ["slug"]),

  members: defineTable({
    orgId: v.id("orgs"),
    userId: v.string(), // Better Auth user id
    role: roleValidator,
  })
    .index("by_org", ["orgId"])
    .index("by_user", ["userId"])
    .index("by_org_user", ["orgId", "userId"]),

  invites: defineTable({
    orgId: v.id("orgs"),
    email: v.string(),
    role: roleValidator,
    token: v.string(),
    invitedBy: v.string(),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_token", ["token"]),

  orgSettings: defineTable({
    orgId: v.id("orgs"),
    plan: v.string(),
    aiModel: v.string(),
    aiMonthlyQuota: v.number(),
    byoAnthropicKeyEnc: v.optional(v.string()),
    timezone: v.string(),
    businessHours: v.object({
      days: v.array(v.number()), // 0 = Sunday ... 6 = Saturday
      start: v.string(), // "08:00"
      end: v.string(), // "17:00"
    }),
    defaultLanguage: v.string(),
    aiInstructions: v.optional(v.string()),
  }).index("by_org", ["orgId"]),

  // ---- Instagram ----
  igAccounts: defineTable({
    orgId: v.id("orgs"),
    igUserId: v.string(), // IG professional account id (webhook entry.id)
    username: v.string(),
    name: v.optional(v.string()),
    profilePictureUrl: v.optional(v.string()),
    tokenEnc: v.string(),
    tokenExpiresAt: v.number(),
    status: v.union(v.literal("active"), v.literal("expired"), v.literal("revoked")),
    webhookSubscribed: v.boolean(),
    connectedBy: v.string(),
  })
    .index("by_org", ["orgId"])
    .index("by_igUserId", ["igUserId"])
    .index("by_tokenExpiresAt", ["tokenExpiresAt"]),

  /** Short-lived OAuth state for the "Connect Instagram" flow (CSRF protection). */
  oauthStates: defineTable({
    orgId: v.id("orgs"),
    userId: v.string(),
    state: v.string(),
    expiresAt: v.number(),
  }).index("by_state", ["state"]),

  contacts: defineTable({
    orgId: v.id("orgs"),
    igAccountId: v.id("igAccounts"),
    igsid: v.string(), // Instagram-scoped id of the user talking to us
    username: v.optional(v.string()),
    name: v.optional(v.string()),
    profilePic: v.optional(v.string()),
    tags: v.array(v.string()),
    fields: v.record(v.string(), v.string()),
    lastInboundAt: v.optional(v.number()),
    firstSeenAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_account_igsid", ["igAccountId", "igsid"]),

  conversations: defineTable({
    orgId: v.id("orgs"),
    igAccountId: v.id("igAccounts"),
    contactId: v.id("contacts"),
    mode: conversationMode,
    assignedTo: v.optional(v.string()),
    lastMessageAt: v.number(),
    lastMessagePreview: v.optional(v.string()),
    unread: v.number(),
    agentThreadId: v.optional(v.string()),
  })
    .index("by_org_lastMessageAt", ["orgId", "lastMessageAt"])
    .index("by_contact", ["contactId"]),

  messages: defineTable({
    orgId: v.id("orgs"),
    conversationId: v.id("conversations"),
    direction: messageDirection,
    source: messageSource,
    kind: messageKind,
    text: v.optional(v.string()),
    payload: v.optional(v.any()),
    mid: v.optional(v.string()),
    sentAt: v.number(),
    status: v.union(v.literal("received"), v.literal("queued"), v.literal("sent"), v.literal("failed")),
    error: v.optional(v.string()),
  })
    .index("by_conversation", ["conversationId", "sentAt"])
    .index("by_mid", ["mid"]),

  webhookEvents: defineTable({
    dedupeKey: v.string(),
    orgId: v.optional(v.id("orgs")),
    igAccountId: v.optional(v.id("igAccounts")),
    type: v.string(),
    raw: v.any(),
    receivedAt: v.number(),
    processedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_dedupeKey", ["dedupeKey"])
    .index("by_receivedAt", ["receivedAt"]),

  // ---- Automations ----
  flows: defineTable({
    orgId: v.id("orgs"),
    name: v.string(),
    templateKey: v.optional(v.string()),
    templateConfig: v.optional(v.any()), // the form values used to build the graph
    activeVersionId: v.optional(v.id("flowVersions")),
    archived: v.boolean(),
  }).index("by_org", ["orgId"]),

  flowVersions: defineTable({
    orgId: v.id("orgs"),
    flowId: v.id("flows"),
    version: v.number(),
    graph: v.any(), // validated by convex/engine/graph.ts
    createdBy: v.string(),
  }).index("by_flow", ["flowId", "version"]),

  triggers: defineTable({
    orgId: v.id("orgs"),
    igAccountId: v.id("igAccounts"),
    type: triggerType,
    config: v.any(), // validated by convex/engine/router.ts
    flowId: v.id("flows"),
    enabled: v.boolean(),
    priority: v.number(),
    firedCount: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_account", ["igAccountId"]),

  flowRuns: defineTable({
    orgId: v.id("orgs"),
    flowVersionId: v.id("flowVersions"),
    contactId: v.id("contacts"),
    conversationId: v.id("conversations"),
    workflowId: v.optional(v.string()),
    status: v.union(
      v.literal("running"),
      v.literal("waiting"),
      v.literal("done"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    currentNodeId: v.optional(v.string()),
    waitingFor: v.optional(v.union(v.literal("reply"), v.literal("ai"))),
    vars: v.record(v.string(), v.string()),
    error: v.optional(v.string()),
    endedAt: v.optional(v.number()),
  })
    .index("by_conversation_status", ["conversationId", "status"])
    .index("by_org", ["orgId"]),

  // ---- AI ----
  knowledge: defineTable({
    orgId: v.id("orgs"),
    title: v.string(),
    content: v.string(),
  }).index("by_org", ["orgId"]),

  usage: defineTable({
    orgId: v.id("orgs"),
    month: v.string(), // YYYY-MM
    aiReplies: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsdMicros: v.number(),
    outboundMessages: v.number(),
  }).index("by_org_month", ["orgId", "month"]),
});
