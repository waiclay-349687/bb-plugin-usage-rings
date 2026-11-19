/**
 * [INPUT]: 依赖 @get-bb/plugin-sdk/app 的 experimental_useProviders (BB 已注册的提供方: 名称、图标、品牌色)
 * [OUTPUT]: 对外提供 useProviderPresentation: providerId → 卡片与圆环要用的名称和图标信息
 * [POS]: components 的提供方展示信息来源, 名称图标一律以 BB 为准; 消费者: rail-rings.tsx、settings-overview.tsx
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { experimental_useProviders as useProviders } from "@get-bb/plugin-sdk/app";
import type { ProviderPresentation } from "./usage-card.tsx";

/** 提供方插件未加载时的兜底名称 */
const FALLBACK_NAMES: Record<string, string> = { codex: "Codex", "claude-code": "Claude Code" };

export function useProviderPresentation(): (providerId: string) => ProviderPresentation {
  const { providers } = useProviders();
  return (providerId) => {
    const info = providers.find((p) => p.id === providerId);
    return {
      id: providerId,
      name: info?.displayName ?? FALLBACK_NAMES[providerId] ?? providerId,
      logoUrl: info?.logoUrl ?? null,
      icon: info?.icon ?? null,
      strings: info?.strings?.iconTint ? { iconTint: info.strings.iconTint } : null,
    };
  };
}
