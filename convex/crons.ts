import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.daily("refresh instagram tokens", { hourUTC: 6, minuteUTC: 0 }, internal.accounts.refreshTokens, {});
crons.daily("retention cleanup", { hourUTC: 7, minuteUTC: 30 }, internal.admin.retentionCleanup, {});
export default crons;
