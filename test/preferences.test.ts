import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PREFERENCES, normalizePreferences, parseProviderList, PREFERENCE_KEYS, SETTING_LABELS, toSettingValues } from "../lib/preferences.ts";
import { usedTone } from "../lib/usage.ts";

test("missing or garbage values fall back to defaults", () => {
  assert.deepEqual(normalizePreferences(undefined), DEFAULT_PREFERENCES);
  assert.deepEqual(normalizePreferences({}), DEFAULT_PREFERENCES);
  assert.deepEqual(
    normalizePreferences({ language: "fr", warnThreshold: "abc", antigravityEnabled: "maybe", refreshIntervalMinutes: null, hiddenProviders: 42 }),
    DEFAULT_PREFERENCES,
  );
});

test("numbers are rounded and clamped to their ranges", () => {
  const p = normalizePreferences({ warnThreshold: 10, dangerThreshold: 300, resetUnlockThreshold: 20, refreshIntervalMinutes: 0.4 });
  assert.equal(p.warnThreshold, 40);
  assert.equal(p.dangerThreshold, 100);
  assert.equal(p.resetUnlockThreshold, 50);
  assert.equal(p.refreshIntervalMinutes, 1);
  assert.equal(normalizePreferences({ refreshIntervalMinutes: 999 }).refreshIntervalMinutes, 60);
  assert.equal(normalizePreferences({ warnThreshold: "72.6" }).warnThreshold, 73);
  assert.equal(normalizePreferences({ warnThreshold: 99 }).warnThreshold, 95);
});

test("red never starts below amber", () => {
  assert.equal(normalizePreferences({ warnThreshold: 80, dangerThreshold: 60 }).dangerThreshold, 80);
  assert.equal(normalizePreferences({ warnThreshold: 95, dangerThreshold: 50 }).dangerThreshold, 95);
  assert.equal(normalizePreferences({ warnThreshold: 60, dangerThreshold: 85 }).dangerThreshold, 85);
});

test("booleans accept stored strings", () => {
  assert.equal(normalizePreferences({ antigravityEnabled: "false" }).antigravityEnabled, false);
  assert.equal(normalizePreferences({ defaultDetailsOpen: "true" }).defaultDetailsOpen, true);
  assert.equal(normalizePreferences({ defaultDetailsOpen: true }).defaultDetailsOpen, true);
});

test("hidden providers parse from a comma list or an array, trimmed and deduplicated", () => {
  assert.deepEqual(parseProviderList(" codex, claude-code ,,codex "), ["codex", "claude-code"]);
  assert.deepEqual(parseProviderList(["codex", " ", "acp-antigravity", "codex"]), ["codex", "acp-antigravity"]);
  assert.deepEqual(parseProviderList(undefined), []);
  const p = normalizePreferences({ hiddenProviders: "codex,acp-antigravity" });
  assert.deepEqual(p.hiddenProviders, ["codex", "acp-antigravity"]);
  // 存回宿主设置时是逗号分隔字符串, 读回来不变
  assert.equal(toSettingValues(p).hiddenProviders, "codex,acp-antigravity");
  assert.deepEqual(normalizePreferences(toSettingValues(p)), p);
});

test("every preference has a host setting label", () => {
  assert.deepEqual(Object.keys(SETTING_LABELS).sort(), [...PREFERENCE_KEYS].sort());
});

test("ring colour follows the configured thresholds", () => {
  assert.equal(usedTone(74), "good");
  assert.equal(usedTone(75), "warn");
  assert.equal(usedTone(90), "bad");
  const { warnThreshold, dangerThreshold } = normalizePreferences({ warnThreshold: 50, dangerThreshold: 70 });
  assert.equal(usedTone(49, warnThreshold, dangerThreshold), "good");
  assert.equal(usedTone(50, warnThreshold, dangerThreshold), "warn");
  assert.equal(usedTone(70, warnThreshold, dangerThreshold), "bad");
  // 红色阈值被抬到与橙色相同时, 跨过阈值直接变红
  const same = normalizePreferences({ warnThreshold: 80, dangerThreshold: 60 });
  assert.equal(usedTone(80, same.warnThreshold, same.dangerThreshold), "bad");
  assert.equal(usedTone(79, same.warnThreshold, same.dangerThreshold), "good");
});
