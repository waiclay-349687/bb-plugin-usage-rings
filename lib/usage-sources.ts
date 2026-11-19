/**
 * [INPUT]: 依赖 bb.sdk.plugins (experimental_discoverRpc / callRpc) 找到并调用所有 BB 用量来源; 依赖 bb.sdk.providers / hosts / system 取提供方顺序与主机;
 *          依赖 lib/usage-protocol 的协议定义与 combineSources
 * [OUTPUT]: 对外提供 createUsageSources: read(refresh) 汇总全部来源, 返回与 sdk.system.usageLimits 同形的 "providerId → 额度"
 * [POS]: lib 的服务端汇总层, 与 BB 自带用量卡片同一取数方式 (所以第三方用量插件接入后会自动出现圆环); 消费者: server.ts;
 *        与 lib/antigravity.ts 的边界: 本插件自己的来源也走发现与调用, 不开后门
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { combineSources, getOutputSchema, listOutputSchema, USAGE_GET, USAGE_LIST, type SourceReading, type SourceUsage } from "./usage-protocol.ts";

const CACHE_MS = 60_000;
const CALL_TIMEOUT_MS = 45_000;
/** 与 BB 自带卡片一致: 每批 3 个来源 */
const BATCH = 3;

export function createUsageSources(bb: BbPluginApi) {
  let cached: { at: number; value: Record<string, SourceUsage> } | null = null;
  let inFlight: Promise<Record<string, SourceUsage>> | null = null;

  async function collect(refresh: boolean): Promise<Record<string, SourceUsage>> {
    const [methods, providers, config] = await Promise.all([
      bb.sdk.plugins.experimental_discoverRpc({ method: USAGE_LIST }),
      bb.sdk.providers.list({ capability: "usage" }).catch(() => []),
      bb.sdk.system.config().catch(() => null),
    ]);
    const pluginIds = [...new Set(methods.map((m) => m.pluginId))];
    const readings: SourceReading[] = [];

    for (let i = 0; i < pluginIds.length; i += BATCH) {
      await Promise.all(
        pluginIds.slice(i, i + BATCH).map(async (pluginId) => {
          try {
            const list = await bb.sdk.plugins.callRpc({
              pluginId,
              method: USAGE_LIST,
              input: {},
              outputSchema: listOutputSchema,
              signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
            });
            await Promise.all(
              list.resources.map(async (resource) => {
                try {
                  const result = await bb.sdk.plugins.callRpc({
                    pluginId,
                    method: USAGE_GET,
                    input: { resourceId: resource.id, refresh },
                    outputSchema: getOutputSchema,
                    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
                  });
                  readings.push({ resource, usage: result.usage });
                } catch {
                  readings.push({ resource, usage: { status: "error", plan: null, accountEmail: null, planLabel: null, message: "Usage could not be read." } });
                }
              }),
            );
          } catch (error) {
            bb.log.warn(`usage source ${pluginId} could not be listed: ${error instanceof Error ? error.name : "unknown"}`);
          }
        }),
      );
    }
    const order = providers.map((p) => p.id);
    const primaryHostId = (config as { primaryHostId?: string | null } | null)?.primaryHostId ?? null;
    return combineSources(readings, order, primaryHostId);
  }

  async function read(refresh: boolean): Promise<Record<string, SourceUsage>> {
    if (!refresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
    inFlight ??= collect(refresh)
      .then((value) => {
        cached = { at: Date.now(), value };
        return value;
      })
      .finally(() => (inFlight = null));
    return inFlight;
  }

  return { read };
}
