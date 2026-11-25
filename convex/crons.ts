import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.daily("retention cleanup", { hourUTC: 7, minuteUTC: 30 }, internal.admin.retentionCleanup, {});
export default crons;
