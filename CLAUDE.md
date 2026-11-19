# bb-plugin-usage-rings: 在 bb 侧边栏 rail 底部用圆环显示各 agent 的套餐额度, 悬停看配速、重置与用量
TypeScript 5.9 + React 19 + zod 4 + @get-bb/plugin-sdk 0.6.132（bb 0.49）+ @radix-ui/react-popover（BB 运行时共享）+ Tailwind（BB 主题）+ better-sqlite3（BB 插件存储）+ Node 22 内置测试器

<directory>
lib/: 纯逻辑与服务端适配（额度归一与配速、动效常量、BB 用量协议与来源汇总、Antigravity 采集、Codex 账户、token 收集器），见 lib/CLAUDE.md
hooks/: 额度轮询、rail 挂载点（唯一依赖宿主 DOM 的适配缝）、共用悬浮卡片的开合、动效状态，见 hooks/CLAUDE.md
components/: 圆环、共用悬浮卡片（分区 + BB 原生行）、窗口行、Codex/Activity 分区、设置页总览；components/ui/ 是 BB 组件库 vendored 的按钮，见 components/CLAUDE.md
test/: 单测（中英文案纯度与语言判定、配速对齐 Synara 参考截图的数值、Codex 与 Antigravity 返回解析、来源合并、token 差分、出错保留上次读数）
assets/: 插件图标（单色 SVG，宿主按 mask 着色）
</directory>

<config>
package.json: 插件清单（bb.server / bb.app / branding）与 npm 脚本
app.tsx: 前端注册（experimental_appOverlay + settingsSection）
server.ts: 后端入口，注册插件设置 language（auto / en / zh）、私有 RPC（limits / token_totals / codex_account / codex_use_reset / language / set_language）与可被发现的 BB 用量来源（Antigravity）
rpc.ts: 前后端共享 RPC 契约
LICENSE: 本仓库 MIT 许可
THIRD_PARTY_NOTICES.md: lib/token-totals.ts 改编自 Usage Bar（MIT）的许可声明
PLUGIN_OVERVIEW.md: 商店详情文案，与 bb.description 保持一致
</config>

<commands>
typecheck: npm run typecheck
lint: 无（项目未配置 linter）
test: npm test
build: npm run build（= bb plugin build）
全量: npm run check
安装/重载: bb plugin install "path:$PWD" --yes / bb plugin reload usage-rings
</commands>

<design-system>
颜色只用 BB 主题类（success / warning / destructive / muted / border / popover / subtle-foreground），不写任何色值；提供方图标与品牌色由 experimental_ProviderIcon 读 BB 的提供方信息。
卡片照 BB 会话页上下文卡片：外壳 w-72 rounded-md border bg-popover p-2 shadow-md，分区标题 text-xs 中粗 muted、分区间 border-t，行直接用 SDK 的 experimental_ThreadContextCardRow（26px，悬停 state-hover，可点行与 action 机制都是原生的）；字号：正文 text-xs、辅助 11px、套餐标签 text-2xs（同 BB 自带用量卡片）；圆角：卡片与按钮 rounded-md、标签 rounded-sm。
动效参数只在 lib/motion.ts：BB 默认 150ms + cubic-bezier(.4,0,.2,1)；卡片进出场与 BB PopoverContent 同一组类（淡入 + 95% 缩放）；悬停 100ms 打开、离开 200ms 收起（收起延迟同 BB 上下文圆环）；整列圆环共用一张卡片，底边贴着当前圆环；换圆环时卡片 200ms 快起缓停平移到新圆环、高度同步伸缩，内容“淡出再淡入”（旧内容 100ms 反向推出淡掉，新内容晚 60ms 朝切换方向轻推 4px 淡入，不叠重影），进度条切换时直接到位、只在打开时从 0 填充；Details 用 grid 行 0fr↔1fr 展开 200ms，开关行在内容下方，卡片往上长、开关留在指针下；常驻元素不做循环动画；“减少动态效果”下只保留极短淡入淡出。
配速与配色规则只在 lib/usage.ts（Synara 算法：已过时间下限 5%，按窗口结束时预计用量分 ahead / on-track / behind，余量/赤字四舍五入为 0 一律算 on-track（文案 On pace 与判定同一条规则）；界面一律显示“已用”：环长与填充 = 已用，每个窗口一根整行宽 6px 进度条，看用量 ≥75 琥珀 ≥90 红；刻度 = 匀速时此刻应用到的位置，颜色看配速）。
交互：圆环只悬停触发，鼠标点击不做事；键盘 Enter 打开并把焦点移进卡片、Esc 回到圆环；触屏点按开合（hooks/use-hover-card.ts）。圆环的悬停反馈只在 components/control.ts（BB ghost 按钮的 state-hover / state-active），卡片里的行用原生行自带反馈，不各写各的悬停样式。
悬浮卡片与设置页共用 UsageCard / WindowRow，改一处两处同变。
语言：界面文案只在 lib/i18n.ts（en / zh 两套），组件一律经 hooks/use-language.ts 的 useI18n 取字；零混用：英文模式不出现汉字，中文模式不出现英文界面词（品牌、模型、套餐名与数量单位除外，后端给的英文原文在中文模式下换成概括说法）；语言切换器里各语言用自己的写法（English / 简体中文），是唯一例外；test/i18n.test.ts 机械校验两套文案的纯度。设置值存在宿主插件设置里（bb plugin config usage-rings set language zh），前端镜像到 localStorage `bb-plugin-usage-rings:language:v1`。
</design-system>

<compatibility>
私有 RPC 只给本插件前端用，可自由演进；对外提供的 provider-usage.v1 来源（Antigravity）须保持协议结构不变，BB 自带用量卡片也在读。
依赖的宿主契约：BB 用量来源协议 provider-usage.v1（experimental_discoverRpc + callRpc，结构见 lib/usage-protocol.ts）；thread/tokenUsage/updated 事件；宿主 DOM `nav[data-sidebar-navigation-placement="rail"]`（仅 hooks/use-rail-slot.ts，找不到时不渲染）。
依赖本机 `codex` 命令行 app-server 的 account/rateLimits/read 与 account/rateLimitResetCredit/consume（可用 CODEX_BIN 指定路径）；依赖本机 `agy` 的 `/usage`（可用 AGY_BIN 指定路径），且 BB 里注册了 id 含 antigravity 的提供方才提供该来源。
插件 SQLite 表 token_events / token_cursors / token_sessions 可随时清空重建（只是缓存）；本机 localStorage：`bb-plugin-usage-rings:language:v1`（界面语言镜像，真相源是宿主的插件设置）、`bb-plugin-usage-rings:details-open:v1`（Details 开关，所有卡片共享）、`bb-plugin-usage-rings:codex-reset:<accountId>`（未确认的重置尝试，改结构时升版本号）。
导航方式为 Top list 或窄屏无 rail 时不显示圆环，设置页总览仍可用。
L3 豁免（零适配逻辑的脚手架/组件库文件）：lib/portal-scope.ts、lib/utils.ts、components/ui/button.tsx、components/ui/motion.ts
</compatibility>
