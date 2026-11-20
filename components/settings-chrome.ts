/**
 * [INPUT]: 依赖 bb 插件详情页的 DOM 结构 ([data-resource-detail-section] 分区、[data-settings-anchor="<标签>"] 表单行、插件描述文本);
 *          依赖 lib/preferences 的设置标签、hooks/use-language 的文案
 * [OUTPUT]: 对外提供 useHostSettingsChrome: 设置页挂载期间, 把宿主按 bb.settings 自动生成的英文表单行藏起来 (本插件的双语偏好面板替代它),
 *           并把分区标题 "Configuration"、插件描述、本插件设置分区的标题与说明换成当前语言 (随语言切换即时更新); 卸载时全部还原
 * [POS]: components 里唯一碰宿主设置页 DOM 的地方 (做法同 session-cockpit); 结构对不上时什么也不做, 宿主表单原样显示, CLI 始终可用;
 *        消费者: components/settings-overview.tsx
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useEffect } from "react";
import { MESSAGES } from "../lib/i18n.ts";
import { SETTING_LABELS } from "../lib/preferences.ts";
import { useI18n } from "../hooks/use-language.ts";

const LABELS = new Set(Object.values(SETTING_LABELS));
const TRANSLATED = ["pluginDescription", "settingsTitle", "settingsDescription"] as const;

/** 节点所在的宿主分区里有本插件的设置面板 */
function nearPanel(node: Element): boolean {
  let el: Element | null = node.parentElement;
  for (let i = 0; i < 6 && el; i++, el = el.parentElement) if (el.querySelector("[data-usage-rings-settings]")) return true;
  return false;
}

export function useHostSettingsChrome(): void {
  const { t } = useI18n();
  useEffect(() => {
    const restores = new Map<Node, () => void>();
    const remember = (node: Node, undo: () => void) => {
      if (!restores.has(node)) restores.set(node, undo);
    };
    const apply = () => {
      for (const row of Array.from(document.querySelectorAll<HTMLElement>("[data-settings-anchor]"))) {
        if (!LABELS.has(row.getAttribute("data-settings-anchor") ?? "")) continue;
        const previous = row.style.display;
        remember(row, () => (row.style.display = previous));
        row.style.display = "none";
        const section = row.closest("[data-resource-detail-section]") as HTMLElement | null;
        if (!section) continue;
        // 行全藏了, 包着它们的那张卡片 (边框) 也要藏, 否则留下一个空框; 往上找到不含本插件面板的最外层容器为止
        let box: HTMLElement | null = null;
        for (let el = row.parentElement; el && el !== section && !el.querySelector("[data-usage-rings-settings]"); el = el.parentElement) {
          const rows = Array.from(el.querySelectorAll<HTMLElement>("[data-settings-anchor]"));
          if (rows.some((r) => r.style.display !== "none")) break;
          box = el;
        }
        if (box && box.style.display !== "none") {
          const target = box;
          const shown = target.style.display;
          remember(target, () => (target.style.display = shown));
          target.style.display = "none";
        }
        const visibleRows = Array.from(section.querySelectorAll<HTMLElement>("[data-settings-anchor]")).filter((r) => r.style.display !== "none");
        const ownsPanel = section.querySelector("[data-usage-rings-settings]") !== null;
        // 分区里既没剩宿主的行、也没有本插件面板: 整个分区 (含标题) 一起藏; 否则只把 "Configuration" 标题换成当前语言
        if (visibleRows.length === 0 && !ownsPanel) {
          const shown = section.style.display;
          remember(section, () => (section.style.display = shown));
          section.style.display = "none";
        } else {
          const heading = section.querySelector("h2, h3");
          // 只在文字不同才写: 写入本身也是 DOM 变化, 不加判断会和观察者互相触发
          if (heading && heading.textContent !== t.configuration && (heading.textContent === MESSAGES.en.configuration || heading.textContent === MESSAGES.zh.configuration)) {
            remember(heading, () => (heading.textContent = MESSAGES.en.configuration));
            heading.textContent = t.configuration;
          }
        }
      }
      // 插件描述 (package.json, 英文) 与本插件设置分区的标题、说明 (注册时按当时语言写死) 都换成当前语言
      for (const node of Array.from(document.querySelectorAll<HTMLElement>("p, span, h2, h3, h4"))) {
        if (node.childElementCount > 0) continue;
        const text = node.textContent?.trim() ?? "";
        const key = TRANSLATED.find((k) => text === MESSAGES.en[k] || text === MESSAGES.zh[k]);
        // 只翻本插件设置分区附近的 "Usage" 标题, 不碰宿主别处同名的字
        if (!key || text === t[key] || (key === "settingsTitle" && !nearPanel(node))) continue;
        const original = text;
        remember(node, () => (node.textContent = original));
        node.textContent = t[key];
      }
    };
    apply();
    // 宿主的表单是异步渲染的, 观察到变化再补一次
    const observer = new MutationObserver(() => apply());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const undo of restores.values()) undo();
    };
  }, [t]);
}
