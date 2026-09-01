# 🚖 Apex Cab — Ride Booking on Algorand with x402 Payments

Uber-style ride booking web app (rider + driver) built on the **Algorand blockchain**, with **live x402 payments** through the **GoPlausible Facilitator** on **Algorand Testnet (LoRA)**.

- **Rider app** — book Economy / Comfort / Premium cars, Autos and Bikes; pay the fare with x402; track the driver live; rate the trip.
- **Driver app** — go online, accept paid requests, drive the trip, track earnings in ALGO.
- **x402** — every ride fare is paid via the x402 protocol (HTTP 402), verified and settled on-chain by the GoPlausible facilitator, with **fee abstraction** (the facilitator pays network fees).
- Both apps and the API live in this single repository.

---

## 1. x402 + Algorand Integration (the core requirement)

| Requirement | Implementation |
|---|---|
| x402 integrated | `@x402-avm/core` + `@x402-avm/avm` in [`server/package.json`](server/package.json) — client (signer), resource server, HTTP protocol |
| Algorand blockchain | Every payment is an on-chain ALGO transfer on **Algorand Testnet** (`algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=`, genesis hash of LoRA Testnet) |
| Live on Testnet | `npm run demo:x402` performs a real payment; txn ids are confirmed via the Testnet indexer |
| GoPlausible Facilitator | `https://facilitator.goplausible.xyz` — `/supported`, `/verify`, `/settle` (see [`server/src/x402/resource.ts`](server/src/x402/resource.ts), [`server/src/x402/pay.ts`](server/src/x402/pay.ts)) |
| `@x402-avm` deps | `@x402-avm/core@^2.6.1`, `@x402-avm/avm@^2.6.1` in `server/package.json` |

### How a ride payment works (the x402 flow)

```
 Rider app                      Apex Cab API (resource server)          GoPlausible Facilitator        Algorand Testnet (LoRA)
    │  book ride (fare in ALGO)     │                                        │                              │
    ├──────────────────────────────►│  ride created (state CREATED)          │                              │
    │  POST /api/rides/:id/pay      │                                        │                              │
    ├──────────────────────────────►│  1. x402 client GET /api/x402/ride/:id │                              │
    │                               ├───────────────────────────────────────►│  2. 402 Payment Required     │
    │                               │◄───────────────────────────────────────┤     + PAYMENT-REQUIRED header │
    │                               │  3. client signs ALGO transfer         │     (price, payTo merchant,  │
    │                               │     (+ fee-payer txn, unsigned)        │     feePayer from /supported)│
    │                               │  4. retry with PAYMENT-SIGNATURE       │                              │
    │                               ├───────────────────────────────────────►│  5. verify + settle          │
    │                               │                                        │  signs fee-payer txn &      │
    │                               │                                        │  broadcasts the atomic group├──► on-chain:
    │                               │◄───────────────────────────────────────┤                              │  payer → merchant (ALGO)
    │                               │  6. 200 + PAYMENT-RESPONSE             │                              │  fee payer → network fee
    │                               │  ride marked PAID, txn ids recorded    │                              │
    │◄──────────────────────────────┤                                        │                              │
    │  receipt: txn id + explorer    │                                        │                              │
```

Key files:

- `server/src/x402/resource.ts` — the x402 **resource server**: builds the 402 `PaymentRequirements` (dynamic fare price, native ALGO asset `"0"`, merchant `payTo`), verifies via the facilitator, settles, and records on-chain txn ids. Fee abstraction is automatic: the facilitator's `feePayer` (from `GET /supported`) is merged into every requirement.
- `server/src/x402/pay.ts` — the x402 **client**: `x402Client` + `registerExactAvmScheme` with `toClientAvmSigner`, performs the unpaid-request → sign → `PAYMENT-SIGNATURE` retry → `PAYMENT-RESPONSE` cycle.
- `server/src/x402/algod.ts` — Testnet account balance checks (algod), dispenser funding, and indexer confirmation of txn ids.
- `server/src/x402/demo.ts` + `demo-run.ts` — live demo endpoints and standalone script.
- `server/src/x402/keys.ts` — merchant (receiver) and payer wallets, auto-generated and persisted under `data/` (gitignored).

### Live demo

```bash
npm install
npm run demo:x402        # funds wallets (Testnet faucet), books a ride, pays with x402
```

The demo prints:

- payer + merchant Testnet addresses,
- the fare in ALGO,
- the **on-chain payment txn id** and the facilitator **fee-payer txn id**,
- Pera Explorer links and indexer confirmation (round, sender → receiver, amount).

> Demo wallets are generated on first run and stored in `data/merchant.json` / `data/payer.json` (gitignored). You can also set `MERCHANT_PRIVATE_KEY` / `PAYER_PRIVATE_KEY` (base64, 64 bytes) in the environment.

---

## 2. Feature tree (branches & sub-functions)

### Rider app — `apps/customer/`

```
Apex Cab Rider
├── Authentication
│   ├── Sign in (phone) → bearer token (no passwords; demo)
│   └── Sign out
├── Booking
│   ├── Set pickup & dropoff (map click + labels)
│   ├── Fare estimation (all 5 vehicle types, ALGO)
│   ├── Vehicle catalogue
│   │   ├── Car — Economy (🚗 4 seats)
│   │   ├── Car — Comfort (🚙 4 seats)
│   │   ├── Car — Premium (🏎️ 5 seats)
│   │   ├── Auto (🛺 3 seats)
│   │   └── Bike (🛵 1 seat)
│   ├── Book ride → ride created (state machine CREATED → …)
│   └── Cancel ride (before driver assigned)
├── x402 Payment (server-side gateway)
│   ├── Pay with x402 → facilitator verify + settle on Testnet
│   ├── Fund demo payer (Testnet faucet, if underfunded)
│   └── Receipt: txn id, fee-payer txn, Pera Explorer link
├── Live tracking
│   ├── Poll ride state (3 s)
│   ├── Driver card (name, vehicle, plate, rating)
│   ├── Route + driver marker on map
│   └── State steps: Paid → Assigned → Arriving → In progress → Completed
├── Post-trip
│   ├── Rate driver (1–5 stars) + review
│   └── Ride history (state, fare, x402 txn links)
└── Blockchain status panel
    ├── Network / facilitator
    ├── Merchant + payer addresses & ALGO balances
    └── Last x402 payment txn
```

### Driver app — `apps/driver/`

```
Apex Cab Driver
├── Authentication
│   ├── Register / sign in (name, phone, vehicle type, vehicle no)
│   └── Sign out
├── Availability
│   ├── Online / Offline toggle
│   └── Status: offline → idle → assigned → on-ride
├── Ride requests (polling)
│   ├── Incoming paid requests (matching vehicle)
│   ├── Fare, pickup/dropoff, distance, ETA
│   └── Accept → assigned (only when idle, no double-booking)
├── Trip execution
│   ├── I've arrived (ASSIGNED → ARRIVING)
│   ├── Start trip (ARRIVING → IN_PROGRESS)
│   └── Complete trip (IN_PROGRESS → COMPLETED)
│   └── Route + rider info on map
├── Earnings
│   ├── Trips count, total ALGO earned
│   ├── Earnings by vehicle type
│   └── Trip history (state, fare, rating)
```

### API server — `server/`

```
Apex Cab API (Express + TypeScript)
├── /api/vehicles            vehicle catalogue
├── /api/estimate            per-vehicle fare estimates (ALGO)
├── /api/customers/login     rider auth
├── /api/rides               create ride (validated, fare computed)
├── /api/rides/:id           ride state + driver (rider)
├── /api/rides/:id/pay       x402 payment (client side)
├── /api/rides/:id/cancel    cancel before assignment
├── /api/rides/:id/rate      rating + review
├── /api/customers/me/rides  ride history
├── /api/drivers/login       driver auth (create-or-login)
├── /api/drivers/me          profile (PATCH: online, location, vehicle)
├── /api/drivers/me/available  paid requests for this driver's vehicle
├── /api/drivers/me/active   current ride
├── /api/drivers/me/rides    history
├── /api/drivers/me/earnings totals + per-vehicle breakdown
├── /api/rides/:id/accept    driver accepts (state → ASSIGNED)
├── /api/rides/:id/status    ARRIVING / IN_PROGRESS / COMPLETED
├── /api/x402/ride/:rideId   ★ x402-protected resource (402 → verify → settle)
└── /api/demo/status|fund|book-and-pay|transactions/:txId  live demo helpers
```

---

## 3. Run it locally

```bash
npm install            # installs all workspaces (server + 2 apps)
npm run dev:server     # API on http://localhost:3000
npm run dev:customer   # rider app on http://localhost:5173
npm run dev:driver     # driver app on http://localhost:5174
```

Or build once and let the API serve everything:

```bash
npm run build          # builds both apps into apps/*/dist
npm run start          # API + static apps on http://localhost:3000
```

Seed drivers are created on startup (5 drivers covering cars, auto, bike — see `server/src/seed.ts`).

**Demo driver:** `Amit Sharma · +919876543210 · KA-01-AB-1234` (any phone works; new phones register a new driver).

**Demo rider:** any phone, e.g. `+919876543210`.

> The x402 payment needs the demo payer wallet funded with Testnet ALGO (the demo's "Fund demo payer" button / `POST /api/demo/fund` does this via the AlgoKit dispenser; it can also be funded manually at <https://lora.algokit.io/testnet/fund>).

---

## 4. Repository layout

```
Apex.cab/
├── server/                 Express + TypeScript API
│   ├── src/
│   │   ├── x402/           ★ x402 + Algorand integration (resource server, client, demo)
│   │   ├── routes/         rides (rider) + drivers routers
│   │   ├── app.ts          express app (helmet, cors, rate limits, static apps)
│   │   ├── store.ts        JSON-file-backed store (rides, drivers, customers)
│   │   ├── fares.ts        vehicle catalogue + fare engine (microALGO)
│   │   ├── security.ts     validation + bearer auth
│   │   └── seed.ts         demo drivers
│   └── package.json        deps incl. @x402-avm/core + @x402-avm/avm
├── apps/
│   ├── customer/           Vite + React rider app (book → x402 pay → track → rate)
│   └── driver/             Vite + React driver app (online → accept → complete → earnings)
├── package.json            npm workspaces + scripts
└── README.md
```

## 5. Security notes

- No secrets in the repo — keys are generated at runtime under `data/` (gitignored, owner-only mode) or via env vars; `.env*` gitignored.
- `helmet` headers, strict CORS allow-list, JSON body limit, rate limits on the API, auth endpoints and payment endpoints.
- Input validation on every public route (coordinates, vehicle types, string lengths, ratings).
- Ride ownership is enforced server-side; the x402 resource only exposes a known ride id and the payment is the credential.
- Demo auth is intentionally passwordless (phone → token); swap for real auth in production.

## 6. Ecosystem

- x402 spec: <https://x402.org> · Algorand exact scheme: <https://github.com/coinbase/x402/tree/main/specs/schemes/exact>
- `@x402-avm/avm` + `@x402-avm/core`: <https://www.npmjs.com/package/@x402-avm/avm>
- GoPlausible facilitator: <https://facilitator.goplausible.xyz> · docs: <https://x402.goplausible.xyz>
- Algorand Testnet explorer (LoRA): <https://lora.algokit.io/testnet> · faucet: <https://lora.algokit.io/testnet/fund>
