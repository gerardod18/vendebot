import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { webhook as billingWebhook } from "./billing";
import { dataDeletion, deauthorize, oauthCallback, receiveWebhook, verifyWebhook } from "./meta";

const http = httpRouter();

// Better Auth endpoints under /api/auth/*
authComponent.registerRoutes(http, createAuth, { cors: true });

// Instagram webhooks
http.route({ path: "/meta/webhook", method: "GET", handler: verifyWebhook });
http.route({ path: "/meta/webhook", method: "POST", handler: receiveWebhook });

http.route({ path: "/meta/oauth/callback", method: "GET", handler: oauthCallback });
http.route({ path: "/meta/data-deletion", method: "POST", handler: dataDeletion });
http.route({ path: "/meta/deauthorize", method: "POST", handler: deauthorize });

http.route({ path: "/billing/webhook", method: "POST", handler: billingWebhook });

export default http;
