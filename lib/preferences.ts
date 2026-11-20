/**
 * [INPUT]: 依赖 lib/i18n 的语言设置类型 (纯函数, 无 IO)
 * [OUTPUT]: 对外提供 Preferences / DEFAULT_PREFERENCES / PREFERENCE_RANGES / PREFERENCE_KEYS / normalizePreferences / parseProviderList / toSettingValues / PreferenceSettingValues / SETTING_LABELS:
 *           全部可配置项的默认值、范围与校验 (越界夹取, 红色阈值不低于橙色阈值), 以及与宿主插件设置 (字符串/数字/布尔) 之间的互转
 * [POS]: lib 的偏好唯一真相源; 宿主设置、RPC、前端镜像读到的值都先过 normalizePreferences, 任何一处都拿不到越界值;
 *        消费者: server.ts、hooks/use-preferences.ts、components/settings-overview.tsx、test/preferences.test.ts
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { isLanguageSetting, type LanguageSetting } from "./i18n.ts";

export interface Preferences {
  language: LanguageSetting;
  /** 圆环与进度条变琥珀色的已用百分比 */
  warnThreshold: number;
  /** 变红的已用百分比, 不低于 warnThreshold */
  dangerThreshold: number;
  /** Codex 重置按钮解锁所需的最高窗口已用百分比; 前端按钮与服务端执行前复核都读它 */
  resetUnlockThreshold: number;
  /** 是否提供内置的 Antigravity 用量来源 (本机 agy 的 /usage) */
  antigravityEnabled: boolean;
  /** 前端自动重读额度的间隔 */
  refreshIntervalMinutes: number;
  /** 悬浮卡片默认是否展开 Details */
  defaultDetailsOpen: boolean;
  /** 不在侧边栏显示圆环的提供方 id (设置页总览照常显示) */
  hiddenProviders: string[];
}

export const DEFAULT_PREFERENCES: Preferences = {
  language: "auto",
  warnThreshold: 75,
  dangerThreshold: 90,
  resetUnlockThreshold: 90,
  antigravityEnabled: true,
  refreshIntervalMinutes: 5,
  defaultDetailsOpen: false,
  hiddenProviders: [],
};

export const PREFERENCE_RANGES = {
  warnThreshold: { min: 40, max: 95 },
  dangerThreshold: { min: 50, max: 100 },
  resetUnlockThreshold: { min: 50, max: 100 },
  refreshIntervalMinutes: { min: 1, max: 60 },
} as const;

export const PREFERENCE_KEYS = Object.keys(DEFAULT_PREFERENCES) as (keyof Preferences)[];

type NumberKey = keyof typeof PREFERENCE_RANGES;

function clampInt(value: unknown, key: NumberKey): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_PREFERENCES[key];
  const { min, max } = PREFERENCE_RANGES[key];
  return Math.min(max, Math.max(min, Math.round(n)));
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

/** 逗号分隔的字符串或字符串数组 → 去空白、去重的 id 列表 */
export function parseProviderList(value: unknown): string[] {
  const parts = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const ids = parts.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter((v) => v !== "" && v.length <= 200);
  return [...new Set(ids)];
}

/** 任何来源的原始值 (宿主设置、RPC、本地镜像) 都经这里变成合法偏好 */
export function normalizePreferences(raw: unknown): Preferences {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const warnThreshold = clampInt(r.warnThreshold, "warnThreshold");
  return {
    language: isLanguageSetting(r.language) ? r.language : DEFAULT_PREFERENCES.language,
    warnThreshold,
    // 红色不能先于琥珀出现
    dangerThreshold: Math.max(warnThreshold, clampInt(r.dangerThreshold, "dangerThreshold")),
    resetUnlockThreshold: clampInt(r.resetUnlockThreshold, "resetUnlockThreshold"),
    antigravityEnabled: bool(r.antigravityEnabled, DEFAULT_PREFERENCES.antigravityEnabled),
    refreshIntervalMinutes: clampInt(r.refreshIntervalMinutes, "refreshIntervalMinutes"),
    defaultDetailsOpen: bool(r.defaultDetailsOpen, DEFAULT_PREFERENCES.defaultDetailsOpen),
    hiddenProviders: parseProviderList(r.hiddenProviders),
  };
}

/** 宿主插件设置只存字符串/数字/布尔: 提供方列表存成逗号分隔字符串 */
export type PreferenceSettingValues = Omit<Preferences, "hiddenProviders"> & { hiddenProviders: string };

export function toSettingValues(prefs: Preferences): PreferenceSettingValues {
  return { ...prefs, hiddenProviders: prefs.hiddenProviders.join(",") };
}

/** 宿主插件设置里每一项的英文标签 (server.ts 注册时用); 设置页据此找到宿主自动生成的表单行并换成本插件的双语面板 */
export const SETTING_LABELS: Record<keyof Preferences, string> = {
  language: "Language",
  warnThreshold: "Amber from (% used)",
  dangerThreshold: "Red from (% used)",
  resetUnlockThreshold: "Codex reset unlocks at (% used)",
  antigravityEnabled: "Antigravity source",
  refreshIntervalMinutes: "Refresh every (minutes)",
  defaultDetailsOpen: "Open Details by default",
  hiddenProviders: "Hidden rings",
};
