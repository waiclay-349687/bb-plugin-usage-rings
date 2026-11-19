import { formatSpan } from "../lib/i18n.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatTokens,
  normalizeUsage,
  paceCopy,
  paceOf,
  paceTone,
  primaryWindow,
  usedTone,
  windowTitle,
  groupWindows,
  type UsageWindow,
} from "../lib/usage.ts";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-11-18T07:00:00.000Z");

function weekly(usedPercent: number, resetsInMs: number, label = "Weekly limit"): UsageWindow {
  return { label, usedPercent, resetsAt: NOW + resetsInMs, kind: "weekly" };
}

// Synara 截图: Claude Weekly 18% left (= 82% used), Resets in 4d 23h → 53% in deficit, 红刻度, 琥珀填充
test("Claude reference: deficit, run-out, marker and tones", () => {
  const pace = paceOf(weekly(82, (4 * 24 + 23) * HOUR), NOW);
  assert.equal(pace.status, "behind");
  assert.equal(paceCopy(pace).amount, "53% in deficit");
  assert.equal(paceCopy(pace).outlook, "Runs out in 10h 45m");
  assert.equal(Math.round(pace.expectedUsedPercent!), 29);
  assert.equal(usedTone(pace.usedPercent), "warn");
  assert.equal(paceTone(pace.status!), "bad");
});

// Synara 截图: Codex Weekly 100% left, 刚过 1 小时 → 已过时间按 5% 计, 显示 "5% in reserve"
test("Codex reference: elapsed floor of 5% gives 5% in reserve", () => {
  const pace = paceOf(weekly(0, (6 * 24 + 23) * HOUR), NOW);
  assert.equal(pace.status, "ahead");
  assert.deepEqual(paceCopy(pace), { amount: "5% in reserve", outlook: "Lasts until reset" });
  assert.equal(Math.round(pace.expectedUsedPercent!), 5);
  assert.equal(usedTone(pace.usedPercent), "good");
});

test("projected usage between 80% and 100% is on track", () => {
  // 已过 3.5 天 = 50%, 已用 45% → 预计 90%
  const pace = paceOf(weekly(45, 3.5 * 24 * HOUR), NOW);
  assert.equal(pace.status, "on-track");
  assert.equal(paceTone(pace.status!), "warn");
  assert.deepEqual(paceCopy(pace), { amount: "5% in reserve", outlook: "Lasts until reset" });
});

test("rounding to zero reads as on pace and is judged on pace", () => {
  // 外推 100.6% 本会落进 behind; 文案写 On pace 时, 判定也必须是匀速: 不染警示色、不算用完时间
  const pace = paceOf(weekly(50.3, 3.5 * 24 * HOUR), NOW);
  assert.equal(pace.status, "on-track");
  assert.equal(pace.runsOutInMs, null);
  assert.deepEqual(paceCopy(pace), { amount: "On pace", outlook: "Lasts until reset" });
  // 差值刚好 0.5 时文案进位成 1%, 判定照常
  const deficit = paceOf(weekly(50.5, 3.5 * 24 * HOUR), NOW);
  assert.equal(paceCopy(deficit).amount, "1% in deficit");
  assert.equal(deficit.status, "behind");
});

test("exhausted window reads limit reached and when it comes back", () => {
  const pace = paceOf(weekly(100, 2 * 24 * HOUR), NOW);
  assert.equal(pace.exhausted, true);
  assert.equal(pace.runsOutInMs, null);
  assert.deepEqual(paceCopy(pace), { amount: "Limit reached", outlook: "Back in 2d 0h" });
  assert.equal(usedTone(pace.usedPercent), "bad");
});

test("unknown window length or reset time has no pace", () => {
  const custom: UsageWindow = { label: "Monthly", usedPercent: 85, resetsAt: NOW + HOUR, kind: "custom" };
  const pace = paceOf(custom, NOW);
  assert.equal(pace.status, null);
  assert.equal(pace.expectedUsedPercent, null);
  // 标题行已有 "85% used", 这里不重复
  assert.deepEqual(paceCopy(pace), { amount: null, outlook: null });
  const noReset = paceOf({ ...custom, kind: "weekly", resetsAt: null }, NOW);
  assert.equal(noReset.status, null);
  assert.equal(noReset.resetsInMs, null);
});

test("reset time already passed has no pace", () => {
  const pace = paceOf(weekly(40, -HOUR), NOW);
  assert.equal(pace.resetsInMs, 0);
  assert.equal(pace.status, null);
});

test("tone thresholds: amber from 75% used, red from 90% (Synara's 25% / 10% left)", () => {
  assert.equal(usedTone(74), "good");
  assert.equal(usedTone(75), "warn");
  assert.equal(usedTone(90), "bad");
});

test("normalizeUsage keeps ok and error providers in order and drops the rest", () => {
  const raw = {
    codex: {
      status: "ok",
      planLabel: "Pro",
      windows: [{ label: "Weekly limit", usedPercent: 0, resetsAt: "2026-11-25T06:40:08.000Z", kind: "weekly" }],
    },
    "claude-code": {
      status: "ok",
      planLabel: "Ultra",
      windows: [
        { label: "Weekly limit", usedPercent: 83, resetsAt: "2026-11-23T06:00:00.123Z", kind: "weekly" },
        { label: "Fable", usedPercent: 182, resetsAt: "bad date", kind: "monthly" },
        { label: "Broken", usedPercent: "12" },
      ],
    },
    "acp-cursor": { status: "expired" },
    "acp-opencode": { status: "unauthenticated" },
    grok: { status: "error", message: "  " },
    empty: { status: "ok", windows: [] },
    junk: 42,
  };
  const result = normalizeUsage(raw);
  assert.deepEqual(result.map((p) => [p.providerId, p.status]), [
    ["codex", "ok"],
    ["claude-code", "ok"],
    ["grok", "error"],
  ]);
  const claude = result[1];
  assert.ok(claude.status === "ok");
  assert.deepEqual(claude.windows[1], { label: "Fable", usedPercent: 100, resetsAt: null, kind: null });
  const grok = result[2];
  assert.ok(grok.status === "error");
  assert.equal(grok.message, "Usage could not be loaded.");
  assert.deepEqual(normalizeUsage(null), []);
  assert.deepEqual(normalizeUsage([1, 2]), []);
});

test("primaryWindow picks the most used window, first on ties", () => {
  const a = weekly(83, HOUR, "Weekly limit");
  const b = weekly(82, HOUR, "Fable");
  const c = weekly(83, HOUR, "Other");
  assert.equal(primaryWindow([b, a, c]), a);
  assert.equal(primaryWindow([]), null);
});

test("formatting helpers", () => {
  assert.equal(formatSpan(0, "en"), "<1m");
  assert.equal(formatSpan(35 * 60_000 + 59_000, "en"), "35m");
  assert.equal(formatSpan((4 * 24 + 23) * HOUR + 59 * 60_000, "en"), "4d 23h");
  assert.equal(formatSpan((12 * 24 + 17) * HOUR, "en", 1), "12d");
  assert.equal(formatSpan(2 * HOUR + 5 * 60_000, "en", 1), "2h");
  assert.equal(formatTokens(512), "512");
  assert.equal(formatTokens(12_345), "12.3K");
  assert.equal(formatTokens(10_400_000), "10M");
  assert.equal(formatTokens(2_100_000_000), "2B");
  assert.equal(windowTitle(weekly(1, HOUR, "Weekly limit")), "Weekly");
  assert.equal(windowTitle(weekly(1, HOUR, "Fable")), "Fable");
  const grouped = groupWindows([weekly(1, HOUR, "Gemini · 5-hour"), weekly(1, HOUR, "Gemini · Weekly"), weekly(1, HOUR, "Claude/GPT · Weekly")]);
  assert.deepEqual(
    grouped.map((group) => [group.name, group.items.map((item) => item.title)]),
    [["Gemini", ["5-hour", "Weekly"]], ["Claude/GPT", ["Weekly"]]],
  );
  assert.deepEqual(groupWindows([weekly(1, HOUR, "Weekly limit")]).map((group) => [group.name, group.items[0]?.title]), [[null, "Weekly"]]);
});
