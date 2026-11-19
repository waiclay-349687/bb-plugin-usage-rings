/**
 * [INPUT]: 依赖 bb.sdk.threads.list / threads.events.list 读 BB 记录的 thread/tokenUsage/updated 事件; 依赖 bb.storage 的插件 SQLite
 * [OUTPUT]: 对外提供 createTokenTotals (snapshot 返回各提供方 24h/7d/30d 的 token 数与会话数, kick 在数据过期时后台增量同步) 与纯函数 tokenDelta
 * [POS]: lib 的服务端收集器, 只在 server.ts 里用; 不扫本机日志, 只统计在 BB 里跑过的会话;
 *        改编自 Usage Bar (Dmitrii Kapustin, MIT, 见 THIRD_PARTY_NOTICES.md): 增加了提供方维度与会话数, 改为后台同步
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { TokenTotals } from "../rpc.ts";

const DAY_MS = 86_400_000;
const PERIODS = { "24h": DAY_MS, "7d": 7 * DAY_MS, "30d": 30 * DAY_MS } as const;
const STALE_MS = 60_000;
/** 只保留 35 天内的明细, 30 天窗口够用 */
const KEEP_MS = 35 * DAY_MS;
const PAGE = 100;

/** 线程上报的是累计值: 差分得到这次新增; 累计值变小 (新会话) 时取本次增量 */
export function tokenDelta(total: number, last: number, previous?: number): number {
  if (![total, last].every((n) => Number.isSafeInteger(n) && n >= 0)) return 0;
  if (previous === undefined || total < previous) return Math.min(total, last);
  return total - previous;
}

export function createTokenTotals(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    "CREATE TABLE token_events (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, tokens INTEGER NOT NULL, thread_id TEXT NOT NULL, provider_id TEXT NOT NULL)",
    "CREATE INDEX token_events_time ON token_events(created_at)",
    "CREATE TABLE token_cursors (thread_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    "CREATE TABLE token_sessions (thread_id TEXT NOT NULL, provider_thread_id TEXT NOT NULL, total INTEGER NOT NULL, PRIMARY KEY(thread_id, provider_thread_id))",
  ]);
  const insert = db.prepare("INSERT OR IGNORE INTO token_events VALUES (?, ?, ?, ?, ?)");
  const previous = db.prepare("SELECT total FROM token_sessions WHERE thread_id = ? AND provider_thread_id = ?");
  const saveSession = db.prepare("INSERT OR REPLACE INTO token_sessions VALUES (?, ?, ?)");
  const cursor = db.prepare("SELECT seq, updated_at FROM token_cursors WHERE thread_id = ?");
  const saveCursor = db.prepare("INSERT OR REPLACE INTO token_cursors VALUES (?, ?, ?)");
  const prune = db.prepare("DELETE FROM token_events WHERE created_at < ?");
  const sums = db.prepare(
    "SELECT provider_id AS providerId, SUM(tokens) AS tokens, COUNT(DISTINCT thread_id) AS sessions FROM token_events WHERE created_at >= ? GROUP BY provider_id",
  );

  const controller = new AbortController();
  bb.onDispose(() => controller.abort());
  let running: Promise<void> | null = null;
  let fetchedAt: number | null = null;
  let error: string | null = null;
  let completedOnce = false;

  async function syncThread(thread: { id: string; providerId: string; createdAt: number; updatedAt: number; status: string }): Promise<boolean> {
    const saved = cursor.get(thread.id) as { seq: number; updated_at: number } | undefined;
    if (saved?.updated_at === thread.updatedAt && !["active", "starting", "stopping"].includes(thread.status)) return true;
    let seq = saved?.seq ?? 0;
    try {
      while (true) {
        const events = await bb.sdk.threads.events.list({
          threadId: thread.id,
          afterSeq: String(seq),
          order: "asc",
          limit: String(PAGE),
          types: ["thread/tokenUsage/updated"],
          signal: controller.signal,
        });
        db.transaction(() => {
          for (const event of events) {
            if (event.type !== "thread/tokenUsage/updated") continue;
            const { providerThreadId, tokenUsage } = event.data;
            const prior = previous.get(thread.id, providerThreadId) as { total: number } | undefined;
            const total = tokenUsage.total.totalTokens;
            const amount = tokenDelta(total, tokenUsage.last.totalTokens, prior?.total);
            // 分叉线程复制来的历史只作基线, 不算新用量
            if (event.createdAt >= thread.createdAt) insert.run(event.id, event.createdAt, amount, thread.id, thread.providerId);
            saveSession.run(thread.id, providerThreadId, total);
            seq = event.seq;
          }
          saveCursor.run(thread.id, seq, thread.updatedAt);
        })();
        if (events.length < PAGE) return true;
      }
    } catch (cause) {
      if (controller.signal.aborted) throw cause;
      saveCursor.run(thread.id, seq, -1); // 下次重试没读完的页
      return false;
    }
  }

  async function sync(): Promise<void> {
    const seen = new Set<string>();
    let failures = 0;
    const horizon = Date.now() - KEEP_MS;
    // 已归档和隐藏的 agent 线程也算; 分页避开默认上限
    for (const archived of [false, true]) {
      for (let offset = 0; ; offset += PAGE) {
        const threads = await bb.sdk.threads.list({ archived, includeHidden: true, limit: PAGE, offset, signal: controller.signal });
        for (const thread of threads) {
          if (seen.has(thread.id)) continue;
          seen.add(thread.id);
          if (thread.updatedAt < horizon) continue; // 35 天没动过的线程不可能贡献窗口内用量
          if (!(await syncThread(thread))) failures++;
        }
        if (threads.length < PAGE) break;
      }
    }
    prune.run(horizon);
    error = failures > 0 ? `Could not read ${failures} threads. Showing what was collected.` : null;
    fetchedAt = Date.now();
    completedOnce = true;
  }

  /** 数据过期就后台同步, 不阻塞调用方 */
  function kick(): void {
    if (running || (fetchedAt !== null && Date.now() - fetchedAt < STALE_MS)) return;
    running = sync()
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        error = "Token usage could not be refreshed. Showing saved data.";
        bb.log.warn(`token totals sync failed: ${cause instanceof Error ? cause.message : "unknown"}`);
      })
      .finally(() => (running = null));
  }

  function snapshot(): TokenTotals {
    const now = Date.now();
    const byProvider: TokenTotals["byProvider"] = {};
    for (const [period, span] of Object.entries(PERIODS) as [keyof typeof PERIODS, number][]) {
      for (const row of sums.all(now - span) as { providerId: string; tokens: number; sessions: number }[]) {
        const entry = (byProvider[row.providerId] ??= {
          "24h": { tokens: 0, sessions: 0 },
          "7d": { tokens: 0, sessions: 0 },
          "30d": { tokens: 0, sessions: 0 },
        });
        entry[period] = { tokens: row.tokens ?? 0, sessions: row.sessions ?? 0 };
      }
    }
    return { state: completedOnce ? "ready" : "collecting", fetchedAt, error, byProvider };
  }

  const markDirty = (): void => {
    fetchedAt = null;
  };

  return { kick, snapshot, markDirty };
}
