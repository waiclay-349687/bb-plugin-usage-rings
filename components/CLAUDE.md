# components/
> L2 | 父级: ../CLAUDE.md

## 成员清单
rail-rings.tsx: RailRings，app overlay；取 rail 挂载点、额度数据与提供方信息，把圆环列 portal 进 rail（容器带插件作用域，Tailwind 类才生效）；整列圆环共用一张 Radix Popover 悬浮卡片，锚点是 useFollowAnchor 给的虚拟锚点（底边贴当前圆环、右侧 8px，updatePositionStrategy=always 每帧重读），换圆环时卡片平移过去，MorphHeight 伸缩高度，内容淡出再淡入（上一张盖在上面 100ms 淡出、150ms 后移除并 inert，新内容晚 60ms 按切换方向从上/下轻推 4px 淡入），切换时进度条不重新填充；外壳照 BB 会话页上下文卡片（w-72 rounded-md border bg-popover shadow-md，进出场同 BB PopoverContent）；挂载时预热 token_totals 与 codex_account，首次悬停不跳高
usage-ring.tsx: UsageRing，32px 圆环触发器（GHOST_CONTROL 反馈 + 悬停与卡片显示它时轨道加深；环长 = 最紧窗口已用%，首次从 0 画出，数值变化 600ms 过渡；颜色看用量；用尽即整圈状态色；出错灰环 + 红点弹出）；不设 title，免得原生提示与卡片叠在一起
morph-height.tsx: MorphHeight，morphKey 变化（换圆环）时外框从旧高度 200ms 快起缓停伸缩到新高度（直接写样式，起点在本帧落定；途中内容再变就改追新高度），平时 height:auto；Details 展开不经它，免得两套过渡互相追
collapse.tsx: Collapse，grid 行 0fr↔1fr + 淡入淡出（与 session-cockpit 同一技法），收起时 inert
usage-card.tsx: UsageCard，悬浮卡片与设置页共用的卡片内容：头部（提供方图标 + 名称 + 套餐标签，套餐名已含在名称里时不显示）、出错提示、Limits（窗口名带 “X · ” 前缀时按前缀分区）、可折叠的 Details（Codex 的 Resets/Credits、Activity；默认收起、记住开关）、Details 开关行（在内容下方，收起时箭头朝上并写里面有什么）、刷新行（整行可点，刷新中图标旋转，右侧写更新时间）；animateFill 控制进度条是否从 0 填充
card-section.tsx: CardSection（分区：灰色小标题 + 可选右侧注记，非首个分区带细分隔线，规格同 BB 上下文卡片）、SubLine（行下 11px 说明，与行标签对齐）
window-row.tsx: WindowRow，一个额度窗口 = 标题行（窗口名 · “N% used”，琥珀/红随用量 · 右侧 “Resets in …”，放不下只截窗口名）+ 整行宽 6px 进度条（卡片里最醒目的元素，左右与分区标题对齐）+ 余量/结论行；进度条打开时从 0 填充、逐行错开 40ms，配速刻度随后淡入并挖底色缺口；提示与读屏用含分组前缀的全名
sections.tsx: CodexSections 与 ActivitySection。Resets：每行右侧常驻按钮；某窗口用到门槛 90% 才可用，未达时按钮灰掉、按钮上写 “Unlocks at 90%”，提示行写当前用量，门槛与用量由后端下发；达到后按钮为 Use，两步确认 + 4 秒倒计时细线；幂等键先落盘再请求，结果不明只能重试同一次；那次若已生效、不在可用列表里，单独补一行 “Unconfirmed reset” 供重试，避免锁死。Credits（≈ 美元）。Activity：各提供方 24h/7d/30d 的 token 与会话数（首次回填期间每 3 秒补数）
tone.ts: 状态 → BB 主题色类（text / bg）
control.ts: GHOST_CONTROL，圆环的交互反馈 = BB ghost 按钮（悬停 state-hover 即时出现、离开 150ms 淡出，卡片显示它时 state-active）+ 按下 state-active；卡片里的行用 BB 原生行自带反馈
presentation.ts: useProviderPresentation，providerId → BB 里的名称、图标、品牌色
settings-overview.tsx: SettingsOverview，插件设置页：顶部语言切换器（自动 / English / 简体中文，点了立即生效并写回宿主设置）+ 总览，每个提供方一张 UsageCard（外壳同悬浮卡片，不带阴影）
ui/button.tsx、ui/motion.ts: BB 组件库 vendored（按钮与控件悬停过渡），L3 豁免

所有界面文字都经 hooks/use-language 的 useI18n 取自 lib/i18n，组件里不写字面文案。

## 边界
本模块负责: 视图、交互与动效的落地
本模块不负责: 取数与挂载点（hooks/）、数值计算与动效参数（lib/）
上游: hooks/、lib/、rpc.ts、@get-bb/plugin-sdk/app（含 experimental_ThreadContextCardRow）、@radix-ui/react-popover、sonner
下游: app.tsx

[PROTOCOL]: 变更时更新此文件,然后检查父级 CLAUDE.md
