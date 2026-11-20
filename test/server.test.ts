import { test } from "node:test";
import assert from "node:assert/strict";
import { canUseReset, parseRateLimits } from "../lib/codex-account.ts";
import { tokenDelta } from "../lib/token-totals.ts";
import { mergeLastKnown, type ProviderUsage } from "../lib/usage.ts";

const NOW = 1_795_000_000_000;

// 实测 codex app-server 的 account/rateLimits/read 返回结构 (id 已替换)
function sample(usedPercent: number) {
  const core = {
    limitId: "codex",
    primary: { usedPercent, windowDurationMins: 10080, resetsAt: 1795588808 },
    secondary: null,
    credits: { hasCredits: true, unlimited: false, balance: "62495.2866937500" },
    planType: "pro",
  };
  return {
    accountId: "acct-1",
    rateLimits: core,
    rateLimitsByLimitId: { codex: core },
    rateLimitResetCredits: {
      availableCount: 3,
      credits: [
        { id: "c2", status: "available", expiresAt: 1796164896, title: "Full reset" },
        { id: "c1", status: "available", expiresAt: 1796069530, title: "Full reset" },
        { id: "old", status: "available", expiresAt: 1700000000, title: "Expired" },
        { id: "used", status: "redeemed", expiresAt: 1797114977, title: "Full reset" },
      ],
    },
  };
}

test("parseRateLimits reads credits and available resets, soonest expiry first", () => {
  const account = parseRateLimits(sample(2), NOW, 90);
  assert.equal(account.status, "ok");
  if (account.status !== "ok") return;
  assert.equal(account.accountId, "acct-1");
  assert.deepEqual(account.credits, { balance: 62495.28669375, unlimited: false });
  assert.equal(account.resets?.availableCount, 3);
  assert.deepEqual(account.resets?.credits.map((c) => c.id), ["c1", "c2"]);
  assert.equal(account.resets?.credits[0].expiresAt, 1796069530_000);
  assert.equal(account.canUseReset, false);
  assert.equal(account.resetThresholdPercent, 90);
  assert.equal(account.peakUsedPercent, 2);
});

test("resets become usable once a window reaches the configured threshold", () => {
  assert.equal(canUseReset(sample(89), 90), false);
  assert.equal(canUseReset(sample(90), 90), true);
  assert.equal(canUseReset({ accountId: "x" }, 90), undefined);
  const nearlyOut = parseRateLimits(sample(93), NOW, 90);
  assert.ok(nearlyOut.status === "ok" && nearlyOut.canUseReset);
  // 门槛调低后, 同一份读数立即可用, 且下发的门槛跟着变
  assert.equal(canUseReset(sample(60), 60), true);
  const lowered = parseRateLimits(sample(60), NOW, 60);
  assert.ok(lowered.status === "ok" && lowered.canUseReset && lowered.resetThresholdPercent === 60);
  assert.equal(canUseReset(sample(95), 100), false);
});

test("parseRateLimits without an account is unavailable", () => {
  assert.equal(parseRateLimits({ rateLimits: {} }, NOW, 90).status, "unavailable");
  assert.equal(parseRateLimits(null, NOW, 90).status, "unavailable");
});

test("tokenDelta turns cumulative totals into increments", () => {
  assert.equal(tokenDelta(1000, 1000), 1000); // 首次见到: 取本次
  assert.equal(tokenDelta(1500, 500, 1000), 500); // 累计增加
  assert.equal(tokenDelta(300, 300, 1500), 300); // 新会话累计归零
  assert.equal(tokenDelta(-1, 5), 0);
});

test("mergeLastKnown keeps the previous reading when a provider fails", () => {
  const ok: ProviderUsage = { providerId: "codex", status: "ok", planLabel: "Pro", windows: [{ label: "Weekly limit", usedPercent: 40, resetsAt: NOW, kind: "weekly" }] };
  const failed: ProviderUsage = { providerId: "codex", status: "error", planLabel: null, message: "Timed out." };
  const merged = mergeLastKnown([ok], [failed]);
  assert.equal(merged[0].status, "ok");
  assert.equal(merged[0].status === "ok" && merged[0].staleMessage, "Timed out.");
  assert.equal(merged[0].status === "ok" && merged[0].planLabel, "Pro");
  assert.deepEqual(mergeLastKnown([], [failed]), [failed]);
});
