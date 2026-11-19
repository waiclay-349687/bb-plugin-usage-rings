/**
 * [INPUT]: 依赖 lib/i18n 的文案与时长格式; 输入是 limits RPC (汇总的 BB 用量来源) 的原始响应
 * [OUTPUT]: 对外提供 normalizeUsage / mergeLastKnown / paceOf / paceCopy / usedTone / paceTone / primaryWindow / formatTokens / windowTitle / groupWindows 及其类型:
 *           把原始响应归一成"提供方 → 额度窗口"视图, 按 Synara 的算法算配速 (已过时间下限 5%, 按窗口结束时预计用量分档); 界面统一按"已用"表达
 * [POS]: lib 的纯逻辑核心, 无 IO、无 React; 配速与配色规则的唯一真相源; 消费者: hooks/use-usage-limits.ts、components/*;
 *        与 components 的边界: 这里只算数和拼文案, 不碰 DOM
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { formatSpan, MESSAGES, type Lang } from "./i18n.ts";

export type WindowKind = "five-hour" | "daily" | "weekly" | "custom";

export interface UsageWindow {
  label: string;
  /** 0..100, 已用百分比 */
  usedPercent: number;
  /** 重置时刻 (epoch ms); 宿主未给出时为 null */
  resetsAt: number | null;
  kind: WindowKind | null;
}

/**
 * 只保留能展示的两种状态; not_installed / unauthenticated / expired 不进视图。
 * staleMessage: 这次读取失败, 窗口是上一次成功的读数 (见 mergeLastKnown)
 */
export type ProviderUsage =
  | { providerId: string; status: "ok"; planLabel: string | null; windows: UsageWindow[]; staleMessage?: string }
  | { providerId: string; status: "error"; planLabel: string | null; message: string };

/** 领先 (预计用量 ≤80%) / 持平 (≤100%) / 落后 (会在重置前用完) */
export type PaceStatus = "ahead" | "on-track" | "behind";
export type Tone = "good" | "warn" | "bad";

export interface Pace {
  /** 0..100, 已用百分比 (界面统一显示"用了多少") */
  usedPercent: number;
  resetsInMs: number | null;
  exhausted: boolean;
  /** 匀速消耗时此刻应已用的百分比 (进度条上的刻度, 即已过时间%); 窗口时长或重置时间未知时为 null */
  expectedUsedPercent: number | null;
  status: PaceStatus | null;
  /** 已用% − 已过时间%: 正数为赤字, 负数为余量 */
  deltaPercent: number | null;
  /** 按当前平均速度会在重置前用完时, 距用完的毫秒数 */
  runsOutInMs: number | null;
}

const MINUTE_MS = 60_000;
const WINDOW_MS: Record<Exclude<WindowKind, "custom">, number> = {
  "five-hour": 300 * MINUTE_MS,
  daily: 1440 * MINUTE_MS,
  weekly: 10080 * MINUTE_MS,
};
const KINDS = new Set<string>(["five-hour", "daily", "weekly", "custom"]);
/** 窗口刚开始时已过时间按至少 5% 计, 避免开头几分钟的少量使用被外推成"马上用完" (Synara 同值) */
const MIN_ELAPSED_FRACTION = 0.05;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function parseWindow(raw: unknown): UsageWindow | null {
  if (!isRecord(raw)) return null;
  const used = raw.usedPercent;
  if (typeof used !== "number" || !Number.isFinite(used)) return null;
  const resetsAt = typeof raw.resetsAt === "string" ? Date.parse(raw.resetsAt) : Number.NaN;
  return {
    label: textOrNull(raw.label) ?? "Limit",
    usedPercent: Math.min(100, Math.max(0, used)),
    resetsAt: Number.isFinite(resetsAt) ? resetsAt : null,
    kind: typeof raw.kind === "string" && KINDS.has(raw.kind) ? (raw.kind as WindowKind) : null,
  };
}

/** 宿主响应是不可信输入: 逐字段校验, 坏条目直接丢弃, 保持响应里的提供方顺序 */
export function normalizeUsage(raw: unknown): ProviderUsage[] {
  if (!isRecord(raw)) return [];
  const result: ProviderUsage[] = [];
  for (const [providerId, entry] of Object.entries(raw)) {
    if (!isRecord(entry)) continue;
    const planLabel = textOrNull(entry.planLabel);
    if (entry.status === "ok") {
      const windows = Array.isArray(entry.windows)
        ? entry.windows.map(parseWindow).filter((w): w is UsageWindow => w !== null)
        : [];
      if (windows.length > 0) result.push({ providerId, status: "ok", planLabel, windows });
    } else if (entry.status === "error") {
      result.push({ providerId, status: "error", planLabel, message: textOrNull(entry.message) ?? "Usage could not be loaded." });
    }
  }
  return result;
}

/** 某提供方这次读取出错时, 沿用上一次成功的窗口并标记过期, 而不是把读数清空 */
export function mergeLastKnown(previous: readonly ProviderUsage[], next: readonly ProviderUsage[]): ProviderUsage[] {
  return next.map((entry) => {
    if (entry.status !== "error") return entry;
    const last = previous.find((p) => p.providerId === entry.providerId);
    if (last?.status !== "ok") return entry;
    return { ...last, planLabel: entry.planLabel ?? last.planLabel, staleMessage: entry.message };
  });
}

export function paceOf(window: UsageWindow, now: number): Pace {
  const used = window.usedPercent;
  const exhausted = used >= 100;
  const resetsInMs = window.resetsAt === null ? null : Math.max(0, window.resetsAt - now);
  const durationMs = window.kind === null || window.kind === "custom" ? null : WINDOW_MS[window.kind];
  const unknown: Pace = { usedPercent: used, resetsInMs, exhausted, expectedUsedPercent: null, status: null, deltaPercent: null, runsOutInMs: null };
  if (durationMs === null || resetsInMs === null || window.resetsAt === null) return unknown;

  const elapsedMs = durationMs - resetsInMs;
  if (elapsedMs <= 0 || resetsInMs <= 0) return unknown;

  const elapsedFraction = Math.max(elapsedMs / durationMs, MIN_ELAPSED_FRACTION);
  const elapsedPercent = elapsedFraction * 100;
  // 按窗口内平均速度外推: 窗口结束时预计用掉多少
  const projectedPercent = used === 0 ? 0 : used / elapsedFraction;
  const deltaPercent = used - elapsedPercent;
  const status: PaceStatus = exhausted
    ? "behind"
    : isOnPace(deltaPercent)
      ? "on-track"
      : used === 0 || projectedPercent <= 80
        ? "ahead"
        : projectedPercent <= 100
          ? "on-track"
          : "behind";

  let runsOutInMs: number | null = null;
  if (status === "behind" && !exhausted) {
    const percentPerMs = projectedPercent / durationMs;
    const remainingMs = (100 - used) / percentPerMs;
    if (remainingMs > 0 && remainingMs < resetsInMs) runsOutInMs = remainingMs;
  }

  return {
    usedPercent: used,
    resetsInMs,
    exhausted,
    expectedUsedPercent: elapsedPercent,
    status,
    deltaPercent,
    runsOutInMs,
  };
}

/** 余量/赤字四舍五入为 0 即匀速: 文案 "On pace" 与判定共用这一条, 不会一边写匀速一边染警示色、算用完时间 */
function isOnPace(deltaPercent: number): boolean {
  return Math.round(Math.abs(deltaPercent)) === 0;
}

/** 进度条下面那一行: 左边余量/赤字, 右边结论; 文案按界面语言取 */
export function paceCopy(pace: Pace, lang: Lang = "en"): { amount: string | null; outlook: string | null } {
  const t = MESSAGES[lang];
  if (pace.exhausted) {
    return { amount: t.limitReached, outlook: pace.resetsInMs === null ? null : t.backIn(formatSpan(pace.resetsInMs, lang)) };
  }
  // 算不出配速时不重复标题行里的"已用 N%"
  if (pace.deltaPercent === null || pace.status === null) return { amount: null, outlook: null };
  const rounded = Math.round(Math.abs(pace.deltaPercent));
  const amount = isOnPace(pace.deltaPercent) ? t.onPace : pace.deltaPercent > 0 ? t.deficit(rounded) : t.reserve(rounded);
  if (pace.status !== "behind") return { amount, outlook: t.lastsUntilReset };
  return { amount, outlook: pace.runsOutInMs === null ? null : t.runsOutIn(formatSpan(pace.runsOutInMs, lang)) };
}

/** 环与进度条填充色看用量: 用到 75% 琥珀、90% 红 (即 Synara 的剩 25% / 10%) */
export function usedTone(usedPercent: number): Tone {
  return usedPercent >= 90 ? "bad" : usedPercent >= 75 ? "warn" : "good";
}

/** 配速刻度颜色看配速 */
export function paceTone(status: PaceStatus): Tone {
  return status === "behind" ? "bad" : status === "on-track" ? "warn" : "good";
}

/** 圆环代表最紧的那个窗口: 剩余最少者, 同值取先出现的 */
export function primaryWindow(windows: readonly UsageWindow[]): UsageWindow | null {
  let best: UsageWindow | null = null;
  for (const w of windows) if (best === null || w.usedPercent > best.usedPercent) best = w;
  return best;
}

const COMPACT_SMALL = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const COMPACT_LARGE = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 0 });

/** 10M / 485M / 2B; 百万以下保留一位小数 */
export function formatTokens(tokens: number): string {
  const value = Math.max(0, tokens);
  if (value < 1000) return String(Math.round(value));
  return (value < 1_000_000 ? COMPACT_SMALL : COMPACT_LARGE).format(value);
}

/** "Weekly limit" → "Weekly"; 模型专属窗口 (如 "Fable") 保持原名 */
export function windowTitle(window: UsageWindow): string {
  const stripped = window.label.replace(/\s+limit$/i, "").trim();
  return stripped === "" ? window.label : stripped;
}

export interface WindowGroup {
  /** 分组名 (如 Antigravity 的 "Gemini"); 窗口名不带 " · " 前缀时为 null */
  name: string | null;
  items: { window: UsageWindow; title: string }[];
}

/** "Gemini · 5-hour" 这类带前缀的窗口按前缀分组, 行内只显示后半段; 窄卡片里长标签就不必截断 */
export function groupWindows(windows: UsageWindow[]): WindowGroup[] {
  const groups: WindowGroup[] = [];
  for (const window of windows) {
    const full = windowTitle(window);
    const cut = full.lastIndexOf(" · ");
    const name = cut > 0 ? full.slice(0, cut) : null;
    const item = { window, title: cut > 0 ? full.slice(cut + 3) : full };
    const last = groups.at(-1);
    if (last && last.name === name) last.items.push(item);
    else groups.push({ name, items: [item] });
  }
  return groups;
}
