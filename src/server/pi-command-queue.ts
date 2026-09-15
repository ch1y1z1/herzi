import { randomUUID } from "node:crypto";

import type { PiBridgeCommand, PiBridgeCommandImage } from "../shared/protocol.js";

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

export class PiCommandQueue {
  private presence = new Map<string, BridgePresence>();
  private commands = new Map<string, QueuedCommand>();
  private requestCommands = new Map<string, string>();
  private waiters = new Map<string, Set<PollWaiter>>();

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
        return queued.command;
      }
    }
    return null;
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
