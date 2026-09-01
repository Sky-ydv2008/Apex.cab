import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { api, fmtAlgo } from "./api.js";

const STATE_LABEL = {
  CREATED: "Awaiting payment",
  PAID: "Rider paid — request open",
  ASSIGNED: "Assigned — head to pickup",
  ARRIVING: "Arrived at pickup",
  IN_PROGRESS: "Trip in progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

function pin(emoji) {
  return L.divIcon({
    className: "",
    html: `<div style="font-size:24px;transform:translate(-50%,-100%)">${emoji}</div>`,
    iconSize: [24, 24],
  });
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("apex_driver_token") || "");
  const [form, setForm] = useState({ name: "", phone: "", vehicleType: "car-economy", vehicleNo: "" });
  const [driver, setDriver] = useState(null);
  const [available, setAvailable] = useState([]);
  const [active, setActive] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [earnings, setEarnings] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("home");

  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const drawRef = useRef(null);
  const pollRef = useRef(null);

  // ---- map (lazy init after login) ----
  useEffect(() => {
    if (!token || !mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current).setView([13.05, 77.65], 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [token]);

  // ---- redraw active ride route ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (drawRef.current) {
      map.removeLayer(drawRef.current);
      drawRef.current = null;
    }
    if (!active) return;
    const layer = L.layerGroup();
    layer.addLayer(L.marker([active.ride.pickup.lat, active.ride.pickup.lng], { icon: pin("🟢") }));
    layer.addLayer(L.marker([active.ride.dropoff.lat, active.ride.dropoff.lng], { icon: pin("🔴") }));
    const line = L.polyline(
      [
        [active.ride.pickup.lat, active.ride.pickup.lng],
        [active.ride.dropoff.lat, active.ride.dropoff.lng],
      ],
      { color: "#1f6feb", weight: 4, dashArray: "8 8" },
    );
    layer.addLayer(line);
    if (driver?.location) {
      layer.addLayer(
        L.marker([driver.location.lat, driver.location.lng], { icon: pin("🚘") }),
      );
    }
    layer.addTo(map);
    drawRef.current = layer;
    map.fitBounds(line.getBounds().pad(0.3));
  }, [active, driver]);

  // ---- login ----
  const doLogin = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const d = await api.login(form);
      localStorage.setItem("apex_driver_token", d.token);
      setToken(d.token);
      setDriver(d.driver);
    } catch (err) {
      setError(err.message);
    }
  };

  const logout = () => {
    localStorage.removeItem("apex_driver_token");
    setToken("");
    setDriver(null);
    setActive(null);
    setAvailable([]);
  };

  // ---- go online/offline ----
  const setOnline = async (online) => {
    const d = await api.updateMe({
      online,
      location: { lat: 12.9716 + (Math.random() - 0.5) * 0.02, lng: 77.5946 + (Math.random() - 0.5) * 0.02 },
    });
    setDriver(d.driver);
  };

  const refresh = async () => {
    try {
      const [me, av, act] = await Promise.all([api.me(), api.available(), api.active()]);
      setDriver(me.driver);
      setAvailable(av.rides);
      setActive(act.ride ? { ride: act.ride, customer: act.customer } : null);
      if (act.ride) setCustomer(act.customer);
    } catch {
      /* transient */
    }
  };

  // ---- poll while logged in ----
  useEffect(() => {
    if (!token) return;
    refresh();
    pollRef.current = setInterval(refresh, 3000);
    return () => clearInterval(pollRef.current);
  }, [token]);

  const acceptRide = async (id) => {
    await api.accept(id);
    await refresh();
  };

  const transition = async (status) => {
    await api.setStatus(active.ride.id, status);
    await refresh();
    if (status === "COMPLETED") {
      const [e, h] = await Promise.all([api.earnings(), api.myRides()]);
      setEarnings(e);
      setHistory(h.rides);
      setTab("earnings");
    }
  };

  const loadEarnings = async () => {
    const [e, h] = await Promise.all([api.earnings(), api.myRides()]);
    setEarnings(e);
    setHistory(h.rides);
  };

  if (!token) {
    return (
      <div className="app">
        <div className="topbar">
          <div className="brand">
            <span className="logo">🚘</span>
            <div>
              <h1>Apex Cab Driver</h1>
              <small>Earn ALGO per trip · paid via x402 on Algorand Testnet</small>
            </div>
          </div>
        </div>
        <div className="grid">
          <div className="card">
            <h2>Driver sign in</h2>
            <form onSubmit={doLogin}>
              <label>Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              <label>Phone</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
              <label>Vehicle type</label>
              <select value={form.vehicleType} onChange={(e) => setForm({ ...form, vehicleType: e.target.value })}>
                <option value="car-economy">Economy car</option>
                <option value="car-comfort">Comfort car</option>
                <option value="car-premium">Premium car</option>
                <option value="auto">Auto</option>
                <option value="bike">Bike</option>
              </select>
              <label>Vehicle number</label>
              <input value={form.vehicleNo} onChange={(e) => setForm({ ...form, vehicleNo: e.target.value })} placeholder="KA-01-AB-1234" required />
              {error && <p className="error">{error}</p>}
              <div style={{ marginTop: 12 }}>
                <button className="primary" type="submit">Sign in</button>
              </div>
            </form>
            <p className="muted" style={{ marginTop: 8 }}>
              New phone = new driver. Try: <span className="mono">Amit Sharma · +919876543210 · KA-01-AB-1234</span>
            </p>
          </div>
          <div className="card">
            <h2>How it works</h2>
            <ol className="muted" style={{ lineHeight: 1.8 }}>
              <li>Sign in and go <b>online</b></li>
              <li>Paid ride requests appear automatically (polling)</li>
              <li>Accept → drive to pickup → start trip → complete</li>
              <li>Fares settle on Algorand Testnet via the GoPlausible x402 facilitator</li>
              <li>Track earnings in the Earnings tab</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  const online = driver?.status !== "offline";

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <span className="logo">🚘</span>
          <div>
            <h1>Apex Cab Driver</h1>
            <small>
              {driver?.name} · {driver?.vehicleType.replace("car-", "")} {driver?.vehicleNo} · {driver?.rating.toFixed(1)} ★
            </small>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div className="toggle">
            <span className="muted">{online ? "Online" : "Offline"}</span>
            <button
              className={`switch ${online ? "on" : ""}`}
              onClick={() => setOnline(!online)}
              aria-label="toggle online"
            >
              <span className="knob" />
            </button>
          </div>
          <button onClick={logout}>Sign out</button>
        </div>
      </div>

      <div className="tabs" style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")} style={tab === "home" ? { borderColor: "#1f6feb", color: "#fff" } : {}}>
          Requests
        </button>
        <button className={tab === "earnings" ? "active" : ""} onClick={() => { setTab("earnings"); loadEarnings(); }} style={tab === "earnings" ? { borderColor: "#1f6feb", color: "#fff" } : {}}>
          Earnings
        </button>
      </div>

      {tab === "home" && (
        <>
          {active ? (
            <div className="card" style={{ borderColor: "#1f6feb", marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2>{STATE_LABEL[active.ride.state]}</h2>
                <span className="state-badge">{active.ride.state}</span>
              </div>
              <p className="muted" style={{ margin: "4px 0" }}>
                Rider: <b>{customer?.name}</b> · {active.ride.pickup.label} → {active.ride.dropoff.label}
              </p>
              <p className="muted" style={{ margin: "4px 0" }}>
                {active.ride.distanceKm} km · ~{active.ride.durationMin} min
              </p>
              <div className="fare">{fmtAlgo(active.ride.fareMicroAlgo)}</div>
              <div className="map" ref={mapEl} style={{ marginTop: 10 }} />
              <div className="actions">
                {active.ride.state === "ASSIGNED" && (
                  <button className="primary" onClick={() => transition("ARRIVING")}>I've arrived</button>
                )}
                {active.ride.state === "ARRIVING" && (
                  <button className="primary" onClick={() => transition("IN_PROGRESS")}>Start trip</button>
                )}
                {active.ride.state === "IN_PROGRESS" && (
                  <button className="primary" onClick={() => transition("COMPLETED")}>Complete trip</button>
                )}
              </div>
            </div>
          ) : (
            <div className="card" style={{ marginBottom: 14 }}>
              <h2>Incoming ride requests</h2>
              {!online && <p className="muted">Go online to receive requests.</p>}
              {online && available.length === 0 && <p className="muted">No requests yet — waiting… <span className="spin">◌</span></p>}
              {available.map((r) => (
                <div key={r.id} className="ride-card">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div>
                      <h3>{r.vehicleType.replace("car-", "")} ride</h3>
                      <p className="muted" style={{ margin: "2px 0" }}>🟢 {r.pickup.label}</p>
                      <p className="muted" style={{ margin: "2px 0" }}>🔴 {r.dropoff.label}</p>
                      <p className="muted" style={{ margin: "4px 0" }}>{r.distanceKm} km · ~{r.durationMin} min</p>
                    </div>
                    <div className="fare">{fmtAlgo(r.fareMicroAlgo)}</div>
                  </div>
                  <div className="actions">
                    <button className="primary" onClick={() => acceptRide(r.id)}>Accept</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "earnings" && (
        <div className="card">
          <h2>Earnings</h2>
          {earnings && (
            <div className="row" style={{ marginBottom: 14 }}>
              <div className="stat">
                <div className="num">{earnings.ridesCompleted}</div>
                <div className="lbl">Trips</div>
              </div>
              <div className="stat">
                <div className="num">{fmtAlgo(earnings.totalFareMicroAlgo)}</div>
                <div className="lbl">Total fare (ALGO)</div>
              </div>
            </div>
          )}
          <h3>Trip history</h3>
          {history.length === 0 && <p className="muted">No trips yet.</p>}
          {history.map((r) => (
            <div key={r.id} className="ride-card">
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div>
                  <b>{r.pickup.label}</b> → <b>{r.dropoff.label}</b>
                  <div className="muted mono">{r.id}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div>{STATE_LABEL[r.state]}</div>
                  <div className="fare">{fmtAlgo(r.fareMicroAlgo)}</div>
                  {r.rating && <div className="muted">⭐ {r.rating}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
