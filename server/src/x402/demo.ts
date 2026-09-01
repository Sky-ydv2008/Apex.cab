import { Router } from "express";
import { config, explorerTxUrl } from "../config.js";
import { store } from "../store.js";
import { merchantKeys, payerKeys } from "./keys.js";
import { fundFromDispenser, getAccountInfo, lookupTxn, waitForTxn } from "./algod.js";
import { payForRide } from "./pay.js";
import { estimateFare } from "../fares.js";
import { newId } from "../auth.js";
import type { Ride, VehicleKind } from "../types.js";

export const demoRouter = Router();

const DEMO_CUSTOMER_PHONE = "+919999900001";

function demoCustomer() {
  let c = store.customerByPhone(DEMO_CUSTOMER_PHONE);
  if (!c) c = store.createCustomer("Demo Rider", DEMO_CUSTOMER_PHONE);
  return c;
}

/** Funds both demo accounts (payer + merchant) on Algorand Testnet. */
export async function demoFund() {
  const results = [];
  for (const account of [
    { name: "payer", address: payerKeys.address },
    { name: "merchant", address: merchantKeys.address },
  ]) {
    const info = await getAccountInfo(account.address).catch(() => null);
    if (info && info.amount > 2_000_000) {
      results.push({ account: account.name, address: account.address, txId: null, note: "already funded" });
      continue;
    }
    const { txId } = await fundFromDispenser(account.address);
    await waitForTxn(txId);
    results.push({ account: account.name, address: account.address, txId, explorerUrl: explorerTxUrl(txId) });
  }
  return results;
}

/** Creates a ride for the demo customer and pays it with x402 through GoPlausible. */
export async function demoBookAndPay() {
  const customer = demoCustomer();
  const pickup = { label: "Kempegowda Intl Airport", lat: 13.1986, lng: 77.7066 };
  const dropoff = { label: "MG Road, Bengaluru", lat: 12.9758, lng: 77.6065 };
  const vehicleType: VehicleKind = "car-economy";
  const est = estimateFare(vehicleType, pickup, dropoff);

  const ride: Ride = {
    id: newId("ride"),
    customerId: customer.id,
    driverId: null,
    vehicleType,
    pickup,
    dropoff,
    distanceKm: est.distanceKm,
    durationMin: est.durationMin,
    fareMicroAlgo: est.fareMicroAlgo,
    state: "CREATED",
    createdAt: Date.now(),
    payment: null,
  };
  store.createRide(ride);

  // Make sure the payer can afford the fare (fund via AlgoKit dispenser if not).
  const payerInfo = await getAccountInfo(payerKeys.address);
  if (payerInfo.amount < ride.fareMicroAlgo + 500_000) {
    const { txId } = await fundFromDispenser(payerKeys.address);
    await waitForTxn(txId);
  }

  const outcome = await payForRide(ride.id);
  return { ride, outcome };
}

demoRouter.get("/status", async (_req, res) => {
  const [payer, merchant] = await Promise.all([
    getAccountInfo(payerKeys.address).catch((e: Error) => ({ error: e.message })),
    getAccountInfo(merchantKeys.address).catch((e: Error) => ({ error: e.message })),
  ]);
  const lastPaid = [...store.db.rides]
    .reverse()
    .find((r) => r.payment?.status === "paid");
  res.json({
    network: config.network,
    facilitator: config.facilitatorUrl,
    payer: { address: payerKeys.address, ...payer },
    merchant: { address: merchantKeys.address, ...merchant },
    merchantExplorerUrl: `https://testnet.explorer.perawallet.app/address/${merchantKeys.address}`,
    lastPayment: lastPaid
      ? {
          rideId: lastPaid.id,
          fareMicroAlgo: lastPaid.fareMicroAlgo,
          txnId: lastPaid.payment?.txnId,
          feePayerTxnId: lastPaid.payment?.feePayerTxnId,
          explorerUrl: lastPaid.payment?.explorerUrl,
        }
      : null,
  });
});

demoRouter.post("/fund", async (_req, res) => {
  try {
    res.json(await demoFund());
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

demoRouter.post("/book-and-pay", async (_req, res) => {
  try {
    const result = await demoBookAndPay();
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

demoRouter.get("/transactions/:txId", async (req, res) => {
  const info = await lookupTxn(req.params.txId).catch((e: Error) => ({ error: e.message }));
  if (!info) return res.status(404).json({ error: "transaction not found on Testnet indexer" });
  res.json({ ...info, explorerUrl: explorerTxUrl(req.params.txId) });
});
