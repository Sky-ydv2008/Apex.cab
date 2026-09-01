import path from "node:path";
import fs from "node:fs";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { ridesRouter } from "./routes/rides.js";
import { driversRouter } from "./routes/drivers.js";
import { demoRouter } from "./x402/demo.js";
import { x402RideMiddleware, initX402ResourceServer } from "./x402/resource.js";

/**
 * Express app factory. The x402 resource server must be initialized first
 * (initX402ResourceServer) — it fetches facilitator support from GoPlausible.
 */
export function createApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");

  app.use(
    helmet({
      // CSP for the served rider/driver apps (JSON API responses are unaffected).
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https://tile.openstreetmap.org"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  app.use(
    cors({
      origin: config.corsOrigins,
      methods: ["GET", "POST", "PATCH", "OPTIONS"],
      allowedHeaders: [
        "content-type",
        "authorization",
        "payment-signature",
        "payment-required",
        "payment-response",
      ],
      exposedHeaders: ["payment-required", "payment-response"],
    }),
  );

  app.use(express.json({ limit: "100kb" }));

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "rate limit exceeded — slow down" },
  });
  const authLimiter = rateLimit({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too many login attempts" },
  });
  const paymentLimiter = rateLimit({
    windowMs: 60_000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too many payment requests" },
  });

  app.use("/api", apiLimiter);
  app.post("/api/customers/login", authLimiter);
  app.post("/api/drivers/login", authLimiter);
  app.post("/api/demo/fund", paymentLimiter);
  app.post("/api/demo/book-and-pay", paymentLimiter);

  // x402-protected resource — deliberately unauthenticated: the x402 payment
  // is the credential. Ride ownership is checked before the ride is created,
  // and the resource only exposes payment status for a known ride id.
  app.get("/api/x402/ride/:rideId", x402RideMiddleware());

  app.use("/api", ridesRouter);
  app.use("/api", driversRouter);
  app.use("/api/demo", demoRouter);

  app.get("/health", (_req, res) => {
    res.json({ ok: true, network: config.network });
  });
  // Serve the built rider + driver apps from this server (single-URL demo).
  const customerDist = path.resolve(here, "../../apps/customer/dist");
  const driverDist = path.resolve(here, "../../apps/driver/dist");
  if (fs.existsSync(customerDist)) app.use(express.static(customerDist));
  if (fs.existsSync(driverDist)) {
    app.use("/driver", express.static(driverDist));
  }
  app.get("/", (_req, res) => {
    res
      .type("html")
      .send(
        '<!doctype html><meta charset="utf-8"><title>Apex Cab</title>' +
          '<body style="font-family:system-ui;background:#0d1117;color:#e6edf3;display:grid;place-items:center;height:100vh">' +
          '<div style="text-align:center"><h1>🚖 Apex Cab</h1>' +
          '<p>Ride booking on Algorand · x402 payments via GoPlausible facilitator</p>' +
          '<p><a href="/" style="margin-right:12px">Rider app</a>' +
          '<a href="/driver" style="margin-left:12px">Driver app</a> · ' +
          '<a href="/api/demo/status">Demo status API</a></p></div>',
      );
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  app.use((err: Error & { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    // Malformed JSON body → 400, never 500
    if (err.type === "entity.parse.failed" || err.type === "entity.too.large") {
      res.status(400).json({ error: "invalid request body" });
      return;
    }
    console.error("[api error]", err);
    res.status(err.status && err.status < 500 ? err.status : 500).json({
      error: err.status && err.status < 500 ? err.message : "internal error",
    });
  });

  return app;
}

export async function startServer(port = config.port) {
  await initX402ResourceServer();
  const app = createApp();
  return app.listen(port, () => {
    console.log(`Apex Cab API listening on http://localhost:${port}`);
    console.log(`x402 network: ${config.network}`);
    console.log(`x402 facilitator: ${config.facilitatorUrl}`);
  });
}
