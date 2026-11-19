/**
 * [INPUT]: 依赖 bb 宿主 DOM 的 `nav[data-sidebar-navigation-placement="rail"]` (bb 为任何 rail 位置的导航画的外壳)
 * [OUTPUT]: 对外提供 useRailSlot: 在 rail 列底部 (Settings 之上) 挂一个本插件独占的容器并返回它; 没有 rail 时返回 null
 * [POS]: hooks 的宿主适配缝, 本插件唯一依赖宿主 DOM 结构的地方; 消费者: components/rail-rings.tsx;
 *        与 hooks/use-usage-limits.ts 的边界: 本文件只管挂载点, 不碰数据
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useEffect, useState } from "react";

const RAIL_SELECTOR = 'nav[data-sidebar-navigation-placement="rail"]';
const SLOT_ATTRIBUTE = "data-usage-rings-slot";

/**
 * rail 是 flex 纵列, 内部 flex-1 区域占满剩余高度; 追加为最后一个子元素即落在列底部。
 * 导航插件重渲染或切换导航方式时 nav 可能被重建, 用 MutationObserver 跟随重挂。
 */
export function useRailSlot(): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;
    let frame: number | null = null;

    const sync = () => {
      frame = null;
      const nav = document.querySelector<HTMLElement>(RAIL_SELECTOR);
      if (nav !== null && current !== null && current.isConnected && current.parentElement === nav) {
        // 别的节点被追加到我们后面时, 把自己挪回最底部
        if (nav.lastElementChild !== current) nav.appendChild(current);
        return;
      }
      current?.remove();
      current = null;
      if (nav !== null) {
        current = document.createElement("div");
        current.setAttribute(SLOT_ATTRIBUTE, "");
        current.style.flexShrink = "0"; // rail 是纵向 flex, 不让圆环区被压缩
        nav.appendChild(current);
      }
      setSlot(current);
    };

    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(sync);
    };

    sync();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
      current?.remove();
      current = null;
      setSlot(null);
    };
  }, []);

  return slot;
}
