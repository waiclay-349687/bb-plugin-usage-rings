/**
 * [INPUT]: 依赖 hooks/use-rail-slot 的挂载点、hooks/use-usage-limits 的额度数据、hooks/use-hover-card 的共用卡片开合、hooks/use-follow-anchor 的跟随锚点; 依赖 components/presentation 的提供方名称图标;
 *          依赖 @radix-ui/react-popover (BB 运行时共享, 定位/层级/Esc 与 BB 弹层一致); 依赖 SDK 的 experimental_useRpcQuery 预热卡片分区数据 (与 sections.tsx 同一查询键, 共用缓存)
 * [OUTPUT]: 对外提供 RailRings: app overlay 组件, 把每个有额度数据的提供方画成一个圆环, portal 进侧边栏 rail 底部; 整列圆环共用一张悬浮卡片, 底边贴着当前圆环, 换圆环时平移过去
 * [POS]: components 的装配层; 消费者: app.tsx (experimental_appOverlay);
 *        与 usage-ring 的边界: 圆环只是触发器, 卡片外壳 (照 BB 会话页上下文卡片: rounded-md border bg-popover p-2 shadow-md) 与切换动效都在这里
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import * as Popover from "@radix-ui/react-popover";
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { rpcContract } from "../rpc.ts";
import { useFollowAnchor } from "../hooks/use-follow-anchor.ts";
import { useHoverCard } from "../hooks/use-hover-card.ts";
import { useRailSlot } from "../hooks/use-rail-slot.ts";
import { useNow, useUsageLimits } from "../hooks/use-usage-limits.ts";
import { DURATION, MOTION } from "../lib/motion.ts";
import { usePortalScopeProps } from "../lib/portal-scope.ts";
import { cn } from "../lib/utils.ts";
import { MorphHeight } from "./morph-height.tsx";
import { useProviderPresentation } from "./presentation.ts";
import { UsageCard } from "./usage-card.tsx";
import { UsageRing } from "./usage-ring.tsx";

export function RailRings() {
  const slot = useRailSlot();
  const limits = useUsageLimits();
  const now = useNow(30_000);
  const present = useProviderPresentation();
  const portalScope = usePortalScopeProps();
  const card = useHoverCard<string>();
  // 卡片底边贴着当前圆环; 换圆环时锚点滑过去, 卡片跟着平移
  const anchor = useFollowAnchor(card.triggerElement(card.active), card.open);
  // 悬浮卡片里的分区在卡片打开时才挂载; 提前把它们的数据取好, 第一次悬停卡片就不会在弹出后再长高
  const ready = slot !== null && limits.providers.length > 0;
  experimental_useRpcQuery({ contract: rpcContract, method: "token_totals", input: null, enabled: ready });
  experimental_useRpcQuery({
    contract: rpcContract,
    method: "codex_account",
    input: { refresh: false },
    enabled: ready && limits.providers.some((usage) => usage.providerId === "codex"),
  });
  // 切换后, 上一张内容盖在上面 100ms 淡出, 150ms 后拿掉; 卡片外壳一直在, 只是内容淡出再淡入
  const [ghostDone, setGhostDone] = useState(0);
  useEffect(() => {
    if (card.switchCount === 0) return;
    const timer = window.setTimeout(() => setGhostDone(card.switchCount), DURATION.fast);
    return () => window.clearTimeout(timer);
  }, [card.switchCount]);

  if (slot === null || limits.providers.length === 0) return null;

  const ids = limits.providers.map((usage) => usage.providerId);
  const active = limits.providers.find((usage) => usage.providerId === card.active) ?? null;
  const previous = limits.providers.find((usage) => usage.providerId === card.switchedFrom) ?? null;
  const ghost = previous !== null && ghostDone !== card.switchCount ? previous : null;
  // 换圆环时卡片不动: 旧内容反向推出并先淡掉, 新内容稍后朝切换方向轻推 4px 淡入 (往下换从下方进, 往上换从上方进)
  const down = previous !== null && active !== null && ids.indexOf(active.providerId) > ids.indexOf(previous.providerId);
  const enter = previous === null ? null : down ? "animate-in fade-in-0 slide-in-from-bottom-1 duration-200" : "animate-in fade-in-0 slide-in-from-top-1 duration-200";
  const leave = down ? "slide-out-to-top-1" : "slide-out-to-bottom-1";
  const cardProps = { now, updatedAt: limits.updatedAt, error: limits.error, refreshing: limits.refreshing, onRefresh: limits.refresh };

  return createPortal(
    <div {...portalScope} className="flex flex-col items-center pb-1.5 pt-1">
      <Popover.Root open={card.open && active !== null} onOpenChange={card.onOpenChange}>
        <Popover.Anchor virtualRef={anchor} />
        <div ref={card.anchorRef} role="group" aria-label="Agent usage limits" className="flex flex-col gap-1.5">
          {limits.providers.map((usage) => (
            <UsageRing key={usage.providerId} usage={usage} provider={present(usage.providerId)} trigger={card.triggerProps(usage.providerId)} />
          ))}
        </div>
        <Popover.Portal>
          {active ? (
            <Popover.Content
              {...portalScope}
              {...card.contentProps}
              side="right"
              align="end"
              sideOffset={8}
              collisionPadding={8}
              // 每帧重读锚点: 锚点在两个圆环之间滑动时卡片才会跟着走
              updatePositionStrategy="always"
              aria-label={`${present(active.providerId).name} usage`}
              className={cn("z-50 w-72 rounded-md border bg-popover text-popover-foreground shadow-md outline-none", MOTION.popover, MOTION.reduce)}
            >
              <MorphHeight morphKey={active.providerId}>
                <div className="relative">
                  {/* 切换时进度条直接到位, 不再从 0 重新填充 */}
                  <div
                    key={active.providerId}
                    className={cn("p-2", enter, "motion-reduce:animate-none")}
                    // 延迟期间保持起始帧 (透明), 等旧内容淡得差不多再出现
                    style={enter ? { animationDelay: `${DURATION.swapDelay}ms`, animationFillMode: "backwards" } : undefined}
                  >
                    <UsageCard usage={active} provider={present(active.providerId)} animateFill={previous === null} {...cardProps} />
                  </div>
                  {ghost ? (
                    <div
                      key={`ghost-${card.switchCount}`}
                      aria-hidden="true"
                      inert
                      className={cn("pointer-events-none absolute inset-x-0 top-0 p-2 animate-out fade-out-0 fill-mode-forwards duration-100", leave, "motion-reduce:hidden")}
                    >
                      <UsageCard usage={ghost} provider={present(ghost.providerId)} animateFill={false} {...cardProps} />
                    </div>
                  ) : null}
                </div>
              </MorphHeight>
            </Popover.Content>
          ) : null}
        </Popover.Portal>
      </Popover.Root>
    </div>,
    slot,
  );
}
