/**
 * [INPUT]: 依赖 lib/usage.ts 的 Tone
 * [OUTPUT]: 对外提供 TONE_TEXT / TONE_BG: 状态到 BB 主题色类的映射
 * [POS]: components 的配色映射, 颜色只取 BB 主题 (success / warning / destructive), 不写任何色值; 消费者: usage-ring.tsx、window-row.tsx
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import type { Tone } from "../lib/usage.ts";

export type RingTone = Tone | "muted";

export const TONE_TEXT: Record<RingTone, string> = {
  good: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
  muted: "text-muted-foreground",
};

export const TONE_BG: Record<RingTone, string> = {
  good: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
  muted: "bg-muted-foreground",
};
