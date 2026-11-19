/**
 * [INPUT]: 依赖 SDK 的 useSettings (宿主下发的 language 设置, CLI 改动也会跟进) 与 experimental_useRpcMutation (写回设置); 依赖 lib/i18n 的判定与文案;
 *          依赖浏览器 localStorage (镜像) 与 <html lang> / navigator.language (auto 的依据)
 * [OUTPUT]: 对外提供 useI18n (当前语言 + 文案)、useLanguageSync (把宿主设置同步进本地)、useSetLanguage (设置页切换器用)、readStoredMessages (app.tsx 挂载时同步取文案)
 * [POS]: hooks 的语言状态层: 所有组件共用一个语言, 设置一改全部同时换; 消费者: components/*、app.tsx;
 *        与 lib/i18n 的边界: 这里只管"现在是哪种语言", 文案和格式化在 lib/i18n
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useEffect, useSyncExternalStore } from "react";
import { experimental_useRpcMutation, experimental_useRpcQuery, useSettings } from "@get-bb/plugin-sdk/app";
import { isLanguageSetting, MESSAGES, resolveLanguage, type Lang, type LanguageSetting, type Messages } from "../lib/i18n.ts";
import { rpcContract } from "../rpc.ts";

const STORAGE_KEY = "bb-plugin-usage-rings:language:v1";
const listeners = new Set<() => void>();

function readSetting(): LanguageSetting {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isLanguageSetting(stored) ? stored : "auto";
  } catch {
    return "auto";
  }
}

function writeSetting(next: LanguageSetting): void {
  if (readSetting() === next) return;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 存不下就只在本次会话生效
  }
  for (const listener of listeners) listener();
}

function hostLanguage(): string {
  return document.documentElement.lang || navigator.language || "";
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // auto 模式下宿主切换界面语言时也要跟着换
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  window.addEventListener("languagechange", onChange);
  return () => {
    listeners.delete(onChange);
    observer.disconnect();
    window.removeEventListener("languagechange", onChange);
  };
}

const snapshot = () => `${readSetting()}|${resolveLanguage(readSetting(), hostLanguage())}`;

export function useI18n(): { lang: Lang; setting: LanguageSetting; t: Messages } {
  const [setting, lang] = useSyncExternalStore(subscribe, snapshot, () => "auto|en").split("|") as [LanguageSetting, Lang];
  return { lang, setting, t: MESSAGES[lang] };
}

/** 宿主里的设置是唯一真相源 (设置页切换器与 bb plugin config 都写它), 这里只把它镜像到本地, 让同步读取的地方也拿得到 */
export function useLanguageSync(): void {
  const { values } = useSettings();
  // 宿主设置值随改随到 (含 CLI); 拿不到时退回本插件的 language RPC
  const query = experimental_useRpcQuery({ contract: rpcContract, method: "language", input: null, enabled: values?.language === undefined });
  const remote = values?.language ?? query.data?.language;
  useEffect(() => {
    if (isLanguageSetting(remote)) writeSetting(remote);
  }, [remote]);
}

export function useSetLanguage(): (next: LanguageSetting) => void {
  const mutation = experimental_useRpcMutation({ contract: rpcContract, method: "set_language" });
  return (next) => {
    writeSetting(next); // 先在本地生效, 不等往返
    void mutation.mutate({ language: next }).catch(() => undefined);
  };
}

/** app.tsx 注册设置页标题时还没有 React, 只能同步读本地镜像 */
export function readStoredMessages(): Messages {
  return MESSAGES[resolveLanguage(readSetting(), hostLanguage())];
}
