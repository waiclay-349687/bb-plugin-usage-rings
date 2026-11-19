/**
 * [INPUT]: 依赖浏览器 matchMedia (是否能悬停); 依赖 lib/motion 的悬停延迟
 * [OUTPUT]: 对外提供 useHoverCard: 一组圆环共用一张悬浮卡片的开合与"当前是谁"状态, 以及铺到圆环、锚点、卡片上的属性
 *           (鼠标悬停开合、点击不做事、卡片开着时划到别的圆环只换内容不收起; 键盘 Enter 打开并把焦点移进卡片、Esc 回到圆环; 触屏点按开合)
 * [POS]: hooks 的交互状态层, 开合节奏照 BB 会话页上下文圆环的悬浮钩子 (卡片可悬停、悬停打开不抢焦点); 消费者: components/rail-rings.tsx;
 *        与 use-motion 的边界: 这里只管开合与切换, 动效在 lib/motion 与组件里
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore, type FocusEvent, type MouseEvent, type RefObject } from "react";
import { DURATION } from "../lib/motion.ts";

const HOVER_QUERY = "(hover: hover)";

function subscribeHover(onChange: () => void): () => void {
  const media = window.matchMedia(HOVER_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export interface RingTriggerProps {
  ref(element: HTMLElement | null): void;
  "aria-haspopup": "dialog";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
  "data-state": "open" | "closed";
  onPointerEnter(): void;
  onPointerLeave(): void;
  onClick(event: MouseEvent<HTMLElement>): void;
}

export interface HoverCard<Id extends string> {
  open: boolean;
  /** 卡片正在显示哪个圆环; 收起后保留, 退场动画期间内容不变 */
  active: Id | null;
  /** 从哪个圆环切换过来 (首次打开为 null), 用来决定内容从哪个方向滑入 */
  switchedFrom: Id | null;
  /** 每切换一次加 1; 组件据此给"上一张内容"的淡出层计时 */
  switchCount: number;
  /** 交给 Radix Popover.Root 的 onOpenChange: Esc、点外面时收起 */
  onOpenChange(open: boolean): void;
  /** 铺到整列圆环的容器上 (同时是卡片的定位锚点) */
  anchorRef: RefObject<HTMLDivElement | null>;
  triggerProps(id: Id): RingTriggerProps;
  /** 某个圆环的 DOM 元素, 给卡片定位用 */
  triggerElement(id: Id | null): HTMLElement | null;
  contentProps: {
    id: string;
    onPointerEnter(): void;
    onPointerLeave(): void;
    onFocus(event: FocusEvent<HTMLElement>): void;
    onBlur(event: FocusEvent<HTMLElement>): void;
    onOpenAutoFocus(event: Event): void;
    onCloseAutoFocus(event: Event): void;
    onInteractOutside(event: Event): void;
  };
}

export function useHoverCard<Id extends string>(): HoverCard<Id> {
  const supportsHover = useSyncExternalStore(subscribeHover, () => window.matchMedia(HOVER_QUERY).matches, () => true);
  const contentId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggers = useRef(new Map<Id, HTMLElement>());
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<Id | null>(null);
  const [switchedFrom, setSwitchedFrom] = useState<Id | null>(null);
  const [switchCount, setSwitchCount] = useState(0);
  const [hovered, setHovered] = useState<Id | null>(null);
  const [contentHover, setContentHover] = useState(false);
  const [contentFocus, setContentFocus] = useState(false);
  /** 由键盘或触屏明确打开: 允许焦点进出卡片; 悬停打开则不碰焦点 */
  const explicit = useRef(false);
  const wanted = hovered !== null || contentHover || contentFocus;

  // 连同悬停/聚焦记录一起清掉, 否则残留状态会把卡片再打开
  const close = () => {
    setHovered(null);
    setContentHover(false);
    setContentFocus(false);
    setOpen(false);
  };

  const show = (id: Id) => {
    const switching = open && active !== null && active !== id;
    setSwitchedFrom(switching ? active : null);
    if (switching) setSwitchCount((count) => count + 1);
    setActive(id);
    setOpen(true);
  };

  // 卡片开着时划到另一个圆环: 立刻换内容, 卡片本身不收起 (共享同一张卡片)
  useEffect(() => {
    if (open && hovered !== null && hovered !== active) show(hovered);
  }, [open, hovered, active]);

  useEffect(() => {
    if (!supportsHover || wanted === open) return;
    const timer = window.setTimeout(
      () => {
        if (!wanted) return setOpen(false);
        explicit.current = false;
        // 指针回到正在退场的卡片上时 hovered 为空, 沿用原来的内容
        const target = hovered ?? active;
        if (target !== null) show(target);
      },
      wanted ? DURATION.hoverOpen : DURATION.hoverClose,
    );
    return () => window.clearTimeout(timer);
  }, [supportsHover, wanted, open, hovered, active]);

  return {
    open,
    active,
    switchedFrom,
    switchCount,
    onOpenChange: (next) => {
      if (!next) close();
    },
    anchorRef,
    triggerProps: (id) => {
      const current = open && active === id;
      return {
        ref: (element) => {
          if (element) triggers.current.set(id, element);
          else triggers.current.delete(id);
        },
        "aria-haspopup": "dialog",
        "aria-expanded": current,
        "aria-controls": current ? contentId : undefined,
        "data-state": current ? "open" : "closed",
        onPointerEnter: () => setHovered(id),
        onPointerLeave: () => setHovered((now) => (now === id ? null : now)),
        // 鼠标点击 (detail ≥ 1) 不做事; 键盘触发的 click 的 detail 为 0, 触屏没有悬停, 这两种点按开合
        onClick: (event) => {
          if (supportsHover && event.detail !== 0) return;
          if (current) return close();
          explicit.current = true;
          show(id);
        },
      };
    },
    triggerElement: (id) => (id === null ? null : triggers.current.get(id) ?? null),
    contentProps: {
      id: contentId,
      onPointerEnter: () => setContentHover(true),
      onPointerLeave: () => setContentHover(false),
      // 只认键盘焦点: 鼠标点卡片里的按钮也会拿到焦点, 不该因此钉住卡片
      onFocus: (event) => setContentFocus((event.target as Element).matches(":focus-visible")),
      onBlur: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setContentFocus(false);
      },
      // 悬停打开不抢焦点 (BB 同样处理), 否则正在输入的编辑框会丢焦点
      onOpenAutoFocus: (event) => {
        if (!explicit.current) event.preventDefault();
      },
      // 圆环不是 Radix 的 Trigger, 焦点由这里还给当前圆环
      onCloseAutoFocus: (event) => {
        event.preventDefault();
        if (explicit.current && active !== null) triggers.current.get(active)?.focus();
        explicit.current = false;
      },
      // 点圆环交给圆环自己的 onClick 处理, 不算"点外面"
      onInteractOutside: (event) => {
        if (anchorRef.current?.contains(event.target as Node)) event.preventDefault();
      },
    },
  };
}
