import type { VehicleKind, VehicleType } from "./types.js";

/**
 * Apex Cab vehicle catalogue: 3 car categories + auto + bike.
 * Fares are denominated in microALGO (ALGO has 6 decimals) because x402
 * payments on Algorand settle in the native asset (asset id "0").
 */
export const VEHICLES: Record<VehicleKind, VehicleType> = {
  "car-economy": {
    kind: "car-economy",
    name: "Apex Economy",
    category: "car",
    seats: 4,
    baseFareMicroAlgo: 20_000, // 0.02 ALGO
    perKmMicroAlgo: 4_000, // 0.004 ALGO / km
    perMinMicroAlgo: 200, // 0.0002 ALGO / min
    minFareMicroAlgo: 30_000,
    icon: "🚗",
    description: "Everyday hatchback · up to 4 riders",
  },
  "car-comfort": {
    kind: "car-comfort",
    name: "Apex Comfort",
    category: "car",
    seats: 4,
    baseFareMicroAlgo: 35_000,
    perKmMicroAlgo: 6_000,
    perMinMicroAlgo: 300,
    minFareMicroAlgo: 50_000,
    icon: "🚙",
    description: "Spacious sedan · extra legroom",
  },
  "car-premium": {
    kind: "car-premium",
    name: "Apex Premium",
    category: "car",
    seats: 5,
    baseFareMicroAlgo: 60_000,
    perKmMicroAlgo: 9_000,
    perMinMicroAlgo: 500,
    minFareMicroAlgo: 80_000,
    icon: "🏎️",
    description: "Luxury SUV · top-rated drivers",
  },
  auto: {
    kind: "auto",
    name: "Apex Auto",
    category: "auto",
    seats: 3,
    baseFareMicroAlgo: 15_000,
    perKmMicroAlgo: 3_000,
    perMinMicroAlgo: 150,
    minFareMicroAlgo: 25_000,
    icon: "🛺",
    description: "Three-wheeler · zips through traffic",
  },
  bike: {
    kind: "bike",
    name: "Apex Bike",
    category: "bike",
    seats: 1,
    baseFareMicroAlgo: 10_000,
    perKmMicroAlgo: 2_000,
    perMinMicroAlgo: 100,
    minFareMicroAlgo: 15_000,
    icon: "🛵",
    description: "Fastest for solo city trips",
  },
};

export const VEHICLE_KINDS = Object.keys(VEHICLES) as VehicleKind[];

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface FareEstimate {
  distanceKm: number;
  durationMin: number;
  fareMicroAlgo: number;
  fareAlgo: string;
}

export function estimateFare(
  vehicle: VehicleKind,
  pickup: { lat: number; lng: number },
  dropoff: { lat: number; lng: number },
): FareEstimate {
  const v = VEHICLES[vehicle];
  const distanceKm = Math.max(0.3, haversineKm(pickup, dropoff));
  // City traffic heuristic: ~4 min per km + 3 min fixed pickup.
  const durationMin = Math.max(5, Math.round(distanceKm * 4) + 3);
  const raw = v.baseFareMicroAlgo + distanceKm * v.perKmMicroAlgo + durationMin * v.perMinMicroAlgo;
  const fare = Math.max(v.minFareMicroAlgo, Math.round(raw / 1000) * 1000);
  return {
    distanceKm: Math.round(distanceKm * 100) / 100,
    durationMin,
    fareMicroAlgo: fare,
    fareAlgo: (fare / 1_000_000).toFixed(6),
  };
}

export function microAlgoToAlgo(micro: number | string): string {
  return (Number(micro) / 1_000_000).toFixed(6);
}
