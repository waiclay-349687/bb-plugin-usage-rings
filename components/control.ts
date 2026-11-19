/**
 * [INPUT]: 依赖 components/ui/button 的 buttonVariants (BB 组件库的按钮样式)
 * [OUTPUT]: 对外提供 GHOST_CONTROL: 本插件无边框控件 (圆环) 的统一交互样式; 卡片里的行用 BB 原生行自带的悬停反馈
 * [POS]: components 的交互反馈唯一真相源 = BB ghost 按钮 (悬停 state-hover, 打开 state-active, 悬停即时出现、离开 150ms 淡出) + 按下 state-active;
 *        消费者: usage-ring.tsx; 尺寸与字号由使用处覆盖 (cn 合并时后者优先)
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { cn } from "../lib/utils.ts";
import { buttonVariants } from "./ui/button.tsx";

export const GHOST_CONTROL = cn(buttonVariants({ variant: "ghost" }), "active:bg-state-active");
