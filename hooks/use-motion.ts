/**
 * [INPUT]: 依赖浏览器 matchMedia 与 localStorage
 * [OUTPUT]: 对外提供 useReducedMotion (系统"减少动态效果") / useAnimateIn (挂载两帧后变真, 用来从 0 过渡到目标值) / useDetailsOpen (记住 Details 展开状态, 所有卡片共享)
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

function readDetails(): boolean {
  try {
    return localStorage.getItem(DETAILS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Details 默认收起, 展开后记住 (Synara 的做法); 各提供方卡片与设置页共用一个状态 */
export function useDetailsOpen(): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    readDetails,
    () => false,
  );
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
