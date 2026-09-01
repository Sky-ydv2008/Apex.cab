export type VehicleKind =
  | "car-economy"
  | "car-comfort"
  | "car-premium"
  | "auto"
  | "bike";

export interface VehicleType {
  kind: VehicleKind;
  name: string;
  category: "car" | "auto" | "bike";
  seats: number;
  baseFareMicroAlgo: number; // in microALGO (1 ALGO = 1_000_000)
  perKmMicroAlgo: number;
  perMinMicroAlgo: number;
  minFareMicroAlgo: number;
  icon: string;
  description: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Place {
  label: string;
  lat: number;
  lng: number;
}

export type RideState =
  | "CREATED"
  | "PAID"
  | "ASSIGNED"
  | "ARRIVING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

export interface PaymentReceipt {
  status: "paid" | "failed";
  paymentId?: string;
  txnId?: string; // on-chain payment txn id
  feePayerTxnId?: string; // facilitator fee-payer txn id (fee abstraction)
  amountMicroAlgo: string;
  asset: string;
  network: string;
  explorerUrl?: string;
  error?: string;
  facilitatorSettleTransaction?: string;
  paidAt?: number;
}

export interface Ride {
  id: string;
  customerId: string;
  driverId: string | null;
  vehicleType: VehicleKind;
  pickup: Place;
  dropoff: Place;
  distanceKm: number;
  durationMin: number;
  fareMicroAlgo: number;
  state: RideState;
  createdAt: number;
  assignedAt?: number;
  completedAt?: number;
  rating?: number;
  review?: string;
  payment: PaymentReceipt | null;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  token: string;
  createdAt: number;
}

export type DriverStatus = "offline" | "idle" | "assigned" | "on-ride";

export interface Driver {
  id: string;
  name: string;
  phone: string;
  vehicleType: VehicleKind;
  vehicleNo: string;
  token: string;
  status: DriverStatus;
  location: LatLng;
  rating: number;
  ratingCount: number;
  ridesCompleted: number;
  createdAt: number;
  currentRideId: string | null;
}
