import type { ComponentPropsWithoutRef } from "react";

/**
 * react-markdown 会把 hast 节点以 `node` 传给自定义组件；它不是 HTML 属性，
 * 这里显式剔除，不依赖 React 对未知属性的过滤行为（实测 React 19 会静默丢弃，
 * 但把 `node` 透传给 DOM 本身是错误语义）。
 */
type MarkdownLinkProps = ComponentPropsWithoutRef<"a"> & {
  node?: unknown;
};

const REQUIRED_REL_TOKENS = ["noopener", "noreferrer"];

/**
 * Chat Markdown 链接的窄范围 renderer，挂在 `markdownPlugins.ts` 的
 * `markdownShared.components.a` 上，使 assistant 正文与 activity 内嵌 Markdown
 * 共用同一份链接行为。
 *
 * 行为契约：
 * - 默认 `target="_blank"`：点击在浏览器新 tab 打开，不覆盖当前 Herzi 页面；
 * - 始终带 `noopener noreferrer`：即使调用方自己传了 `rel` 也不会被削弱，并
 *   移除会与 `noopener` 冲突的 `opener`；调用方显式传入的其它 `rel` token 与
 *   `target` 仍然保留；
 * - 固定追加 `markdown-link` class，作为 `.markdown-body a, .markdown-link` 的
 *   样式钩子（见 styles.css）。
 */
export function MarkdownLink({
  href,
  children,
  className,
  target = "_blank",
  rel,
  node: _node,
  ...rest
}: MarkdownLinkProps) {
  return (
    <a
      {...rest}
      className={className ? `markdown-link ${className}` : "markdown-link"}
      href={href}
      target={target}
      rel={resolveRel(rel)}
    >
      {children}
    </a>
  );
}

function resolveRel(rel: string | undefined): string {
  const tokens = (rel ?? "")
    .split(/\s+/)
    .filter((token) => token.length > 0 && token !== "opener");
  return [...new Set([...tokens, ...REQUIRED_REL_TOKENS])].join(" ");
}
