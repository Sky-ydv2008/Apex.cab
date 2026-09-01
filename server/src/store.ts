import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { newId, newToken } from "./auth.js";
import type { Customer, Driver, Ride, VehicleKind } from "./types.js";

interface DB {
  customers: Customer[];
  drivers: Driver[];
  rides: Ride[];
}

const empty = (): DB => ({ customers: [], drivers: [], rides: [] });

/**
 * JSON-file-backed in-memory store. Written synchronously at small scale so
 * the demo never races reads/writes; swap for Postgres in production.
 */
 class Store {
  db: DB;
  private file: string;

  constructor() {
    this.file = path.join(config.dataDir, "db.json");
    fs.mkdirSync(config.dataDir, { recursive: true });
    try {
      this.db = JSON.parse(fs.readFileSync(this.file, "utf8")) as DB;
    } catch {
      this.db = empty();
    }
  }

  persist(): void {
    fs.writeFileSync(this.file, JSON.stringify(this.db, null, 2));
  }

  // ---- customers -------------------------------------------------------
  customerByPhone(phone: string): Customer | undefined {
    return this.db.customers.find((c) => c.phone === phone.trim());
  }
  customerByToken(token: string): Customer | undefined {
    return this.db.customers.find((c) => c.token === token);
  }
  customerById(id: string): Customer | undefined {
    return this.db.customers.find((c) => c.id === id);
  }
  createCustomer(name: string, phone: string): Customer {
    const customer: Customer = {
      id: newId("cust"),
      name: name.trim() || "Rider",
      phone: phone.trim(),
      token: newToken(),
      createdAt: Date.now(),
    };
    this.db.customers.push(customer);
    this.persist();
    return customer;
  }

  // ---- drivers ---------------------------------------------------------
  driverByPhone(phone: string): Driver | undefined {
    return this.db.drivers.find((d) => d.phone === phone.trim());
  }
  driverByToken(token: string): Driver | undefined {
    return this.db.drivers.find((d) => d.token === token);
  }
  driverById(id: string): Driver | undefined {
    return this.db.drivers.find((d) => d.id === id);
  }
  createDriver(input: {
    name: string;
    phone: string;
    vehicleType: VehicleKind;
    vehicleNo: string;
  }): Driver {
    const driver: Driver = {
      id: newId("drv"),
      name: input.name.trim() || "Driver",
      phone: input.phone.trim(),
      vehicleType: input.vehicleType,
      vehicleNo: input.vehicleNo.trim().toUpperCase(),
      token: newToken(),
      status: "offline",
      location: { lat: 12.9716, lng: 77.5946 }, // Bengaluru, India
      rating: 5,
      ratingCount: 0,
      ridesCompleted: 0,
      createdAt: Date.now(),
      currentRideId: null,
    };
    this.db.drivers.push(driver);
    this.persist();
    return driver;
  }
  updateDriver(id: string, patch: Partial<Driver>): Driver | undefined {
    const d = this.driverById(id);
    if (!d) return undefined;
    Object.assign(d, patch);
    this.persist();
    return d;
  }

  /** Rides a driver can accept: paid, unassigned, matching their vehicle. */
  availableRidesFor(driver: Driver): Ride[] {
    const rideKinds = new Set<VehicleKind>([driver.vehicleType]);
    if (driver.vehicleType.startsWith("car-")) {
      // A car driver can serve any car category (economy/comfort/premium).
      ["car-economy", "car-comfort", "car-premium"].forEach((k) =>
        rideKinds.add(k as VehicleKind),
      );
    }
    return this.db.rides.filter(
      (r) => r.state === "PAID" && !r.driverId && rideKinds.has(r.vehicleType),
    );
  }

  // ---- rides -----------------------------------------------------------
  createRide(ride: Ride): Ride {
    this.db.rides.push(ride);
    this.persist();
    return ride;
  }
  rideById(id: string): Ride | undefined {
    return this.db.rides.find((r) => r.id === id);
  }
  updateRide(id: string, patch: Partial<Ride>): Ride | undefined {
    const r = this.rideById(id);
    if (!r) return undefined;
    Object.assign(r, patch);
    this.persist();
    return r;
  }
  ridesForCustomer(customerId: string): Ride[] {
    return this.db.rides
      .filter((r) => r.customerId === customerId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  ridesForDriver(driverId: string): Ride[] {
    return this.db.rides
      .filter((r) => r.driverId === driverId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  activeRideForDriver(driverId: string): Ride | undefined {
    return this.db.rides.find(
      (r) =>
        r.driverId === driverId &&
        ["ASSIGNED", "ARRIVING", "IN_PROGRESS"].includes(r.state),
    );
  }
  activeRideForCustomer(customerId: string): Ride | undefined {
    return this.db.rides.find(
      (r) =>
        r.customerId === customerId &&
        ["PAID", "ASSIGNED", "ARRIVING", "IN_PROGRESS"].includes(r.state),
    );
  }
}

export const store = new Store();
