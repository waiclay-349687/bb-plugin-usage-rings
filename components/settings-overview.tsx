/**
 * [INPUT]: 依赖 hooks/use-usage-limits 的额度数据、hooks/use-language 的语言状态与切换、components/presentation 的提供方名称、components/usage-card 的卡片;
 *          依赖 lib/i18n 的语言名; 依赖 components/control 的 BB ghost 按钮样式
 * [OUTPUT]: 对外提供 SettingsOverview: 插件设置页里的语言切换器 (自动 / English / 简体中文) + 总览, 每个提供方一张 UsageCard (外壳与悬浮卡片同款, 只是不带阴影)
 * [POS]: components 的设置页视图, 与悬浮卡片共用同一套卡片, 改一处两处都变; 消费者: app.tsx (settingsSection)
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { LANGUAGE_NATIVE_NAMES, LANGUAGE_SETTINGS, type LanguageSetting } from "../lib/i18n.ts";
import { cn } from "../lib/utils.ts";
import { useI18n, useLanguageSync, useSetLanguage } from "../hooks/use-language.ts";
import { useNow, useUsageLimits } from "../hooks/use-usage-limits.ts";
import { GHOST_CONTROL } from "./control.ts";
import { useProviderPresentation } from "./presentation.ts";
import { UsageCard } from "./usage-card.tsx";

function LanguageSwitcher() {
  const { t, setting } = useI18n();
  const setLanguage = useSetLanguage();
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
            onClick={() => setLanguage(option)}
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

export function SettingsOverview() {
  useLanguageSync();
  const { t } = useI18n();
  const limits = useUsageLimits();
  const now = useNow(30_000);
  const present = useProviderPresentation();

  return (
    <div>
      <LanguageSwitcher />
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
