/**
 * Projection of the `todo` extension's tool-result snapshot.
 *
 * Every successful `todo` call returns the complete task state in
 * `details = { action, nextId, params, tasks }`, and the extension itself
 * replays its state as "the last snapshot wins". Herzi does the same: the
 * reader keeps the last matching tool result and this module narrows it to the
 * fields that were verified against real session data.
 *
 * Nothing here invents data: unknown statuses are kept as-is (the UI groups
 * them with the pending work), unverified fields are dropped, and a snapshot
 * over the size budget is degraded to `{ nextId, updatedAt, tasks: [], truncated }`
 * instead of being truncated to a partial list.
 */

import type { ChatTodosSnapshot, TodoTask } from "./protocol.js";

/** Serialized-size budget for one snapshot (measured max in practice: ~10 KiB). */
export const TODO_SNAPSHOT_MAX_BYTES = 128 * 1024;

export interface TodoDetails {
  tasks: unknown[];
  nextId: number;
}

/**
 * Shape check for a `todo` tool result's `details`. The two fields the
 * extension documents as its persistence format are required; everything else
 * is optional and ignored.
 */
export function isTodoDetails(value: unknown): value is TodoDetails {
  return (
    isRecord(value) && Array.isArray(value.tasks) && typeof value.nextId === "number"
  );
}

/** Keeps only the verified fields of every task; drops malformed entries. */
export function projectTodoTasks(tasks: unknown[]): TodoTask[] {
  return tasks.flatMap((task): TodoTask[] => {
    if (!isRecord(task)) return [];
    if (typeof task.id !== "number" || typeof task.subject !== "string") return [];
    if (typeof task.status !== "string") return [];

    const blockedBy = numberArray(task.blockedBy);
    return [
      {
        id: task.id,
        subject: task.subject,
        status: task.status,
        ...(typeof task.activeForm === "string" && task.activeForm
          ? { activeForm: task.activeForm }
          : {}),
        ...(typeof task.description === "string" && task.description
          ? { description: task.description }
          : {}),
        ...(blockedBy ? { blockedBy } : {}),
      },
    ];
  });
}

/**
 * Builds the snapshot Herzi serves. The size check runs on the projected data
 * (what is actually sent to the client), so a snapshot with many unverified
 * fields cannot be degraded for bytes that would never be transmitted.
 */
export function buildTodoSnapshot(
  details: TodoDetails,
  updatedAt: number,
  maxBytes: number = TODO_SNAPSHOT_MAX_BYTES,
): ChatTodosSnapshot {
  const tasks = projectTodoTasks(details.tasks);
  const snapshot: ChatTodosSnapshot = { tasks, nextId: details.nextId, updatedAt };
  if (serializedBytes(snapshot) <= maxBytes) return snapshot;
  return { tasks: [], nextId: details.nextId, updatedAt, truncated: true };
}

function serializedBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return 0;
  // TextEncoder instead of Buffer: this module is shared, and only the Node
  // server is expected to call it.
  return new TextEncoder().encode(serialized).length;
}

function numberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const numbers = value.filter(
    (entry): entry is number => typeof entry === "number",
  );
  return numbers.length ? numbers : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
