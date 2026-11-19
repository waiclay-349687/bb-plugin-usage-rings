/**
 * [INPUT]: 依赖 lib/motion 的时长曲线、hooks/use-motion 的"减少动态效果"
 * [OUTPUT]: 对外提供 Collapse: 高度未知内容的展开/收起 (grid 行 0fr↔1fr + 淡入淡出), 收起时 inert
 * [POS]: components 的动效原语, 与 session-cockpit 的折叠同一技法 (也是 BB 原生横幅详情的技法); 消费者: usage-card.tsx (Details);
 *        与 morph-height 的边界: 这里管卡片内部的展开, morph-height 只管换圆环时整张卡片的高度
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import type { ReactNode } from "react";
import { DURATION, EASE_OUT, transition } from "../lib/motion.ts";
import { useReducedMotion } from "../hooks/use-motion.ts";

export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <div
      className="grid"
      inert={!open}
      style={{
        gridTemplateRows: open ? "1fr" : "0fr",
        opacity: open ? 1 : 0,
        transition: transition(reduced, [
          ["grid-template-rows", DURATION.collapse, EASE_OUT],
          ["opacity", DURATION.collapse],
        ]),
      }}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
