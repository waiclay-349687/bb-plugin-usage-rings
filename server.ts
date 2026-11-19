/**
 * [INPUT]: 依赖 @get-bb/plugin-sdk 的 BbPluginApi (rpc、events、sdk.providers / hosts / system、log);
 *          依赖 lib/usage-sources (汇总全部 BB 用量来源)、lib/antigravity、lib/token-totals、lib/codex-account; 依赖 rpc.ts 与 lib/usage-protocol 的契约
 * [OUTPUT]: 对外提供插件后端入口 (default export): 插件设置 language (auto / en / zh); 私有 RPC limits / token_totals / codex_account / codex_use_reset / language / set_language,
 *           以及一个可被发现的 BB 用量来源 (Antigravity), BB 自带用量卡片与本插件的圆环都能读到
 * [POS]: 插件后端; 消费者: bb 宿主、hooks/use-usage-limits.ts、components/sections.tsx、BB 自带 Provider usage 卡片 (经用量协议)
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { isLanguageSetting } from "./lib/i18n.ts";
import { createAntigravityUsage } from "./lib/antigravity.ts";
import { createCodexAccount } from "./lib/codex-account.ts";
import { createTokenTotals } from "./lib/token-totals.ts";
import { USAGE_GET, USAGE_LIST, usageSourceContract, type UsageResource } from "./lib/usage-protocol.ts";
import { createUsageSources } from "./lib/usage-sources.ts";
import { rpcContract } from "./rpc.ts";

const ANTIGRAVITY_RESOURCE = "antigravity";

export default async function plugin(bb: BbPluginApi) {
  const totals = createTokenTotals(bb);
  const codex = createCodexAccount();
  const sources = createUsageSources(bb);
  const antigravity = createAntigravityUsage();
  // 界面语言: 设置页切换器和 `bb plugin config usage-rings set language zh` 写的都是这一项
  const settings = bb.settings.define({
    language: {
      type: "select",
      label: "Language",
      description: "auto follows bb's language (zh* → Chinese, otherwise English).",
      options: ["auto", "en", "zh"],
      experimental_optionLabels: { auto: "Auto", en: "English", zh: "简体中文" },
      default: "auto",
    },
  });

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
    async language() {
      const { language } = await settings.get();
      return { language: isLanguageSetting(language) ? language : "auto" };
    },
    async set_language({ language }) {
      const next = await settings.experimental_set({ language });
      return { language: isLanguageSetting(next.language) ? next.language : "auto" };
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
        if (resourceId !== ANTIGRAVITY_RESOURCE) throw new Error("Unknown usage resource.");
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
