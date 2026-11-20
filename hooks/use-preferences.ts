/**
 * [INPUT]: 依赖 SDK 的 useSettings (宿主下发的插件设置, CLI 改动随改随到)、experimental_useRpcQuery / experimental_useRpcMutation (preferences 读写 RPC);
 *          依赖 lib/preferences 的默认值与校验; 依赖浏览器 localStorage (镜像, 让同步读取的地方也拿得到)
 * [OUTPUT]: 对外提供 usePreferences (当前偏好)、usePreferencesSync (把宿主设置镜像进本地)、useUpdatePreferences (改几项 / 恢复默认)、readStoredPreferences (非 React 处同步读)
 * [POS]: hooks 的偏好状态层: 所有组件共用一个外部 store, 设置一改圆环、卡片、设置页同时变; 真相源是宿主的插件设置, 这里只是镜像 + 乐观更新;
 *        消费者: hooks/use-language.ts、hooks/use-usage-limits.ts、hooks/use-motion.ts、components/*; 与 lib/preferences 的边界: 校验规则在那里, 这里只管状态
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useEffect, useSyncExternalStore } from "react";
import { experimental_useRpcMutation, experimental_useRpcQuery, useSettings } from "@get-bb/plugin-sdk/app";
import { DEFAULT_PREFERENCES, normalizePreferences, PREFERENCE_KEYS, type Preferences } from "../lib/preferences.ts";
import { rpcContract } from "../rpc.ts";
import { forgetDetailsOpen } from "./use-motion.ts";

const STORAGE_KEY = "bb-plugin-usage-rings:preferences:v1";
/** 上一版只存了语言; 首次读取时沿用它, 免得升级后语言闪回 auto */
const LEGACY_LANGUAGE_KEY = "bb-plugin-usage-rings:language:v1";
const listeners = new Set<() => void>();
let current: Preferences | null = null;

function load(): Preferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return normalizePreferences(JSON.parse(stored));
    return normalizePreferences({ language: localStorage.getItem(LEGACY_LANGUAGE_KEY) });
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function readStoredPreferences(): Preferences {
  current ??= load();
  return current;
}

const same = (a: Preferences, b: Preferences) => PREFERENCE_KEYS.every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]));

function write(next: Preferences): void {
  if (same(readStoredPreferences(), next)) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 存不下就只在本次会话生效
  }
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, readStoredPreferences, () => DEFAULT_PREFERENCES);
}

/** 宿主设置值随改随到 (含 CLI); 拿不到时退回 preferences RPC。挂在每个入口组件上 (rail 与设置页) */
export function usePreferencesSync(): void {
  const { values } = useSettings();
  const query = experimental_useRpcQuery({ contract: rpcContract, method: "preferences", input: null, enabled: values === undefined });
  const remote = values ?? query.data;
  const key = remote ? JSON.stringify(normalizePreferences(remote)) : null;
  useEffect(() => {
    if (key !== null) write(JSON.parse(key) as Preferences);
  }, [key]);
}

export function useUpdatePreferences(): { update(patch: Partial<Preferences>): void; reset(): void } {
  const set = experimental_useRpcMutation({ contract: rpcContract, method: "set_preferences" });
  const clear = experimental_useRpcMutation({ contract: rpcContract, method: "reset_preferences" });
  return {
    update(patch) {
      if (patch.defaultDetailsOpen !== undefined) forgetDetailsOpen();
      // 先在本地按同一套规则生效, 不等往返; 服务端写入前再校验一次
      write(normalizePreferences({ ...readStoredPreferences(), ...patch }));
      void set.mutate(patch).then(write, () => undefined);
    },
    reset() {
      forgetDetailsOpen();
      write(DEFAULT_PREFERENCES);
      void clear.mutate(null).then(write, () => undefined);
    },
  };
}
