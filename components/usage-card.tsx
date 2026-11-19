/**
 * [INPUT]: 依赖 SDK 的 experimental_ThreadContextCardRow / experimental_Icon / experimental_ProviderIcon; 依赖 lib/usage 的配速、lib/i18n 的时长与窗口名、hooks/use-language 的文案、hooks/use-motion 的 Details 开关;
 *          依赖 components/card-section、window-row、sections、collapse
 * [OUTPUT]: 对外提供 UsageCard (一个提供方的卡片内容: 头部 · Limits (按窗口名前缀分区) · 可折叠的 Details (Codex 的 Resets/Credits · Activity) · Details 开关行 · 刷新行) 与 ProviderPresentation / UsageCardProps 类型
 * [POS]: components 的卡片组合层, 版式照 BB 线程上下文卡片 (分区 + 原生行); 悬浮卡片与设置页共用同一套;
 *        消费者: rail-rings.tsx (共用悬浮卡片)、settings-overview.tsx; 与 window-row / sections 的边界: 这里只排版, 行与分区各自成件
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import {
  experimental_Icon as Icon,
  experimental_ProviderIcon as ProviderIcon,
  experimental_ThreadContextCardRow as CardRow,
} from "@get-bb/plugin-sdk/app";
import { DURATION, transition } from "../lib/motion.ts";
import { formatSpan, localizeWindowName, type Lang, type Messages } from "../lib/i18n.ts";
import { groupWindows, paceOf, type ProviderUsage } from "../lib/usage.ts";
import { cn } from "../lib/utils.ts";
import { useI18n } from "../hooks/use-language.ts";
import { useDetailsOpen, useReducedMotion } from "../hooks/use-motion.ts";
import { CardSection } from "./card-section.tsx";
import { Collapse } from "./collapse.tsx";
import { ActivitySection, CodexSections } from "./sections.tsx";
import { WindowRow } from "./window-row.tsx";

export interface ProviderPresentation {
  id: string;
  name: string;
  logoUrl: string | null;
  icon: { glyph: string } | null;
  /** 提供方品牌色 (如 Claude 的橙色), 由 BB 的提供方图标组件读取 */
  strings: { iconTint?: { light: string; dark: string } | null } | null;
}

export interface UsageCardProps {
  usage: ProviderUsage;
  provider: ProviderPresentation;
  now: number;
  updatedAt: number | null;
  error: string | null;
  refreshing: boolean;
  onRefresh(): void;
  /** 进度条是否从 0 填充; 共用卡片在圆环间切换时传 false, 免得每次切换都像重新出现 */
  animateFill?: boolean;
}

function updatedCopy(t: Messages, lang: Lang, now: number, updatedAt: number | null, error: string | null): string {
  if (error) return t.refreshFailed;
  if (updatedAt === null) return t.notUpdated;
  return now - updatedAt < 60_000 ? t.updatedJustNow : t.updatedAgo(formatSpan(now - updatedAt, lang));
}

export function UsageCard({ usage, provider, now, updatedAt, error, refreshing, onRefresh, animateFill = true }: UsageCardProps) {
  const { t, lang } = useI18n();
  // 中文模式不显示后端给的英文原文, 换成概括说法
  const alert =
    usage.status === "error"
      ? lang === "en" ? usage.message : t.loadFailed
      : usage.staleMessage === undefined ? null : t.staleNote(usage.staleMessage);
  const stale = usage.status === "ok" && usage.staleMessage !== undefined;
  const showPlan = usage.planLabel !== null && !provider.name.toLowerCase().includes(usage.planLabel.toLowerCase());
  const [detailsOpen, setDetailsOpen] = useDetailsOpen();
  const reduced = useReducedMotion();
  const codex = usage.providerId === "codex";

  return (
    <div className="text-xs text-popover-foreground">
      {/* 头部: 与原生行同一套内边距与图标尺寸, 名称用前景色, 其余灰 */}
      <div className="mb-1 flex h-6 items-center gap-2 px-2">
        <ProviderIcon providerKind="agent" provider={provider} aria-hidden={true} className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{provider.name}</span>
        {showPlan ? (
          // 与 BB 自带用量卡片同一款套餐标签
          <span className="shrink-0 rounded-sm bg-sidebar-border/60 px-1 py-0.5 text-2xs leading-none text-subtle-foreground">{usage.planLabel}</span>
        ) : null}
      </div>

      {alert ? (
        <p className="mx-2 mb-1.5 mt-0 rounded-md bg-destructive/10 px-2 py-1 text-[11px] leading-4 text-destructive-text animate-in fade-in-0 duration-200 motion-reduce:animate-none">
          {alert}
        </p>
      ) : null}

      {/* 窗口名带 "X · " 前缀时按前缀分区 (Antigravity 的 Gemini / Claude/GPT), 否则一个 Limits 分区 */}
      {usage.status === "ok"
        ? groupWindows(usage.windows).map((group, groupIndex, groups) => {
            const offset = groups.slice(0, groupIndex).reduce((count, previous) => count + previous.items.length, 0);
            return (
              <CardSection key={group.name ?? "limits"} title={group.name === null ? t.limits : localizeWindowName(group.name, lang)} first={groupIndex === 0}>
                {group.items.map(({ window, title }, index) => (
                  <WindowRow key={window.label} window={window} title={localizeWindowName(title, lang)} pace={paceOf(window, now)} index={offset + index} stale={stale} animateFill={animateFill} />
                ))}
              </CardSection>
            );
          })
        : null}

      {/* Details 展开在开关行的上方: 悬浮卡片底边贴着圆环, 往上长, 刚点过的开关行就留在指针下面不跑 */}
      <Collapse open={detailsOpen}>
        {codex ? <CodexSections onUsageChanged={onRefresh} /> : null}
        <ActivitySection providerId={usage.providerId} />
      </Collapse>

      {/* 开关与刷新都是整行可点的原生行, 悬停反馈与 BB 一致 */}
      <div className="mt-2 border-t border-border pt-1">
        <CardRow
          leading={
            // 收起时箭头朝上 (内容会在上方出现), 展开后朝下
            <Icon
              name="ChevronRight"
              aria-hidden={true}
              className={cn("size-3.5 shrink-0 text-muted-foreground", detailsOpen ? "rotate-90" : "-rotate-90")}
              style={{ transition: transition(reduced, [["transform", DURATION.fast]]) }}
            />
          }
          label={detailsOpen ? t.hideDetails : t.details}
          trailing={detailsOpen ? undefined : codex ? t.detailsSummaryCodex : t.detailsSummary}
          onClick={() => setDetailsOpen(!detailsOpen)}
        />
        <CardRow
          leading={
            <Icon
              name="RotateCcw"
              aria-hidden={true}
              className={cn("size-3.5 shrink-0 text-muted-foreground", refreshing && "animate-spin [animation-direction:reverse] motion-reduce:animate-none")}
            />
          }
          label={refreshing ? t.refreshing : t.refresh}
          trailing={<span className={cn(error && "text-destructive-text")}>{updatedCopy(t, lang, now, updatedAt, error)}</span>}
          onClick={onRefresh}
        />
      </div>
    </div>
  );
}
