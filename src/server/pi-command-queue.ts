import { randomUUID } from "node:crypto";

import type {
  PiBridgeCommand,
  PiBridgeCommandImage,
  PromptDeliveryEvent,
  PromptDeliveryStatus,
} from "../shared/protocol.js";

const PRESENCE_TTL_MS = 35_000;
const COMMAND_TTL_MS = 60_000;
const POLL_TIMEOUT_MS = 20_000;

interface BridgeIdentity {
  paneId: string;
  sessionPath: string;
  runtimeId: string;
}

interface BridgePresence extends BridgeIdentity {
  lastSeen: number;
}

interface QueuedCommand {
  command: PiBridgeCommand;
  paneId: string;
  sessionPath: string;
  createdAt: number;
  claimedBy?: string;
  status: "queued" | "claimed" | "dispatched" | "failed";
  error?: string;
}

interface PollWaiter {
  identity: BridgeIdentity;
  resolve: (command: PiBridgeCommand | null) => void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export type PiCommandLifecyclePhase =
  | "queue.enqueued"
  | "queue.claimed"
  | "queue.dispatched"
  | "queue.failed"
  | "queue.expired";

/**
 * Metadata-only lifecycle signal for one queued Pi bridge command. The raw
 * bridge error text is intentionally not part of this shape: prompt bodies and
 * model errors must never reach the delivery trace, only a stable error code.
 */
export type PiCommandQueueStatus =
  | "queued"
  | "claimed"
  | "dispatched"
  | "failed"
  | "expired";

/**
 * Metadata-only lifecycle signal for one queued Pi bridge command. The raw
 * bridge error text is intentionally not part of this shape: prompt bodies and
 * model errors must never reach the delivery trace, only a stable error code.
 */
export interface PiCommandLifecycleEvent {
  phase: PiCommandLifecyclePhase;
  requestId: string;
  paneId: string;
  commandId: string;
  /** Milliseconds elapsed since the command was enqueued. */
  latencyMs: number;
  queueStatus: PiCommandQueueStatus;
  /**
   * Stable code; never the raw error message. Expiry distinguishes
   * `queue-expired-unclaimed` (never polled, so the prompt was never sent) from
   * `queue-expired-unacked` (claimed but the acknowledgement never arrived, so
   * the Pi session may well contain the prompt).
   */
  errorCode?: string;
}

export class PiCommandQueue {
  private presence = new Map<string, BridgePresence>();
  private commands = new Map<string, QueuedCommand>();
  private requestCommands = new Map<string, string>();
  private waiters = new Map<string, Set<PollWaiter>>();

  constructor(
    private readonly onLifecycle?: (event: PiCommandLifecycleEvent) => void,
  ) {}

  touch(identity: BridgeIdentity): void {
    this.presence.set(identity.paneId, { ...identity, lastSeen: Date.now() });
  }

  isAvailable(paneId: string, sessionPath: string): boolean {
    const presence = this.presence.get(paneId);
    return Boolean(
      presence &&
        presence.sessionPath === sessionPath &&
        Date.now() - presence.lastSeen <= PRESENCE_TTL_MS,
    );
  }

  enqueue(input: {
    paneId: string;
    sessionPath: string;
    requestId: string;
    text: string;
    images: PiBridgeCommandImage[];
  }): PiBridgeCommand {
    const existingId = this.requestCommands.get(input.requestId);
    const existing = existingId ? this.commands.get(existingId) : undefined;
    if (existing) return existing.command;

    const command: PiBridgeCommand = {
      id: randomUUID(),
      requestId: input.requestId,
      type: "user-message",
      text: input.text,
      images: input.images,
      delivery: "immediate-or-steer",
    };
    this.commands.set(command.id, {
      command,
      paneId: input.paneId,
      sessionPath: input.sessionPath,
      createdAt: Date.now(),
      status: "queued",
    });
    this.requestCommands.set(input.requestId, command.id);
    this.emitLifecycle(command.id, "queue.enqueued", "queued");
    this.deliverWaiting(input.paneId);
    return command;
  }

  async poll(
    identity: BridgeIdentity,
    signal?: AbortSignal,
  ): Promise<PiBridgeCommand | null> {
    this.touch(identity);
    if (signal?.aborted) return null;
    const immediate = this.claimNext(identity);
    if (immediate) return immediate;

    return new Promise<PiBridgeCommand | null>((resolve) => {
      const waiter: PollWaiter = {
        identity,
        resolve,
        signal,
        timer: setTimeout(() => this.finishWaiter(waiter, null), POLL_TIMEOUT_MS),
      };
      waiter.onAbort = () => this.finishWaiter(waiter, null);
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      waiter.timer.unref?.();
      const paneWaiters = this.waiters.get(identity.paneId) ?? new Set<PollWaiter>();
      paneWaiters.add(waiter);
      this.waiters.set(identity.paneId, paneWaiters);
    });
  }

  ack(
    identity: BridgeIdentity,
    commandId: string,
    status: "dispatched" | "failed",
    error?: string,
  ): boolean {
    this.touch(identity);
    const queued = this.commands.get(commandId);
    if (
      !queued ||
      queued.paneId !== identity.paneId ||
      queued.sessionPath !== identity.sessionPath ||
      queued.claimedBy !== identity.runtimeId
    ) {
      return false;
    }
    queued.status = status;
    queued.error = error?.slice(0, 500);
    this.emitLifecycle(
      commandId,
      status === "dispatched" ? "queue.dispatched" : "queue.failed",
      status,
      status === "failed" ? "bridge-failed" : undefined,
    );
    return true;
  }

  ownsClaim(identity: BridgeIdentity, commandId: string): boolean {
    const queued = this.commands.get(commandId);
    return Boolean(
      queued &&
        queued.paneId === identity.paneId &&
        queued.sessionPath === identity.sessionPath &&
        queued.claimedBy === identity.runtimeId,
    );
  }

  cleanup(): void {
    const now = Date.now();
    for (const [paneId, presence] of this.presence) {
      if (now - presence.lastSeen > PRESENCE_TTL_MS * 2) this.presence.delete(paneId);
    }
    for (const [commandId, queued] of this.commands) {
      if (now - queued.createdAt <= COMMAND_TTL_MS) continue;
      if (queued.status === "queued") {
        // The bridge never polled it, so nothing was sent to Pi.
        this.emitLifecycle(
          commandId,
          "queue.expired",
          "expired",
          "queue-expired-unclaimed",
        );
      } else if (queued.status === "claimed") {
        // The bridge claimed it but never acknowledged: the prompt may already
        // be in the session, only the receipt is missing.
        this.emitLifecycle(
          commandId,
          "queue.expired",
          "expired",
          "queue-expired-unacked",
        );
      }
      this.commands.delete(commandId);
      if (this.requestCommands.get(queued.command.requestId) === commandId) {
        this.requestCommands.delete(queued.command.requestId);
      }
    }
  }

  stop(): void {
    for (const waiters of this.waiters.values()) {
      for (const waiter of waiters) this.finishWaiter(waiter, null);
    }
    this.waiters.clear();
  }

  private claimNext(identity: BridgeIdentity): PiBridgeCommand | null {
    const now = Date.now();
    for (const queued of this.commands.values()) {
      if (now - queued.createdAt > COMMAND_TTL_MS) continue;
      if (
        queued.status === "queued" &&
        queued.paneId === identity.paneId &&
        queued.sessionPath === identity.sessionPath
      ) {
        queued.status = "claimed";
        queued.claimedBy = identity.runtimeId;
        this.emitLifecycle(queued.command.id, "queue.claimed", "claimed");
        return queued.command;
      }
    }
    return null;
  }

  private emitLifecycle(
    commandId: string,
    phase: PiCommandLifecyclePhase,
    queueStatus: PiCommandQueueStatus,
    errorCode?: string,
  ): void {
    const queued = this.commands.get(commandId);
    if (!queued) return;
    try {
      this.onLifecycle?.({
        phase,
        requestId: queued.command.requestId,
        paneId: queued.paneId,
        commandId,
        latencyMs: Math.max(0, Date.now() - queued.createdAt),
        queueStatus,
        ...(errorCode ? { errorCode } : {}),
      });
    } catch {
      // Delivery tracing must never break the queue itself.
    }
  }

  private deliverWaiting(paneId: string): void {
    const paneWaiters = this.waiters.get(paneId);
    if (!paneWaiters) return;
    for (const waiter of paneWaiters) {
      const command = this.claimNext(waiter.identity);
      if (!command) continue;
      this.finishWaiter(waiter, command);
      return;
    }
  }

  private finishWaiter(waiter: PollWaiter, command: PiBridgeCommand | null): void {
    clearTimeout(waiter.timer);
    if (waiter.onAbort) waiter.signal?.removeEventListener("abort", waiter.onAbort);
    const paneWaiters = this.waiters.get(waiter.identity.paneId);
    paneWaiters?.delete(waiter);
    if (paneWaiters?.size === 0) this.waiters.delete(waiter.identity.paneId);
    waiter.resolve(command);
  }
}

/**
 * Maps a queue lifecycle signal onto a metadata-only trace event. Expired
 * commands must never keep reporting their pre-expiry `claimed`/`queued` status:
 * the status has to read as "delivery unconfirmed" so trace consumers and the UI
 * agree. The two expiry causes stay distinguishable through `errorCode`.
 */
export function queueLifecycleEvent(
  event: PiCommandLifecycleEvent,
  at: number = Date.now(),
): PromptDeliveryEvent {
  return {
    requestId: event.requestId,
    paneId: event.paneId,
    source: "server",
    phase: event.phase,
    at,
    latencyMs: event.latencyMs,
    queueStatus: event.queueStatus,
    status: queueStatusToDeliveryStatus(event.queueStatus),
    commandId: event.commandId,
    ...(event.errorCode ? { errorCode: event.errorCode } : {}),
  };
}

export function queueStatusToDeliveryStatus(
  status: PiCommandQueueStatus,
): PromptDeliveryStatus {
  switch (status) {
    case "dispatched":
      return "dispatched";
    case "claimed":
      return "claimed";
    case "failed":
      return "failed";
    case "expired":
      return "delivery-unconfirmed";
    default:
      return "queued";
  }
}

export function parseBridgeIdentity(value: unknown): BridgeIdentity | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.paneId !== "string" ||
    typeof record.sessionPath !== "string" ||
    typeof record.runtimeId !== "string" ||
    !record.paneId ||
    !record.sessionPath ||
    !record.runtimeId
  ) {
    return null;
  }
  return {
    paneId: record.paneId,
    sessionPath: record.sessionPath,
    runtimeId: record.runtimeId,
  };
}
