/**
 * [INPUT]: 依赖 lib/utils 的 cn
 * [OUTPUT]: 对外提供 CardSection (分区: 灰色小标题 + 可选右侧注记, 非首个分区带细分隔线) 与 SubLine (行下面一行 11px 说明, 与行标签对齐)
 * [POS]: components 的卡片原语, 照 BB 线程上下文卡片的分区规格 (标题 text-xs 中粗 muted、min-h-5、区间 border-t + pt-2 + mt-2);
 *        行本身直接用 SDK 的 experimental_ThreadContextCardRow; 消费者: usage-card.tsx、sections.tsx
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import type { ReactNode } from "react";
import { cn } from "../lib/utils.ts";

export function CardSection({ title, trailing, first = false, children }: { title: string; trailing?: ReactNode; first?: boolean; children: ReactNode }) {
  return (
    <section className={cn(!first && "mt-2 border-t border-border pt-2")}>
      <div className="mb-0.5 flex min-h-5 items-center gap-2 px-2">
        <h3 className="m-0 min-w-0 flex-1 truncate text-xs font-medium leading-5 text-muted-foreground">{title}</h3>
        {trailing !== undefined ? <span className="shrink-0 text-[11px] tabular-nums text-subtle-foreground">{trailing}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** 与原生行的标签对齐: 行内边距 8px + 图标 14px + 间距 8px = 30px */
export function SubLine({ children, tone }: { children: ReactNode; tone?: "default" | "warn" }) {
  return (
    <p className={cn("m-0 -mt-0.5 mb-1 pl-[30px] pr-2 text-[11px] leading-4 tabular-nums", tone === "warn" ? "text-warning-text" : "text-muted-foreground")}>
      {children}
    </p>
  );
}
