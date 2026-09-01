import type { Request, RequestHandler, Response, NextFunction } from "express";
import {
  HTTPFacilitatorClient,
  x402ResourceServer,
  x402HTTPResourceServer,
  type HTTPAdapter,
  type HTTPRequestContext,
  type ProcessSettleResultResponse,
} from "@x402-avm/core/server";
import { registerExactAvmScheme } from "@x402-avm/avm/exact/server";
import {
  ALGORAND_TESTNET_CAIP2,
  decodeTransaction,
  getTransactionId,
} from "@x402-avm/avm";
import type { PaymentPayload } from "@x402-avm/core/types";
import { config, explorerTxUrl } from "../config.js";
import { store } from "../store.js";
import { merchantKeys } from "./keys.js";
import type { Ride } from "../types.js";

let httpServer: x402HTTPResourceServer | null = null;

/**
 * Builds the x402-protected ride endpoint.
 *
 * The server is the *resource server* of the x402 protocol: an unpaid request
 * gets HTTP 402 + a `PAYMENT-REQUIRED` header describing the exact price
 * (fare in ALGO, Algorand Testnet) and the merchant `payTo` address. When the
 * client retries with a signed `PAYMENT-SIGNATURE` header, the GoPlausible
 * facilitator (facilitator.goplausible.xyz) verifies and settles the payment
 * on-chain (fee abstraction via its feePayer), and the ride is marked PAID.
 */
export async function initX402ResourceServer(): Promise<void> {
  if (httpServer) return;

  const facilitatorClient = new HTTPFacilitatorClient({ url: config.facilitatorUrl });
  const resourceServer = new x402ResourceServer(facilitatorClient);
  httpServer = new x402HTTPResourceServer(resourceServer, {
    "/api/x402/ride/[rideId]": {
      accepts: {
        scheme: "exact",
        payTo: merchantKeys.address,
        price: async (ctx) => {
          const rideId = ctx.path.split("/").pop() ?? "";
          const ride = store.rideById(rideId);
          if (!ride) throw new Error("ride not found");
          // AssetAmount in native ALGO (asset id "0"); amount is microALGO.
          return {
            amount: String(ride.fareMicroAlgo),
            asset: "0",
            extra: { name: "ALGO", decimals: 6 },
          };
        },
        network: ALGORAND_TESTNET_CAIP2,
        maxTimeoutSeconds: 120,
      },
      description: "Apex Cab ride fare",
      mimeType: "application/json",
    },
  });
  registerExactAvmScheme(httpServer.server);
  await httpServer.initialize();
}

function expressAdapter(req: Request): HTTPAdapter {
  return {
    getHeader: (name) => req.headers[name.toLowerCase()] as string | undefined,
    getMethod: () => req.method,
    getPath: () => req.path,
    getUrl: () => `${config.publicBaseUrl}${req.path}`,
    getAcceptHeader: () => req.headers.accept || "",
    getUserAgent: () => req.headers["user-agent"] || "",
  };
}

/** Extracts on-chain txn ids from the signed payment group in the payload. */
function extractTxnIds(payload: PaymentPayload): string[] {
  const group = (payload.payload as { paymentGroup?: string[] }).paymentGroup;
  if (!Array.isArray(group)) return [];
  const ids: string[] = [];
  for (const b64 of group) {
    try {
      ids.push(getTransactionId(decodeTransaction(b64)));
    } catch {
      // unsigned txn (e.g. the facilitator's fee-payer txn) — skip
    }
  }
  return ids;
}

export function buildPaymentReceipt(
  ride: Ride,
  payload: PaymentPayload,
  settle: ProcessSettleResultResponse,
) {
  const txnIds = extractTxnIds(payload);
  const paymentTxnId = txnIds[0] ?? (settle as { transaction?: string }).transaction;
  const feePayerTxnId = txnIds[1];
  return {
    status: "paid" as const,
    amountMicroAlgo: String(ride.fareMicroAlgo),
    asset: "0",
    network: config.network,
    txnId: paymentTxnId,
    feePayerTxnId,
    explorerUrl: paymentTxnId ? explorerTxUrl(paymentTxnId) : undefined,
    facilitatorSettleTransaction: (settle as { transaction?: string }).transaction,
    paidAt: Date.now(),
  };
}

/**
 * Express handler for GET /api/x402/ride/:rideId — the x402 resource.
 */
export function x402RideMiddleware(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context: HTTPRequestContext = {
        adapter: expressAdapter(req),
        path: req.path,
        method: req.method,
      };
      const result = await httpServer!.processHTTPRequest(context);

      if (result.type === "payment-error") {
        const r = result.response;
        res.status(r.status);
        res.set(r.headers);
        if (r.isHtml) return res.type("html").send(r.body);
        return res.json(r.body ?? {});
      }

      if (result.type === "payment-verified") {
        const rideId = req.params.rideId as string;
        const ride = store.rideById(rideId);
        if (!ride) return res.status(404).json({ error: "ride not found" });

        const settle = await httpServer!.processSettlement(
          result.paymentPayload,
          result.paymentRequirements,
        );

        if (settle.success) {
          const receipt = buildPaymentReceipt(ride, result.paymentPayload, settle);
          store.updateRide(rideId, { state: "PAID", payment: receipt });
          res.set(settle.headers);
          return res.json({ ok: true, rideId, state: "PAID", payment: receipt });
        }
        return res.status(402).json({ ok: false, error: settle.errorReason });
      }

      res.status(404).json({ error: "no payment required for this resource" });
    } catch (err) {
      next(err);
    }
  };
}
