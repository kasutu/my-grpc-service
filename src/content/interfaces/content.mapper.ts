import type {
  ContentPackage,
  Content,
  TimeSlot,
  Campaign,
  MediaRef,
  Media,
} from "src/generated/content/v1/content";

export class ContentMapper {
  static toContentPackage(json: any): ContentPackage {
    return {
      deliveryId: json.delivery_id?.toString() ?? "",
      requiresAck: json.requires_ack ?? false,
      content: this.toContent(json.content),
      media: (json.media ?? []).map((m: any) => this.toMedia(m)),
    };
  }

  private static toContent(json: any): Content {
    return {
      id: json.id ?? 0,
      hmacSignature: json.hmac_signature ?? "",
      createdAt: json.created_at ?? "",
      fallbackMediaRef: this.toMediaRef(json.fallback_media_ref),
      timeSlots: (json.time_slots ?? []).map((slot: any) =>
        this.toTimeSlot(slot),
      ),
    };
  }

  private static toTimeSlot(json: any): TimeSlot {
    return {
      id: json.id ?? "",
      startWindow: json.start_window ?? "",
      endWindow: json.end_window ?? "",
      campaigns: (json.campaigns ?? []).map((camp: any) =>
        this.toCampaign(camp),
      ),
    };
  }

  private static toCampaign(json: any): Campaign {
    return {
      id: json.id ?? "",
      index: json.index ?? 0,
      mediaId: json.media_id ?? "",
    };
  }

  private static toMediaRef(json: any): MediaRef {
    return {
      mediaId: json?.media_id ?? "",
    };
  }

  private static toMedia(json: any): Media {
    return {
      id: json.id ?? "",
      checksum: json.checksum ?? "",
      url: json.url ?? "",
    };
  }
}
