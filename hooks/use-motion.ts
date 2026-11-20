/**
 * [INPUT]: 依赖浏览器 matchMedia 与 localStorage
 * [OUTPUT]: 对外提供 useReducedMotion (系统"减少动态效果") / useAnimateIn (挂载两帧后变真, 用来从 0 过渡到目标值) / useDetailsOpen (Details 开关: 手动开关后记住, 否则按偏好默认值; 所有卡片共享) / forgetDetailsOpen
 * [POS]: hooks 的交互状态层; 消费者: components/*; 与 lib/motion.ts 的边界: 这里只有状态, 参数在 lib/motion.ts
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useEffect, useState, useSyncExternalStore } from "react";

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduce(onChange: () => void): () => void {
  const media = window.matchMedia(REDUCE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduce, () => window.matchMedia(REDUCE_QUERY).matches, () => false);
}

/** 首帧为 false, 两帧后为 true: 让宽度、弧长从 0 走到目标值; 减少动态效果时一开始就是 true */
export function useAnimateIn(): boolean {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced);
  useEffect(() => {
    if (reduced) {
      setShown(true);
      return;
    }
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [reduced]);
  return shown;
}

const DETAILS_KEY = "bb-plugin-usage-rings:details-open:v1";
const listeners = new Set<() => void>();

/** "1" / "0" = 用户手动开关过; null = 没动过, 按偏好 defaultDetailsOpen */
function readDetails(): string | null {
  try {
    return localStorage.getItem(DETAILS_KEY);
  } catch {
    return null;
  }
}

/** 偏好里的"默认展开"改了: 忘掉手动开关的记录, 让新默认值立刻生效 */
export function forgetDetailsOpen(): void {
  try {
    localStorage.removeItem(DETAILS_KEY);
  } catch {
    // 无妨
  }
  for (const listener of listeners) listener();
}

/** Details 开关: 手动开关后记住 (Synara 的做法), 没动过时按偏好的默认值; 各提供方卡片与设置页共用一个状态 */
export function useDetailsOpen(defaultOpen: boolean): [boolean, (open: boolean) => void] {
  const stored = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    readDetails,
    () => null,
  );
  const open = stored === null ? defaultOpen : stored === "1";
  const setOpen = (next: boolean) => {
    try {
      localStorage.setItem(DETAILS_KEY, next ? "1" : "0");
    } catch {
      // 存不下就只在本次会话生效
    }
    for (const listener of listeners) listener();
  };
  return [open, setOpen];
}
