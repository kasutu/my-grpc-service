import { Injectable, Logger } from "@nestjs/common";
import * as cbor from "cbor";
import { AnalyticsStoreService } from "./services/analytics-store.service";
import type {
  Batch,
  Ack,
  Event,
  Policy,
} from "../generated/analytics/v1/analytics";
import { ConnectionQuality } from "../generated/analytics/v1/analytics";

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  // Default server-side policy
  private readonly defaultPolicy: Policy = {
    minQuality: ConnectionQuality.FAIR as number,
    maxBatchSize: 100,
    maxQueueAgeHours: 24,
    uploadIntervalSeconds: 300, // 5 minutes
  };

  constructor(private readonly store: AnalyticsStoreService) {}

  /**
   * Process an analytics batch (primary ingestion method)
   */
  ingest(batch: Batch): Ack {
    return this.processBatch(batch);
  }

  /**
   * Process a batch of events from a device
   */
  private processBatch(batch: Batch): Ack {
    // Validate batch
    if (!batch) {
      return this.createAck(Buffer.alloc(0), false, [], "Missing batch");
    }

    // Validate batchId (should be 16 bytes)
    if (!batch.batchId || batch.batchId.length === 0) {
      return this.createAck(Buffer.alloc(0), false, [], "Missing batch_id");
    }

    // Validate events
    if (
      !batch.events ||
      !Array.isArray(batch.events) ||
      batch.events.length === 0
    ) {
      return this.createAck(
        batch.batchId,
        false,
        [],
        "Empty batch (no events)",
      );
    }

    // Validate batch size
    if (batch.events.length > this.defaultPolicy.maxBatchSize) {
      return this.createAck(
        batch.batchId,
        false,
        [],
        `Batch size exceeds maximum (${batch.events.length} > ${this.defaultPolicy.maxBatchSize})`,
      );
    }

    const batchIdHex = this.bytesToHex(batch.batchId);
    this.logger.log(
      `Received analytics batch ${batchIdHex} from device ${batch.deviceFingerprint} with ${batch.events.length} events`,
    );

    // Process each event
    const rejectedEventIds: Uint8Array[] = [];
    const eventsToStore: Array<{
      eventId: string;
      deviceFingerprint: number;
      batchId: string;
      timestampMs: number;
      type: number;
      schemaVersion: number;
      payload: unknown;
      network?: {
        quality: number;
        downloadMbps?: number;
        uploadMbps?: number;
        connectionType?: string;
        signalStrengthDbm?: number;
      };
    }> = [];

    for (const event of batch.events) {
      try {
        const processed = this.processEvent(event);
        if (processed) {
          eventsToStore.push({
            ...processed,
            deviceFingerprint: batch.deviceFingerprint,
            batchId: batchIdHex,
          });
        } else {
          rejectedEventIds.push(event.eventId);
        }
      } catch (error) {
        this.logger.warn(`Failed to process event: ${error}`);
        rejectedEventIds.push(event.eventId);
      }
    }

    // Store valid events
    if (eventsToStore.length > 0) {
      this.store.storeEvents(batchIdHex, eventsToStore);
    }

    const accepted = rejectedEventIds.length === 0;

    if (accepted) {
      this.logger.log(
        `Batch ${batchIdHex} accepted (${eventsToStore.length} events)`,
      );
    } else {
      this.logger.warn(
        `Batch ${batchIdHex} partially accepted (${eventsToStore.length}/${batch.events.length} events)`,
      );
    }

    return this.createAck(
      batch.batchId,
      accepted,
      rejectedEventIds,
      accepted ? undefined : "Some events failed to process",
    );
  }

  /**
   * Process a single event - decode CBOR payload
   */
  private processEvent(event: Event): {
    eventId: string;
    timestampMs: number;
    type: number;
    schemaVersion: number;
    payload: unknown;
    network?: {
      quality: number;
      downloadMbps?: number;
      uploadMbps?: number;
      connectionType?: string;
      signalStrengthDbm?: number;
    };
  } | null {
    // Validate eventId (should be 16 bytes)
    if (!event.eventId || event.eventId.length !== 16) {
      this.logger.warn("Event missing valid event_id, skipping");
      return null;
    }

    // Validate payload exists
    if (!event.payload || event.payload.length === 0) {
      this.logger.warn(
        `Event ${this.bytesToHex(event.eventId)} has no payload, skipping`,
      );
      return null;
    }

    // Decode CBOR payload
    let decodedPayload: unknown;
    try {
      decodedPayload = cbor.decode(event.payload);
    } catch (error) {
      this.logger.warn(
        `Failed to decode CBOR payload for event ${this.bytesToHex(event.eventId)}: ${error}`,
      );
      return null;
    }

    return {
      eventId: this.bytesToHex(event.eventId),
      timestampMs: event.timestampMs,
      type: event.type,
      schemaVersion: event.schemaVersion,
      payload: decodedPayload,
      network: event.network
        ? {
            quality: event.network.quality,
            downloadMbps: event.network.downloadMbps,
            uploadMbps: event.network.uploadMbps,
            connectionType: event.network.connectionType,
            signalStrengthDbm: event.network.signalStrengthDbm,
          }
        : undefined,
    };
  }

  /**
   * Create an Ack response
   */
  private createAck(
    batchId: Uint8Array,
    accepted: boolean,
    rejectedEventIds: Uint8Array[],
    errorMessage?: string,
  ): Ack {
    // Log error if present
    if (errorMessage) {
      this.logger.warn(`Batch rejected: ${errorMessage}`);
    }

    return {
      batchId,
      accepted,
      rejectedEventIds,
      throttleMs: 0,
      policy: this.defaultPolicy,
    };
  }

  /**
   * Get the current upload policy
   */
  getPolicy(): Policy {
    return this.defaultPolicy;
  }

  /**
   * Convert bytes to hex string
   */
  private bytesToHex(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString("hex");
  }

  /**
   * Get EventType string from number
   */
  getEventTypeString(type: number): string {
    const map: Record<number, string> = {
      0: "UNSPECIFIED",
      1: "ERROR",
      2: "IMPRESSION",
      3: "HEARTBEAT",
      4: "PERFORMANCE",
      5: "LIFECYCLE",
    };
    return map[type] || "UNKNOWN";
  }

  /**
   * Get ConnectionQuality string from number
   */
  getConnectionQualityString(quality: number): string {
    const map: Record<number, string> = {
      0: "UNSPECIFIED",
      1: "OFFLINE",
      2: "POOR",
      3: "FAIR",
      4: "GOOD",
      5: "EXCELLENT",
    };
    return map[quality] || "UNKNOWN";
  }
}
