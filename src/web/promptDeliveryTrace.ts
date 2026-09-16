import type {
  PromptDeliveryEvent,
  PromptDeliveryPhase,
  PromptDeliveryStatus,
  PromptQueueStatus,
  PromptTransport,
} from "../shared/protocol";
import { parsePromptDeliveryEvent } from "../shared/prompt-delivery";
import { apiFetch } from "./api";

const ENDPOINT = "/api/prompt-delivery/events";
const MAX_LOCAL_EVENTS = 200;
const MAX_PENDING_EVENTS = 40;
const MAX_BATCH_SIZE = 20;
const FLUSH_DELAY_MS = 300;
const RETRY_DELAY_MS = 3_000;

export interface PromptTraceFields {
  transport?: PromptTransport;
  status?: PromptDeliveryStatus;
  httpStatus?: number;
  errorCode?: string;
  errorClass?: string;
  latencyMs?: number;
  queueStatus?: PromptQueueStatus;
  commandId?: string;
}

export interface PromptDeliveryTraceHandle {
  readonly requestId: string;
  /** Records one metadata-only stage of this attempt. Never throws. */
  record: (phase: PromptDeliveryPhase, fields?: PromptTraceFields) => void;
  /** Sends everything buffered so far. */
  flush: () => Promise<void>;
}

let localEvents: PromptDeliveryEvent[] = [];
let pending: PromptDeliveryEvent[] = [];
let flushTimer: number | undefined;
let retryTimer: number | undefined;
let inFlight: Promise<void> | null = null;
let failureCount = 0;

/**
 * Client-side half of the prompt delivery trace.
 *
 * Events are bounded twice (a local ring for debugging plus a pending upload
 * batch) and are always re-sanitized, so prompt text, image bytes and tokens
 * can never leave the browser through this path.
 */
export function createPromptDeliveryTrace(input: {
  paneId: string;
  requestId: string;
  attempt?: number;
}): PromptDeliveryTraceHandle {
  return {
    requestId: input.requestId,
    record(phase, fields = {}) {
      recordClientPromptDeliveryEvent({
        requestId: input.requestId,
        paneId: input.paneId,
        phase,
        ...(input.attempt !== undefined ? { attempt: input.attempt } : {}),
        ...fields,
      });
    },
    flush: flushPromptDeliveryTrace,
  };
}

export function recordClientPromptDeliveryEvent(
  input: Omit<PromptDeliveryEvent, "source" | "at"> & { at?: number },
): PromptDeliveryEvent | null {
  try {
    const event = parsePromptDeliveryEvent(
      { ...input, at: input.at ?? Date.now() },
      { source: "client" },
    );
    if (!event) return null;

    localEvents.push(event);
    if (localEvents.length > MAX_LOCAL_EVENTS) {
      localEvents = localEvents.slice(localEvents.length - MAX_LOCAL_EVENTS);
    }

    console.debug("[herzi:prompt-delivery]", event);

    pending.push(event);
    if (pending.length > MAX_PENDING_EVENTS) {
      pending = pending.slice(pending.length - MAX_PENDING_EVENTS);
    }
    scheduleFlush(FLUSH_DELAY_MS);
    return event;
  } catch {
    // Tracing must never break prompt delivery.
    return null;
  }
}

/** Recent client events, for debugging and tests. */
export function recentPromptDeliveryEvents(): PromptDeliveryEvent[] {
  return [...localEvents];
}

export function flushPromptDeliveryTrace(): Promise<void> {
  if (inFlight) return inFlight;
  if (pending.length === 0) return Promise.resolve();

  const batch = pending.slice(0, MAX_BATCH_SIZE);
  const sent = new Set(batch);
  inFlight = (async () => {
    try {
      const response = await apiFetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: batch }),
      });
      if (!response.ok) {
        throw new Error(`Prompt delivery trace failed (${response.status})`);
      }
      pending = pending.filter((event) => !sent.has(event));
      failureCount = 0;
    } catch {
      // Keep the batch buffered (bounded) and retry a few times, then wait for
      // the next event instead of hammering an unavailable server.
      failureCount += 1;
      if (failureCount < 5) scheduleFlush(RETRY_DELAY_MS);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Test helper: clears buffers, timers and the last flush error. */
export function resetPromptDeliveryTrace(): void {
  localEvents = [];
  pending = [];
  if (flushTimer !== undefined) window.clearTimeout(flushTimer);
  if (retryTimer !== undefined) window.clearTimeout(retryTimer);
  flushTimer = undefined;
  retryTimer = undefined;
  inFlight = null;
  failureCount = 0;
}

function scheduleFlush(delay: number): void {
  if (retryTimer !== undefined) return;
  if (delay === FLUSH_DELAY_MS && flushTimer !== undefined) return;
  const timer = window.setTimeout(() => {
    if (delay === FLUSH_DELAY_MS) flushTimer = undefined;
    else retryTimer = undefined;
    void flushPromptDeliveryTrace();
  }, delay);
  if (delay === FLUSH_DELAY_MS) flushTimer = timer;
  else retryTimer = timer;
}
