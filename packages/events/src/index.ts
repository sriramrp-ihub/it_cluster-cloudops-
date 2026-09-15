/**
 * @cloudops/events
 * Placeholder package for Event Bus and Real-Time SSE delivery (Phase 7).
 */
import type { EventId, EventType, RunId } from "@cloudops/shared";

export interface DomainEvent<TPayload = Record<string, unknown>> {
  id: EventId;
  runId: RunId;
  type: EventType;
  sequenceNumber: number;
  payload: TPayload;
  timestamp: Date;
}
