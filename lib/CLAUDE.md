# lib/
> L2 | 父级: ../CLAUDE.md

## 成员清单
usage.ts: 额度核心逻辑，纯函数；normalizeUsage 校验宿主原始响应（只留 ok / error，保持提供方顺序），mergeLastKnown 单个提供方出错时沿用上次窗口并标 staleMessage，paceOf 按 Synara 算法算配速（已过时间下限 5%，预计用量 ≤80 ahead / ≤100 on-track / 否则 behind，余量/赤字四舍五入为 0 一律 on-track，预计用完时间只在 behind 时算），paceCopy 拼“N% in deficit / Runs out in …”文案（算不出配速时不重复“N% used”），usedTone（用到 75% 琥珀、90% 红）/ paceTone 两层配色，primaryWindow、formatTokens、windowTitle、groupWindows（“Gemini · 5-hour”这类带前缀的窗口按前缀分组，行内只显示后半段）
usage-protocol.ts: BB 用量来源协议（provider-usage.v1 的 listResources / getResource）在本插件里的唯一定义：方法名、zod 结构、usageSourceContract（注册与调用共用）；combineSources 把各来源读数合并成“每个提供方一份”（主机优先、按 BB 提供方顺序）
usage-sources.ts: 服务端用，experimental_discoverRpc 找到全部用量来源（与 BB 自带卡片同一方式，含本插件自己），callRpc 逐个 list/get（每批 3 个、45 秒超时、60 秒缓存），输出与 sdk.system.usageLimits 同形
antigravity.ts: 服务端用，`agy -p /usage --output-format json`（内置命令，实测 0 回合 0 token，不读凭据）换算成协议 usage：按模型组（Gemini、Claude/GPT）× 5 小时 / 每周给窗口；60 秒缓存；出错不回传子进程输出（未登录时可能含登录链接）
i18n.ts: 界面文案唯一真相源（en / zh 两套 Messages）、resolveLanguage（auto 按宿主语言 zh* → zh，其余 → en）、formatSpan（按语言格式化时长：4d 23h / 4 天 23 小时）、localizeWindowName（中文模式把 Weekly / 5-hour / Daily / Session 等通用窗口词译成中文，品牌与模型名保持原样）
motion.ts: 动效常量的唯一真相源（BB 曲线与时长、悬停开合延迟、Details 展开、卡片平移与高度伸缩、内容切换延迟、卡片进出场类、easeOut（EASE_OUT 的 JS 版，逐帧算锚点位置用）、悬停过渡、减少动态效果类），transition() 拼行内过渡
codex-account.ts: 服务端用，短命启动 `codex app-server`（JSON-RPC over stdio）；read 读 credits、可用重置、本插件的重置门槛（90%，沿用 Synara 的保护规则，Codex 官方界面不预先拦截）与当前最高用量（60 秒缓存、并发合并），consume 用掉一次重置（执行前重读并核对账号与 90% 规则、同账号并发去重、幂等键）；parseRateLimits / canUseReset 为纯函数
token-totals.ts: 服务端用，增量收集 BB 线程的 thread/tokenUsage/updated 事件进插件 SQLite（按线程游标跳过未变线程、累计值差分、35 天外裁剪），snapshot 按提供方汇总 24h/7d/30d 的 token 与会话数；改编自 Usage Bar（MIT）
utils.ts: cn（clsx + tailwind-merge），L3 豁免
portal-scope.ts: 脚手架 vendored，给 portal 节点打 data-bb-plugin 作用域属性，L3 豁免

## 边界
本模块负责: 数值计算、动效参数、BB 用量协议、服务端数据源（来源汇总、Antigravity、Codex 账户、token 收集）
本模块不负责: React 视图与宿主 DOM
上游: bb 插件 SDK（服务端文件）、本机 codex 与 agy 命令行
下游: hooks/、components/、server.ts

[PROTOCOL]: 变更时更新此文件,然后检查父级 CLAUDE.md
