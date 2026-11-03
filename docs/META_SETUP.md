# Meta / Instagram setup and rules

> Meta changes these screens and limits often. Treat the steps as a guide and confirm against
> developers.facebook.com (Instagram Platform → "Instagram API with Instagram Login").

## 1. Requirements
- An Instagram **professional** account (Business or Creator). Personal accounts can't use the API.
- A Meta developer account and a Meta app of type **Business**, with the **Instagram** product added and configured for "API setup with Instagram login".
- A public HTTPS URL for webhooks. Use the Convex HTTP actions URL: `https://<deployment>.convex.site/meta/webhook`.

## 2. Access levels
| Level | Who can connect | What's needed |
|---|---|---|
| **Standard Access** (start here) | Instagram accounts that have a role on the app (admin / developer / tester) | Nothing beyond app setup. Free. |
| **Advanced Access** | Any professional account (real customers) | **Business Verification** (registered business + documents) and **App Review** per permission (screencast + description). Takes about 2–6 weeks, often over several rounds. |

Known issue to check on day one: some developers report `messages` webhooks not arriving on Standard Access or in Development mode even though the Conversations API shows the DM. If that happens, try switching the app to Live mode, and check the Meta developer community.

## 3. Permissions (Instagram Login scopes)
- `instagram_business_basic`: profile and account id
- `instagram_business_manage_messages`: receive and send DMs
- `instagram_business_manage_comments`: read comments, private replies, public replies
- (later) `instagram_business_content_publish`: only if we add publishing

## 4. Webhook setup
1. In the app dashboard → Instagram → Webhooks: callback URL `https://<deployment>.convex.site/meta/webhook`, verify token = `META_WEBHOOK_VERIFY_TOKEN`.
2. Subscribe to these fields: `messages`, `messaging_postbacks`, `messaging_seen` (optional), `comments`, `mentions` (story mentions arrive as messages with `story_mention` attachments), `messaging_referral` (ads/ref links, optional).
3. **Configuring the callback doesn't subscribe an account.** After OAuth, our code calls the subscribed-apps endpoint for each connected account (see `instagram/oauth.ts`).
4. Test by sending a DM from a **different** Instagram account.

## 5. Values to put in Convex env
`META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_GRAPH_VERSION`.
OAuth redirect URI to register in the app: `https://<deployment>.convex.site/meta/oauth/callback`.

## 6. Messaging rules the product must enforce
- **User-initiated only.** You can only message people who messaged you, commented, or mentioned you. No cold DMs.
- **24-hour window** from the user's last message for automated messages.
- **`HUMAN_AGENT` tag:** a human (not the bot) can reply up to **7 days** after the last user message.
- **Private replies to comments:** one private DM per comment. Rate limit of about **750/hour per account**.
- Send API: about 100–300 calls/second per account (sources disagree; stay conservative). Conversations API: 2 calls/second.
- Every bot experience must offer a way to reach a human (our `handoff` node + inbox).
- **No new-follower webhook.** "Welcome on follow" isn't possible.
- Quick replies: max 13. Generic template (carousel): max 10 elements. Ice breakers: max 4.

## 7. App Review checklist (Phase 6)
- [ ] Business Verification completed in Meta Business Manager
- [ ] Privacy policy URL, terms URL, app icon, category
- [ ] Data deletion callback URL (or instructions URL) + deauthorize callback
- [ ] Screencast per permission showing: login → connect IG → the feature using that permission
- [ ] Test credentials for reviewers (a test workspace)
- [ ] Clear description of use: "Businesses automate replies to their own Instagram DMs and comments, with optional AI assistant and human handoff."
