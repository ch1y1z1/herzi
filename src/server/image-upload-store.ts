import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";

import type { ImageUploadResponse, PiBridgeCommandImage } from "../shared/protocol.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_SNIFF_BYTES = 64 * 1024;
const MAX_IMAGE_SIDE = 16_384;
const MAX_IMAGE_PIXELS = 40_000_000;
const UPLOAD_TTL_MS = 60 * 60 * 1_000;
const NATIVE_TTL_MS = 24 * 60 * 60 * 1_000;
const FALLBACK_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ImageUploadState = "uploaded" | "native" | "fallback";

interface StoredImageUpload {
  uploadId: string;
  paneId: string;
  sessionPath: string | null;
  name: string;
  mimeType: string;
  extension: string;
  size: number;
  sha256: string;
  createdAt: number;
  expiresAt: number;
  state: ImageUploadState;
}

export interface CreateImageUploadInput {
  paneId: string;
  sessionPath: string | null;
  name: string;
  stream: Readable;
}

export class ImageUploadStore {
  readonly root: string;
  private records = new Map<string, StoredImageUpload>();
  private dataUrls = new Map<string, string>();

  constructor(root = defaultUploadRoot()) {
    this.root = root;
  }

  async create(input: CreateImageUploadInput): Promise<ImageUploadResponse> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });

    const uploadId = randomUUID();
    const temporaryPath = path.join(this.root, `${uploadId}.uploading`);
    const file = await open(temporaryPath, "wx", 0o600);
    const hash = createHash("sha256");
    const sniffChunks: Buffer[] = [];
    let sniffedBytes = 0;
    let size = 0;

    try {
      for await (const value of input.stream) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
        size += chunk.length;
        if (size > MAX_IMAGE_BYTES) {
          throw new ImageUploadError("Image exceeds the 10 MiB limit", "too-large");
        }
        if (sniffedBytes < MAX_SNIFF_BYTES) {
          const remaining = MAX_SNIFF_BYTES - sniffedBytes;
          const sample = chunk.subarray(0, remaining);
          sniffChunks.push(sample);
          sniffedBytes += sample.length;
        }
        hash.update(chunk);
        await file.write(chunk);
      }
    } catch (error) {
      await file.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }

    await file.close();
    if (size === 0) {
      await unlink(temporaryPath).catch(() => undefined);
      throw new ImageUploadError("Image is empty", "invalid-image");
    }

    const sample = Buffer.concat(sniffChunks);
    const detected = detectImageType(sample);
    if (!detected) {
      await unlink(temporaryPath).catch(() => undefined);
      throw new ImageUploadError(
        "Only PNG, JPEG, GIF, and WebP images are supported",
        "unsupported-type",
      );
    }
    const dimensions = detectImageDimensions(sample, detected.mimeType);
    if (
      !dimensions ||
      dimensions.width < 1 ||
      dimensions.height < 1 ||
      dimensions.width > MAX_IMAGE_SIDE ||
      dimensions.height > MAX_IMAGE_SIDE ||
      dimensions.width * dimensions.height > MAX_IMAGE_PIXELS
    ) {
      await unlink(temporaryPath).catch(() => undefined);
      throw new ImageUploadError(
        "Image dimensions are invalid or exceed the 40 megapixel limit",
        "invalid-image",
      );
    }

    const finalPath = this.imagePath(uploadId, detected.extension);
    await rename(temporaryPath, finalPath);

    const createdAt = Date.now();
    const record: StoredImageUpload = {
      uploadId,
      paneId: input.paneId,
      sessionPath: input.sessionPath,
      name: normalizeDisplayName(input.name, detected.extension),
      mimeType: detected.mimeType,
      extension: detected.extension,
      size,
      sha256: hash.digest("hex"),
      createdAt,
      expiresAt: createdAt + UPLOAD_TTL_MS,
      state: "uploaded",
    };
    this.records.set(uploadId, record);
    await this.persist(record);
    return publicUpload(record);
  }

  async getBound(
    uploadId: string,
    paneId: string,
    sessionPath: string | null,
  ): Promise<StoredImageUpload> {
    const record = await this.load(uploadId);
    if (!record || record.paneId !== paneId) {
      throw new ImageUploadError("Image upload not found", "not-found");
    }
    if (record.sessionPath && sessionPath && record.sessionPath !== sessionPath) {
      throw new ImageUploadError("Image belongs to another Pi session", "wrong-session");
    }
    if (record.expiresAt <= Date.now()) {
      await this.delete(uploadId);
      throw new ImageUploadError("Image upload has expired", "expired");
    }
    return record;
  }

  async commandImage(
    uploadId: string,
    paneId: string,
    sessionPath: string,
  ): Promise<PiBridgeCommandImage> {
    const record = await this.getBound(uploadId, paneId, sessionPath);
    return {
      uploadId: record.uploadId,
      name: record.name,
      mimeType: record.mimeType,
      size: record.size,
      sha256: record.sha256,
    };
  }

  async readBase64(
    uploadId: string,
    paneId: string,
    sessionPath: string,
  ): Promise<{ data: string; mimeType: string; sha256: string }> {
    const record = await this.getBound(uploadId, paneId, sessionPath);
    const bytes = await readFile(this.imagePath(record.uploadId, record.extension));
    if (bytes.length !== record.size || createHash("sha256").update(bytes).digest("hex") !== record.sha256) {
      throw new ImageUploadError("Image upload failed integrity verification", "integrity");
    }
    return { data: bytes.toString("base64"), mimeType: record.mimeType, sha256: record.sha256 };
  }

  async managedPath(
    uploadId: string,
    paneId: string,
    sessionPath: string | null,
  ): Promise<string> {
    const record = await this.getBound(uploadId, paneId, sessionPath);
    return this.imagePath(record.uploadId, record.extension);
  }

  async markSubmitted(uploadId: string, state: "native" | "fallback"): Promise<void> {
    const record = await this.load(uploadId);
    if (!record) return;
    record.state = state;
    record.expiresAt =
      Date.now() + (state === "native" ? NATIVE_TTL_MS : FALLBACK_TTL_MS);
    await this.persist(record);
  }

  async dataUrlFor(
    uploadId: string,
    paneId: string,
    sessionPath: string,
  ): Promise<{ image: string; name: string; mimeType: string; sha256: string } | null> {
    try {
      const record = await this.getBound(uploadId, paneId, sessionPath);
      let image = this.dataUrls.get(uploadId);
      if (!image) {
        const bytes = await readFile(this.imagePath(record.uploadId, record.extension));
        image = `data:${record.mimeType};base64,${bytes.toString("base64")}`;
        this.dataUrls.set(uploadId, image);
        while (this.dataUrls.size > 32) {
          const oldest = this.dataUrls.keys().next().value as string | undefined;
          if (!oldest) break;
          this.dataUrls.delete(oldest);
        }
      }
      return {
        image,
        name: record.name,
        mimeType: record.mimeType,
        sha256: record.sha256,
      };
    } catch {
      return null;
    }
  }

  async delete(uploadId: string): Promise<void> {
    const record = await this.load(uploadId);
    this.records.delete(uploadId);
    this.dataUrls.delete(uploadId);
    await unlink(this.metadataPath(uploadId)).catch(() => undefined);
    if (record) {
      await unlink(this.imagePath(record.uploadId, record.extension)).catch(() => undefined);
    }
  }

  async cleanup(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const entries = await readdir(this.root);
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const uploadId = entry.slice(0, -5);
      const record = await this.load(uploadId);
      if (record && record.expiresAt <= Date.now()) await this.delete(uploadId);
    }
  }

  private async load(uploadId: string): Promise<StoredImageUpload | null> {
    if (!UUID_PATTERN.test(uploadId)) return null;
    const cached = this.records.get(uploadId);
    if (cached) return cached;
    try {
      const value = JSON.parse(await readFile(this.metadataPath(uploadId), "utf8")) as unknown;
      if (!isStoredImageUpload(value) || value.uploadId !== uploadId) return null;
      await stat(this.imagePath(value.uploadId, value.extension));
      this.records.set(uploadId, value);
      return value;
    } catch {
      return null;
    }
  }

  private async persist(record: StoredImageUpload): Promise<void> {
    const temporaryPath = `${this.metadataPath(record.uploadId)}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(record), { mode: 0o600 });
    await rename(temporaryPath, this.metadataPath(record.uploadId));
  }

  private imagePath(uploadId: string, extension: string): string {
    return path.join(this.root, `${uploadId}.${extension}`);
  }

  private metadataPath(uploadId: string): string {
    return path.join(this.root, `${uploadId}.json`);
  }
}

export class ImageUploadError extends Error {
  constructor(
    message: string,
    readonly code:
      | "too-large"
      | "invalid-image"
      | "unsupported-type"
      | "not-found"
      | "wrong-session"
      | "expired"
      | "integrity",
  ) {
    super(message);
  }
}

function defaultUploadRoot(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  return process.env.HERZI_UPLOAD_DIR ?? path.join(os.tmpdir(), `herzi-${uid}`, "uploads");
}

function detectImageType(bytes: Buffer): { mimeType: string; extension: string } | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  const ascii = bytes.toString("ascii");
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) {
    return { mimeType: "image/gif", extension: "gif" };
  }
  if (bytes.length >= 12 && ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") {
    return { mimeType: "image/webp", extension: "webp" };
  }
  return null;
}

function detectImageDimensions(
  bytes: Buffer,
  mimeType: string,
): { width: number; height: number } | null {
  if (mimeType === "image/png") {
    if (bytes.length < 24 || bytes.toString("ascii", 12, 16) !== "IHDR") return null;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mimeType === "image/gif") {
    if (bytes.length < 10) return null;
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (mimeType === "image/jpeg") return jpegDimensions(bytes);
  if (mimeType === "image/webp") {
    if (bytes.length < 30) return null;
    const chunkType = bytes.toString("ascii", 12, 16);
    if (chunkType === "VP8X") {
      return {
        width: 1 + bytes.readUIntLE(24, 3),
        height: 1 + bytes.readUIntLE(27, 3),
      };
    }
    if (chunkType === "VP8 " && bytes.length >= 30) {
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
      return {
        width: bytes.readUInt16LE(26) & 0x3fff,
        height: bytes.readUInt16LE(28) & 0x3fff,
      };
    }
    if (chunkType === "VP8L" && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21);
      return {
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >>> 14) & 0x3fff),
      };
    }
  }
  return null;
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (startOfFrame.has(marker) && length >= 7) {
      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  return null;
}

function normalizeDisplayName(name: string, extension: string): string {
  const normalized = path.basename(name).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (normalized || `image.${extension}`).slice(0, 160);
}

function publicUpload(record: StoredImageUpload): ImageUploadResponse {
  return {
    uploadId: record.uploadId,
    name: record.name,
    mimeType: record.mimeType,
    size: record.size,
    sha256: record.sha256,
    expiresAt: record.expiresAt,
  };
}

function isStoredImageUpload(value: unknown): value is StoredImageUpload {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StoredImageUpload>;
  return (
    typeof record.uploadId === "string" &&
    typeof record.paneId === "string" &&
    (record.sessionPath === null || typeof record.sessionPath === "string") &&
    typeof record.name === "string" &&
    typeof record.mimeType === "string" &&
    typeof record.extension === "string" &&
    typeof record.size === "number" &&
    typeof record.sha256 === "string" &&
    typeof record.createdAt === "number" &&
    typeof record.expiresAt === "number" &&
    (record.state === "uploaded" || record.state === "native" || record.state === "fallback")
  );
}
