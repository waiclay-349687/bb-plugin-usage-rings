# hooks/
> L2 | 父级: ../CLAUDE.md

## 成员清单
use-usage-limits.ts: useUsageLimits 每 5 分钟、以及窗口重新可见且数据旧于 2 分钟时调用本插件的 limits RPC（后端汇总全部 BB 用量来源；RPC 客户端放 ref，轮询只启动一次）；手动刷新传 refresh: true 并抢占进行中的请求；整次失败保留上次数据并给出 error，单个提供方失败经 mergeLastKnown 保留上次窗口；除首次外每次读到额度都经 experimental_useRpcRefresh 让本插件的 RPC 查询（Resets/Credits/Activity）过期重取。useNow 定时推进当前时间
use-rail-slot.ts: useRailSlot 在 `nav[data-sidebar-navigation-placement="rail"]` 末尾追加独占容器（落在 rail 底部、Settings 之上），MutationObserver + rAF 合并跟随 nav 重建，卸载时移除
use-hover-card.ts: useHoverCard 整列圆环共用一张悬浮卡片：悬停 100ms 打开、离开 200ms 收起，指针移进卡片保持打开；卡片开着时划到别的圆环立即换内容（给出 switchedFrom 供滑入方向、switchCount 供淡出层计时）；鼠标点击不做事，键盘 Enter 打开并移焦进卡片、Esc 把焦点还给圆环，触屏点按开合；只认键盘焦点，悬停打开不抢焦点（同 BB 会话页上下文圆环）；triggerElement 给出圆环元素供定位
use-follow-anchor.ts: useFollowAnchor 给 Popover.Anchor 的虚拟锚点：渲染时就指向当前圆环（首次打开即定位正确）；卡片开着时换圆环，纵向用 easeOut 在 200ms 内从此刻所在位置滑到新圆环，关着时换圆环直接到位；减少动态效果下不滑
use-language.ts: useI18n 给出当前语言与文案（所有组件共用一个外部 store，设置一改全部同时换；auto 时监听 <html lang> 与浏览器语言变化）；useLanguageSync 把宿主插件设置（useSettings，拿不到时退回 language RPC）镜像到 localStorage；useSetLanguage 先本地生效再经 set_language RPC 写回宿主；readStoredMessages 给 app.tsx 注册设置页标题时同步取文案
use-motion.ts: useReducedMotion（系统“减少动态效果”）、useAnimateIn（挂载两帧后为真，驱动从 0 过渡到目标值）、useDetailsOpen（Details 展开状态存 localStorage，所有卡片共享）

## 边界
本模块负责: 数据来源、宿主挂载点、交互状态这三类副作用
本模块不负责: 数值计算与动效参数（lib/）、视图（components/）
上游: @get-bb/plugin-sdk/app、宿主 DOM、lib/
下游: components/

[PROTOCOL]: 变更时更新此文件,然后检查父级 CLAUDE.md
