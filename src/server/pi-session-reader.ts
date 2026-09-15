import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import type {
  ChatJsonObject,
  ChatMessage,
  ChatPart,
  ChatSnapshot,
  ChatToolResultPayload,
} from "../shared/protocol.js";
import { extractManagedAttachments } from "./managed-attachments.js";

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

const imageHashes = new WeakMap<object, string>();

interface CacheEntry {
  mtimeMs: number;
  size: number;
  entries: PiEntry[];
}

type ManagedAttachmentResolver = (
  uploadId: string,
  paneId: string,
  sessionPath: string,
) => Promise<
  | { image: string; name: string; mimeType: string; sha256: string }
  | null
>;

export class PiSessionReader {
  private cache = new Map<string, CacheEntry>();

  constructor(private readonly resolveManagedAttachment?: ManagedAttachmentResolver) {}

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

    const messages = convertActiveBranch(cached.entries, branchLeafId);
    return {
      paneId,
      running,
      updatedAt: cached.mtimeMs,
      messages: this.resolveManagedAttachment
        ? await hydrateManagedAttachments(
            messages,
            paneId,
            sessionPath,
            this.resolveManagedAttachment,
          )
        : messages,
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
      return [
        {
          type: "image",
          image: `data:${part.mimeType};base64,${part.data}`,
          mimeType: part.mimeType,
          sha256: imageSha256(part, part.data),
        },
      ];
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

async function hydrateManagedAttachments(
  messages: ChatMessage[],
  paneId: string,
  sessionPath: string,
  resolveAttachment: ManagedAttachmentResolver,
): Promise<ChatMessage[]> {
  return Promise.all(
    messages.map(async (message) => {
      if (message.role !== "user") return message;

      const content: ChatPart[] = [];
      for (const part of message.content) {
        if (part.type !== "text") {
          content.push(part);
          continue;
        }

        const extracted = extractManagedAttachments(part.text);
        if (extracted.text) content.push({ type: "text", text: extracted.text });
        for (const uploadId of extracted.uploadIds) {
          const resolved = await resolveAttachment(uploadId, paneId, sessionPath);
          if (resolved) {
            content.push({
              type: "image",
              image: resolved.image,
              name: resolved.name,
              mimeType: resolved.mimeType,
              uploadId,
              sha256: resolved.sha256,
            });
          } else {
            content.push({
              type: "text",
              text: `[Image attachment unavailable: ${uploadId}]`,
            });
          }
        }
      }
      return { ...message, content };
    }),
  );
}

function imageSha256(part: object, data: string): string {
  const cached = imageHashes.get(part);
  if (cached) return cached;
  const hash = createHash("sha256").update(data, "base64").digest("hex");
  imageHashes.set(part, hash);
  return hash;
}

function toolResultValue(value: PiMessage["content"]): unknown {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;

  const textValues: string[] = [];
  const images: ChatToolResultPayload["images"] = [];
  for (const part of value) {
    if (part.type === "text" && "text" in part && typeof part.text === "string") {
      textValues.push(part.text);
      continue;
    }
    if (
      part.type === "image" &&
      "data" in part &&
      "mimeType" in part &&
      typeof part.data === "string" &&
      typeof part.mimeType === "string"
    ) {
      images.push({
        image: `data:${part.mimeType};base64,${part.data}`,
        mimeType: part.mimeType,
        sha256: imageSha256(part, part.data),
      });
    }
  }

  const textResult =
    textValues.length <= 1 ? (textValues[0] ?? "") : textValues;
  if (images.length === 0) return textResult;
  return {
    type: "herzi-tool-result",
    value: textResult,
    images,
  } satisfies ChatToolResultPayload;
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
