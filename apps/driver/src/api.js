const json = async (res) => {
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
};

const authed = (method, path, body) => {
  const headers = { "content-type": "application/json" };
  const token = localStorage.getItem("apex_driver_token");
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  }).then(json);
};

export const api = {
  login: (body) =>
    fetch("/api/drivers/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(json),

  me: () => authed("GET", "/api/drivers/me"),
  updateMe: (body) => authed("PATCH", "/api/drivers/me", body),
  available: () => authed("GET", "/api/drivers/me/available"),
  active: () => authed("GET", "/api/drivers/me/active"),
  myRides: () => authed("GET", "/api/drivers/me/rides"),
  earnings: () => authed("GET", "/api/drivers/me/earnings"),
  accept: (id) => authed("POST", `/api/rides/${id}/accept`),
  setStatus: (id, status) => authed("POST", `/api/rides/${id}/status`, { status }),
};

export const fmtAlgo = (micro) => `${(Number(micro) / 1_000_000).toFixed(6)} ALGO`;
