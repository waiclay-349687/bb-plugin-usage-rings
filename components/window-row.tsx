/**
 * [INPUT]: 依赖 lib/usage 的配速与文案、lib/motion 的动效参数、hooks/use-motion 的 useAnimateIn / useReducedMotion
 * [OUTPUT]: 对外提供 WindowRow: 一个额度窗口 = 标题行 (窗口名 · 已用% · 重置倒计时) + 整行宽 6px 进度条 (带匀速刻度) + 余量/结论行;
 *           title 可只给分组后的短名, animateFill 关掉从 0 填充
 * [POS]: components 的行原语, 悬浮卡片与设置页共用; 消费者: usage-card.tsx; 与 usage-card 的边界: 这里只画一个窗口;
 *        左右内边距与分区标题、原生行对齐 (px-2), 进度条是卡片里最醒目的元素
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { DURATION, EASE_OUT, transition } from "../lib/motion.ts";
import { formatSpan, paceCopy, paceTone, usedTone, windowTitle, type Pace, type UsageWindow } from "../lib/usage.ts";
import { cn } from "../lib/utils.ts";
import { useAnimateIn, useReducedMotion } from "../hooks/use-motion.ts";
import { TONE_BG, TONE_TEXT } from "./tone.ts";

export function WindowRow({
  window,
  title = windowTitle(window),
  pace,
  index,
  stale,
  animateFill = true,
}: {
  window: UsageWindow;
  title?: string;
  pace: Pace;
  index: number;
  stale: boolean;
  animateFill?: boolean;
}) {
  const drawn = useAnimateIn();
  const shown = drawn || !animateFill;
  const reduced = useReducedMotion();
  const used = Math.min(100, Math.max(0, pace.usedPercent));
  const tone = usedTone(used);
  const copy = paceCopy(pace);
  const delay = index * DURATION.stagger;
  // 刻度 = 匀速时此刻应用到的位置, 填充越过它就是用快了
  const marker = pace.expectedUsedPercent !== null && !pace.exhausted ? Math.min(100, Math.max(0, pace.expectedUsedPercent)) : null;
  const full = windowTitle(window); // 提示与读屏用全名 (含分组前缀)

  return (
    <div className={cn("px-2 py-1.5", stale && "opacity-50")} style={{ transition: transition(reduced, [["opacity", 200]]) }}>
      {/* 标题行: 放不下时只截窗口名, 百分比与倒计时不截 */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 text-xs leading-5">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate font-medium text-foreground">{title}</span>
          <span className={cn("shrink-0 tabular-nums", tone === "good" ? "text-foreground" : TONE_TEXT[tone])}>{Math.round(used)}% used</span>
        </span>
        <span className="tabular-nums text-muted-foreground">
          {pace.resetsInMs === null ? "Reset time not reported" : `Resets in ${formatSpan(pace.resetsInMs)}`}
        </span>
      </div>

      <div
        role="meter"
        aria-label={`${full} used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(used)}
        className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full", TONE_BG[tone])}
          style={{
            width: `${shown ? used : 0}%`,
            transition: transition(reduced, [
              ["width", DURATION.fill, EASE_OUT, delay],
              ["background-color", DURATION.tone],
            ]),
          }}
        />
        {marker !== null && pace.status !== null ? (
          // 刻度两侧挖一道底色缺口, 落在填充上也看得清 (Synara 的做法); 两处外壳都是 bg-popover
          <div
            title="Even pace"
            className="absolute inset-y-0 flex w-1.5 -translate-x-1/2 justify-center bg-popover"
            style={{ left: `${marker}%`, opacity: shown ? 1 : 0, transition: transition(reduced, [["opacity", DURATION.fast, undefined, delay + 300]]) }}
          >
            <span className={cn("h-full w-0.5 rounded-full", TONE_BG[paceTone(pace.status)])} />
          </div>
        ) : null}
      </div>

      {copy.amount !== null || copy.outlook !== null ? (
        <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-[11px] leading-4 tabular-nums text-muted-foreground">
          <span className={cn(pace.status === "behind" && "text-warning-text")}>{copy.amount}</span>
          <span className="text-right">{copy.outlook}</span>
        </div>
      ) : null}
    </div>
  );
}
