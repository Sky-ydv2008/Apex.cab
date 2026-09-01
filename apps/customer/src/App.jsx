import React, { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import { api, fmtAlgo } from "./api.js";

const STATE_LABEL = {
  CREATED: "Waiting for payment",
  PAID: "Looking for a driver",
  ASSIGNED: "Driver assigned",
  ARRIVING: "Driver on the way",
  IN_PROGRESS: "On the trip",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
const RIDE_STEPS = ["PAID", "ASSIGNED", "ARRIVING", "IN_PROGRESS", "COMPLETED"];

function pin(emoji) {
  return L.divIcon({
    className: "",
    html: `<div style="font-size:26px;transform:translate(-50%,-100%)">${emoji}</div>`,
    iconSize: [26, 26],
  });
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("apex_customer_token") || "");
  const [customer, setCustomer] = useState(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [vehicles, setVehicles] = useState([]);
  const [estimates, setEstimates] = useState([]);
  const [selected, setSelected] = useState("car-economy");
  const [pickup, setPickup] = useState({ label: "Kempegowda Intl Airport", lat: 13.1986, lng: 77.7066 });
  const [dropoff, setDropoff] = useState({ label: "MG Road, Bengaluru", lat: 12.9758, lng: 77.6065 });
  const [activeField, setActiveField] = useState("pickup");
  const activeFieldRef = useRef("pickup");
  const [ride, setRide] = useState(null);
  const [driver, setDriver] = useState(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("book");
  const [history, setHistory] = useState([]);
  const [rating, setRating] = useState(5);
  const [review, setReview] = useState("");
  const [demo, setDemo] = useState(null);

  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const drawRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => {
    activeFieldRef.current = activeField;
  }, [activeField]);

  // ---- map ----
  useEffect(() => {
    if (!token || !mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current).setView([13.05, 77.65], 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    map.on("click", (e) => {
      const which = activeFieldRef.current;
      const p = {
        label: which === "pickup" ? "Map pickup point" : "Map dropoff point",
        lat: +e.latlng.lat.toFixed(6),
        lng: +e.latlng.lng.toFixed(6),
      };
      if (which === "pickup") setPickup(p);
      else setDropoff(p);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [token]);

  // redraw route whenever endpoints or driver move
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (drawRef.current) {
      map.removeLayer(drawRef.current);
      drawRef.current = null;
    }
    const layer = L.layerGroup();
    layer.addLayer(L.marker([pickup.lat, pickup.lng], { icon: pin("🟢") }));
    layer.addLayer(L.marker([dropoff.lat, dropoff.lng], { icon: pin("🔴") }));
    const line = L.polyline(
      [
        [pickup.lat, pickup.lng],
        [dropoff.lat, dropoff.lng],
      ],
      { color: "#1f6feb", weight: 4, opacity: 0.75, dashArray: "8 8" },
    );
    layer.addLayer(line);
    if (driver?.location) {
      layer.addLayer(
        L.marker([driver.location.lat, driver.location.lng], {
          icon: pin(vehicles.find((v) => v.kind === driver.vehicleType)?.icon ?? "🚗"),
        }),
      );
    }
    layer.addTo(map);
    drawRef.current = layer;
    map.fitBounds(line.getBounds().pad(0.3));
  }, [pickup, dropoff, driver, vehicles]);

  // ---- auth + bootstrap ----
  useEffect(() => {
    if (!token) return;
    api
      .myRides()
      .then((d) => setHistory(d.rides))
      .catch(() => {});
    api
      .demoStatus()
      .then(setDemo)
      .catch(() => {});
  }, [token]);

  const doLogin = async (e) => {
    e.preventDefault();
    if (!phone.trim()) return;
    const d = await api.login(name, phone);
    localStorage.setItem("apex_customer_token", d.token);
    setToken(d.token);
    setCustomer(d.customer);
    const v = await api.vehicles();
    setVehicles(v);
  };

  const logout = () => {
    localStorage.removeItem("apex_customer_token");
    setToken("");
    setCustomer(null);
    setRide(null);
    setDriver(null);
  };

  const findRides = async () => {
    setPayError("");
    const d = await api.estimate(pickup, dropoff);
    setEstimates(d.estimates);
    setTab("book");
  };

  const bookRide = async () => {
    setPayError("");
    setNotice("");
    const d = await api.createRide({ vehicleType: selected, pickup, dropoff });
    setRide(d.ride);
  };

  const payNow = async () => {
    setPaying(true);
    setPayError("");
    try {
      const d = await api.pay(ride.id);
      setRide(d.ride);
      if (d.outcome?.status === "paid") setNotice("Payment settled on Algorand Testnet ✓");
    } catch (err) {
      setPayError(err.message);
    } finally {
      setPaying(false);
    }
  };

  const fundPayer = async () => {
    setNotice("Funding demo payer wallet on Testnet…");
    await api.demoFund();
    setNotice("Funded. Try payment again.");
    const st = await api.demoStatus();
    setDemo(st);
  };

  const cancelRide = async () => {
    const d = await api.cancel(ride.id);
    setRide(d.ride);
  };

  const rateRide = async () => {
    const d = await api.rate(ride.id, { rating, review });
    setRide(d.ride);
    setReview("");
  };

  // ---- live tracking poll ----
  useEffect(() => {
    if (!ride || !["PAID", "ASSIGNED", "ARRIVING", "IN_PROGRESS"].includes(ride.state)) return;
    pollRef.current = setInterval(async () => {
      try {
        const d = await api.ride(ride.id);
        setRide(d.ride);
        setDriver(d.driver);
        if (["COMPLETED", "CANCELLED"].includes(d.ride.state)) {
          clearInterval(pollRef.current);
          const h = await api.myRides();
          setHistory(h.rides);
        }
      } catch {
        /* transient */
      }
    }, 3000);
    return () => clearInterval(pollRef.current);
  }, [ride?.id, ride?.state]);

  const loadHistory = async () => {
    const d = await api.myRides();
    setHistory(d.rides);
  };

  const active = ride && ["PAID", "ASSIGNED", "ARRIVING", "IN_PROGRESS"].includes(ride.state);

  // ---- render ----
  if (!token) {
    return (
      <div className="app">
        <div className="topbar">
          <div className="brand">
            <span className="logo">🚖</span>
            <div>
              <h1>Apex Cab</h1>
              <small>Ride booking on Algorand · x402 payments via GoPlausible facilitator</small>
            </div>
          </div>
        </div>
        <div className="grid">
          <div className="card">
            <h2>Rider sign in</h2>
            <form onSubmit={doLogin}>
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Rider" />
              <label>Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" required />
              <div style={{ marginTop: 12 }}>
                <button className="primary" type="submit">Continue</button>
              </div>
            </form>
            <p className="hint">Demo phone-based login — no passwords. Any phone works.</p>
          </div>
          <div className="card">
            <h2>How it works</h2>
            <ol className="muted" style={{ lineHeight: 1.8 }}>
              <li>Pick pickup &amp; dropoff on the map</li>
              <li>Choose a car category (Economy / Comfort / Premium), Auto or Bike</li>
              <li>Book — your fare is priced in ALGO (Algorand Testnet)</li>
              <li>Pay with x402: the GoPlausible facilitator verifies &amp; settles the payment on-chain</li>
              <li>A driver accepts, you track them live, ride, rate</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <span className="logo">🚖</span>
          <div>
            <h1>Apex Cab</h1>
            <small>Rider · {customer?.name}</small>
          </div>
        </div>
        <button onClick={logout}>Sign out</button>
      </div>

      <div className="tabs">
        <button className={tab === "book" ? "active" : ""} onClick={() => setTab("book")}>Book</button>
        <button className={tab === "track" ? "active" : ""} onClick={() => { setTab("track"); loadHistory(); }}>My rides</button>
      </div>

      {active && (
        <div className="card" style={{ marginBottom: 14, borderColor: "#1f6feb" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0 }}>{STATE_LABEL[ride.state]}</h2>
            <span className="muted mono">{ride.id}</span>
          </div>
          <div className="steps">
            {RIDE_STEPS.map((s) => (
              <span
                key={s}
                className={`step ${RIDE_STEPS.indexOf(s) < RIDE_STEPS.indexOf(ride.state) ? "done" : RIDE_STEPS.indexOf(s) === RIDE_STEPS.indexOf(ride.state) ? "now" : ""}`}
              >
                {STATE_LABEL[s]}
              </span>
            ))}
          </div>
          <div className="grid" style={{ marginTop: 8 }}>
            <div>
              <p className="muted" style={{ margin: "2px 0" }}>🟢 {ride.pickup.label}</p>
              <p className="muted" style={{ margin: "2px 0" }}>🔴 {ride.dropoff.label}</p>
              <p className="muted" style={{ margin: "4px 0" }}>
                {ride.distanceKm} km · ~{ride.durationMin} min ·{" "}
                <b style={{ color: "var(--accent)" }}>{fmtAlgo(ride.fareMicroAlgo)}</b>
              </p>
              {driver && (
                <div className="driver-card">
                  <div className="avatar">{driver.name[0]}</div>
                  <div>
                    <b>{driver.name}</b> · {driver.vehicleType.replace("car-", "")}
                    <div className="muted mono">{driver.vehicleNo} · rating {driver.rating.toFixed(1)} ★</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "book" && (
        <div className="grid">
          <div>
            <div className="card">
              <h2>Plan your trip</h2>
              <div className="field-row">
                <div className="field">
                  <label>Pickup</label>
                  <input
                    value={pickup.label}
                    onChange={(e) => setPickup({ ...pickup, label: e.target.value })}
                    onFocus={() => setActiveField("pickup")}
                  />
                </div>
                <div className="field">
                  <label>Dropoff</label>
                  <input
                    value={dropoff.label}
                    onChange={(e) => setDropoff({ ...dropoff, label: e.target.value })}
                    onFocus={() => setActiveField("dropoff")}
                  />
                </div>
              </div>
              <p className="hint">
                Click the map to set the {activeField === "pickup" ? "pickup" : "dropoff"} point (currently editing:{" "}
                <b>{activeField}</b>).
              </p>
              <div className="map" ref={mapEl} />
            </div>
          </div>

          <div>
            <div className="card">
              <h2>Choose your ride</h2>
              <div className="vehicles">
                {(estimates.length ? estimates : vehicles.map((v) => ({ vehicleType: v.kind, fareMicroAlgo: null }))).map((est) => {
                  const v = vehicles.find((x) => x.kind === est.vehicleType);
                  if (!v) return null;
                  return (
                    <button
                      key={v.kind}
                      className={`vehicle ${selected === v.kind ? "selected" : ""}`}
                      onClick={() => setSelected(v.kind)}
                    >
                      <div className="icon">{v.icon}</div>
                      <div className="name">{v.name}</div>
                      <div className="desc">{v.description}</div>
                      {est.fareMicroAlgo != null ? (
                        <div className="fare">{fmtAlgo(est.fareMicroAlgo)}</div>
                      ) : (
                        <div className="fare muted">—</div>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="field-row" style={{ marginTop: 14 }}>
                <button onClick={findRides}>Estimate fares</button>
                <button className="primary" onClick={bookRide} disabled={!estimates.length}>
                  Book {vehicles.find((v) => v.kind === selected)?.name}
                </button>
              </div>
              {notice && <p className="warn">{notice}</p>}
            </div>

            {ride && (
              <div className="card" style={{ marginTop: 14 }}>
                <h2>Payment — x402 on Algorand Testnet</h2>
                <p className="muted">
                  Ride <span className="mono">{ride.id}</span> ·{" "}
                  <b>{fmtAlgo(ride.fareMicroAlgo)}</b> to <b>{ride.dropoff.label}</b>
                </p>
                {ride.state === "CREATED" && (
                  <>
                    <p className="hint">
                      Paying via the GoPlausible facilitator: your signed ALGO transfer is verified and
                      settled on-chain. Demo payer wallet:{" "}
                      <span className="mono">{demo?.payer?.address ?? "…"}</span>
                    </p>
                    <div className="field-row">
                      <button className="primary" onClick={payNow} disabled={paying}>
                        {paying ? <span className="spin">◌</span> : "Pay with x402"} · {fmtAlgo(ride.fareMicroAlgo)}
                      </button>
                      {payError && (
                        <>
                          <button onClick={fundPayer}>Fund demo payer (Testnet faucet)</button>
                        </>
                      )}
                    </div>
                    {payError && <p className="error">{payError}</p>}
                  </>
                )}
                {ride.payment?.status === "paid" && (
                  <div className="receipt">
                    <b>✓ Paid on Algorand Testnet</b>
                    <div className="mono" style={{ marginTop: 6 }}>
                      txn: {ride.payment.txnId}
                      <br />
                      fee payer: {ride.payment.feePayerTxnId ?? "n/a"}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <a href={ride.payment.explorerUrl} target="_blank" rel="noreferrer">
                        View on Pera Explorer →
                      </a>
                    </div>
                  </div>
                )}
                {ride.state === "CANCELLED" && <p className="error">Ride cancelled.</p>}
              </div>
            )}

            {ride && ["PAID", "ASSIGNED", "ARRIVING", "IN_PROGRESS"].includes(ride.state) && (
              <div className="card" style={{ marginTop: 14 }}>
                <button className="danger" onClick={cancelRide}>Cancel ride</button>
              </div>
            )}

            {ride?.state === "COMPLETED" && !ride.rating && (
              <div className="card" style={{ marginTop: 14 }}>
                <h2>Rate your driver</h2>
                <div className="stars">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} onClick={() => setRating(n)} style={{ background: "none", border: "none", fontSize: 22, color: n <= rating ? "var(--warn)" : "var(--border)" }}>
                      ★
                    </button>
                  ))}
                </div>
                <textarea value={review} onChange={(e) => setReview(e.target.value)} placeholder="Leave a review (optional)" rows={2} style={{ marginTop: 8 }} />
                <div style={{ marginTop: 10 }}>
                  <button className="primary" onClick={rateRide}>Submit rating</button>
                </div>
              </div>
            )}

            <div className="card" style={{ marginTop: 14 }}>
              <h3>Blockchain status</h3>
              <div className="blockchain-strip">
                <div>Network: <b>{demo?.network ?? "algorand testnet"}</b></div>
                <div>Facilitator: <b className="mono">{demo?.facilitator ?? "facilitator.goplausible.xyz"}</b></div>
                <div>Merchant (receives fares): <span className="mono">{demo?.merchant?.address ?? "…"}</span></div>
                <div>
                  Merchant ALGO: <b>{demo?.merchant?.amount != null ? (demo.merchant.amount / 1e6).toFixed(4) : "…"}</b> · Payer ALGO:{" "}
                  <b>{demo?.payer?.amount != null ? (demo.payer.amount / 1e6).toFixed(4) : "…"}</b>
                </div>
                {demo?.lastPayment && (
                  <div>
                    Last x402 payment:{" "}
                    <a href={demo.lastPayment.explorerUrl} target="_blank" rel="noreferrer" className="mono">
                      {demo.lastPayment.txnId}
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "track" && (
        <div className="card">
          <h2>My rides</h2>
          {history.length === 0 && <p className="muted">No rides yet.</p>}
          {history.map((r) => (
            <div key={r.id} className="ride-row">
              <div className="top">
                <div>
                  <b>{r.pickup.label}</b> → <b>{r.dropoff.label}</b>
                  <div className="muted mono">{r.id} · {r.vehicleType}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span className={r.state === "COMPLETED" ? "" : "muted"}>{STATE_LABEL[r.state]}</span>
                  <div style={{ fontWeight: 700, color: "var(--accent)" }}>{fmtAlgo(r.fareMicroAlgo)}</div>
                </div>
              </div>
              {r.payment?.status === "paid" && (
                <div className="muted" style={{ marginTop: 6 }}>
                  x402 txn:{" "}
                  <a href={r.payment.explorerUrl} target="_blank" rel="noreferrer" className="mono">
                    {r.payment.txnId}
                  </a>
                  {r.rating ? <span> · rated {r.rating}★</span> : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
