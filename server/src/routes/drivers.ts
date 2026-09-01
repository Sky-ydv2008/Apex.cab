import { Router } from "express";
import type { Request } from "express";
import {
  asyncHandler,
  isLatLng,
  isVehicleKind,
  requireAuth,
  shortStr,
  str,
} from "../security.js";
import { store } from "../store.js";
import { VEHICLES } from "../fares.js";
import type { Driver, RideState } from "../types.js";

export const driversRouter = Router();

function driverOf(req: Request): Driver {
  return (req as Request & { driver: Driver }).driver;
}

function publicDriver(d: Driver) {
  return {
    id: d.id,
    name: d.name,
    vehicleType: d.vehicleType,
    vehicleNo: d.vehicleNo,
    status: d.status,
    location: d.location,
    rating: d.rating,
    ratingCount: d.ratingCount,
    ridesCompleted: d.ridesCompleted,
    currentRideId: d.currentRideId,
  };
}

driversRouter.post(
  "/drivers/login",
  asyncHandler(async (req, res) => {
    const phone = str(req.body?.phone, 20);
    const name = shortStr(req.body?.name, 60);
    const vehicleNo = shortStr(req.body?.vehicleNo, 15);
    const vehicleType = req.body?.vehicleType;
    if (!phone || !name || !vehicleNo) {
      res.status(400).json({ error: "phone, name and vehicleNo are required" });
      return;
    }
    if (!isVehicleKind(vehicleType)) {
      res.status(400).json({ error: "invalid vehicleType" });
      return;
    }
    let driver = store.driverByPhone(phone);
    if (!driver) {
      driver = store.createDriver({ name, phone, vehicleType, vehicleNo });
      store.updateDriver(driver.id, { status: "idle" });
    }
    res.json({ token: driver.token, driver: publicDriver(driver) });
  }),
);

driversRouter.get(
  "/drivers/me",
  requireAuth("driver"),
  asyncHandler(async (req, res) => {
    res.json({ driver: publicDriver(driverOf(req)) });
  }),
);

driversRouter.patch(
  "/drivers/me",
  requireAuth("driver"),
  asyncHandler(async (req, res) => {
    const driver = driverOf(req);
    const patch: Partial<Driver> = {};
    if (typeof req.body?.online === "boolean") {
      const hasActiveRide = !!store.activeRideForDriver(driver.id);
      patch.status = hasActiveRide
        ? driver.status
        : req.body.online
          ? "idle"
          : "offline";
    }
    if (isLatLng(req.body?.location)) {
      patch.location = { lat: req.body.location.lat, lng: req.body.location.lng };
    }
    if (req.body?.vehicleType !== undefined) {
      if (!isVehicleKind(req.body.vehicleType)) {
        res.status(400).json({ error: "invalid vehicleType" });
        return;
      }
      if (store.activeRideForDriver(driver.id)) {
        res.status(409).json({ error: "cannot change vehicle during a ride" });
        return;
      }
      patch.vehicleType = req.body.vehicleType;
    }
    const updated = store.updateDriver(driver.id, patch)!;
    res.json({ driver: publicDriver(updated) });
  }),
);

driversRouter.get(
  "/drivers/me/available",
  requireAuth("driver"),
  asyncHandler(async (req, res) => {
    const driver = driverOf(req);
    if (driver.status === "offline") {
      res.json({ rides: [] });
      return;
    }
    const rides = store.availableRidesFor(driver);
    res.json({
      rides: rides.map((r) => ({
        id: r.id,
        vehicleType: r.vehicleType,
        pickup: r.pickup,
        dropoff: r.dropoff,
        distanceKm: r.distanceKm,
        durationMin: r.durationMin,
        fareMicroAlgo: r.fareMicroAlgo,
        fareAlgo: (r.fareMicroAlgo / 1_000_000).toFixed(6),
        createdAt: r.createdAt,
      })),
    });
  }),
);

driversRouter.get(
  "/drivers/me/active",
  requireAuth("driver"),
  asyncHandler(async (req, res) => {
    const driver = driverOf(req);
    const ride = store.activeRideForDriver(driver.id);
    if (!ride) {
      res.json({ ride: null });
      return;
    }
    const customer = store.customerById(ride.customerId);
    res.json({
      ride,
      customer: customer ? { id: customer.id, name: customer.name } : null,
    });
  }),
);

driversRouter.get(
  "/drivers/me/rides",
  requireAuth("driver"),
  asyncHandler(async (req, res) => {
    res.json({ rides: store.ridesForDriver(driverOf(req).id) });
  }),
);

driversRouter.get(
  "/drivers/me/earnings",
  requireAuth("driver"),
  asyncHandler(async (req, res) => {
    const driver = driverOf(req);
    const rides = store.ridesForDriver(driver.id).filter((r) => r.state === "COMPLETED");
    const totalMicroAlgo = rides.reduce((sum, r) => sum + r.fareMicroAlgo, 0);
    res.json({
      ridesCompleted: rides.length,
      totalFareMicroAlgo: totalMicroAlgo,
      totalFareAlgo: (totalMicroAlgo / 1_000_000).toFixed(6),
      byVehicle: Object.fromEntries(
        Object.keys(VEHICLES).map((k) => [
          k,
          rides.filter((r) => r.vehicleType === k).length,
        ]),
      ),
    });
  }),
);

driversRouter.post(
  "/rides/:id/accept",
  requireAuth("driver"),
  asyncHandler(async (req, res) => {
    const driver = driverOf(req);
    const ride = store.rideById(req.params.id);
    if (!ride) {
      res.status(404).json({ error: "ride not found" });
      return;
    }
    if (ride.state !== "PAID" || ride.driverId) {
      res.status(409).json({ error: "ride is no longer available" });
      return;
    }
    const eligible = store.availableRidesFor(driver).some((r) => r.id === ride.id);
    if (!eligible) {
      res.status(409).json({ error: "vehicle type does not match this ride" });
      return;
    }
    const active = store.activeRideForDriver(driver.id);
    if (active) {
      res.status(409).json({ error: "finish current ride first" });
      return;
    }
    store.updateRide(ride.id, { driverId: driver.id, state: "ASSIGNED", assignedAt: Date.now() });
    store.updateDriver(driver.id, {
      status: "assigned",
      currentRideId: ride.id,
      location: ride.pickup,
    });
    res.json({ ok: true, ride: store.rideById(ride.id) });
  }),
);

const ALLOWED_TRANSITIONS: Record<string, RideState[]> = {
  ASSIGNED: ["ARRIVING"],
  ARRIVING: ["IN_PROGRESS"],
  IN_PROGRESS: ["COMPLETED"],
};

driversRouter.post(
  "/rides/:id/status",
  requireAuth("driver"),
  asyncHandler(async (req, res) => {
    const driver = driverOf(req);
    const ride = store.rideById(req.params.id);
    if (!ride || ride.driverId !== driver.id) {
      res.status(404).json({ error: "ride not found" });
      return;
    }
    const next = req.body?.status as RideState;
    if (!next || !(ALLOWED_TRANSITIONS[ride.state] ?? []).includes(next)) {
      res.status(400).json({
        error: `cannot transition from ${ride.state} to ${String(next)}`,
      });
      return;
    }
    const patch: Partial<Driver> = {};
    if (next === "COMPLETED") {
      patch.status = "idle";
      patch.currentRideId = null;
      const driverRow = store.driverById(driver.id);
      if (driverRow) patch.ridesCompleted = driverRow.ridesCompleted + 1;
    }
    store.updateDriver(driver.id, patch);
    store.updateRide(ride.id, {
      state: next,
      ...(next === "COMPLETED" ? { completedAt: Date.now() } : {}),
    });
    res.json({ ok: true, ride: store.rideById(ride.id) });
  }),
);
