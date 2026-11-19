/**
 * [INPUT]: 依赖 SDK 的 experimental_ThreadContextCardRow / experimental_Icon / experimental_useRpcQuery / experimental_useRpcMutation; 依赖 rpc.ts 契约; 依赖 lib/i18n 的时长格式、hooks/use-language 的文案;
 *          依赖 sonner (BB 运行时垫片, 提示进 BB 通知中心); 依赖 components/ui/button (BB 组件库按钮)、components/card-section
 * [OUTPUT]: 对外提供 CodexSections (Resets: 每行常驻按钮, 未解锁灰掉并写解锁门槛, 解锁后为"使用/Use", 两步确认 + 幂等键; Credits) 与 ActivitySection (24h/7d/30d 的 token 与会话数)
 * [POS]: components 的数据分区, 卡片打开时挂载; 数据由 rail-rings 预热、随额度刷新一起过期 (hooks/use-usage-limits), 打开即有; 消费者: usage-card.tsx; 与 usage-card 的边界: 这里只画分区内容与重置交互
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  experimental_Icon as Icon,
  experimental_ThreadContextCardRow as CardRow,
  experimental_useRpcMutation,
  experimental_useRpcQuery,
} from "@get-bb/plugin-sdk/app";
import { rpcContract, TOKEN_PERIODS, type CodexAccount, type ResetCredit, type ResetOutcome } from "../rpc.ts";
import { DURATION, transition } from "../lib/motion.ts";
import { formatSpan, type Messages } from "../lib/i18n.ts";
import { formatTokens } from "../lib/usage.ts";
import { cn } from "../lib/utils.ts";
import { useI18n } from "../hooks/use-language.ts";
import { useAnimateIn, useReducedMotion } from "../hooks/use-motion.ts";
import { CardSection, SubLine } from "./card-section.tsx";
import { Button } from "./ui/button.tsx";

/** Codex 公布的 credit 标价, 用于折算美元 (与 Synara 一致) */
const CREDIT_PRICE_USD = 0.04;
const CREDITS = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function outcomeCopy(t: Messages, outcome: ResetOutcome): string {
  return { reset: t.outcomeReset, nothingToReset: t.outcomeNothingToReset, noCredit: t.outcomeNoCredit, alreadyRedeemed: t.outcomeAlreadyRedeemed }[outcome];
}

function RowIcon({ name }: { name: string }) {
  return <Icon name={name} fallback="Circle" aria-hidden={true} className="size-3.5 shrink-0 text-muted-foreground" />;
}

// ---------- Codex: Resets + Credits ----------

/** 重置成功后 onUsageChanged 让外层重新读额度, 圆环随之回满 */
export function CodexSections({ onUsageChanged }: { onUsageChanged(): void }) {
  const { t } = useI18n();
  const query = experimental_useRpcQuery({ contract: rpcContract, method: "codex_account", input: { refresh: false } });
  const account = query.data;
  if (!account) {
    return query.isLoading ? (
      <CardSection title={t.resets}>
        <SubLine>{t.readingAccount}</SubLine>
      </CardSection>
    ) : null;
  }
  if (account.status === "unavailable") {
    return (
      <CardSection title={t.resets}>
        <SubLine>{t.accountUnavailable(account.message)}</SubLine>
      </CardSection>
    );
  }
  return (
    <>
      <ResetsSection
        account={account}
        onDone={() => {
          void query.refetch();
          onUsageChanged();
        }}
      />
      {account.credits ? (
        <CardSection title={t.credits}>
          <CardRow
            leading={<RowIcon name="Layers" />}
            label={t.balance}
            trailing={
              account.credits.unlimited
                ? t.unlimited
                : `${CREDITS.format(account.credits.balance)} · ≈ ${USD.format(account.credits.balance * CREDIT_PRICE_USD)}`
            }
          />
        </CardSection>
      ) : null}
    </>
  );
}

type OkAccount = Extract<CodexAccount, { status: "ok" }>;
interface Attempt {
  idempotencyKey: string;
  creditId?: string;
}

const attemptKey = (accountId: string) => `bb-plugin-usage-rings:codex-reset:${accountId}`;

function readAttempt(accountId: string): Attempt | null {
  try {
    const raw = JSON.parse(localStorage.getItem(attemptKey(accountId)) ?? "null") as unknown;
    if (!raw || typeof raw !== "object") return null;
    const { idempotencyKey, creditId } = raw as Record<string, unknown>;
    if (typeof idempotencyKey !== "string" || (creditId !== undefined && typeof creditId !== "string")) return null;
    return { idempotencyKey, ...(creditId ? { creditId } : {}) };
  } catch {
    return null;
  }
}

/** 提示行: 说清门槛和当前用量, 未解锁的行才不会像坏了 */
function resetHint(t: Messages, account: OkAccount): string {
  const { resetThresholdPercent: threshold, peakUsedPercent: peak } = account;
  // 一行放得下 (约 40 字符), 否则 "5%" 会孤零零掉到第二行
  if (account.canUseReset) return t.hintReady(Math.round(peak ?? threshold));
  return t.hintLocked(threshold, peak === null ? null : Math.round(peak));
}

function ResetsSection({ account, onDone }: { account: OkAccount; onDone(): void }) {
  const { t, lang } = useI18n();
  const [attempt, setAttempt] = useState<Attempt | null>(() => readAttempt(account.accountId));
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const mutation = experimental_useRpcMutation({ contract: rpcContract, method: "codex_use_reset" });

  useEffect(() => {
    if (confirmId === null) return;
    const timer = window.setTimeout(() => setConfirmId(null), DURATION.confirm);
    return () => window.clearTimeout(timer);
  }, [confirmId]);

  const resets = account.resets;
  // 没给出逐个明细时, 只给一行"下一个可用的重置"
  const listed: (ResetCredit | null)[] = !resets ? [] : resets.credits.length > 0 ? resets.credits : resets.availableCount > 0 ? [null] : [];
  // 结果不明的那次可能其实已在 Codex 生效, 它就不会再出现在可用列表里;
  // 仍要给它留一行重试, 否则其他重置都被拦住, 用户被锁死 (Synara 同样处理)
  const pendingMissing = attempt !== null && !listed.some((credit) => credit?.id === attempt.creditId);
  const rows: (ResetCredit | null)[] = pendingMissing ? [{ id: attempt.creditId ?? "", expiresAt: null, title: null }, ...listed] : listed;
  if (rows.length === 0) return null;

  async function apply(creditId: string | undefined) {
    if (attempt && attempt.creditId !== creditId) {
      toast.error(t.retryPreviousFirst);
      return;
    }
    // 每次确认一个幂等键, 先落盘再发请求: 网络中断后重试的是同一次, 不会扣两次
    const current: Attempt = attempt ?? { idempotencyKey: crypto.randomUUID(), ...(creditId ? { creditId } : {}) };
    try {
      localStorage.setItem(attemptKey(account.accountId), JSON.stringify(current));
    } catch {
      // 存不下时仍可执行, 只是刷新页面后不能重试同一次
    }
    setAttempt(current);
    setConfirmId(null);
    try {
      const { outcome } = await mutation.mutate({ accountId: account.accountId, ...current });
      localStorage.removeItem(attemptKey(account.accountId));
      setAttempt(null);
      if (outcome === "reset" || outcome === "alreadyRedeemed") toast.success(outcomeCopy(t, outcome));
      else toast.info(outcomeCopy(t, outcome));
      onDone();
    } catch (cause) {
      const reason = cause instanceof Error && cause.message.trim() !== "" ? cause.message.trim().replace(/[.!?]?$/, ".") + " " : "";
      toast.error(t.resetNotConfirmed, { description: t.resetNotConfirmedDetail(reason) });
    }
  }

  return (
    <CardSection title={t.resets} trailing={t.available(resets?.availableCount ?? 0)}>
      <SubLine>{resetHint(t, account)}</SubLine>
      {rows.map((credit, index) => {
        const isPendingRow = pendingMissing && index === 0;
        const id = isPendingRow ? attempt?.creditId : credit?.id;
        const key = id ?? "next";
        const pending = attempt !== null && attempt.creditId === id;
        const number = pendingMissing ? index : index + 1;
        const state: ResetState =
          mutation.isPending && pending ? "applying" : pending ? "retry" : !account.canUseReset ? "locked" : confirmId === key ? "confirm" : "idle";
        const expires = credit?.expiresAt ? t.expiresIn(formatSpan(credit.expiresAt - Date.now(), lang, 1)) : null;
        return (
          <CardRow
            key={isPendingRow ? "pending" : key}
            leading={<RowIcon name={state === "locked" ? "Lock" : "SquareUnlock02"} />}
            label={
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="shrink-0">{isPendingRow ? t.unconfirmedReset : credit ? t.resetN(number) : t.nextReset}</span>
                {expires ? <span className="truncate text-[11px] text-subtle-foreground">{expires}</span> : null}
              </span>
            }
            // 按钮常驻: 未解锁时灰掉, 按钮上直接写原因; 解锁后就是 Use
            trailing={
              <ResetButton
                state={state}
                threshold={account.resetThresholdPercent}
                disabled={state === "locked" || mutation.isPending}
                onClick={() => {
                  if (pending || confirmId === key) void apply(id);
                  else setConfirmId(key);
                }}
              />
            }
          />
        );
      })}
    </CardSection>
  );
}

type ResetState = "idle" | "locked" | "confirm" | "applying" | "retry";
function ResetButton({ state, threshold, disabled, onClick }: { state: ResetState; threshold: number; disabled: boolean; onClick(): void }) {
  const { t } = useI18n();
  const label = { locked: t.unlocksAt(threshold), idle: t.use, confirm: t.confirm, applying: t.applying, retry: t.retry }[state];
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative h-5 gap-1 overflow-hidden px-1.5 text-[11px] active:scale-[.97] motion-reduce:transform-none",
        state === "confirm" && "border-destructive/60 text-destructive hover:text-destructive",
      )}
    >
      {state === "applying" ? (
        <span aria-hidden="true" className="size-2 animate-spin rounded-full border border-current border-r-transparent motion-reduce:animate-none" />
      ) : null}
      {label}
      {state === "confirm" ? <Countdown /> : null}
    </Button>
  );
}

/** 两步确认的倒计时细线: 4 秒内从满到空, 走完按钮自动复原 */
function Countdown() {
  const started = useAnimateIn();
  const reduced = useReducedMotion();
  return (
    <span
      aria-hidden="true"
      className="absolute inset-x-0 bottom-0 h-px origin-left bg-destructive/60"
      style={{ transform: `scaleX(${started && !reduced ? 0 : 1})`, transition: transition(reduced, [["transform", DURATION.confirm, "linear"]]) }}
    />
  );
}

// ---------- Activity: 24h / 7d / 30d ----------

export function ActivitySection({ providerId }: { providerId: string }) {
  const { t } = useI18n();
  const query = experimental_useRpcQuery({ contract: rpcContract, method: "token_totals", input: null });
  const totals = query.data;
  const collecting = totals?.state === "collecting";

  // 首次回填期间每 3 秒取一次, 数字逐步补齐
  useEffect(() => {
    if (!collecting) return;
    const timer = window.setInterval(() => void query.refetch(), 3000);
    return () => window.clearInterval(timer);
  }, [collecting, query.refetch]);

  const note = !totals ? null : collecting ? t.counting : t.bbSessions;
  const entry = totals?.byProvider[providerId];
  return (
    <CardSection title={t.activity} trailing={note ?? undefined}>
      {!totals ? (
        <SubLine>{query.isLoading ? t.countingSessions : t.activityUnavailable}</SubLine>
      ) : (
        TOKEN_PERIODS.map((period) => {
          const value = entry?.[period] ?? { tokens: 0, sessions: 0 };
          return (
            <CardRow
              key={period}
              leading={<RowIcon name="ChartColumn" />}
              label={t.period[period]}
              trailing={t.activityValue(formatTokens(value.tokens), value.sessions)}
            />
          );
        })
      )}
      {totals?.error ? <SubLine>{t.activityError(totals.error)}</SubLine> : null}
    </CardSection>
  );
}
