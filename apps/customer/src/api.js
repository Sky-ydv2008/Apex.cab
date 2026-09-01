// Thin fetch wrapper around the Apex Cab API (same origin in prod, proxied in dev).
const json = async (res) => {
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
};

const authed = (method, path, body) => {
  const headers = { "content-type": "application/json" };
  const token = localStorage.getItem("apex_customer_token");
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  }).then(json);
};

export const api = {
  login: (name, phone) =>
    fetch("/api/customers/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, phone }),
    }).then(json),

  vehicles: () => fetch("/api/vehicles").then(json),
  estimate: (pickup, dropoff) =>
    fetch(
      `/api/estimate?plat=${pickup.lat}&plng=${pickup.lng}&dlat=${dropoff.lat}&dlng=${dropoff.lng}`,
    ).then(json),

  createRide: (body) => authed("POST", "/api/rides", body),
  ride: (id) => authed("GET", `/api/rides/${id}`),
  pay: (id) => authed("POST", `/api/rides/${id}/pay`),
  cancel: (id) => authed("POST", `/api/rides/${id}/cancel`),
  rate: (id, body) => authed("POST", `/api/rides/${id}/rate`, body),
  myRides: () => authed("GET", "/api/customers/me/rides"),

  demoStatus: () => fetch("/api/demo/status").then(json),
  demoFund: () =>
    fetch("/api/demo/fund", { method: "POST" }).then(json),
};

export const fmtAlgo = (micro) => `${(Number(micro) / 1_000_000).toFixed(6)} ALGO`;
