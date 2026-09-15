// @vitest-environment jsdom

import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
} from "@assistant-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "../api";
import {
  ComposerAttachments,
  HerziImageAttachmentAdapter,
  ToolResultImagePreview,
} from "./ChatAttachments";

vi.mock("../api", () => ({ apiFetch: vi.fn() }));

const mockedApiFetch = vi.mocked(apiFetch);

afterEach(() => {
  cleanup();
  mockedApiFetch.mockReset();
});

describe("Chat image attachments", () => {
  it("adds a pasted image to the assistant-ui composer", async () => {
    const adapter = new HerziImageAttachmentAdapter("pane-1");
    render(<ComposerHarness adapter={adapter} onNew={vi.fn()} />);
    const input = screen.getByLabelText("prompt");
    const file = new File([pngText()], "screenshot.png", { type: "image/png" });

    fireEvent.paste(input, { clipboardData: { files: [file] } });

    await waitFor(() => expect(screen.getByText("screenshot.png")).toBeTruthy());
  });

  it("uploads the image before delivering the composed message", async () => {
    mockedApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          uploadId: "4c29d589-e5c0-4b86-b8d5-e234e552ad25",
          name: "screenshot.png",
          mimeType: "image/png",
          size: pngText().length,
          sha256: "a".repeat(64),
          expiresAt: Date.now() + 60_000,
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    const onNew = vi.fn<(message: AppendMessage) => Promise<void>>(async () => {});
    const adapter = new HerziImageAttachmentAdapter("pane-1");
    render(<ComposerHarness adapter={adapter} onNew={onNew} />);
    const input = screen.getByLabelText("prompt");
    const file = new File([pngText()], "screenshot.png", { type: "image/png" });

    fireEvent.paste(input, { clipboardData: { files: [file] } });
    await waitFor(() => expect(screen.getByText("screenshot.png")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await waitFor(() => expect(onNew).toHaveBeenCalledTimes(1));
    expect(mockedApiFetch).toHaveBeenCalledWith(
      "/api/panes/pane-1/uploads",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
    expect(onNew.mock.calls[0]![0].attachments?.[0]?.id).toBe(
      "4c29d589-e5c0-4b86-b8d5-e234e552ad25",
    );
  });

  it("renders read tool result images as preview buttons", () => {
    render(
      <ToolResultImagePreview
        toolName="read"
        result={{
          type: "herzi-tool-result",
          value: "Read image file [image/png]",
          images: [
            {
              image: "data:image/png;base64,AA==",
              mimeType: "image/png",
              sha256: "a".repeat(64),
            },
          ],
        }}
      />,
    );

    const preview = screen.getByRole("button", { name: "预览图片" });
    expect(preview.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,AA==",
    );
  });

  it("does not render tool result images for non-read tools", () => {
    const { container } = render(
      <ToolResultImagePreview
        toolName="bash"
        result={{
          type: "herzi-tool-result",
          value: "result",
          images: [
            {
              image: "data:image/png;base64,AA==",
              mimeType: "image/png",
              sha256: "a".repeat(64),
            },
          ],
        }}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("rejects unsupported and oversized files", async () => {
    const adapter = new HerziImageAttachmentAdapter("pane-1");
    await expect(
      adapter.add({
        file: new File(["<svg/>"], "image.svg", { type: "image/svg+xml" }),
      }),
    ).rejects.toThrow("仅支持");
    await expect(
      adapter.add({
        file: new File([new ArrayBuffer(10 * 1024 * 1024 + 1)], "large.png", {
          type: "image/png",
        }),
      }),
    ).rejects.toThrow("10 MiB");
  });
});

function ComposerHarness({
  adapter,
  onNew,
}: {
  adapter: HerziImageAttachmentAdapter;
  onNew: (message: AppendMessage) => Promise<void>;
}) {
  const runtime = useExternalStoreRuntime<TestMessage>({
    messages: [] as TestMessage[],
    convertMessage: (message) => ({
      id: message.id,
      role: "user",
      createdAt: new Date(message.createdAt),
      content: [{ type: "text", text: message.text }],
    }),
    isRunning: false,
    onNew,
    adapters: { attachments: adapter },
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ComposerPrimitive.Root>
        <ComposerPrimitive.Input aria-label="prompt" />
        <ComposerAttachments />
        <ComposerPrimitive.Send aria-label="send">send</ComposerPrimitive.Send>
      </ComposerPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

interface TestMessage {
  id: string;
  createdAt: number;
  text: string;
}

function pngText(): string {
  return String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1);
}
