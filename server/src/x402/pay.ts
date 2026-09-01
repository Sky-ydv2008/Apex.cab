import { x402Client } from "@x402-avm/core/client";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from "@x402-avm/core/http";
import { registerExactAvmScheme } from "@x402-avm/avm/exact/client";
import { toClientAvmSigner } from "@x402-avm/avm";
import { config } from "../config.js";
import { store } from "../store.js";
import { payerKeys } from "./keys.js";
import { getAccountInfo } from "./algod.js";

export interface PaymentOutcome {
  status: "paid" | "failed";
  resourceUrl: string;
  error?: string;
  settle?: Record<string, unknown>;
  resourceBody?: Record<string, unknown>;
}

/**
 * Client side of the x402 flow. Pays for a ride through the GoPlausible
 * facilitator:
 *
 *  1. GET  /api/x402/ride/:id          → 402 + PAYMENT-REQUIRED (price, payTo)
 *  2. createPaymentPayload(...)        → client signs ALGO transfer (+ fee-payer txn)
 *  3. GET  same URL + PAYMENT-SIGNATURE → facilitator verifies + settles on-chain
 *  4. 200 + PAYMENT-RESPONSE           → ride is PAID, txn ids recorded
 */
export async function payForRide(rideId: string): Promise<PaymentOutcome> {
  const ride = store.rideById(rideId);
  if (!ride) return { status: "failed", resourceUrl: "", error: "ride not found" };

  const url = `${config.publicBaseUrl}/api/x402/ride/${rideId}`;
  try {
    // Step 1: unpaid request → 402 with payment requirements
    const unpaid = await fetch(url, { headers: { accept: "application/json" } });
    if (unpaid.status !== 402) {
      return {
        status: "failed",
        resourceUrl: url,
        error: `expected 402 Payment Required, got ${unpaid.status}`,
      };
    }
    const paymentRequiredHeader = unpaid.headers.get("payment-required");
    if (!paymentRequiredHeader) {
      return { status: "failed", resourceUrl: url, error: "missing PAYMENT-REQUIRED header" };
    }
    const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);

    // Step 2: sign the payment (server-side signer; no wallet needed in demo)
    const signer = toClientAvmSigner(payerKeys.privateKeyBase64);
    const client = new x402Client();
    registerExactAvmScheme(client, {
      signer,
      algodConfig: { algodUrl: config.algodUrl },
      networks: [config.network],
    });
    const paymentPayload = await client.createPaymentPayload(paymentRequired);

    // Step 3: retry with the payment signature → facilitator verify + settle
    const paid = await fetch(url, {
      headers: {
        "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(paymentPayload),
        accept: "application/json",
      },
    });
    const bodyText = await paid.text();
    const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};

    if (!paid.ok) {
      return {
        status: "failed",
        resourceUrl: url,
        error: `payment rejected (${paid.status}): ${bodyText.slice(0, 400)}`,
      };
    }

    const paymentResponse = paid.headers.get("payment-response");
    const settle = paymentResponse
      ? (decodePaymentResponseHeader(paymentResponse) as Record<string, unknown>)
      : {};

    return { status: "paid", resourceUrl: url, settle, resourceBody: body };
  } catch (err) {
    return { status: "failed", resourceUrl: url, error: (err as Error).message };
  }
}

/** True when the payer has enough ALGO for the fare (checked before paying). */
export async function payerCanAfford(rideId: string): Promise<boolean> {
  const ride = store.rideById(rideId);
  if (!ride) return false;
  const info = await getAccountInfo(payerKeys.address);
  return info.amount >= ride.fareMicroAlgo + 500_000; // + buffer for fees
}
