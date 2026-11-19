/**
 * [INPUT]: 依赖 @get-bb/plugin-sdk/app 的 experimental_ProviderIcon; 依赖 lib/i18n 的窗口名、hooks/use-language 的文案; 依赖 hooks/use-hover-card 的触发器属性类型、lib/usage 的配色、lib/motion 的动效参数
 * [OUTPUT]: 对外提供 UsageRing: rail 上的一个圆环 (环长 = 最紧窗口已用%, 颜色看用量, 用尽整圈红, 出错灰环 + 红点), 本身只是悬浮卡片的触发器
 * [POS]: components 的单个提供方入口; 消费者: rail-rings.tsx (共用卡片也在那里); 与 rail-rings 的边界: 这里只画环, 开合与卡片由 rail-rings 管
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { experimental_ProviderIcon as ProviderIcon } from "@get-bb/plugin-sdk/app";
import type { RingTriggerProps } from "../hooks/use-hover-card.ts";
import { useI18n } from "../hooks/use-language.ts";
import { localizeWindowName, type Lang, type Messages } from "../lib/i18n.ts";
import { DURATION, EASE_OUT, transition } from "../lib/motion.ts";
import { usedTone, primaryWindow, windowTitle, type ProviderUsage } from "../lib/usage.ts";
import { cn } from "../lib/utils.ts";
import { useAnimateIn, useReducedMotion } from "../hooks/use-motion.ts";
import { GHOST_CONTROL } from "./control.ts";
import { TONE_TEXT, type RingTone } from "./tone.ts";
import type { ProviderPresentation } from "./usage-card.tsx";

const RADIUS = 12;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function ringState(usage: ProviderUsage, t: Messages, lang: Lang): { used: number | null; tone: RingTone; label: string } {
  if (usage.status === "error") return { used: null, tone: "muted", label: lang === "en" ? usage.message : t.loadFailed };
  const window = primaryWindow(usage.windows);
  if (window === null) return { used: null, tone: "muted", label: t.noLimitReported };
  const used = Math.min(100, Math.max(0, window.usedPercent));
  const label = t.ringLabel(localizeWindowName(windowTitle(window), lang), Math.round(used));
  return usage.staleMessage ? { used, tone: "muted", label: `${label}${t.refreshFailedSuffix}` } : { used, tone: usedTone(used), label };
}

export function UsageRing({ usage, provider, trigger }: { usage: ProviderUsage; provider: ProviderPresentation; trigger: RingTriggerProps }) {
  const drawn = useAnimateIn(); // 首次出现从 0 画到当前值
  const reduced = useReducedMotion();
  const { t, lang } = useI18n();
  const ring = ringState(usage, t, lang);
  // 环长 = 已用; 用尽时整圈即为状态色, 不再需要单独的"空环"样式
  const dash = ring.used === null || !drawn ? 0 : (ring.used / 100) * CIRCUMFERENCE;
  const failed = usage.status === "error" || usage.staleMessage !== undefined;

  return (
    // 不设 title: 原生提示会和悬浮卡片叠在一起; 读屏靠 aria-label. data-state 由 trigger 给, 卡片显示的是它时为 open
    <button
      type="button"
      {...trigger}
      aria-label={t.ringAria(provider.name, ring.label)}
      className={cn(GHOST_CONTROL, "group/ring relative grid size-8 place-items-center rounded-lg p-0 text-sidebar-foreground focus-visible:ring-sidebar-ring")}
    >
      <svg aria-hidden="true" viewBox="0 0 28 28" className="absolute inset-0.5 size-7 -rotate-90 overflow-visible">
        {/* 背景大半被圆环和图标挡住, 悬停与卡片显示它时轨道同步加深作第二道提示; 用具名组 group/ring, 否则 BB 侧边栏外层的 group 一悬停就会误触发 */}
        <circle
          cx="14"
          cy="14"
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          className="text-sidebar-border transition-colors duration-150 group-hover/ring:text-muted-foreground/45 group-hover/ring:duration-0 group-data-[state=open]/ring:text-muted-foreground/45 motion-reduce:transition-none"
        />
        <circle
          cx="14"
          cy="14"
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
          className={cn(TONE_TEXT[ring.tone], (ring.used === null || ring.used <= 0) && "opacity-0")}
          style={{
            transition: transition(reduced, [
              ["stroke-dasharray", DURATION.ring, EASE_OUT],
              ["color", DURATION.tone],
              ["opacity", DURATION.fast],
            ]),
          }}
        />
      </svg>
      <ProviderIcon providerKind="agent" provider={provider} aria-hidden={true} className="size-4" />
      {failed ? (
        <span
          aria-hidden="true"
          className="absolute right-[3px] top-[3px] size-[7px] rounded-full bg-destructive ring-[1.5px] ring-sidebar animate-in zoom-in-0 duration-200 motion-reduce:animate-none"
        />
      ) : null}
    </button>
  );
}
