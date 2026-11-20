/**
 * [INPUT]: 依赖 hooks/use-preferences 的偏好 store (language 是其中一项); 依赖 lib/i18n 的判定与文案; 依赖 <html lang> / navigator.language (auto 的依据)
 * [OUTPUT]: 对外提供 useI18n (当前语言 + 文案) 与 readStoredMessages (app.tsx 注册设置页标题时同步取文案)
 * [POS]: hooks 的语言层: 所有组件共用一个语言, 设置一改全部同时换; auto 时跟随宿主语言变化; 消费者: components/*、app.tsx;
 *        与 use-preferences 的边界: 那边管设置值, 这里只把 language 解析成 en / zh 并给出文案
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useSyncExternalStore } from "react";
import { MESSAGES, resolveLanguage, type Lang, type LanguageSetting, type Messages } from "../lib/i18n.ts";
import { readStoredPreferences, usePreferences } from "./use-preferences.ts";

function hostLanguage(): string {
  return document.documentElement.lang || navigator.language || "";
}

function subscribeHost(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  window.addEventListener("languagechange", onChange);
  return () => {
    observer.disconnect();
    window.removeEventListener("languagechange", onChange);
  };
}

export function useI18n(): { lang: Lang; setting: LanguageSetting; t: Messages } {
  const setting = usePreferences().language;
  const host = useSyncExternalStore(subscribeHost, hostLanguage, () => "");
  const lang = resolveLanguage(setting, host);
  return { lang, setting, t: MESSAGES[lang] };
}

/** 注册设置页时还没有 React, 只能同步读本地镜像 */
export function readStoredMessages(): Messages {
  return MESSAGES[resolveLanguage(readStoredPreferences().language, hostLanguage())];
}
