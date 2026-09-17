import { appendFile, mkdir, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { PromptDeliveryEvent } from "../shared/protocol.js";
import { parsePromptDeliveryEvent } from "../shared/prompt-delivery.js";

const DEFAULT_MAX_EVENTS = 2_000;
const DEFAULT_MAX_REQUESTS = 200;
const DEFAULT_MAX_EVENTS_PER_REQUEST = 64;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface PromptDeliveryTraceOptions {
  /** JSONL file receiving every recorded event. */
  filePath?: string;
  /** Bound of the in-memory global ring buffer. */
  maxEvents?: number;
  /** Bound of request ids kept for per-request queries (LRU). */
  maxRequests?: number;
  /** Bound of events kept per request id. */
  maxEventsPerRequest?: number;
  /** Rotate the JSONL file once it would exceed this size. */
  maxFileBytes?: number;
  now?: () => number;
  onWriteError?: (error: unknown) => void;
  onDroppedEvent?: (reason: string) => void;
}

export interface PromptDeliveryTraceQuery {
  requestId?: string;
  limit?: number;
}

/**
 * Bounded, metadata-only prompt delivery trace.
 *
 * The store keeps a fixed-size in-memory ring plus a rotated JSONL file so a
 * long-running server cannot grow without limit. Every event is re-sanitized on
 * the way in, which is also what makes the HTTP ingest route safe: unknown
 * fields such as prompt text are dropped instead of persisted.
 */
export class PromptDeliveryTrace {
  readonly filePath: string;
  private readonly maxEvents: number;
  private readonly maxRequests: number;
  private readonly maxEventsPerRequest: number;
  private readonly maxFileBytes: number;
  private readonly now: () => number;
  private readonly onWriteError?: (error: unknown) => void;
  private readonly onDroppedEvent?: (reason: string) => void;

  private events: PromptDeliveryEvent[] = [];
  private byRequest = new Map<string, PromptDeliveryEvent[]>();
  private listeners = new Set<(event: PromptDeliveryEvent) => void>();
  private sequence = 0;
  private fileBytes = 0;
  private writeChain: Promise<void> = Promise.resolve();
  private writeError: unknown;
  private stopped = false;

  constructor(options: PromptDeliveryTraceOptions = {}) {
    this.filePath = options.filePath ?? defaultTraceFilePath();
    this.maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
    this.maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
    this.maxEventsPerRequest =
      options.maxEventsPerRequest ?? DEFAULT_MAX_EVENTS_PER_REQUEST;
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.now = options.now ?? Date.now;
    this.onWriteError = options.onWriteError;
    this.onDroppedEvent = options.onDroppedEvent;
    this.writeChain = this.prepareFile();
  }

  /**
   * Records one event. Returns the stored event (with `seq` and `at` filled in)
   * or `null` when the input cannot be sanitized. Tracing never throws.
   */
  record(input: PromptDeliveryEvent): PromptDeliveryEvent | null {
    if (this.stopped) return null;

    const sanitized = parsePromptDeliveryEvent(input, {
      source: input?.source === "client" ? "client" : "server",
      now: this.now(),
    });
    if (!sanitized) {
      this.onDroppedEvent?.("unsanitizable-event");
      return null;
    }

    const event: PromptDeliveryEvent = {
      ...sanitized,
      seq: (this.sequence += 1),
    };

    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }

    const existing = this.byRequest.get(event.requestId);
    const requestEvents = existing ? [...existing] : [];
    requestEvents.push(event);
    if (requestEvents.length > this.maxEventsPerRequest) {
      requestEvents.splice(0, requestEvents.length - this.maxEventsPerRequest);
    }
    // Re-insert so the map order stays a least-recently-used list.
    this.byRequest.delete(event.requestId);
    this.byRequest.set(event.requestId, requestEvents);
    while (this.byRequest.size > this.maxRequests) {
      const oldest = this.byRequest.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.byRequest.delete(oldest);
    }

    this.appendLine(event);

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Observers must never break prompt delivery.
      }
    }

    return event;
  }

  query(options: PromptDeliveryTraceQuery = {}): PromptDeliveryEvent[] {
    if (options.requestId) {
      return [...(this.byRequest.get(options.requestId) ?? [])];
    }
    const limit = clampLimit(options.limit);
    return this.events.slice(Math.max(0, this.events.length - limit));
  }

  subscribe(listener: (event: PromptDeliveryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resolves once every event recorded so far has been written or failed. */
  flush(): Promise<void> {
    return this.writeChain;
  }

  get lastWriteError(): unknown {
    return this.writeError;
  }

  stop(): void {
    this.stopped = true;
    this.listeners.clear();
  }

  private appendLine(event: PromptDeliveryEvent): void {
    const line = `${JSON.stringify(event)}\n`;
    this.writeChain = this.writeChain
      .then(() => this.writeLine(line))
      .catch((error: unknown) => {
        this.writeError = error;
        this.onWriteError?.(error);
      });
  }

  private async prepareFile(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    try {
      this.fileBytes = (await stat(this.filePath)).size;
    } catch {
      this.fileBytes = 0;
    }
    if (this.fileBytes > this.maxFileBytes) {
      // A failed rotation is already reported through onWriteError; startup must
      // still succeed so prompt delivery is never blocked by tracing.
      await this.rotate().catch(() => undefined);
    }
  }

  private async writeLine(line: string): Promise<void> {
    const byteLength = Buffer.byteLength(line, "utf8");
    if (this.fileBytes + byteLength > this.maxFileBytes) await this.rotate();
    await appendFile(this.filePath, line, { mode: 0o600 });
    this.fileBytes += byteLength;
  }

  private async rotate(): Promise<void> {
    try {
      await rename(this.filePath, `${this.filePath}.1`);
      this.fileBytes = 0;
    } catch (error) {
      // Renaming can fail (for example when `<file>.1` exists and cannot be
      // replaced). Truncating keeps the size accounting honest; resetting the
      // counter without shrinking the file would silently disable the cap.
      this.onWriteError?.(error);
      await writeFile(this.filePath, "", { mode: 0o600 });
      this.fileBytes = 0;
    }
  }
}

export function defaultTraceFilePath(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  const directory =
    process.env.HERZI_TRACE_DIR ?? path.join(os.tmpdir(), `herzi-${uid}`);
  return path.join(directory, "prompt-delivery.jsonl");
}

function clampLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 50;
  return Math.min(DEFAULT_MAX_EVENTS, Math.max(1, Math.round(value)));
}
