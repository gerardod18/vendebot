import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

// Better Auth endpoints under /api/auth/*
authComponent.registerRoutes(http, createAuth, { cors: true });

export default http;
