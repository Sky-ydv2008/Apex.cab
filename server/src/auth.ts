import crypto from "node:crypto";

export interface Session {
  role: "customer" | "driver";
  id: string;
}

/**
 * Demo auth: phone-based login issues a bearer token (no passwords stored).
 * Tokens are random 128-bit values; the store keeps the full map in memory
 * and persists rides/drivers to disk.
 */
export function newToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

export function hashPhone(phone: string): string {
  return crypto.createHash("sha256").update(phone.trim()).digest("hex").slice(0, 16);
}
