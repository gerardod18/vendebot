import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { receiveWebhook, verifyWebhook } from "./meta";

const http = httpRouter();

// Better Auth endpoints under /api/auth/*
authComponent.registerRoutes(http, createAuth, { cors: true });

// Instagram webhooks
http.route({ path: "/meta/webhook", method: "GET", handler: verifyWebhook });
http.route({ path: "/meta/webhook", method: "POST", handler: receiveWebhook });

export default http;
