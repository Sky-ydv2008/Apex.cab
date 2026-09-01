import { config } from "../config.js";

const INDEXER = "https://testnet-idx.algonode.cloud";

export interface TxnInfo {
  txId: string;
  confirmedRound: number | null;
  sender: string;
  receiver?: string;
  amount: number;
  fee: number;
  note?: string;
  group?: string;
}

export async function getAccountInfo(
  address: string,
): Promise<{ amount: number; status: string; ["min-balance"]: number }> {
  const res = await fetch(`${config.algodUrl}/v2/accounts/${address}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`algod account lookup failed (${res.status})`);
  return (await res.json()) as {
    amount: number;
    status: string;
    ["min-balance"]: number;
  };
}

/** Funds a Testnet account with ALGO via the AlgoKit dispenser API. */
export async function fundFromDispenser(
  address: string,
  amountMicroAlgo?: number,
): Promise<{ txId: string }> {
  const body: Record<string, unknown> = { receiver: address, assetID: 0 };
  if (amountMicroAlgo) body.amount = amountMicroAlgo;
  const res = await fetch(`${config.dispenserUrl}/funds`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { txId?: string; message?: string };
  if (!res.ok || !data.txId) {
    throw new Error(`dispenser funding failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return { txId: data.txId };
}

/** Looks a transaction up on the Algorand Testnet indexer (proof + explorer data). */
export async function lookupTxn(txId: string): Promise<TxnInfo | null> {
  const res = await fetch(`${INDEXER}/v2/transactions/${txId}`, {
    headers: { accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`indexer lookup failed (${res.status})`);
  const json = (await res.json()) as {
    transaction: {
      id: string;
      "confirmed-round"?: number;
      sender: string;
      fee: number;
      note?: string;
      group?: string;
      "payment-transaction"?: { receiver: string; amount: number };
      "asset-transfer-transaction"?: { receiver: string; amount: number };
    };
  };
  const t = json.transaction;
  return {
    txId: t.id,
    confirmedRound: t["confirmed-round"] ?? null,
    sender: t.sender,
    receiver:
      t["payment-transaction"]?.receiver ?? t["asset-transfer-transaction"]?.receiver,
    amount:
      t["payment-transaction"]?.amount ?? t["asset-transfer-transaction"]?.amount ?? 0,
    fee: t.fee,
    note: t.note ? Buffer.from(t.note, "base64").toString("utf8") : undefined,
    group: t.group,
  };
}

export async function waitForTxn(txId: string, timeoutMs = 90_000): Promise<TxnInfo> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const info = await lookupTxn(txId);
    if (info?.confirmedRound) return info;
    if (Date.now() > deadline) throw new Error(`txn ${txId} not confirmed within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}
