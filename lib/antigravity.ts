/**
 * [INPUT]: 依赖本机 Antigravity 命令行 `agy -p /usage --output-format json` (内置命令: 只刷新登录状态, 实测 num_turns 0、token 0; 不读任何凭据文件)
 * [OUTPUT]: 对外提供 createAntigravityUsage (read: 60 秒缓存、并发合并的读取) 与纯函数 normalizeAntigravity: agy 报告 → BB 用量协议的 usage
 * [POS]: lib 的服务端采集器, 补上 BB 核心不采集的 Antigravity 额度; 消费者: server.ts (注册为 BB 用量来源);
 *        与 lib/usage-protocol.ts 的边界: 这里只管 Antigravity 的读取与换算, 协议结构在 usage-protocol
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { SourceUsage, SourceWindow } from "./usage-protocol.ts";

const TIMEOUT_MS = 20_000;
const CACHE_MS = 60_000;

type Json = Record<string, unknown>;
const record = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {});
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
const empty = { plan: null, accountEmail: null, planLabel: null };

/** "Gemini Models" → "Gemini"; "Claude and GPT models" → "Claude/GPT" (卡片里一行放得下) */
function shortGroup(name: string | null): string {
  return (name ?? "Antigravity").replace(/\s+models?$/i, "").replace(/\s+and\s+/gi, "/").trim() || "Antigravity";
}

export function normalizeAntigravity(value: unknown): SourceUsage {
  const result = record(value);
  const command = record(result.command);
  const data = record(command.data);
  if (result.status !== "SUCCESS" || command.name !== "usage" || !Array.isArray(data.groups)) {
    return { status: "error", ...empty, message: "Antigravity returned no usage report." };
  }
  const windows: SourceWindow[] = [];
  for (const rawGroup of data.groups) {
    const group = record(rawGroup);
    if (!Array.isArray(group.buckets)) continue;
    const name = shortGroup(text(group.name));
    for (const rawBucket of group.buckets) {
      const bucket = record(rawBucket);
      const fraction = bucket.remaining_fraction;
      // 剩余比例缺失或越界就跳过, 不臆造"还剩 100%"
      if (typeof fraction !== "number" || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) continue;
      const kind = bucket.window === "5h" ? "five-hour" : bucket.window === "weekly" ? "weekly" : "custom";
      const span = kind === "five-hour" ? "5-hour" : kind === "weekly" ? "Weekly" : text(bucket.name) ?? "Quota";
      const reset = text(bucket.reset_time);
      windows.push({
        kind,
        id: `${text(group.name) ?? name}:${text(bucket.window) ?? span}`,
        label: `${name} · ${span}`,
        usedPercent: Math.min(100, (1 - fraction) * 100),
        resetsAt: reset && Number.isFinite(Date.parse(reset)) ? new Date(reset).toISOString() : null,
        model: null,
        cost: null,
      });
    }
  }
  if (windows.length === 0) return { status: "error", ...empty, message: "Antigravity reported no quota windows." };
  return { status: "ok", ...empty, planLabel: "Antigravity", windows };
}

/** 常见安装位置; 都没有就交给 PATH */
function agyBinary(): string {
  const candidates = [process.env.AGY_BIN?.trim(), join(homedir(), ".local/bin/agy"), "/opt/homebrew/bin/agy", "/usr/local/bin/agy"];
  return candidates.find((path): path is string => !!path && existsSync(path)) ?? "agy";
}

function runAgy(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      agyBinary(),
      ["-p", "/usage", "--output-format", "json"],
      { cwd: tmpdir(), timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024, env: { ...process.env, NO_COLOR: "1" } },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

export function createAntigravityUsage(run: () => Promise<string> = runAgy) {
  let cached: { at: number; usage: SourceUsage } | null = null;
  let inFlight: Promise<SourceUsage> | null = null;

  async function read(refresh: boolean): Promise<{ usage: SourceUsage; observedAt: number | null }> {
    if (!refresh && cached && Date.now() - cached.at < CACHE_MS) return { usage: cached.usage, observedAt: cached.at };
    inFlight ??= run()
      .then((stdout) => normalizeAntigravity(JSON.parse(stdout)))
      .catch((error: unknown): SourceUsage => {
        // 不回传子进程输出: 未登录时它可能打印登录链接
        const code = (error as NodeJS.ErrnoException | null)?.code;
        return code === "ENOENT"
          ? { status: "not_installed", ...empty }
          : { status: "error", ...empty, message: "Could not read Antigravity usage. Open agy to sign in, then refresh." };
      })
      .finally(() => (inFlight = null));
    const usage = await inFlight;
    if (usage.status === "ok") cached = { at: Date.now(), usage };
    return { usage, observedAt: usage.status === "ok" ? Date.now() : cached?.at ?? null };
  }

  return { read };
}
