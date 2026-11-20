/**
 * [INPUT]: 依赖 @get-bb/plugin-sdk/app 的 useRpc 调本插件的 limits (后端汇总全部 BB 用量来源, 与 bb 自带 Provider usage 卡片同源)、experimental_useRpcRefresh 让卡片分区的查询一起过期;
 *          依赖 lib/usage 的 normalizeUsage / mergeLastKnown (单个提供方出错时保留上次读数)
 * [OUTPUT]: 对外提供 useUsageLimits: 轮询额度并给出 { providers, updatedAt, error, refreshing, refresh }; useNow: 按间隔刷新的当前时间
 * [POS]: hooks 的数据层, 也是卡片数据的刷新节拍 (额度每读一次, Resets/Credits/Activity 的缓存随之过期); 消费者: components/rail-rings.tsx、components/settings-overview.tsx;
 *        与 hooks/use-rail-slot.ts 的边界: 本文件只管数据, 不碰 DOM
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { experimental_useRpcRefresh, useRpc } from "@get-bb/plugin-sdk/app";
import { mergeLastKnown, normalizeUsage, type ProviderUsage } from "../lib/usage.ts";
import type { rpcContract } from "../rpc.ts";
import { usePreferences } from "./use-preferences.ts";

/** 窗口重新可见时, 数据旧于该值才重拉 */
const STALE_ON_FOCUS_MS = 2 * 60_000;

export interface UsageLimitsState {
  providers: ProviderUsage[];
  /** 最近一次成功拉取的时刻; 从未成功为 null */
  updatedAt: number | null;
  /** 最近一次失败的原因; 失败时保留上一次成功的数据 */
  error: string | null;
  refreshing: boolean;
  /** 手动刷新: 要求宿主绕过缓存重新采集 */
  refresh(): void;
}

export function useUsageLimits(): UsageLimitsState {
  // 客户端对象未必跨渲染稳定; 放进 ref, 轮询与监听只在挂载时启动一次
  const rpc = useRpc<typeof rpcContract>();
  const rpcRef = useRef(rpc);
  // 自动重读间隔来自偏好 refreshIntervalMinutes (1-60 分钟)
  const pollMs = usePreferences().refreshIntervalMinutes * 60_000;
  rpcRef.current = rpc;
  // BB 的 RPC 查询缓存到被作废为止; 不跟着额度一起作废, 重置次数与 token 统计会停在页面打开那一刻
  const queries = experimental_useRpcRefresh();
  const queriesRef = useRef(queries);
  queriesRef.current = queries;
  const loadedOnce = useRef(false);
  const [providers, setProviders] = useState<ProviderUsage[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef<AbortController | null>(null);
  const updatedAtRef = useRef<number | null>(null);

  const load = useCallback(
    async (refresh: boolean) => {
      // 手动刷新抢占自动轮询; 自动轮询遇到进行中的请求就跳过
      if (inFlight.current !== null) {
        if (!refresh) return;
        inFlight.current.abort();
      }
      const controller = new AbortController();
      inFlight.current = controller;
      setRefreshing(true);
      try {
        const raw = await rpcRef.current.call("limits", { refresh });
        if (controller.signal.aborted) return;
        const now = Date.now();
        setProviders((previous) => mergeLastKnown(previous, normalizeUsage(raw)));
        // 首次读取时分区数据刚预热过, 之后每次 (定时轮询或手动刷新) 都让它们重新取
        if (loadedOnce.current) queriesRef.current.refresh();
        loadedOnce.current = true;
        setUpdatedAt(now);
        updatedAtRef.current = now;
        setError(null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Usage could not be loaded.");
      } finally {
        if (inFlight.current === controller) {
          inFlight.current = null;
          setRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(false), pollMs);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const last = updatedAtRef.current;
      if (last === null || Date.now() - last > STALE_ON_FOCUS_MS) void load(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [load, pollMs]);

  const refresh = useCallback(() => void load(true), [load]);
  return { providers, updatedAt, error, refreshing, refresh };
}

/** "Resets in …" 这类相对时间需要随时间推进重算 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
