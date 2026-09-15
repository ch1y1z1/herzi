import {
  AttachmentPrimitive,
  ComposerPrimitive,
  MessagePartPrimitive,
  type AttachmentAdapter,
} from "@assistant-ui/react";
import { Image as ImageIcon, Paperclip, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import type {
  ChatToolResultPayload,
  ImageUploadResponse,
} from "../../shared/protocol";
import { apiFetch } from "../api";

const ACCEPTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_IMAGES = 4;

export interface UploadedComposerImage extends ImageUploadResponse {
  preview: string;
}

type ComposerAttachmentLike = {
  id: string;
  name: string;
  contentType?: string;
  file?: File;
  status: { type: string };
};

export class HerziImageAttachmentAdapter implements AttachmentAdapter {
  readonly accept = "image/png,image/jpeg,image/webp,image/gif";
  private pending = new Map<string, File>();
  private uploaded = new Map<string, UploadedComposerImage>();

  constructor(private readonly paneId: string) {}

  async add({ file }: { file: File }) {
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      throw new Error("仅支持 PNG、JPEG、WebP 和 GIF 图片");
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error("单张图片不能超过 10 MiB");
    }
    if (this.pending.size >= MAX_IMAGES) {
      throw new Error("一条消息最多添加 4 张图片");
    }
    const total = [...this.pending.values()].reduce((sum, item) => sum + item.size, 0);
    if (total + file.size > MAX_TOTAL_BYTES) {
      throw new Error("一条消息的图片总大小不能超过 20 MiB");
    }

    const id = crypto.randomUUID();
    this.pending.set(id, file);
    return {
      id,
      type: "image" as const,
      name: file.name || "clipboard-image",
      contentType: file.type,
      file,
      status: { type: "requires-action" as const, reason: "composer-send" as const },
    };
  }

  async send(attachment: Parameters<AttachmentAdapter["send"]>[0]) {
    const form = new FormData();
    form.append("file", attachment.file, attachment.name);
    const response = await apiFetch(
      `/api/panes/${encodeURIComponent(this.paneId)}/uploads`,
      { method: "POST", body: form },
    );
    const body = (await response.json().catch(() => null)) as
      | ImageUploadResponse
      | { error?: string }
      | null;
    if (!response.ok || !body || !("uploadId" in body)) {
      throw new Error(
        body && "error" in body && body.error
          ? body.error
          : `图片上传失败 (${response.status})`,
      );
    }

    const preview = await fileToDataUrl(attachment.file);
    this.pending.delete(attachment.id);
    this.uploaded.set(body.uploadId, { ...body, preview });
    return {
      id: body.uploadId,
      type: "image" as const,
      name: body.name,
      contentType: body.mimeType,
      file: attachment.file,
      status: { type: "complete" as const },
      content: [{ type: "image" as const, image: preview }],
    };
  }

  async remove(attachment: Parameters<AttachmentAdapter["remove"]>[0]) {
    this.pending.delete(attachment.id);
    if (!this.uploaded.has(attachment.id)) return;
    this.uploaded.delete(attachment.id);
    await apiFetch(
      `/api/panes/${encodeURIComponent(this.paneId)}/uploads/${encodeURIComponent(attachment.id)}`,
      { method: "DELETE" },
    ).catch(() => undefined);
  }

  getUpload(uploadId: string): UploadedComposerImage | undefined {
    return this.uploaded.get(uploadId);
  }
}

export function ComposerAttachments() {
  return (
    <ComposerPrimitive.Attachments>
      {({ attachment }) => (
        <ComposerAttachmentTile attachment={attachment as ComposerAttachmentLike} />
      )}
    </ComposerPrimitive.Attachments>
  );
}

export function ComposerAddImage() {
  return (
    <ComposerPrimitive.AddAttachment
      className="composer-attach-button"
      aria-label="添加图片"
      multiple
    >
      <Paperclip size={16} />
    </ComposerPrimitive.AddAttachment>
  );
}

export function ChatImagePart() {
  return (
    <ImagePreview>
      <MessagePartPrimitive.Image className="chat-message-image" alt="Chat image" />
    </ImagePreview>
  );
}

export function ToolResultImagePreview({
  toolName,
  result,
}: {
  toolName: string;
  result: unknown;
}) {
  const payload = asToolResultPayload(result);
  if (toolName !== "read" || !payload || payload.images.length === 0) return null;
  return (
    <div className="tool-result-images">
      {payload.images.map((image) => (
        <ImagePreview
          key={image.sha256}
          src={image.image}
          alt={`read tool result (${image.mimeType})`}
          className="tool-result-image"
        />
      ))}
    </div>
  );
}

export function ImagePreview({
  src,
  alt = "Image preview",
  className = "chat-message-image",
  children,
}: {
  src?: string;
  alt?: string;
  className?: string;
  children?: ReactNode;
}) {
  const [preview, setPreview] = useState("");
  return (
    <>
      <button
        type="button"
        className="chat-image-button"
        onClick={(event) => {
          const image = event.currentTarget.querySelector("img");
          if (image?.src) setPreview(image.src);
        }}
        aria-label="预览图片"
      >
        {children ?? <img className={className} src={src} alt={alt} />}
      </button>
      {preview && <ImageLightbox src={preview} onClose={() => setPreview("")} />}
    </>
  );
}

function asToolResultPayload(value: unknown): ChatToolResultPayload | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ChatToolResultPayload>;
  return candidate.type === "herzi-tool-result" && Array.isArray(candidate.images)
    ? (candidate as ChatToolResultPayload)
    : null;
}

function ComposerAttachmentTile({ attachment }: { attachment: ComposerAttachmentLike }) {
  const preview = useObjectUrl(attachment.file);
  return (
    <AttachmentPrimitive.Root className="composer-attachment">
      <button
        type="button"
        className="composer-attachment-preview"
        aria-label={`图片附件 ${attachment.name}`}
      >
        {preview ? (
          <img src={preview} alt="" />
        ) : (
          <ImageIcon size={20} aria-hidden="true" />
        )}
        {attachment.status.type === "running" && (
          <span className="composer-attachment-loading" aria-label="正在上传" />
        )}
      </button>
      <AttachmentPrimitive.Remove
        className="composer-attachment-remove"
        aria-label={`移除 ${attachment.name}`}
      >
        <X size={12} />
      </AttachmentPrimitive.Remove>
      <span className="composer-attachment-name">
        <AttachmentPrimitive.Name />
      </span>
    </AttachmentPrimitive.Root>
  );
}

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="图片预览">
      <button type="button" className="image-lightbox-backdrop" onClick={onClose} aria-label="关闭预览" />
      <img src={src} alt="图片预览" />
      <button type="button" className="image-lightbox-close" onClick={onClose} aria-label="关闭预览">
        <X size={18} />
      </button>
    </div>
  );
}

function useObjectUrl(file?: File): string {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("无法读取图片预览"));
    reader.readAsDataURL(file);
  });
}
