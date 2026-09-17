import type {
  PromptDeliveryEvent,
  PromptDeliveryPhase,
  PromptDeliverySource,
  PromptDeliveryStatus,
  PromptQueueStatus,
  PromptTransport,
} from "./protocol.js";

/**
 * Prompt delivery tracing is metadata-only by construction. Both the browser
 * and the server run every event through this sanitizer, so even a buggy or
 * hostile caller cannot persist prompt text, image bytes, tokens or absolute
 * session paths inside a trace record.
 */
export const CLIENT_PROMPT_PHASES: readonly PromptDeliveryPhase[] = [
  "client.submit",
  "client.optimistic",
  "client.response",
  "client.error",
  "client.retry",
  "client.delivery-status",
  "client.reconciliation",
];

export const SERVER_PROMPT_PHASES: readonly PromptDeliveryPhase[] = [
  "server.received",
  "server.rejected",
  "server.validated",
  "server.transport-selected",
  "server.submitted",
  "server.error",
  "queue.enqueued",
  "queue.claimed",
  "queue.dispatched",
  "queue.failed",
  "queue.expired",
];

export const PROMPT_TRANSPORTS: readonly PromptTransport[] = [
  "text",
  "host-path",
  "pi-native",
];

export const PROMPT_DELIVERY_STATUSES: readonly PromptDeliveryStatus[] = [
  "submitted",
  "queued",
  "claimed",
  "dispatched",
  "observed-live",
  "persisted",
  "delivery-unconfirmed",
  "failed",
];

export const PROMPT_QUEUE_STATUSES: readonly PromptQueueStatus[] = [
  "queued",
  "claimed",
  "dispatched",
  "failed",
  "expired",
];

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const MAX_CLIENT_CLOCK_SKEW_MS = 60_000;
const MAX_CLIENT_EVENT_AGE_MS = 3_600_000;
const MAX_LATENCY_MS = 86_400_000;

const CLIENT_PHASE_SET = new Set<string>(CLIENT_PROMPT_PHASES);
const SERVER_PHASE_SET = new Set<string>(SERVER_PROMPT_PHASES);
const TRANSPORT_SET = new Set<string>(PROMPT_TRANSPORTS);
const STATUS_SET = new Set<string>(PROMPT_DELIVERY_STATUSES);
const QUEUE_STATUS_SET = new Set<string>(PROMPT_QUEUE_STATUSES);

export function isPromptCorrelationId(value: unknown): value is string {
  return typeof value === "string" && CORRELATION_ID_PATTERN.test(value);
}

export interface ParsePromptDeliveryEventOptions {
  source: PromptDeliverySource;
  /** Current time used to clamp client clocks; defaults to `Date.now()`. */
  now?: number;
}

/**
 * Returns a sanitized copy containing only allowlisted fields and bounded
 * values, or `null` when the required correlation fields are unusable.
 */
export function parsePromptDeliveryEvent(
  value: unknown,
  options: ParsePromptDeliveryEventOptions,
): PromptDeliveryEvent | null {
  if (!isRecord(value)) return null;

  const requestId = value.requestId;
  const paneId = value.paneId;
  const phase = value.phase;
  if (!isPromptCorrelationId(requestId)) return null;
  if (!isPromptCorrelationId(paneId)) return null;
  if (typeof phase !== "string" || !isPhaseAllowed(phase, options.source)) {
    return null;
  }

  const now = options.now ?? Date.now();
  const event: PromptDeliveryEvent = {
    requestId,
    paneId,
    source: options.source,
    phase: phase as PromptDeliveryPhase,
    at: clampTimestamp(value.at, now),
  };

  const attempt = clampInteger(value.attempt, 1, 99);
  if (attempt !== undefined) event.attempt = attempt;

  const transport = asMember(value.transport, TRANSPORT_SET) as
    | PromptTransport
    | undefined;
  if (transport) event.transport = transport;

  const status = asMember(value.status, STATUS_SET) as
    | PromptDeliveryStatus
    | undefined;
  if (status) event.status = status;

  const httpStatus = clampInteger(value.httpStatus, 100, 599);
  if (httpStatus !== undefined) event.httpStatus = httpStatus;

  const errorCode = asCode(value.errorCode);
  if (errorCode) event.errorCode = errorCode;

  const errorClass = asCode(value.errorClass);
  if (errorClass) event.errorClass = errorClass;

  const latencyMs = clampFloat(value.latencyMs, 0, MAX_LATENCY_MS);
  if (latencyMs !== undefined) event.latencyMs = latencyMs;

  const queueStatus = asMember(value.queueStatus, QUEUE_STATUS_SET) as
    | PromptQueueStatus
    | undefined;
  if (queueStatus) event.queueStatus = queueStatus;

  if (isPromptCorrelationId(value.commandId)) event.commandId = value.commandId;

  return event;
}

function isPhaseAllowed(phase: string, source: PromptDeliverySource): boolean {
  return source === "client" ? CLIENT_PHASE_SET.has(phase) : SERVER_PHASE_SET.has(phase);
}

function clampTimestamp(value: unknown, now: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return now;
  const rounded = Math.round(value);
  if (rounded < now - MAX_CLIENT_EVENT_AGE_MS) return now;
  if (rounded > now + MAX_CLIENT_CLOCK_SKEW_MS) return now;
  return rounded;
}

function clampInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded < minimum || rounded > maximum) return undefined;
  return rounded;
}

function clampFloat(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < minimum || value > maximum) return undefined;
  return Math.round(value);
}

function asMember(value: unknown, allowed: Set<string>): string | undefined {
  return typeof value === "string" && allowed.has(value) ? value : undefined;
}

function asCode(value: unknown): string | undefined {
  return typeof value === "string" && CODE_PATTERN.test(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
