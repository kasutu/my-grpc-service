// File: src/fleet/interfaces/fleet.types.ts
export interface FleetMember {
  deviceId: string;
  joinedAt: Date;
  metadata?: Record<string, any>;
}

export interface Fleet {
  id: string;
  name: string;
  description?: string;
  members: Map<string, FleetMember>;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface FleetBroadcastResult {
  fleetId: string;
  targetDevices: number;
  successful: number;
  failed: number;
  failures: Array<{ deviceId: string; reason: string }>;
}

export interface CreateFleetDto {
  name: string;
  description?: string;
  deviceIds?: string[];
  metadata?: Record<string, any>;
}

export interface UpdateFleetDto {
  name?: string;
  description?: string;
  metadata?: Record<string, any>;
}
