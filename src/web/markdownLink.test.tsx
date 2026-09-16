// @vitest-environment jsdom

import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  TextMessagePartProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownLink } from "./markdownLink";
import { markdownShared } from "./markdownPlugins";

afterEach(cleanup);

describe("MarkdownLink", () => {
  it("opens links in a new browser tab with a safe rel", () => {
    render(
      <MarkdownLink href="https://example.com/docs">Example docs</MarkdownLink>,
    );

    const link = screen.getByRole("link", { name: "Example docs" });
    expect(link.getAttribute("href")).toBe("https://example.com/docs");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.classList.contains("markdown-link")).toBe(true);
  });

  it("keeps noopener/noreferrer when the caller passes rel and target", () => {
    render(
      <MarkdownLink
        href="https://example.com"
        target="_self"
        rel="nofollow"
        className="extra"
      >
        Overridden
      </MarkdownLink>,
    );

    const link = screen.getByRole("link", { name: "Overridden" });
    expect(link.getAttribute("target")).toBe("_self");
    expect(link.getAttribute("rel")).toBe("nofollow noopener noreferrer");
    expect(link.classList.contains("markdown-link")).toBe(true);
    expect(link.classList.contains("extra")).toBe(true);
  });

  it("drops an opener token that would keep a window handle", () => {
    render(
      <MarkdownLink href="https://example.com" rel="opener">
        Opener
      </MarkdownLink>,
    );

    expect(screen.getByRole("link", { name: "Opener" }).getAttribute("rel")).toBe(
      "noopener noreferrer",
    );
  });

  it("forwards standard anchor props and drops react-markdown's node", () => {
    render(
      <MarkdownLink
        href="https://example.com"
        title="External docs"
        aria-label="External docs"
        data-testid="markdown-link"
        node={{ type: "element", tagName: "a" }}
      >
        Props
      </MarkdownLink>,
    );

    const link = screen.getByTestId("markdown-link");
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("title")).toBe("External docs");
    expect(link.getAttribute("aria-label")).toBe("External docs");
    expect(link.hasAttribute("node")).toBe(false);
  });
});

describe("markdownShared link behavior", () => {
  it("wires the shared markdown config to MarkdownLink", () => {
    expect(markdownShared.components.a).toBe(MarkdownLink);
  });

  it("renders assistant body links in a new tab", () => {
    render(<AssistantBody text={"See [Herdr docs](https://example.com/herdr)."} />);

    const link = screen.getByRole("link", { name: "Herdr docs" });
    expect(link.getAttribute("href")).toBe("https://example.com/herdr");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders activity inline links in a new tab", () => {
    render(
      <TextMessagePartProvider text={"Opened [issue #12](https://example.com/i/12)."}>
        <MarkdownTextPrimitive className="markdown-body" smooth={false} {...markdownShared} />
      </TextMessagePartProvider>,
    );

    const link = screen.getByRole("link", { name: "issue #12" });
    expect(link.getAttribute("href")).toBe("https://example.com/i/12");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

interface TestMessage {
  id: string;
  createdAt: number;
  text: string;
}

function AssistantBody({ text }: { text: string }) {
  const runtime = useExternalStoreRuntime<TestMessage>({
    messages: [{ id: "message-1", createdAt: 0, text }],
    convertMessage: (message): ThreadMessageLike => ({
      id: message.id,
      role: "assistant",
      createdAt: new Date(message.createdAt),
      content: [{ type: "text", text: message.text }],
    }),
    isRunning: false,
    onNew: async (_message: AppendMessage) => {},
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Messages
          components={{ AssistantMessage, UserMessage: () => null }}
        />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="assistant-message">
      <MessagePrimitive.Parts
        components={{
          Text: () => (
            <MarkdownTextPrimitive
              className="markdown-body"
              smooth={false}
              {...markdownShared}
            />
          ),
        }}
      />
    </MessagePrimitive.Root>
  );
}
