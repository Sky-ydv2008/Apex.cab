import { Router } from "express";
import type { Request } from "express";
import {
  asyncHandler,
  isLatLng,
  isVehicleKind,
  requireAuth,
  str,
  shortStr,
} from "../security.js";
import { store } from "../store.js";
import { estimateFare, VEHICLES, VEHICLE_KINDS } from "../fares.js";
import { newId } from "../auth.js";
import { payForRide, payerCanAfford } from "../x402/pay.js";
import { config } from "../config.js";
import type { Customer, Place, Ride } from "../types.js";

export const ridesRouter = Router();

function customerOf(req: Request): Customer {
  return (req as Request & { customer: Customer }).customer;
}

function publicCustomer(c: Customer) {
  return { id: c.id, name: c.name, phone: c.phone };
}

ridesRouter.get("/vehicles", (_req, res) => {
  res.json(Object.values(VEHICLES));
});
ridesRouter.get("/estimate", (req, res) => {
  const pickup = {
    label: "pickup",
    lat: Number(req.query.plat),
    lng: Number(req.query.plng),
  };
  const dropoff = {
    label: "dropoff",
    lat: Number(req.query.dlat),
    lng: Number(req.query.dlng),
  };
  if (!isLatLng(pickup) || !isLatLng(dropoff)) {
    res.status(400).json({ error: "pickup and dropoff coordinates are required" });
    return;
  }
  const estimates = VEHICLE_KINDS.map((kind) => ({
    vehicleType: kind,
    ...estimateFare(kind, pickup, dropoff),
  }));
  res.json({ estimates });
});

ridesRouter.post(
  "/customers/login",
  asyncHandler(async (req, res) => {
    const phone = str(req.body?.phone, 20);
    if (!phone) {
      res.status(400).json({ error: "phone is required" });
      return;
    }
    const name = shortStr(req.body?.name, 60);
    let customer = store.customerByPhone(phone);
    if (!customer) customer = store.createCustomer(name ?? "Rider", phone);
    res.json({ token: customer.token, customer: publicCustomer(customer) });
  }),
);

ridesRouter.get(
  "/customers/me/rides",
  requireAuth("customer"),
  asyncHandler(async (req, res) => {
    const customer = customerOf(req);
    res.json({ rides: store.ridesForCustomer(customer.id) });
  }),
);

function parsePlace(v: unknown): Place | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const label = str(o.label, 120);
  if (!label || !isLatLng(o)) return null;
  return { label, lat: o.lat, lng: o.lng };
}

ridesRouter.post(
  "/rides",
  requireAuth("customer"),
  asyncHandler(async (req, res) => {
    const customer = customerOf(req);
    const vehicleType = req.body?.vehicleType;
    const pickup = parsePlace(req.body?.pickup);
    const dropoff = parsePlace(req.body?.dropoff);
    if (!isVehicleKind(vehicleType)) {
      res.status(400).json({ error: "invalid vehicleType" });
      return;
    }
    if (!pickup || !dropoff) {
      res.status(400).json({ error: "pickup and dropoff must include label, lat, lng" });
      return;
    }
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
    res.status(201).json({
      ride,
      fare: est,
      paymentResource: `${config.publicBaseUrl}/api/x402/ride/${ride.id}`,
    });
  }),
);

ridesRouter.get(
  "/rides/:id",
  requireAuth("customer"),
  asyncHandler(async (req, res) => {
    const customer = customerOf(req);
    const ride = store.rideById(req.params.id);
    if (!ride || ride.customerId !== customer.id) {
      res.status(404).json({ error: "ride not found" });
      return;
    }
    const driver = ride.driverId ? store.driverById(ride.driverId) : null;
    res.json({
      ride,
      driver: driver
        ? {
            id: driver.id,
            name: driver.name,
            vehicleType: driver.vehicleType,
            vehicleNo: driver.vehicleNo,
            location: driver.location,
            rating: driver.rating,
          }
        : null,
    });
  }),
);

ridesRouter.post(
  "/rides/:id/pay",
  requireAuth("customer"),
  asyncHandler(async (req, res) => {
    const customer = customerOf(req);
    const ride = store.rideById(req.params.id);
    if (!ride || ride.customerId !== customer.id) {
      res.status(404).json({ error: "ride not found" });
      return;
    }
    if (ride.state !== "CREATED") {
      res.status(409).json({ error: `ride already ${ride.state}` });
      return;
    }
    if (!(await payerCanAfford(ride.id))) {
      res.status(402).json({
        error: "payer wallet underfunded — top up via POST /api/demo/fund first",
      });
      return;
    }
    const outcome = await payForRide(ride.id);
    if (outcome.status === "paid") {
      const updated = store.rideById(ride.id);
      res.json({ ok: true, ride: updated, outcome });
      return;
    }
    res.status(402).json({ ok: false, error: outcome.error });
  }),
);

ridesRouter.post(
  "/rides/:id/cancel",
  requireAuth("customer"),
  asyncHandler(async (req, res) => {
    const customer = customerOf(req);
    const ride = store.rideById(req.params.id);
    if (!ride || ride.customerId !== customer.id) {
      res.status(404).json({ error: "ride not found" });
      return;
    }
    if (!["CREATED", "PAID"].includes(ride.state)) {
      res.status(409).json({ error: `cannot cancel a ${ride.state} ride` });
      return;
    }
    store.updateRide(ride.id, { state: "CANCELLED" });
    // Demo note: already-settled fares are not clawed back on-chain.
    res.json({ ok: true, ride: store.rideById(ride.id) });
  }),
);

ridesRouter.post(
  "/rides/:id/rate",
  requireAuth("customer"),
  asyncHandler(async (req, res) => {
    const customer = customerOf(req);
    const ride = store.rideById(req.params.id);
    if (!ride || ride.customerId !== customer.id) {
      res.status(404).json({ error: "ride not found" });
      return;
    }
    if (ride.state !== "COMPLETED") {
      res.status(409).json({ error: "ride is not completed" });
      return;
    }
    if (ride.rating) {
      res.status(409).json({ error: "already rated" });
      return;
    }
    const rating = req.body?.rating;
    if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      res.status(400).json({ error: "rating must be an integer 1-5" });
      return;
    }
    const review = shortStr(req.body?.review, 300);
    store.updateRide(ride.id, { rating, review: review ?? undefined });
    if (ride.driverId) {
      const driver = store.driverById(ride.driverId);
      if (driver) {
        const total = driver.rating * driver.ratingCount + rating;
        const count = driver.ratingCount + 1;
        store.updateDriver(driver.id, { rating: total / count, ratingCount: count });
      }
    }
    res.json({ ok: true, ride: store.rideById(ride.id) });
  }),
);
