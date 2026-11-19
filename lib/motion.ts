/**
 * [INPUT]: 依赖 components/ui/motion.ts (BB 组件库里的控件悬停过渡)
 * [OUTPUT]: 对外提供 MOTION (Tailwind 类) / EASE / EASE_OUT / easeOut() (EASE_OUT 的 JS 版) / DURATION / transition(): 本插件全部动效参数
 * [POS]: lib 的动效常量, 动效参数的唯一真相源; 时长与曲线取自 BB (默认 150ms + cubic-bezier(.4,0,.2,1), 悬浮卡片的进出场与开合延迟照 BB 会话页上下文卡片);
 *        消费者: components/*; 与 hooks/use-motion.ts 的边界: 这里只有常量, "减少动态效果"的判断在 hook 里
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { CONTROL_HOVER_TRANSITION } from "../components/ui/motion.ts";

/** BB 默认曲线 */
export const EASE = "cubic-bezier(.4, 0, .2, 1)";
/** BB 里用于展开、抽屉的快起缓停曲线 */
export const EASE_OUT = "cubic-bezier(.16, 1, .3, 1)";

/** EASE_OUT 的 JS 版 (这条贝塞尔就是 easeOutExpo), 给只能逐帧算位置的地方用, 与 CSS 那边同一手感 */
export function easeOut(t: number): number {
  return t >= 1 ? 1 : 1 - 2 ** (-10 * t);
}

export const DURATION = {
  /** 悬停淡出、刻度淡入 */
  fast: 150,
  /** 悬停多久才打开卡片: BB 上下文圆环是 0, 这里圆环叠在去 Settings 的路上, 稍等一下免得划过就弹; 卡片开着时换圆环不等 */
  hoverOpen: 100,
  /** 离开圆环多久收起: 与 BB 上下文圆环相同, 够把指针移进卡片 */
  hoverClose: 200,
  /** Details 展开 / 收起 */
  collapse: 200,
  /** 共用卡片在圆环之间切换时的高度伸缩与平移 */
  morph: 200,
  /** 切换内容用"淡出再淡入" (Material 的 fade through): 旧内容 100ms 淡出, 新内容晚这么久再淡入, 两份文字不会叠成重影 */
  swapDelay: 60,
  /** 颜色跨阈值渐变 */
  tone: 300,
  /** 进度条填充 */
  fill: 420,
  /** 圆环弧长 */
  ring: 600,
  /** 进度条逐行错开 */
  stagger: 40,
  /** 两步确认的等待时间 */
  confirm: 4000,
} as const;

export const MOTION = {
  /** BB 控件悬停: 进入即时, 离开 150ms 淡出 */
  hover: CONTROL_HOVER_TRANSITION,
  /** 与 BB 的 PopoverContent (会话页上下文卡片即用它) 同一组进出场类: 淡入淡出 + 95% 缩放, 不滑动 */
  popover:
    "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
  /** 系统开启"减少动态效果"时关闭; 弹层的进出场类带 data-state 属性选择器, 减弱规则也要叠同样的变体才压得住 */
  reduce:
    "motion-reduce:transition-none motion-reduce:animate-none motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none",
} as const;

/** 拼行内 transition; reduced 为真时直接不过渡 */
export function transition(reduced: boolean, parts: [property: string, ms: number, ease?: string, delayMs?: number][]): string {
  if (reduced) return "none";
  return parts.map(([property, ms, ease = EASE, delay = 0]) => `${property} ${ms}ms ${ease} ${delay}ms`).join(", ");
}
