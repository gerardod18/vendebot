# vendebot

Multi-tenant **Instagram DM automation** with an **AI sales agent** and human handoff, in the style of SendPulse and Manychat.
Built with **React + Convex** and **Claude** (Anthropic).

- Triggers: welcome, keywords, default reply, comment-to-DM, story mentions
- Flows as graphs (templates/forms first, visual builder later)
- AI agent node with quotas, knowledge, and handoff to a live inbox
- Workspaces (organizations) with members, via Better Auth

> Status: early. See [`docs/STATUS.md`](docs/STATUS.md) and the roadmap in [`docs/PLAN.md`](docs/PLAN.md).

## Docs
| File | What |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Rules for AI agents working on this repo |
| [`docs/STATUS.md`](docs/STATUS.md) | Current state, next steps, known issues (handoff) |
| [`docs/PLAN.md`](docs/PLAN.md) | Phased roadmap with checkboxes |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Pipeline, data model, flow graph, env vars |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Decision log |
| [`docs/META_SETUP.md`](docs/META_SETUP.md) | Meta app / Instagram API setup and messaging rules |
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | Background research |

## Getting started (once Phase 0 lands)
```bash
npm install
npx convex dev        # first time: log in / create a deployment
npm run dev
```
Set the Convex env vars listed in `docs/ARCHITECTURE.md` §8.
