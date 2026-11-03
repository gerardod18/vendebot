import { defineApp } from "convex/server";
import agent from "@convex-dev/agent/convex.config";
import workflow from "@convex-dev/workflow/convex.config";
import workpool from "@convex-dev/workpool/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import betterAuth from "@convex-dev/better-auth/convex.config";

const app = defineApp();
app.use(betterAuth);
app.use(agent);
app.use(workflow);
// Fair queue for inbound webhook processing (see docs/ARCHITECTURE.md §1).
app.use(workpool, { name: "eventPool" });
app.use(rateLimiter);

export default app;
