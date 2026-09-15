import { describe, expect, it } from "vitest";

import { appendManagedAttachments, extractManagedAttachments } from "./managed-attachments.js";

describe("managed attachment markers", () => {
  it("round-trips visible text and upload ids", () => {
    const prompt = appendManagedAttachments("Review this", [
      { id: "upload-1", path: "/tmp/upload-1.png", mimeType: "image/png" },
      { id: "upload-2", path: "/tmp/upload-2.jpg", mimeType: "image/jpeg" },
    ]);

    expect(extractManagedAttachments(prompt)).toEqual({
      text: "Review this",
      uploadIds: ["upload-1", "upload-2"],
    });
    expect(prompt).toContain("/tmp/upload-1.png");
  });

  it("keeps malformed user-authored blocks visible", () => {
    const text = "hello\n<herzi-attachments>\nnot-json\n</herzi-attachments>";
    expect(extractManagedAttachments(text)).toEqual({ text, uploadIds: [] });
  });

  it("supplies a useful prompt for image-only messages", () => {
    const prompt = appendManagedAttachments("", [
      { id: "upload-1", path: "/tmp/upload-1.png", mimeType: "image/png" },
    ]);
    expect(extractManagedAttachments(prompt).text).toBe(
      "请查看所附图片并结合图片内容回答。",
    );
  });
});
