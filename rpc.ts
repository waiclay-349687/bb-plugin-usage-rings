/**
 * [INPUT]: 依赖 @get-bb/plugin-sdk 的 defineRpcContract、zod; 依赖 lib/usage-protocol 的 usageSchema (BB 用量协议的单个读数)
 * [OUTPUT]: 对外提供 rpcContract 与 TokenTotals / CodexAccount / ResetOutcome 类型: 前端 ↔ 后端的 RPC 契约 (limits / token_totals / codex_account / codex_use_reset)
 * [POS]: 插件根的前后端共享契约 (前端需要运行时契约对象, 故不能留在 server.ts);
 *        消费者: server.ts (注册 handler)、hooks/use-usage-limits.ts (limits)、components/sections.tsx (读取与执行重置、token 统计)、components/rail-rings.tsx (预热)
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { usageSchema } from "./lib/usage-protocol.ts";

const periodSchema = z.object({ tokens: z.number().min(0), sessions: z.number().int().min(0) });

export const TOKEN_PERIODS = ["24h", "7d", "30d"] as const;
export type TokenPeriod = (typeof TOKEN_PERIODS)[number];

const tokenTotalsSchema = z.object({
  /** collecting: 首次回填尚未完成, 数字可能偏小 */
  state: z.enum(["collecting", "ready"]),
  fetchedAt: z.number().nullable(),
  error: z.string().nullable(),
  byProvider: z.record(z.string(), z.object({ "24h": periodSchema, "7d": periodSchema, "30d": periodSchema })),
});

const resetCreditSchema = z.object({
  id: z.string(),
  expiresAt: z.number().nullable(),
  title: z.string().nullable(),
});

const codexAccountSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    accountId: z.string(),
    credits: z.object({ balance: z.number(), unlimited: z.boolean() }).nullable(),
    resets: z.object({ availableCount: z.number().int().min(0), credits: z.array(resetCreditSchema) }).nullable(),
    /** 有窗口用到 90% 以上才允许用重置 (Codex 自身的规则) */
    canUseReset: z.boolean(),
    /** 允许用重置的用量门槛 (本插件的保护规则, 见 lib/codex-account.ts) */
    resetThresholdPercent: z.number(),
    /** Codex 各窗口里最高的已用百分比 */
    peakUsedPercent: z.number().nullable(),
    fetchedAt: z.number(),
  }),
  z.object({ status: z.literal("unavailable"), message: z.string() }),
]);

export const RESET_OUTCOMES = ["reset", "nothingToReset", "noCredit", "alreadyRedeemed"] as const;

export const rpcContract = defineRpcContract({
  /** 汇总全部 BB 用量来源 (含本插件的 Antigravity), 与 sdk.system.usageLimits 同形 */
  limits: { input: z.object({ refresh: z.boolean() }).strict(), output: z.record(z.string(), usageSchema) },
  token_totals: { input: z.null(), output: tokenTotalsSchema },
  codex_account: { input: z.object({ refresh: z.boolean() }).strict(), output: codexAccountSchema },
  codex_use_reset: {
    input: z
      .object({
        accountId: z.string().min(1).max(200),
        idempotencyKey: z.uuid(),
        creditId: z.string().min(1).max(200).optional(),
      })
      .strict(),
    output: z.object({ outcome: z.enum(RESET_OUTCOMES) }),
  },
});

export type TokenTotals = z.infer<typeof tokenTotalsSchema>;
export type CodexAccount = z.infer<typeof codexAccountSchema>;
export type ResetCredit = z.infer<typeof resetCreditSchema>;
export type ResetOutcome = (typeof RESET_OUTCOMES)[number];
