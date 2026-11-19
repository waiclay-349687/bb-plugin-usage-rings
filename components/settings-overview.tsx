/**
 * [INPUT]: 依赖 hooks/use-usage-limits 的额度数据、components/presentation 的提供方名称、components/usage-card 的卡片
 * [OUTPUT]: 对外提供 SettingsOverview: 插件设置页里的总览, 每个提供方一张 UsageCard (外壳与悬浮卡片同款, 只是不带阴影)
 * [POS]: components 的设置页视图, 与悬浮卡片共用同一套卡片, 改一处两处都变; 消费者: app.tsx (settingsSection)
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useNow, useUsageLimits } from "../hooks/use-usage-limits.ts";
import { useProviderPresentation } from "./presentation.ts";
import { UsageCard } from "./usage-card.tsx";

export function SettingsOverview() {
  const limits = useUsageLimits();
  const now = useNow(30_000);
  const present = useProviderPresentation();

  if (limits.providers.length === 0) {
    return <p className="text-xs text-muted-foreground">{limits.refreshing ? "Loading usage…" : "No provider reports plan limits on this machine."}</p>;
  }
  return (
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
  );
}
