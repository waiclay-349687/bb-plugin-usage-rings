/**
 * [INPUT]: 依赖 @get-bb/plugin-sdk 的 defineRpcContract、zod; 结构对齐 BB 内置的 provider-usage.v1 协议 (bb plugin rpc inspect 所得)
 * [OUTPUT]: 对外提供 USAGE_LIST / USAGE_GET 方法名、usageSourceContract (注册与调用共用)、协议类型, 以及纯函数 combineSources:
 *           把各来源的资源合并成 "providerId → 额度" 视图 (与 sdk.system.usageLimits 同形, 供 lib/usage.ts 归一)
 * [POS]: lib 的协议层, BB 用量来源协议在本插件里的唯一定义; 消费者: lib/usage-sources.ts (汇总)、server.ts (把 Antigravity 注册成来源)、lib/antigravity.ts
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const USAGE_LIST = "provider-usage.v1.listResources";
export const USAGE_GET = "provider-usage.v1.getResource";

const scopeSchema = z.union([
  z.object({ kind: z.literal("shared") }),
  z.object({ kind: z.literal("host"), hostId: z.string().min(1), hostName: z.string().min(1) }),
]);

export const resourceSchema = z.object({
  accountKey: z.string().min(1).nullable().default(null),
  id: z.string().min(1),
  providerId: z.string().min(1),
  label: z.string().min(1),
  scope: scopeSchema,
});

export const listOutputSchema = z.object({ label: z.string().min(1).optional(), resources: z.array(resourceSchema) });

const planSchema = z.object({ id: z.string().min(1), multiplier: z.number().int().nullable() }).nullable().default(null);
const base = { plan: planSchema, accountEmail: z.string().nullable(), planLabel: z.string().nullable() };

export const windowSchema = z.object({
  kind: z.enum(["five-hour", "daily", "weekly", "custom"]).default("custom"),
  id: z.string().min(1),
  label: z.string().min(1),
  usedPercent: z.number().min(0),
  resetsAt: z.string().nullable(),
  model: z.string().nullable(),
  cost: z.object({ usedUsdCents: z.number().min(0), limitUsdCents: z.number() }).nullable(),
});

export const usageSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), ...base, windows: z.array(windowSchema) }),
  z.object({ status: z.literal("not_installed"), ...base }),
  z.object({ status: z.literal("unauthenticated"), ...base }),
  z.object({ status: z.literal("expired"), ...base }),
  z.object({ status: z.literal("error"), ...base, message: z.string() }),
]);

export const getOutputSchema = z.object({
  accountKey: z.string().min(1).nullable().default(null),
  observedAt: z.number().int().min(0).nullable(),
  usage: usageSchema,
});

export type UsageResource = z.infer<typeof resourceSchema>;
export type SourceUsage = z.infer<typeof usageSchema>;
export type SourceWindow = z.infer<typeof windowSchema>;

/** 与 BB 内置来源同一份契约: 本插件注册 Antigravity 来源时用, 调别的来源时用其中的 output 做校验 */
export const usageSourceContract = defineRpcContract({
  [USAGE_LIST]: { input: z.object({}), output: listOutputSchema },
  [USAGE_GET]: { input: z.object({ resourceId: z.string().min(1), refresh: z.boolean() }), output: getOutputSchema },
});

export interface SourceReading {
  resource: UsageResource;
  usage: SourceUsage;
}

/**
 * 每个提供方一份读数: 同一提供方出现在多台机器时优先主机那份, 其次是首个 ok 的;
 * 顺序按 BB 的提供方列表 (与 BB 界面一致), 列表里没有的排在后面。
 */
export function combineSources(
  readings: readonly SourceReading[],
  providerOrder: readonly string[],
  primaryHostId: string | null,
): Record<string, SourceUsage> {
  const score = (r: SourceReading) =>
    (r.resource.scope.kind === "host" && r.resource.scope.hostId === primaryHostId ? 2 : 0) + (r.usage.status === "ok" ? 1 : 0);
  const best = new Map<string, SourceReading>();
  for (const reading of readings) {
    const current = best.get(reading.resource.providerId);
    if (!current || score(reading) > score(current)) best.set(reading.resource.providerId, reading);
  }
  const rank = (id: string) => {
    const index = providerOrder.indexOf(id);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const ids = [...best.keys()].sort((a, b) => rank(a) - rank(b));
  return Object.fromEntries(ids.map((id) => [id, best.get(id)!.usage]));
}
