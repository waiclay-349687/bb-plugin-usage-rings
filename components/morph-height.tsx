/**
 * [INPUT]: 依赖浏览器 ResizeObserver; 依赖 lib/motion 的时长曲线、hooks/use-motion 的"减少动态效果"
 * [OUTPUT]: 对外提供 MorphHeight: morphKey 变化 (换圆环) 时外框高度从旧内容平滑伸缩到新内容; 平时高度 auto, 自然跟随内容
 * [POS]: components 的动效原语; 消费者: rail-rings.tsx; 与 collapse 的边界: Details 展开由 collapse 自己动画, 这里不插手, 免得两套过渡互相追
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { DURATION, EASE_OUT, transition } from "../lib/motion.ts";
import { useReducedMotion } from "../hooks/use-motion.ts";

export function MorphHeight({ morphKey, children }: { morphKey: string; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  /** 最近一次量到的内容高度 = 换内容前画出来的高度 */
  const measured = useRef<number | null>(null);
  const animating = useRef(false);
  const mounted = useRef(false);
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    const box = outer.current;
    const content = inner.current;
    if (!box || !content) return;
    const observer = new ResizeObserver(() => {
      measured.current = content.offsetHeight;
      // 伸缩途中内容又变了 (如数据到达), 改追新高度
      if (animating.current) box.style.height = `${measured.current}px`;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // 直接改样式而不走 React 状态: 起点必须在本帧画之前落定, 晚一帧就会闪
  useLayoutEffect(() => {
    const box = outer.current;
    const content = inner.current;
    if (!box || !content) return;
    if (!mounted.current) {
      mounted.current = true;
      measured.current = content.offsetHeight;
      return;
    }
    const from = animating.current ? box.getBoundingClientRect().height : measured.current;
    const to = content.offsetHeight;
    measured.current = to;
    if (reduced || from === null || Math.abs(from - to) < 1) return;
    animating.current = true;
    box.style.transition = "none";
    box.style.height = `${from}px`;
    void box.offsetHeight;
    box.style.transition = transition(false, [["height", DURATION.morph, EASE_OUT]]);
    box.style.height = `${to}px`;
    const timer = window.setTimeout(() => {
      animating.current = false;
      box.style.transition = "";
      box.style.height = "";
    }, DURATION.morph + 20);
    return () => window.clearTimeout(timer);
  }, [morphKey, reduced]);

  return (
    <div ref={outer} className="overflow-hidden">
      <div ref={inner}>{children}</div>
    </div>
  );
}
