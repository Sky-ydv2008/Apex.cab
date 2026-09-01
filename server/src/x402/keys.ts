import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { toClientAvmSigner } from "@x402-avm/avm";
import { config } from "../config.js";

export interface ApexKeys {
  privateKeyBase64: string;
  address: string;
}

/**
 * Loads an Algorand Testnet account from data/, or generates and persists it.
 * Key format matches @x402-avm/avm: base64 of 64 bytes (32-byte seed + 32-byte
 * public key; the public half is re-derived from the seed by the signer).
 * Files are gitignored and written with owner-only permissions.
 */
function loadOrCreate(name: string): ApexKeys {
  const file = path.join(config.dataDir, name);
  fs.mkdirSync(config.dataDir, { recursive: true });
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as ApexKeys;
    if (saved.privateKeyBase64 && saved.address) return saved;
  } catch {
    /* fall through to creation */
  }
  const seed = crypto.randomBytes(32);
  const privateKeyBase64 = Buffer.concat([seed, Buffer.alloc(32)]).toString("base64");
  const address = toClientAvmSigner(privateKeyBase64).address;
  const keys: ApexKeys = { privateKeyBase64, address };
  fs.writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
  return keys;
}

/** Merchant (resource owner): receives every ride fare on-chain. */
export const merchantKeys = loadOrCreate("merchant.json");

/** Demo payer: the app's x402 client signs fares with this account. */
export const payerKeys = loadOrCreate("payer.json");
