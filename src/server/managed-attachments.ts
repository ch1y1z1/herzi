const ATTACHMENT_BLOCK_PATTERN = /\n*<herzi-attachments>\n([\s\S]*?)\n<\/herzi-attachments>/g;

interface ManagedAttachmentLine {
  id: string;
  path: string;
  mimeType: string;
}

export function appendManagedAttachments(
  text: string,
  attachments: ManagedAttachmentLine[],
): string {
  const prompt = text.trim() || "请查看所附图片并结合图片内容回答。";
  const lines = attachments.map((attachment) => JSON.stringify(attachment));
  return `${prompt}\n\n<herzi-attachments>\n${lines.join("\n")}\n</herzi-attachments>`;
}

export function extractManagedAttachments(text: string): {
  text: string;
  uploadIds: string[];
} {
  const uploadIds: string[] = [];
  const visibleText = text.replace(ATTACHMENT_BLOCK_PATTERN, (_match, body: string) => {
    const blockIds: string[] = [];
    for (const line of body.split("\n")) {
      try {
        const value = JSON.parse(line) as unknown;
        if (
          !value ||
          typeof value !== "object" ||
          !("id" in value) ||
          typeof value.id !== "string"
        ) {
          return _match;
        }
        blockIds.push(value.id);
      } catch {
        // Leave malformed user-authored blocks visible instead of treating them as attachments.
        return _match;
      }
    }
    uploadIds.push(...blockIds);
    return "";
  });
  return { text: visibleText.trim(), uploadIds };
}
