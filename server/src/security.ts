import type { Request, Response, NextFunction } from "express";
import { store } from "./store.js";
import { VEHICLE_KINDS } from "./fares.js";

/** Very small numeric/string validators to keep the public API tight. */
export function isLatLng(v: unknown): v is { lat: number; lng: number } {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.lat === "number" &&
    Number.isFinite(o.lat) &&
    o.lat >= -90 &&
    o.lat <= 90 &&
    typeof o.lng === "number" &&
    Number.isFinite(o.lng) &&
    o.lng >= -180 &&
    o.lng <= 180
  );
}

export function isVehicleKind(v: unknown): v is (typeof VEHICLE_KINDS)[number] {
  return typeof v === "string" && VEHICLE_KINDS.includes(v as never);
}

export function str(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length === 0 || s.length > max) return null;
  return s;
}

export function shortStr(v: unknown, max = 40): string | null {
  return str(v, max);
}

/** Bearer-token middleware. `role` narrows which store it looks up. */
export function requireAuth(role: "customer" | "driver") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) {
      res.status(401).json({ error: "missing bearer token" });
      return;
    }
    if (role === "customer") {
      const customer = store.customerByToken(token);
      if (!customer) {
        res.status(401).json({ error: "invalid token" });
        return;
      }
      (req as Request & { customer?: unknown }).customer = customer;
    } else {
      const driver = store.driverByToken(token);
      if (!driver) {
        res.status(401).json({ error: "invalid token" });
        return;
      }
      (req as Request & { driver?: unknown }).driver = driver;
    }
    next();
  };
}

export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void> | void,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}
