import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { ImageUploadError, ImageUploadStore } from "./image-upload-store.js";

const testRoots: string[] = [];

async function createStore() {
  const root = await mkdtemp(path.join(process.cwd(), ".tmp-herzi-upload-test-"));
  testRoots.push(root);
  return new ImageUploadStore(root);
}

afterEach(async () => {
  await Promise.all(testRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ImageUploadStore", () => {
  it("stores a sniffed PNG with private permissions and verifies integrity", async () => {
    const store = await createStore();
    const bytes = pngBytes();
    const upload = await store.create({
      paneId: "pane-1",
      sessionPath: "/session/a.jsonl",
      name: "../../screenshot.png",
      stream: Readable.from(bytes),
    });

    expect(upload).toMatchObject({
      name: "screenshot.png",
      mimeType: "image/png",
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    const payload = await store.readBase64(
      upload.uploadId,
      "pane-1",
      "/session/a.jsonl",
    );
    expect(Buffer.from(payload.data, "base64")).toEqual(bytes);

    const imagePath = path.join(store.root, `${upload.uploadId}.png`);
    expect((await stat(imagePath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path.join(store.root, `${upload.uploadId}.json`), "utf8"))).toMatchObject({
      paneId: "pane-1",
      sessionPath: "/session/a.jsonl",
    });
  });

  it("rejects unsupported bytes", async () => {
    const store = await createStore();
    await expect(
      store.create({
        paneId: "pane-1",
        sessionPath: null,
        name: "fake.svg",
        stream: Readable.from(Buffer.from("<svg></svg>")),
      }),
    ).rejects.toMatchObject({ code: "unsupported-type" } satisfies Partial<ImageUploadError>);
  });

  it("rejects images that exceed the pixel budget", async () => {
    const store = await createStore();
    await expect(
      store.create({
        paneId: "pane-1",
        sessionPath: null,
        name: "huge.png",
        stream: Readable.from(pngBytes(10_000, 10_000)),
      }),
    ).rejects.toMatchObject({ code: "invalid-image" });
  });

  it("enforces pane and session binding", async () => {
    const store = await createStore();
    const upload = await store.create({
      paneId: "pane-1",
      sessionPath: "/session/a.jsonl",
      name: "image.png",
      stream: Readable.from(pngBytes()),
    });

    await expect(
      store.getBound(upload.uploadId, "pane-2", "/session/a.jsonl"),
    ).rejects.toMatchObject({ code: "not-found" });
    await expect(
      store.getBound(upload.uploadId, "pane-1", "/session/b.jsonl"),
    ).rejects.toMatchObject({ code: "wrong-session" });
  });
});

function pngBytes(width = 1, height = 1): Buffer {
  const bytes = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
