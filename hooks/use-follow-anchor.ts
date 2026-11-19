/**
 * [INPUT]: 依赖 lib/motion 的时长与 easeOut、hooks/use-motion 的"减少动态效果"
 * [OUTPUT]: 对外提供 useFollowAnchor: 给 Radix Popover.Anchor 的 virtualRef, 位置 = 当前圆环; 卡片开着时换圆环, 锚点用 200ms 快起缓停从旧圆环滑到新圆环
 * [POS]: hooks 的交互状态层; 消费者: components/rail-rings.tsx (配合 Popover.Content 的 updatePositionStrategy="always", Radix 每帧重读锚点位置);
 *        与 use-hover-card 的边界: 那边决定显示谁, 这里只决定卡片贴在哪
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useLayoutEffect, useRef, type RefObject } from "react";
import { DURATION, easeOut } from "../lib/motion.ts";
import { useReducedMotion } from "./use-motion.ts";

interface Measurable {
  getBoundingClientRect(): DOMRect;
}

interface Slide {
  from: DOMRect;
  start: number;
}

/** 只在纵向插值: 圆环同在一列, 横向与尺寸都取目标的 */
function along(slide: Slide | null, to: DOMRect, reduced: boolean): DOMRect {
  if (slide === null || reduced) return to;
  const progress = (performance.now() - slide.start) / DURATION.morph;
  if (progress >= 1) return to;
  const y = slide.from.y + (to.y - slide.from.y) * easeOut(progress);
  return new DOMRect(to.x, y, to.width, to.height);
}

export function useFollowAnchor(target: HTMLElement | null, open: boolean): RefObject<Measurable> {
  const reduced = useReducedMotion();
  // 渲染时就指向最新目标: 第一次打开时 Radix 在本组件的布局副作用之前就会量锚点
  const latest = useRef({ target, reduced });
  latest.current = { target, reduced };
  const pointedAt = useRef<HTMLElement | null>(null);
  const slide = useRef<Slide | null>(null);
  const wasOpen = useRef(false);

  const anchor = useRef<Measurable>({
    getBoundingClientRect() {
      const { target: element, reduced: still } = latest.current;
      const to = element?.getBoundingClientRect() ?? new DOMRect();
      const rect = along(slide.current, to, still);
      if (rect === to) slide.current = null;
      return rect;
    },
  });

  useLayoutEffect(() => {
    const previous = pointedAt.current;
    if (target !== previous) {
      // 卡片本来就开着才滑; 起点取此刻画在哪 (连续快速切换时接着上一段走)
      slide.current =
        wasOpen.current && previous !== null && target !== null
          ? { from: along(slide.current, previous.getBoundingClientRect(), reduced), start: performance.now() }
          : null;
      pointedAt.current = target;
    }
    wasOpen.current = open;
  }, [target, open, reduced]);

  return anchor;
}
