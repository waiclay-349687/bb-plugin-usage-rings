/**
 * [INPUT]: 无外部依赖 (纯函数)
 * [OUTPUT]: 对外提供 Lang / LanguageSetting / LANGUAGE_SETTINGS / resolveLanguage / formatSpan / localizeWindowName / MESSAGES / Messages:
 *           语言判定 (auto 按宿主语言, zh* → zh, 其余 → en)、两套界面文案、按语言格式化时长与通用窗口名
 * [POS]: lib 的文案唯一真相源; 界面上的每一个字都从这里取, 英文模式不出现汉字, 中文模式不出现英文界面词 (品牌与模型名除外);
 *        消费者: lib/usage.ts (配速文案)、hooks/use-language.ts、components/*、test/i18n.test.ts; 与 hooks/use-language 的边界: 这里不碰 DOM 与存储
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */

export type Lang = "en" | "zh";
export type LanguageSetting = "auto" | Lang;
export const LANGUAGE_SETTINGS: readonly LanguageSetting[] = ["auto", "en", "zh"];

/** 语言切换器里每种语言用它自己的写法 (行业惯例: 看不懂当前语言的人也认得出自己的语言), 不属于界面文案, 不受零混用约束 */
export const LANGUAGE_NATIVE_NAMES: Record<Lang, string> = { en: "English", zh: "简体中文" };

export function isLanguageSetting(value: unknown): value is LanguageSetting {
  return typeof value === "string" && (LANGUAGE_SETTINGS as readonly string[]).includes(value);
}

/** auto 时看宿主语言 (<html lang> 优先, 其次浏览器语言): zh 开头为中文, 其余一律英文 */
export function resolveLanguage(setting: unknown, hostLanguage: string | null | undefined): Lang {
  if (setting === "en" || setting === "zh") return setting;
  return (hostLanguage ?? "").trim().toLowerCase().startsWith("zh") ? "zh" : "en";
}

const MINUTE_MS = 60_000;

/** en: 4d 23h / 2h 5m / 35m / <1m; zh: 4 天 23 小时 / 2 小时 5 分钟 / 35 分钟 / 不到 1 分钟; units = 1 只留最大单位, 用在窄处 */
export function formatSpan(ms: number, lang: Lang, units: 1 | 2 = 2): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / MINUTE_MS);
  if (totalMinutes < 1) return lang === "zh" ? "不到 1 分钟" : "<1m";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const unit = lang === "zh" ? { d: " 天", h: " 小时", m: " 分钟" } : { d: "d", h: "h", m: "m" };
  const parts =
    days > 0 ? [`${days}${unit.d}`, `${hours}${unit.h}`] : hours > 0 ? [`${hours}${unit.h}`, `${minutes}${unit.m}`] : [`${minutes}${unit.m}`];
  return parts.slice(0, units).join(" ");
}

/** 协议与后端返回的通用窗口词 (不含品牌/模型名) 在中文模式下的译法; 词边界匹配, "Weekly (Sonnet)" → "每周 (Sonnet)" */
const WINDOW_WORDS_ZH: [RegExp, string][] = [
  [/\b(?:5|five)[- ]?(?:hours?|h)\b/gi, "5 小时"],
  [/\bcurrent session\b/gi, "当前会话"],
  [/\bsession\b/gi, "当前会话"],
  [/\bweekly\b/gi, "每周"],
  [/\bdaily\b/gi, "每日"],
  [/\bmonthly\b/gi, "每月"],
  [/\blimit\b/gi, "限额"],
];

export function localizeWindowName(name: string, lang: Lang): string {
  if (lang === "en") return name;
  return WINDOW_WORDS_ZH.reduce((text, [pattern, zh]) => text.replace(pattern, zh), name).replace(/\s{2,}/g, " ").trim();
}

export interface Messages {
  // 卡片
  limits: string;
  resets: string;
  credits: string;
  balance: string;
  unlimited: string;
  activity: string;
  details: string;
  hideDetails: string;
  detailsSummaryCodex: string;
  detailsSummary: string;
  refresh: string;
  refreshing: string;
  refreshFailed: string;
  notUpdated: string;
  updatedJustNow: string;
  updatedAgo(span: string): string;
  loadFailed: string;
  staleNote(message: string): string;
  // 窗口与配速
  usedPercent(percent: number): string;
  resetsIn(span: string): string;
  resetUnknown: string;
  meterLabel(title: string): string;
  evenPace: string;
  limitReached: string;
  backIn(span: string): string;
  onPace: string;
  deficit(percent: number): string;
  reserve(percent: number): string;
  lastsUntilReset: string;
  runsOutIn(span: string): string;
  // 重置与点数
  readingAccount: string;
  accountUnavailable(message: string): string;
  available(count: number): string;
  hintLocked(threshold: number, peak: number | null): string;
  hintReady(peak: number): string;
  unconfirmedReset: string;
  resetN(n: number): string;
  nextReset: string;
  expiresIn(span: string): string;
  unlocksAt(threshold: number): string;
  use: string;
  confirm: string;
  applying: string;
  retry: string;
  outcomeReset: string;
  outcomeNothingToReset: string;
  outcomeNoCredit: string;
  outcomeAlreadyRedeemed: string;
  retryPreviousFirst: string;
  resetNotConfirmed: string;
  resetNotConfirmedDetail(reason: string): string;
  // 活跃统计
  bbSessions: string;
  counting: string;
  countingSessions: string;
  activityUnavailable: string;
  activityError(message: string): string;
  period: Record<"24h" | "7d" | "30d", string>;
  activityValue(tokens: string, sessions: number): string;
  // 圆环
  ringAria(provider: string, label: string): string;
  ringLabel(title: string, percent: number): string;
  noLimitReported: string;
  refreshFailedSuffix: string;
  ringsGroup: string;
  cardAria(provider: string): string;
  // 设置页
  settingsTitle: string;
  settingsDescription: string;
  loadingUsage: string;
  noProviders: string;
  language: string;
  languageAuto: string;
  languageHint: string;
}

const en: Messages = {
  limits: "Limits",
  resets: "Resets",
  credits: "Credits",
  balance: "Balance",
  unlimited: "Unlimited",
  activity: "Activity",
  details: "Details",
  hideDetails: "Hide details",
  detailsSummaryCodex: "Resets · Credits · Activity",
  detailsSummary: "Activity",
  refresh: "Refresh",
  refreshing: "Refreshing…",
  refreshFailed: "Refresh failed",
  notUpdated: "Not updated yet",
  updatedJustNow: "Updated just now",
  updatedAgo: (span) => `Updated ${span} ago`,
  loadFailed: "Usage could not be loaded.",
  staleNote: (message) => `${message} Showing the last reading.`,
  usedPercent: (percent) => `${percent}% used`,
  resetsIn: (span) => `Resets in ${span}`,
  resetUnknown: "Reset time not reported",
  meterLabel: (title) => `${title} used`,
  evenPace: "Even pace",
  limitReached: "Limit reached",
  backIn: (span) => `Back in ${span}`,
  onPace: "On pace",
  deficit: (percent) => `${percent}% in deficit`,
  reserve: (percent) => `${percent}% in reserve`,
  lastsUntilReset: "Lasts until reset",
  runsOutIn: (span) => `Runs out in ${span}`,
  readingAccount: "Reading Codex account…",
  accountUnavailable: (message) => `Codex account details are unavailable: ${message}`,
  available: (count) => `${count} available`,
  hintLocked: (threshold, peak) => `A limit must reach ${threshold}%${peak === null ? "" : ` · now ${peak}%`}`,
  hintReady: (peak) => `Limit at ${peak}% · resets are ready to use`,
  unconfirmedReset: "Unconfirmed reset",
  resetN: (n) => `Reset ${n}`,
  nextReset: "Next reset",
  expiresIn: (span) => `expires in ${span}`,
  unlocksAt: (threshold) => `Unlocks at ${threshold}%`,
  use: "Use",
  confirm: "Confirm",
  applying: "Applying…",
  retry: "Retry",
  outcomeReset: "Codex limits reset.",
  outcomeNothingToReset: "Codex limits do not need a reset right now.",
  outcomeNoCredit: "No banked resets available.",
  outcomeAlreadyRedeemed: "That reset was already used.",
  retryPreviousFirst: "Retry the previous reset before choosing another one.",
  resetNotConfirmed: "Reset result not confirmed",
  resetNotConfirmedDetail: (reason) => `${reason}Retry the same attempt; it will not spend a second reset.`,
  bbSessions: "BB sessions",
  counting: "counting…",
  countingSessions: "Counting BB sessions…",
  activityUnavailable: "Activity is unavailable.",
  activityError: (message) => message,
  period: { "24h": "24h", "7d": "7d", "30d": "30d" },
  activityValue: (tokens, sessions) => `${tokens} tokens · ${sessions === 1 ? "1 session" : `${sessions} sessions`}`,
  ringAria: (provider, label) => `${provider} usage: ${label}`,
  ringLabel: (title, percent) => `${title} ${percent}% used`,
  noLimitReported: "No limit reported",
  refreshFailedSuffix: ", refresh failed",
  ringsGroup: "Agent usage limits",
  cardAria: (provider) => `${provider} usage`,
  settingsTitle: "Usage",
  settingsDescription: "Every provider that reports plan limits, with pace, resets and activity.",
  loadingUsage: "Loading usage…",
  noProviders: "No provider reports plan limits on this machine.",
  language: "Language",
  languageAuto: "Auto",
  languageHint: "Auto follows bb's language.",
};

// 中文模式下, 后端或宿主给的英文原文 (错误信息等) 一律不显示, 换成中文的概括说法
const zh: Messages = {
  limits: "限额",
  resets: "重置次数",
  credits: "额度点数",
  balance: "余额",
  unlimited: "不限量",
  activity: "活跃统计",
  details: "详情",
  hideDetails: "收起详情",
  detailsSummaryCodex: "重置次数 · 额度点数 · 活跃统计",
  detailsSummary: "活跃统计",
  refresh: "刷新",
  refreshing: "刷新中…",
  refreshFailed: "刷新失败",
  notUpdated: "尚未更新",
  updatedJustNow: "刚刚更新",
  updatedAgo: (span) => `${span}前更新`,
  loadFailed: "用量读取失败。",
  staleNote: () => "刷新失败，显示的是上次读数。",
  usedPercent: (percent) => `已用 ${percent}%`,
  resetsIn: (span) => `${span}后重置`,
  resetUnknown: "未提供重置时间",
  meterLabel: (title) => `${title}已用`,
  evenPace: "匀速刻度",
  limitReached: "已用完",
  backIn: (span) => `${span}后恢复`,
  onPace: "进度正常",
  deficit: (percent) => `超前消耗 ${percent}%`,
  reserve: (percent) => `富余 ${percent}%`,
  lastsUntilReset: "可持续至重置",
  runsOutIn: (span) => `预计 ${span}后用完`,
  readingAccount: "正在读取 Codex 账户…",
  accountUnavailable: () => "暂时读不到 Codex 账户详情。",
  available: (count) => `${count} 次可用`,
  hintLocked: (threshold, peak) => `限额需达到 ${threshold}%${peak === null ? "" : ` · 当前 ${peak}%`}`,
  hintReady: (peak) => `限额已达 ${peak}% · 可以使用重置`,
  unconfirmedReset: "未确认的重置",
  resetN: (n) => `重置 ${n}`,
  nextReset: "下一次重置",
  expiresIn: (span) => `${span}后过期`,
  unlocksAt: (threshold) => `达到 ${threshold}% 解锁`,
  use: "使用",
  confirm: "确认使用",
  applying: "执行中…",
  retry: "重试",
  outcomeReset: "Codex 限额已重置。",
  outcomeNothingToReset: "Codex 限额暂时不需要重置。",
  outcomeNoCredit: "没有可用的重置次数。",
  outcomeAlreadyRedeemed: "这次重置已经用过了。",
  retryPreviousFirst: "请先重试上一次未确认的重置。",
  resetNotConfirmed: "重置结果未确认",
  resetNotConfirmedDetail: () => "重试同一次操作，不会再扣一次重置。",
  bbSessions: "BB 会话",
  counting: "统计中…",
  countingSessions: "正在统计 BB 会话…",
  activityUnavailable: "活跃统计暂不可用。",
  activityError: () => "活跃统计出错，稍后会重试。",
  period: { "24h": "24 小时", "7d": "7 天", "30d": "30 天" },
  activityValue: (tokens, sessions) => `${tokens} 词元 · ${sessions} 次会话`,
  ringAria: (provider, label) => `${provider} 用量：${label}`,
  ringLabel: (title, percent) => `${title}已用 ${percent}%`,
  noLimitReported: "未上报限额",
  refreshFailedSuffix: "，刷新失败",
  ringsGroup: "各提供方用量限额",
  cardAria: (provider) => `${provider} 用量`,
  settingsTitle: "用量概览",
  settingsDescription: "所有上报套餐限额的提供方，含配速、重置次数与活跃统计。",
  loadingUsage: "正在加载用量…",
  noProviders: "本机没有提供方上报套餐限额。",
  language: "语言",
  languageAuto: "自动",
  languageHint: "自动：跟随 BB 的界面语言。",
};

export const MESSAGES: Record<Lang, Messages> = { en, zh };
