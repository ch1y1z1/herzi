import {
  escapeCurrencyDollars,
  normalizeMathDelimiters,
} from "@assistant-ui/react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { MarkdownLink } from "./markdownLink";

/**
 * Chat 中两处 MarkdownTextPrimitive（assistant 正文与 activity 内嵌文本）共用
 * 的渲染配置，避免正文与折叠区渲染能力漂移。
 *
 * - remark-math 解析 $...$ / $$...$$ 公式（singleDollarTextMath 默认开启）；
 * - rehype-katex 渲染为 KaTeX HTML；
 * - preprocess 先把模型常见的 \( \) / \[ \] 定界符归一化为 $ 形式，再转义裸
 *   价格 $5 这类文本，防止被当成行内公式起始符；
 * - components.a 统一覆盖链接，默认新 tab 打开并带安全 rel（见 markdownLink.tsx）。
 */
export const markdownShared = {
  remarkPlugins: [remarkGfm, remarkMath],
  rehypePlugins: [rehypeKatex],
  preprocess: (text: string) =>
    escapeCurrencyDollars(normalizeMathDelimiters(text)),
  components: { a: MarkdownLink },
};
