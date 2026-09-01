/**
 * Standalone live demo: boots the API, funds the demo accounts on Algorand
 * Testnet, books a ride, and pays it with x402 through the GoPlausible
 * facilitator. Prints the on-chain transaction ids + explorer links.
 *
 * Run: npm run demo:x402
 */
import { startServer } from "../app.js";
import { seedDrivers } from "../seed.js";
import { config, explorerTxUrl } from "../config.js";
import { merchantKeys, payerKeys } from "./keys.js";
import { demoFund, demoBookAndPay } from "./demo.js";
import { getAccountInfo, lookupTxn } from "./algod.js";
import { store } from "../store.js";

async function main() {
  seedDrivers();
  const server = await startServer(config.port);
  console.log("\n=== Apex Cab · Live x402 demo on Algorand Testnet ===\n");

  console.log("Merchant (resource owner):", merchantKeys.address);
  console.log("Payer (x402 client):      ", payerKeys.address);

  console.log("\n[1/4] Funding Testnet accounts via AlgoKit dispenser...");
  const funding = await demoFund();
  for (const f of funding) {
    console.log(
      `  - ${f.account}: ${f.txId ? `${f.txId} (${f.explorerUrl})` : f.note}`,
    );
  }

  console.log("\n[2/4] Booking a ride (Apex Economy, Airport → MG Road)...");
  const { ride, outcome } = await demoBookAndPay();
  console.log(`  ride:      ${ride.id}`);
  console.log(`  distance:  ${ride.distanceKm} km · est. ${ride.durationMin} min`);
  console.log(`  fare:      ${(ride.fareMicroAlgo / 1_000_000).toFixed(6)} ALGO (${ride.fareMicroAlgo} microALGO)`);

  console.log("\n[3/4] x402 payment through GoPlausible facilitator...");
  if (outcome.status !== "paid") {
    console.error("  PAYMENT FAILED:", outcome.error);
    server.close();
    process.exit(1);
  }
  const receipt = store.rideById(ride.id)?.payment;
  console.log("  status:    paid ✓");
  console.log(`  payment txn:    ${receipt?.txnId}`);
  console.log(`  fee-payer txn:  ${receipt?.feePayerTxnId ?? "n/a"}`);
  console.log(`  explorer:   ${receipt?.explorerUrl}`);
  console.log(`  facilitator settle txn: ${receipt?.facilitatorSettleTransaction ?? "n/a"}`);

  console.log("\n[4/4] Confirming on-chain via Testnet indexer...");
  if (receipt?.txnId) {
    const info = await lookupTxn(receipt.txnId);
    if (info?.confirmedRound) {
      console.log(`  confirmed in round ${info.confirmedRound}`);
      console.log(`  ${info.sender} -> ${info.receiver ?? "?"} : ${(info.amount / 1_000_000).toFixed(6)} ALGO`);
      console.log(`  note: "${info.note ?? ""}"`);
    } else {
      console.log("  txn not yet visible on indexer (retry in a few seconds)");
    }
  }
  const bal = await getAccountInfo(merchantKeys.address);
  console.log(`\nMerchant balance after payment: ${(bal.amount / 1_000_000).toFixed(6)} ALGO`);

  console.log("\n=== demo complete ===");
  server.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("demo failed:", err);
  process.exit(1);
});
