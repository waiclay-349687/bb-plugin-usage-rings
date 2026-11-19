/**
 * [INPUT]: 依赖 @get-bb/plugin-sdk/app 的 definePluginApp、experimental_appOverlay 与 settingsSection 插槽; 依赖 components/rail-rings、components/settings-overview
 * [OUTPUT]: 对外提供插件前端入口 (default export): 一个 app overlay (把额度圆环 portal 进侧边栏 rail) + 插件设置页里的用量总览
 * [POS]: 插件前端注册层, 只做"哪个视图挂到 bb 哪个位置"; 消费者: bb 宿主; 与 components 的边界: 本文件不含视图逻辑
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { RailRings } from "./components/rail-rings.tsx";
import { SettingsOverview } from "./components/settings-overview.tsx";

export default definePluginApp((app) => {
  // 用 overlay 而不是接管导航插槽: 不改用户的导航设置, 也不与其他导航插件抢独占位
  app.slots.experimental_appOverlay({ id: "rail-rings", component: RailRings });
  app.slots.settingsSection({
    id: "overview",
    title: "Usage",
    description: "Every provider that reports plan limits, with pace, resets and activity.",
    component: SettingsOverview,
  });
});
