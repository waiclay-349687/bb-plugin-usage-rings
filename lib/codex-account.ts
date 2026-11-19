/**
 * [INPUT]: 依赖本机 `codex` 命令行的 app-server (JSON-RPC over stdio): account/rateLimits/read、account/rateLimitResetCredit/consume
 * [OUTPUT]: 对外提供 createCodexAccount (read 读账号: credits 余额、可用重置及过期时间; consume 用掉一次重置) 与纯解析函数 parseRateLimits / canUseReset
 * [POS]: lib 的服务端适配层, 只在 server.ts 里用; 不读任何登录凭据, 全部经 Codex 官方接口;
 *        与 lib/usage.ts 的边界: 这里只管 Codex 账户附加信息, 额度窗口仍以 bb 的 usageLimits 为准
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { CodexAccount, ResetCredit, ResetOutcome } from "../rpc.ts";
import { RESET_OUTCOMES } from "../rpc.ts";

const APP_SERVER_TIMEOUT_MS = 20_000;
const READ_CACHE_MS = 60_000;
const RESET_THRESHOLD_PERCENT = 90;

type Json = Record<string, unknown>;
const asRecord = (value: unknown): Json | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null);
const asString = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

/** 秒或毫秒时间戳 → 毫秒 */
function epochMs(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e11 ? n : n * 1000;
}

/** Codex 主/次窗口里用得最多的百分比; 读不到窗口时为 null */
export function peakUsedPercent(json: unknown): number | null {
  const root = asRecord(json);
  const core = asRecord(asRecord(root?.rateLimitsByLimitId)?.codex) ?? asRecord(root?.rateLimits);
  const used = [asRecord(core?.primary), asRecord(core?.secondary)]
    .map((w) => w?.usedPercent)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return used.length === 0 ? null : Math.max(...used);
}

/**
 * 本插件的保护门槛 (沿用 Synara): 某个窗口用到 90% 以上才允许用重置, 避免额度还很充足时把重置浪费掉。
 * Codex 官方界面不预先拦截, 由服务端判断; 这里更保守。读不到窗口时返回 undefined。
 */
export function canUseReset(json: unknown): boolean | undefined {
  const peak = peakUsedPercent(json);
  return peak === null ? undefined : peak >= RESET_THRESHOLD_PERCENT;
}

export function parseRateLimits(json: unknown, now: number): CodexAccount {
  const root = asRecord(json);
  const accountId = asString(root?.accountId);
  if (!root || !accountId) return { status: "unavailable", message: "Codex did not report an account." };

  const core = asRecord(asRecord(root.rateLimitsByLimitId)?.codex) ?? asRecord(root.rateLimits);
  const creditsRaw = asRecord(core?.credits);
  const balance = Number(creditsRaw?.balance);
  const unlimited = creditsRaw?.unlimited === true;
  const credits =
    creditsRaw && (unlimited || (Number.isFinite(balance) && (creditsRaw.hasCredits !== false || balance > 0)))
      ? { balance: Number.isFinite(balance) ? balance : 0, unlimited }
      : null;

  const resetsRaw = asRecord(root.rateLimitResetCredits);
  const count = Number(resetsRaw?.availableCount);
  const list: ResetCredit[] = Array.isArray(resetsRaw?.credits)
    ? resetsRaw.credits.flatMap((entry) => {
        const credit = asRecord(entry);
        const id = asString(credit?.id);
        if (!credit || !id || credit.status !== "available") return [];
        const expiresAt = epochMs(credit.expiresAt);
        if (expiresAt !== null && expiresAt <= now) return [];
        return [{ id, expiresAt, title: asString(credit.title) }];
      })
    : [];
  list.sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));
  const resets = Number.isInteger(count) && count >= 0 ? { availableCount: count, credits: list } : null;

  return {
    status: "ok",
    accountId,
    credits,
    resets,
    canUseReset: canUseReset(json) === true,
    // 门槛与当前用量一起下发, 前端按钮文案只引用这里的数, 不另写一份 90
    resetThresholdPercent: RESET_THRESHOLD_PERCENT,
    peakUsedPercent: peakUsedPercent(json),
    fetchedAt: now,
  };
}

type Request = (method: string, params: unknown) => Promise<unknown>;

/** 起一个短命的 codex app-server, 握手后执行 run, 结束即退出 */
async function withAppServer<T>(run: (request: Request) => Promise<T>): Promise<T> {
  const child = spawn(process.env.CODEX_BIN?.trim() || "codex", ["app-server"], { stdio: ["pipe", "pipe", "ignore"] });
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let nextId = 0;
  let failure: ((e: Error) => void) | null = null;
  const failed = new Promise<never>((_, reject) => (failure = reject));
  failed.catch(() => {});
  const fail = (error: Error) => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    failure?.(error);
  };
  const write = (message: Json) => {
    child.stdin.write(`${JSON.stringify(message)}\n`, (error) => error && fail(error));
  };
  const request: Request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      write({ id, method, params });
    });

  child.on("error", (error) => fail(error.message.includes("ENOENT") ? new Error("Codex CLI was not found on this machine.") : error));
  child.on("exit", () => fail(new Error("Codex app-server exited early.")));
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message: Json | null = null;
    try {
      message = asRecord(JSON.parse(line));
    } catch {
      return;
    }
    if (!message) return;
    // 服务端发来的交互请求 (审批等) 一律拒绝: 这里只读用量
    if (typeof message.method === "string" && message.id !== undefined) {
      write({ id: message.id, error: { code: -32601, message: "Interactive requests are not supported." } });
      return;
    }
    const waiter = typeof message.id === "number" ? pending.get(message.id) : undefined;
    if (!waiter) return;
    pending.delete(message.id as number);
    if (message.error !== undefined) waiter.reject(new Error("Codex rejected the request."));
    else waiter.resolve(message.result);
  });

  const timer = setTimeout(() => fail(new Error("Codex did not answer in time.")), APP_SERVER_TIMEOUT_MS);
  try {
    return await Promise.race([
      failed,
      (async () => {
        await request("initialize", {
          clientInfo: { name: "bb-usage-rings", title: "Usage Rings", version: "0.2.0" },
          capabilities: { experimentalApi: true },
        });
        write({ method: "initialized" });
        return run(request);
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    child.removeAllListeners("exit");
    child.kill();
  }
}

export function createCodexAccount() {
  let cached: CodexAccount | null = null;
  let inFlight: Promise<CodexAccount> | null = null;
  const activeResets = new Map<string, { key: string; promise: Promise<ResetOutcome> }>();

  async function read(refresh: boolean): Promise<CodexAccount> {
    if (!refresh && cached?.status === "ok" && Date.now() - cached.fetchedAt < READ_CACHE_MS) return cached;
    if (inFlight) return inFlight;
    inFlight = withAppServer((request) => request("account/rateLimits/read", {}))
      .then((json) => (cached = parseRateLimits(json, Date.now())))
      .catch((error: unknown): CodexAccount => ({
        status: "unavailable",
        message: error instanceof Error ? error.message : "Codex usage could not be read.",
      }))
      .finally(() => (inFlight = null));
    return inFlight;
  }

  /**
   * 用掉一次重置。客户端为每次确认生成幂等键并持久化, 结果不明时只能用同一个键重试, 不会重复扣。
   * 执行前重新读取: 账号变了或已不满足 90% 规则就不扣。
   */
  async function consume(input: { accountId: string; idempotencyKey: string; creditId?: string }): Promise<ResetOutcome> {
    const active = activeResets.get(input.accountId);
    if (active) {
      if (active.key === input.idempotencyKey) return active.promise;
      throw new Error("A reset is already in progress for this Codex account.");
    }
    const promise = withAppServer(async (request) => {
      const usage = await request("account/rateLimits/read", {});
      if (asString(asRecord(usage)?.accountId) !== input.accountId) {
        throw new Error("The Codex account changed. Refresh usage before using a reset.");
      }
      const allowed = canUseReset(usage);
      if (allowed === undefined) throw new Error("Current Codex usage is unavailable. Retry the same attempt.");
      if (!allowed) return "nothingToReset" as const;
      const result = asRecord(
        await request("account/rateLimitResetCredit/consume", {
          idempotencyKey: input.idempotencyKey,
          ...(input.creditId ? { creditId: input.creditId } : {}),
        }),
      );
      const outcome = result?.outcome;
      if (typeof outcome === "string" && (RESET_OUTCOMES as readonly string[]).includes(outcome)) return outcome as ResetOutcome;
      throw new Error("Codex returned an unknown reset result. Retry the same attempt.");
    });
    activeResets.set(input.accountId, { key: input.idempotencyKey, promise });
    try {
      return await promise;
    } finally {
      activeResets.delete(input.accountId);
      cached = null;
    }
  }

  return { read, consume };
}
