import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSpan, localizeWindowName, MESSAGES, resolveLanguage, type Lang, type Messages } from "../lib/i18n.ts";
import { paceOf, paceCopy, type UsageWindow } from "../lib/usage.ts";

const HOUR = 3_600_000;
const HAN = /[一-鿿]/;
/** 中文模式允许出现的拉丁字符: 品牌名 (Codex、BB、Antigravity) 与数量单位 (如 "23M") */
const ZH_ALLOWED = /\b(?:Codex|BB|Antigravity)\b/g;

/** 把一套文案里的每一条展开成实际会显示的字符串; 函数用该语言下真实会传入的参数调用 */
function render(messages: Messages, lang: Lang): [string, string][] {
  const span = formatSpan(4 * 24 * HOUR + 3 * HOUR, lang);
  const title = localizeWindowName("Weekly", lang);
  // 后端原文总是英文; 中文模式必须不回显它
  const backendMessage = "Network error: connection refused";
  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(messages)) {
    if (typeof value === "string") out.push([key, value]);
    else if (typeof value === "function") {
      const fn = value as (...args: unknown[]) => string;
      const args: Record<string, unknown[]> = {
        updatedAgo: [span],
        staleNote: [backendMessage],
        usedPercent: [42],
        resetsIn: [span],
        meterLabel: [title],
        backIn: [span],
        deficit: [12],
        reserve: [8],
        runsOutIn: [span],
        accountUnavailable: [backendMessage],
        available: [3],
        hintLocked: [90, 6],
        hintReady: [93],
        resetN: [2],
        expiresIn: [span],
        unlocksAt: [90],
        resetNotConfirmedDetail: [`${backendMessage}. `],
        activityError: [backendMessage],
        activityValue: ["23M", 4],
        ringAria: ["Codex", "x"],
        ringLabel: [title, 42],
        cardAria: ["Codex"],
        minutes: [5],
      };
      assert.ok(key in args, `test needs sample arguments for ${key}`);
      out.push([key, fn(...(args[key] ?? []))]);
    } else {
      for (const [sub, text] of Object.entries(value as Record<string, string>)) out.push([`${key}.${sub}`, text]);
    }
  }
  return out;
}

test("english copy contains no Chinese characters", () => {
  for (const [key, text] of render(MESSAGES.en, "en")) assert.ok(!HAN.test(text), `${key}: ${text}`);
  assert.equal(MESSAGES.en.ringAria("Codex", MESSAGES.en.ringLabel("Weekly", 42)), "Codex usage: Weekly 42% used");
});

test("chinese copy contains no English words besides brand names", () => {
  for (const [key, text] of render(MESSAGES.zh, "zh")) {
    const leftover = text.replace(ZH_ALLOWED, "").match(/[A-Za-z]{2,}/g);
    assert.equal(leftover, null, `${key}: ${text}`);
    assert.ok(HAN.test(text) || /^[\d\s%·.:：,，]*$/.test(text.replace(ZH_ALLOWED, "")), `${key} should be Chinese: ${text}`);
  }
});

test("both languages define every key", () => {
  assert.deepEqual(Object.keys(MESSAGES.zh).sort(), Object.keys(MESSAGES.en).sort());
});

test("auto follows the host language, explicit settings win", () => {
  assert.equal(resolveLanguage("auto", "zh-CN"), "zh");
  assert.equal(resolveLanguage("auto", "zh-Hant-TW"), "zh");
  assert.equal(resolveLanguage("auto", "en-US"), "en");
  assert.equal(resolveLanguage("auto", "ja"), "en");
  assert.equal(resolveLanguage("auto", ""), "en");
  assert.equal(resolveLanguage(undefined, "zh"), "zh");
  assert.equal(resolveLanguage("en", "zh-CN"), "en");
  assert.equal(resolveLanguage("zh", "en-US"), "zh");
  assert.equal(resolveLanguage("fr", "en"), "en");
});

test("spans format per language", () => {
  assert.equal(formatSpan(0, "en"), "<1m");
  assert.equal(formatSpan(0, "zh"), "不到 1 分钟");
  assert.equal(formatSpan((4 * 24 + 23) * HOUR, "zh"), "4 天 23 小时");
  assert.equal(formatSpan(2 * HOUR + 5 * 60_000, "zh"), "2 小时 5 分钟");
  assert.equal(formatSpan(35 * 60_000, "zh"), "35 分钟");
  assert.equal(formatSpan((12 * 24 + 17) * HOUR, "zh", 1), "12 天");
  assert.equal(MESSAGES.zh.updatedAgo(formatSpan(5 * 60_000, "zh")), "5 分钟前更新");
});

test("generic window names translate, brand and model names stay", () => {
  assert.equal(localizeWindowName("Weekly", "zh"), "每周");
  assert.equal(localizeWindowName("5-hour", "zh"), "5 小时");
  assert.equal(localizeWindowName("5h", "zh"), "5 小时");
  assert.equal(localizeWindowName("Five hour", "zh"), "5 小时");
  assert.equal(localizeWindowName("Daily", "zh"), "每日");
  assert.equal(localizeWindowName("Session", "zh"), "当前会话");
  assert.equal(localizeWindowName("Weekly (Sonnet)", "zh"), "每周 (Sonnet)");
  assert.equal(localizeWindowName("Gemini", "zh"), "Gemini");
  assert.equal(localizeWindowName("Claude/GPT", "zh"), "Claude/GPT");
  assert.equal(localizeWindowName("Weekly", "en"), "Weekly");
});

test("pace copy speaks the chosen language", () => {
  const now = Date.UTC(2026, 10, 19);
  const weekly = (used: number, resetsInHours: number): UsageWindow => ({ label: "Weekly", usedPercent: used, resetsAt: now + resetsInHours * HOUR, kind: "weekly" });
  assert.deepEqual(paceCopy(paceOf(weekly(82, 4 * 24 + 23), now), "zh"), { amount: "超前消耗 53%", outlook: "预计 10 小时 45 分钟后用完" });
  assert.deepEqual(paceCopy(paceOf(weekly(45, 3.5 * 24), now), "zh"), { amount: "富余 5%", outlook: "可持续至重置" });
  assert.deepEqual(paceCopy(paceOf(weekly(50.3, 3.5 * 24), now), "zh"), { amount: "进度正常", outlook: "可持续至重置" });
  assert.deepEqual(paceCopy(paceOf(weekly(100, 48), now), "zh"), { amount: "已用完", outlook: "2 天 0 小时后恢复" });
  assert.deepEqual(paceCopy(paceOf(weekly(45, 3.5 * 24), now), "en"), { amount: "5% in reserve", outlook: "Lasts until reset" });
});
