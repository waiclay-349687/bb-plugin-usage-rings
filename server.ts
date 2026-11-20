/**
 * [INPUT]: 依赖 @get-bb/plugin-sdk 的 BbPluginApi (rpc、events、sdk.providers / hosts / system、log);
 *          依赖 lib/usage-sources (汇总全部 BB 用量来源)、lib/antigravity、lib/token-totals、lib/codex-account; 依赖 lib/preferences 的默认值、范围与校验; 依赖 rpc.ts 与 lib/usage-protocol 的契约
 * [OUTPUT]: 对外提供插件后端入口 (default export): 全部偏好的插件设置 (language / warnThreshold / dangerThreshold / resetUnlockThreshold / antigravityEnabled /
 *           refreshIntervalMinutes / defaultDetailsOpen / hiddenProviders); 私有 RPC limits / token_totals / codex_account / codex_use_reset / preferences / set_preferences / reset_preferences,
 *           以及一个可被发现的 BB 用量来源 (Antigravity), BB 自带用量卡片与本插件的圆环都能读到
 * [POS]: 插件后端; 消费者: bb 宿主、hooks/use-usage-limits.ts、components/sections.tsx、BB 自带 Provider usage 卡片 (经用量协议)
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createAntigravityUsage } from "./lib/antigravity.ts";
import { createCodexAccount } from "./lib/codex-account.ts";
import { createTokenTotals } from "./lib/token-totals.ts";
import { USAGE_GET, USAGE_LIST, usageSourceContract, type UsageResource } from "./lib/usage-protocol.ts";
import { createUsageSources } from "./lib/usage-sources.ts";
import { DEFAULT_PREFERENCES, normalizePreferences, PREFERENCE_KEYS, PREFERENCE_RANGES, toSettingValues, SETTING_LABELS, type Preferences } from "./lib/preferences.ts";
import { rpcContract } from "./rpc.ts";

const ANTIGRAVITY_RESOURCE = "antigravity";

export default async function plugin(bb: BbPluginApi) {
  // 全部偏好都在宿主插件设置里: 设置页的偏好面板与 `bb plugin config usage-rings set <key> <value>` 写的是同一组值;
  // 宿主自动生成的英文表单在设置页里被本插件的双语面板替代 (见 components/settings-chrome.ts), CLI 仍可用
  const range = (key: keyof typeof PREFERENCE_RANGES) => z.number().int().min(PREFERENCE_RANGES[key].min).max(PREFERENCE_RANGES[key].max);
  const settings = bb.settings.define({
    language: {
      type: "select",
      label: SETTING_LABELS.language,
      description: "auto follows bb's language (zh* → Chinese, otherwise English).",
      options: ["auto", "en", "zh"],
      experimental_optionLabels: { auto: "Auto", en: "English", zh: "简体中文" },
      default: DEFAULT_PREFERENCES.language,
    },
    warnThreshold: {
      type: "number",
      label: SETTING_LABELS.warnThreshold,
      description: "Rings and bars turn amber at this share used (40-95).",
      experimental_schema: range("warnThreshold"),
      default: DEFAULT_PREFERENCES.warnThreshold,
    },
    dangerThreshold: {
      type: "number",
      label: SETTING_LABELS.dangerThreshold,
      description: "Rings and bars turn red at this share used (50-100, never below the amber threshold).",
      experimental_schema: range("dangerThreshold"),
      default: DEFAULT_PREFERENCES.dangerThreshold,
    },
    resetUnlockThreshold: {
      type: "number",
      label: SETTING_LABELS.resetUnlockThreshold,
      description: "A banked Codex reset can be used once a limit reaches this share used (50-100). The server re-checks it before every reset.",
      experimental_schema: range("resetUnlockThreshold"),
      default: DEFAULT_PREFERENCES.resetUnlockThreshold,
    },
    antigravityEnabled: {
      type: "boolean",
      label: SETTING_LABELS.antigravityEnabled,
      description: "Offer Google Antigravity usage read from the local agy CLI (read-only, spends no tokens).",
      default: DEFAULT_PREFERENCES.antigravityEnabled,
    },
    refreshIntervalMinutes: {
      type: "number",
      label: SETTING_LABELS.refreshIntervalMinutes,
      description: "How often the rings re-read usage in the background (1-60).",
      experimental_schema: range("refreshIntervalMinutes"),
      default: DEFAULT_PREFERENCES.refreshIntervalMinutes,
    },
    defaultDetailsOpen: {
      type: "boolean",
      label: SETTING_LABELS.defaultDetailsOpen,
      description: "Whether the hover card starts with Details open.",
      default: DEFAULT_PREFERENCES.defaultDetailsOpen,
    },
    hiddenProviders: {
      type: "string",
      label: SETTING_LABELS.hiddenProviders,
      description: "Comma-separated provider ids whose rings are hidden from the sidebar (the settings page still shows them).",
      default: "",
    },
  });
  const preferences = async (): Promise<Preferences> => normalizePreferences(await settings.get());

  const totals = createTokenTotals(bb);
  const codex = createCodexAccount(async () => (await preferences()).resetUnlockThreshold);
  const sources = createUsageSources(bb);
  const antigravity = createAntigravityUsage();

  // 线程跑完一轮就标记过期, 下次读取时增量同步
  bb.events.on("thread.idle", totals.markDirty);
  bb.events.on("thread.failed", totals.markDirty);
  totals.kick(); // 启动时就开始首次回填, 第一次悬停卡片时多半已就绪

  bb.rpc.register(rpcContract, {
    async limits({ refresh }) {
      return sources.read(refresh);
    },
    async token_totals() {
      totals.kick();
      return totals.snapshot();
    },
    async codex_account({ refresh }) {
      return codex.read(refresh);
    },
    async preferences() {
      return preferences();
    },
    async set_preferences(patch) {
      // 合并后整体校验再写: 越界值夹回范围, 红色阈值不低于橙色阈值
      const next = normalizePreferences({ ...(await preferences()), ...patch });
      await settings.experimental_set(toSettingValues(next));
      return preferences();
    },
    async reset_preferences() {
      await settings.experimental_set(Object.fromEntries(PREFERENCE_KEYS.map((key) => [key, null])));
      return preferences();
    },
    async codex_use_reset(input) {
      const outcome = await codex.consume(input);
      bb.log.info(`codex reset: ${outcome}`);
      return { outcome };
    },
  });

  /** BB 里注册了 Antigravity 提供方才提供资源; id 以 BB 为准 (官方注册表是 acp-antigravity, 手动添加的可能不同) */
  async function antigravityResource(): Promise<UsageResource | null> {
    const [providers, config, hosts] = await Promise.all([
      bb.sdk.providers.list().catch(() => []),
      bb.sdk.system.config().catch(() => null),
      bb.sdk.hosts.list().catch(() => []),
    ]);
    if (!(await preferences()).antigravityEnabled) return null;
    const provider = providers.find((p) => /antigravity/i.test(p.id));
    if (!provider) return null;
    const primaryHostId = (config as { primaryHostId?: string | null } | null)?.primaryHostId ?? null;
    const host = hosts.find((h) => h.id === primaryHostId);
    return {
      accountKey: null,
      id: ANTIGRAVITY_RESOURCE,
      providerId: provider.id,
      label: provider.displayName,
      // agy 跑在 BB 服务所在的机器上, 即主机
      scope: host ? { kind: "host", hostId: host.id, hostName: host.name } : { kind: "shared" },
    };
  }

  bb.rpc.register(
    usageSourceContract,
    {
      async [USAGE_LIST]() {
        const resource = await antigravityResource();
        return { resources: resource ? [resource] : [] };
      },
      async [USAGE_GET]({ resourceId, refresh }) {
        if (resourceId !== ANTIGRAVITY_RESOURCE || !(await preferences()).antigravityEnabled) throw new Error("Unknown usage resource.");
        const { usage, observedAt } = await antigravity.read(refresh);
        return { accountKey: null, observedAt, usage };
      },
    },
    {
      experimental_discoverable: true,
      experimental_description: "Google Antigravity quota from the local agy CLI (read-only /usage; spends no tokens). Owned by Usage Rings.",
    },
  );
}
