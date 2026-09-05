import { readFile, stat } from "node:fs/promises";

import type {
  ChatJsonObject,
  ChatMessage,
  ChatPart,
  ChatSnapshot,
} from "../shared/protocol.js";

interface PiEntry {
  id: string;
  parentId?: string | null;
  timestamp?: string;
  type: string;
  message?: PiMessage;
}

interface PiMessage {
  role: "user" | "assistant" | "toolResult" | string;
  content?: PiContent[] | string;
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  stopReason?: string;
}

type PiContent =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "image"; data: string; mimeType: string }
  | {
      type: "toolCall";
      id: string;
      name: string;
      arguments?: ChatJsonObject;
    }
  | Record<string, unknown>;

interface CacheEntry {
  mtimeMs: number;
  size: number;
  entries: PiEntry[];
}

export class PiSessionReader {
  private cache = new Map<string, CacheEntry>();

  async read(
    paneId: string,
    sessionPath: string,
    running: boolean,
    branchLeafId?: string | null,
  ): Promise<ChatSnapshot> {
    const fileStat = await stat(sessionPath);
    let cached = this.cache.get(sessionPath);

    if (!cached || cached.mtimeMs !== fileStat.mtimeMs || cached.size !== fileStat.size) {
      const source = await readFile(sessionPath, "utf8");
      const entries = parseJsonLines(source);
      cached = {
        mtimeMs: fileStat.mtimeMs,
        size: fileStat.size,
        entries,
      };
      this.cache.set(sessionPath, cached);
    }

    return {
      paneId,
      running,
      updatedAt: cached.mtimeMs,
      messages: convertActiveBranch(cached.entries, branchLeafId),
    };
  }
}

function parseJsonLines(source: string): PiEntry[] {
  const entries: PiEntry[] = [];
  for (const line of source.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as PiEntry;
      if (entry && typeof entry.id === "string" && typeof entry.type === "string") {
        entries.push(entry);
      }
    } catch {
      // A final partial line is normal while Pi is appending to the session.
    }
  }
  return entries;
}

function convertActiveBranch(
  entries: PiEntry[],
  branchLeafId?: string | null,
): ChatMessage[] {
  if (!entries.length) return [];

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const branch: PiEntry[] = [];
  const visited = new Set<string>();
  let cursor: PiEntry | undefined =
    branchLeafId === undefined
      ? entries.at(-1)
      : branchLeafId === null
        ? undefined
        : byId.get(branchLeafId);

  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    branch.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  branch.reverse();

  const toolResults = new Map<
    string,
    { result: unknown; isError: boolean; toolName?: string }
  >();
  for (const entry of branch) {
    const message = entry.message;
    if (entry.type !== "message" || message?.role !== "toolResult") continue;
    if (!message.toolCallId) continue;
    toolResults.set(message.toolCallId, {
      result: toolResultValue(message.content),
      isError: Boolean(message.isError),
      toolName: message.toolName,
    });
  }

  return branch.flatMap((entry): ChatMessage[] => {
    const message = entry.message;
    if (entry.type !== "message" || !message) return [];
    if (message.role !== "user" && message.role !== "assistant") return [];

    const content = convertContent(message.content, toolResults);
    if (!content.length) return [];

    const entryTimestamp = Date.parse(entry.timestamp ?? "");

    return [
      {
        id: entry.id,
        role: message.role,
        createdAt:
          typeof message.timestamp === "number"
            ? message.timestamp
            : entryTimestamp || 0,
        ...(message.role === "assistant" && Number.isFinite(entryTimestamp)
          ? { completedAt: entryTimestamp }
          : {}),
        content,
        ...(message.role === "assistant"
          ? { status: statusFromStopReason(message.stopReason) }
          : {}),
      },
    ];
  });
}

function convertContent(
  value: PiMessage["content"],
  toolResults: Map<string, { result: unknown; isError: boolean }>,
): ChatPart[] {
  if (typeof value === "string") return value ? [{ type: "text", text: value }] : [];
  if (!Array.isArray(value)) return [];

  return value.flatMap((part): ChatPart[] => {
    if (part.type === "text" && "text" in part && typeof part.text === "string") {
      return part.text ? [{ type: "text", text: part.text }] : [];
    }
    if (
      part.type === "thinking" &&
      "thinking" in part &&
      typeof part.thinking === "string"
    ) {
      return part.thinking ? [{ type: "reasoning", text: part.thinking }] : [];
    }
    if (
      part.type === "image" &&
      "data" in part &&
      "mimeType" in part &&
      typeof part.data === "string" &&
      typeof part.mimeType === "string"
    ) {
      return [{ type: "image", image: `data:${part.mimeType};base64,${part.data}` }];
    }
    if (
      part.type === "toolCall" &&
      "id" in part &&
      "name" in part &&
      typeof part.id === "string" &&
      typeof part.name === "string"
    ) {
      const result = toolResults.get(part.id);
      return [
        {
          type: "tool-call",
          toolCallId: part.id,
          toolName: part.name,
          args:
            "arguments" in part && isRecord(part.arguments)
              ? part.arguments
              : {},
          ...(result ? { result: result.result, isError: result.isError } : {}),
        },
      ];
    }
    return [];
  });
}

function toolResultValue(value: PiMessage["content"]): unknown {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;
  const values = value.flatMap((part) => {
    if (part.type === "text" && "text" in part && typeof part.text === "string") {
      return [part.text];
    }
    if (part.type === "image" && "mimeType" in part) {
      return [`[image: ${String(part.mimeType)}]`];
    }
    return [];
  });
  return values.length <= 1 ? (values[0] ?? "") : values;
}

function statusFromStopReason(stopReason?: string): ChatMessage["status"] {
  switch (stopReason) {
    case "error":
      return { type: "incomplete", reason: "error" };
    case "aborted":
    case "cancelled":
      return { type: "incomplete", reason: "cancelled" };
    case "length":
      return { type: "incomplete", reason: "length" };
    default:
      return { type: "complete", reason: "stop" };
  }
}

function isRecord(value: unknown): value is ChatJsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
