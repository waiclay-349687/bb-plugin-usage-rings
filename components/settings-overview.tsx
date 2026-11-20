/**
 * [INPUT]: 依赖 hooks/use-usage-limits 的额度数据、hooks/use-preferences 的偏好读写、hooks/use-language 的文案、hooks/use-motion 的减少动态效果;
 *          依赖 lib/preferences 的范围与默认值、lib/i18n 的语言名; 依赖 components/presentation、usage-card、collapse、settings-chrome、control
 * [OUTPUT]: 对外提供 SettingsOverview: 插件设置页 = 语言切换器 + 可折叠的「偏好设置」面板 (全部可配置项 + 恢复默认) + 每个提供方一张 UsageCard
 * [POS]: components 的设置页视图: 宿主自动生成的英文设置表单由 settings-chrome 藏起, 这里是唯一的双语配置界面; 与悬浮卡片共用同一套卡片;
 *        消费者: app.tsx (settingsSection)
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useEffect, useState, type ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { LANGUAGE_NATIVE_NAMES, LANGUAGE_SETTINGS, type LanguageSetting } from "../lib/i18n.ts";
import { DURATION, transition } from "../lib/motion.ts";
import { PREFERENCE_RANGES, type Preferences } from "../lib/preferences.ts";
import { cn } from "../lib/utils.ts";
import { useI18n } from "../hooks/use-language.ts";
import { useReducedMotion } from "../hooks/use-motion.ts";
import { usePreferences, usePreferencesSync, useUpdatePreferences } from "../hooks/use-preferences.ts";
import { useNow, useUsageLimits, type UsageLimitsState } from "../hooks/use-usage-limits.ts";
import { Collapse } from "./collapse.tsx";
import { GHOST_CONTROL } from "./control.ts";
import { useProviderPresentation } from "./presentation.ts";
import { useHostSettingsChrome } from "./settings-chrome.ts";
import { UsageCard } from "./usage-card.tsx";

const PANEL_KEY = "bb-plugin-usage-rings:preferences-open:v1";

function LanguageSwitcher() {
  const { t, setting } = useI18n();
  const { update } = useUpdatePreferences();
  // 语言名用各自的写法 (行业惯例), "自动"跟随当前界面语言
  const label = (option: LanguageSetting) => (option === "auto" ? t.languageAuto : LANGUAGE_NATIVE_NAMES[option]);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
      <span className="font-medium text-foreground">{t.language}</span>
      <div role="radiogroup" aria-label={t.language} className="inline-flex rounded-md border p-0.5">
        {LANGUAGE_SETTINGS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={setting === option}
            onClick={() => update({ language: option })}
            className={cn(GHOST_CONTROL, "h-6 rounded-sm px-2 text-xs font-normal", setting === option && "bg-state-active text-foreground")}
          >
            {label(option)}
          </button>
        ))}
      </div>
      <span className="text-muted-foreground">{t.languageHint}</span>
    </div>
  );
}

/** 一行: 左标签 (下附说明), 右控件 */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3 py-1">
      <div className="min-w-0">
        <div className="text-xs text-foreground">{label}</div>
        {hint ? <div className="text-[11px] leading-4 text-muted-foreground">{hint}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** 数字: − / 输入框 / +; 输入时只改草稿, 失焦或回车才提交 (提交值经同一套规则夹回范围) */
function NumberField({ value, min, max, step, unit, label, onCommit }: { value: number; min: number; max: number; step: number; unit: string; label: string; onCommit(v: number): void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n)) return setDraft(String(value));
    onCommit(n);
  };
  const button = "h-6 w-6 rounded-sm p-0 text-xs";
  return (
    <div className="inline-flex items-center gap-1 tabular-nums">
      <button type="button" aria-label={`${label} −`} disabled={value <= min} onClick={() => onCommit(value - step)} className={cn(GHOST_CONTROL, button)}>
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        max={max}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && commit(event.currentTarget.value)}
        className="h-6 w-12 rounded-sm border bg-background px-1 text-center text-xs text-foreground [appearance:textfield] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button type="button" aria-label={`${label} +`} disabled={value >= max} onClick={() => onCommit(value + step)} className={cn(GHOST_CONTROL, button)}>
        +
      </button>
      <span className="w-10 text-[11px] text-muted-foreground">{unit}</span>
    </div>
  );
}

function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange(v: boolean): void }) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={checked ? t.on : t.off}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors", checked ? "border-transparent bg-primary" : "bg-muted")}
      style={{ transition: transition(reduced, [["background-color", DURATION.fast]]) }}
    >
      <span
        aria-hidden="true"
        className="block size-4 rounded-full bg-background shadow-sm"
        style={{ transform: `translateX(${checked ? 17 : 1}px)`, transition: transition(reduced, [["transform", DURATION.fast]]) }}
      />
    </button>
  );
}

function PreferencesPanel({ limits }: { limits: UsageLimitsState }) {
  const { t } = useI18n();
  const prefs = usePreferences();
  const { update, reset } = useUpdatePreferences();
  const present = useProviderPresentation();
  const reduced = useReducedMotion();
  const [open, setOpenState] = useState(() => {
    try {
      return localStorage.getItem(PANEL_KEY) === "1";
    } catch {
      return false;
    }
  });
  const setOpen = (next: boolean) => {
    setOpenState(next);
    try {
      localStorage.setItem(PANEL_KEY, next ? "1" : "0");
    } catch {
      // 只影响下次打开时的折叠状态
    }
  };
  const set = (patch: Partial<Preferences>) => update(patch);
  const percent = (key: "warnThreshold" | "dangerThreshold" | "resetUnlockThreshold", label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <NumberField value={prefs[key]} min={PREFERENCE_RANGES[key].min} max={PREFERENCE_RANGES[key].max} step={5} unit="%" label={label} onCommit={(v) => set({ [key]: v })} />
    </Field>
  );
  // 已上报的提供方 + 被隐藏但这次没上报的 (仍可取消隐藏)
  const providerIds = [...new Set([...limits.providers.map((u) => u.providerId), ...prefs.hiddenProviders])];

  return (
    <section className="mb-3 rounded-md border bg-popover">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={cn(GHOST_CONTROL, "flex h-auto w-full justify-start gap-2 rounded-md px-3 py-2 text-left")}>
        <Icon
          name="ChevronRight"
          aria-hidden={true}
          className={cn("size-3.5 shrink-0 text-muted-foreground", open && "rotate-90")}
          style={{ transition: transition(reduced, [["transform", DURATION.fast]]) }}
        />
        <span className="text-xs font-medium text-foreground">{t.preferences}</span>
        {open ? null : <span className="min-w-0 truncate text-[11px] font-normal text-muted-foreground">{t.preferencesSummary}</span>}
      </button>
      <Collapse open={open}>
        <div className="grid gap-x-8 border-t px-3 pb-3 pt-1 md:grid-cols-2">
          <div>
            {percent("warnThreshold", t.warnThreshold)}
            {percent("dangerThreshold", t.dangerThreshold, t.dangerHint)}
            {percent("resetUnlockThreshold", t.resetUnlockThreshold, t.resetUnlockHint)}
            <Field label={t.refreshInterval}>
              <NumberField
                value={prefs.refreshIntervalMinutes}
                min={PREFERENCE_RANGES.refreshIntervalMinutes.min}
                max={PREFERENCE_RANGES.refreshIntervalMinutes.max}
                step={1}
                unit={t.minutes(prefs.refreshIntervalMinutes).replace(/^\d+\s*/, "")}
                label={t.refreshInterval}
                onCommit={(v) => set({ refreshIntervalMinutes: v })}
              />
            </Field>
          </div>
          <div>
            <Field label={t.antigravityEnabled} hint={t.antigravityHint}>
              <Switch
                checked={prefs.antigravityEnabled}
                label={t.antigravityEnabled}
                onChange={(v) => {
                  set({ antigravityEnabled: v });
                  // 来源增减要绕过缓存重新汇总, 圆环才会马上出现或消失
                  window.setTimeout(limits.refresh, 300);
                }}
              />
            </Field>
            <Field label={t.defaultDetailsOpen}>
              <Switch checked={prefs.defaultDetailsOpen} label={t.defaultDetailsOpen} onChange={(v) => set({ defaultDetailsOpen: v })} />
            </Field>
            <div className="py-1">
              <div className="text-xs text-foreground">{t.ringsShown}</div>
              <div className="text-[11px] leading-4 text-muted-foreground">{t.ringsShownHint}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {providerIds.length === 0 ? <span className="text-[11px] text-muted-foreground">{t.noProvidersYet}</span> : null}
                {providerIds.map((id) => {
                  const shown = !prefs.hiddenProviders.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      role="checkbox"
                      aria-checked={shown}
                      onClick={() => set({ hiddenProviders: shown ? [...prefs.hiddenProviders, id] : prefs.hiddenProviders.filter((h) => h !== id) })}
                      className={cn(GHOST_CONTROL, "h-6 gap-1.5 rounded-md border px-2 text-xs font-normal", shown ? "text-foreground" : "text-muted-foreground line-through")}
                    >
                      <Icon name={shown ? "Check" : "X"} fallback="Circle" aria-hidden={true} className="size-3" />
                      {present(id).name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="pt-2 md:col-span-2">
            <button type="button" onClick={reset} className={cn(GHOST_CONTROL, "h-7 gap-1.5 rounded-md border px-2.5 text-xs font-normal")}>
              <Icon name="RotateCcw" aria-hidden={true} className="size-3.5" />
              {t.resetDefaults}
            </button>
          </div>
        </div>
      </Collapse>
    </section>
  );
}

export function SettingsOverview() {
  usePreferencesSync();
  useHostSettingsChrome();
  const { t } = useI18n();
  const limits = useUsageLimits();
  const now = useNow(30_000);
  const present = useProviderPresentation();

  return (
    <div data-usage-rings-settings="">
      <LanguageSwitcher />
      <PreferencesPanel limits={limits} />
      {limits.providers.length === 0 ? (
        <p className="text-xs text-muted-foreground">{limits.refreshing ? t.loadingUsage : t.noProviders}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {limits.providers.map((usage) => (
            <div key={usage.providerId} className="rounded-md border bg-popover p-2">
              <UsageCard
                usage={usage}
                provider={present(usage.providerId)}
                now={now}
                updatedAt={limits.updatedAt}
                error={limits.error}
                refreshing={limits.refreshing}
                onRefresh={limits.refresh}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
