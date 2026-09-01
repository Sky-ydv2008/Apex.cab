import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Algorand Testnet (LoRA) CAIP-2 identifier. */
export const ALGORAND_TESTNET_CAIP2 =
  "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=" as const;

/** Algorand Testnet USDC ASA id (kept for reference; rides price in ALGO). */
export const USDC_TESTNET_ASA_ID = "10458941";

export const config = {
  port: Number(process.env.PORT || 3000),
  dataDir: process.env.DATA_DIR || path.resolve(here, "../../data"),
  /** GoPlausible public x402 facilitator. */
  facilitatorUrl:
    process.env.FACILITATOR_URL || "https://facilitator.goplausible.xyz",
  /** AVM network used for every x402 payment in this app. */
  network: ALGORAND_TESTNET_CAIP2,
  /** Merchant (resource owner) receives ride fares. 64-byte key, base64. */
  merchantPrivateKey: process.env.MERCHANT_PRIVATE_KEY || "",
  /** Demo payer used by the app's x402 client to pay fares. 64-byte key, base64. */
  payerPrivateKey: process.env.PAYER_PRIVATE_KEY || "",
  /** Algod endpoint used for balance checks / txn lookups. */
  algodUrl: process.env.ALGOD_URL || "https://testnet-api.algonode.cloud",
  /** AlgoKit Testnet Dispenser API (JWT-gated; token from `algokit dispenser login --ci`). */
  dispenserUrl:
    process.env.DISPENSER_URL || "https://api.dispenser.algorandfoundation.tools",
  dispenserToken:
    process.env.DISPENSER_TOKEN ||
    (() => {
      // Fallback: token saved by `algokit dispenser login --ci` (data/ci_token.txt)
      try {
        return fs.readFileSync(path.resolve(here, "../../data/ci_token.txt"), "utf8").trim();
      } catch {
        return "";
      }
    })(),
  /** Allowed browser origins for CORS. */
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:5173,http://localhost:5174")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  /** Public base URL of this server (used as the x402 resource URL). */
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "http://localhost:3000",
};

export function explorerTxUrl(txId: string): string {
  return `https://testnet.explorer.perawallet.app/tx/${txId}`;
}
