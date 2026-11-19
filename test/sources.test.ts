import { test } from "node:test";
import assert from "node:assert/strict";
import { createAntigravityUsage, normalizeAntigravity } from "../lib/antigravity.ts";
import { combineSources, type SourceReading, type SourceUsage } from "../lib/usage-protocol.ts";
import { normalizeUsage, paceOf } from "../lib/usage.ts";

// 实测 `agy -p /usage --output-format json` 的结构 (num_turns 0, token 0)
const report = {
  status: "SUCCESS",
  num_turns: 0,
  usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  command: {
    name: "usage",
    data: {
      groups: [
        {
          name: "Gemini Models",
          buckets: [
            { id: "g-w", name: "Weekly", window: "weekly", remaining_fraction: 0.9976, reset_time: "2026-11-26T03:17:22Z" },
            { id: "g-5", name: "5h", window: "5h", remaining_fraction: 0.25, reset_time: "2026-11-19T08:17:22Z" },
          ],
        },
        {
          name: "Claude and GPT models",
          buckets: [
            { id: "c-w", window: "weekly", remaining_fraction: 1, reset_time: "2026-11-26T03:35:22Z" },
            { id: "bad", window: "5h", remaining_fraction: "1" },
          ],
        },
      ],
    },
  },
};

test("Antigravity report becomes BB usage windows with kinds and short labels", () => {
  const usage = normalizeAntigravity(report);
  assert.equal(usage.status, "ok");
  if (usage.status !== "ok") return;
  assert.deepEqual(
    usage.windows.map((w) => [w.label, w.kind, Math.round(w.usedPercent)]),
    [
      ["Gemini · Weekly", "weekly", 0],
      ["Gemini · 5-hour", "five-hour", 75],
      ["Claude/GPT · Weekly", "weekly", 0],
    ],
  );
  assert.equal(usage.windows[1].resetsAt, "2026-11-19T08:17:22.000Z");
  assert.equal(usage.planLabel, "Antigravity");
});

test("Antigravity windows flow through the existing pace logic", () => {
  const usage = normalizeAntigravity(report);
  const [provider] = normalizeUsage({ "acp-antigravity": usage });
  assert.ok(provider.status === "ok");
  const fiveHour = provider.windows.find((w) => w.kind === "five-hour")!;
  const pace = paceOf(fiveHour, Date.parse("2026-11-19T06:17:22Z")); // 5 小时窗口过了 3 小时
  assert.equal(pace.status, "behind");
  assert.equal(Math.round(pace.expectedUsedPercent!), 60);
});

test("malformed reports and CLI failures never leak output", async () => {
  assert.equal(normalizeAntigravity({ response: "100%" }).status, "error");
  assert.equal(normalizeAntigravity({ status: "SUCCESS", command: { name: "usage", data: { groups: [] } } }).status, "error");

  const missing = await createAntigravityUsage(async () => {
    throw Object.assign(new Error("spawn agy ENOENT"), { code: "ENOENT" });
  }).read(false);
  assert.equal(missing.usage.status, "not_installed");

  for (const run of [async () => "https://accounts.google.com/o/oauth2/auth?PRIVATE", async () => Promise.reject(new Error("PRIVATE TOKEN"))]) {
    const result = await createAntigravityUsage(run).read(false);
    assert.equal(result.usage.status, "error");
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  }
});

test("a successful Antigravity reading is cached for a minute", async () => {
  let calls = 0;
  const source = createAntigravityUsage(async () => {
    calls++;
    return JSON.stringify(report);
  });
  await source.read(false);
  await source.read(false);
  assert.equal(calls, 1);
  await source.read(true);
  assert.equal(calls, 2);
});

function reading(providerId: string, usage: SourceUsage["status"], hostId: string | null): SourceReading {
  const base = { plan: null, accountEmail: null, planLabel: null };
  return {
    resource: {
      accountKey: null,
      id: `${providerId}@${hostId}`,
      providerId,
      label: providerId,
      scope: hostId ? { kind: "host", hostId, hostName: hostId } : { kind: "shared" },
    },
    usage: usage === "ok" ? { status: "ok", ...base, windows: [] } : usage === "error" ? { status: "error", ...base, message: "x" } : { status: usage, ...base },
  };
}

test("combineSources keeps one reading per provider, primary host first, in BB's provider order", () => {
  const result = combineSources(
    [
      reading("acp-antigravity-acp", "ok", "main"),
      reading("claude-code", "error", "remote"),
      reading("claude-code", "ok", "main"),
      reading("codex", "ok", "remote"),
      reading("codex", "expired", "main"),
      reading("someone-else", "ok", null),
    ],
    ["codex", "claude-code", "pi", "acp-antigravity-acp"],
    "main",
  );
  assert.deepEqual(Object.keys(result), ["codex", "claude-code", "acp-antigravity-acp", "someone-else"]);
  assert.equal(result["claude-code"].status, "ok");
  // 主机那份优先, 即使它是 expired
  assert.equal(result.codex.status, "expired");
});
