import { store } from "./store.js";
import type { VehicleKind } from "./types.js";

interface SeedDriver {
  name: string;
  phone: string;
  vehicleType: VehicleKind;
  vehicleNo: string;
  lat: number;
  lng: number;
}

const SEED_DRIVERS: SeedDriver[] = [
  { name: "Amit Sharma", phone: "+919876543210", vehicleType: "car-economy", vehicleNo: "KA-01-AB-1234", lat: 12.9716, lng: 77.5946 },
  { name: "Priya Verma", phone: "+919876543211", vehicleType: "car-economy", vehicleNo: "KA-01-AB-2345", lat: 12.9784, lng: 77.6408 },
  { name: "Rajesh Kumar", phone: "+919876543212", vehicleType: "car-comfort", vehicleNo: "KA-01-AB-3456", lat: 12.9352, lng: 77.6245 },
  { name: "Suresh Rao", phone: "+919876543213", vehicleType: "auto", vehicleNo: "KA-01-AB-4567", lat: 12.9698, lng: 77.75 },
  { name: "Kiran Patel", phone: "+919876543214", vehicleType: "bike", vehicleNo: "KA-01-AB-5678", lat: 12.925, lng: 77.5938 },
];

/** Idempotent: creates demo drivers once; keeps existing data intact. */
export function seedDrivers(): void {
  let changed = false;
  for (const d of SEED_DRIVERS) {
    if (store.driverByPhone(d.phone)) continue;
    const driver = store.createDriver(d);
    store.updateDriver(driver.id, {
      status: "idle",
      location: { lat: d.lat, lng: d.lng },
    });
    changed = true;
  }
  if (changed) store.persist();
}
