# bb-plugin-usage-rings

Agent plan limits as rings at the bottom of BB's sidebar rail, just above
Settings: one ring per provider that reports usage.

Limits come from every source of BB's usage protocol (`provider-usage.v1`),
the same sources BB's own Provider usage card reads: BB's built-in Codex,
Claude Code and ACP collectors, any usage plugin you install, and an
**Antigravity** source this plugin adds. The Antigravity source runs the local
`agy` CLI's built-in `/usage` command (zero turns, zero tokens; no login files
are read), shows Gemini and Claude/GPT five-hour and weekly windows, and also
appears in BB's own usage card.

- **Ring length**: how much of that provider's tightest limit is used.
- **Ring colour**: green, amber from 75% used, red from 90%. A used-up
  limit fills the whole ring in red; a failed refresh greys it and adds a
  red dot while the last reading stays visible.

Hover a ring for its card, styled like BB's own thread context card. The card
sits beside the ring you hover, its bottom edge level with the ring. All rings
share one card: move to another ring and the card slides to it and eases to
the new height while the old contents fade out and the new ones fade in. Clicking a ring does
nothing; with the keyboard, Enter opens the card and moves focus into it, and
Escape returns to the ring. On touch screens a tap opens and closes it.

The card shows **Limits** first. **Details** (closed by default, remembered
for every card) opens Resets, Credits and Activity above its toggle row, so the
toggle stays under the pointer while the card grows upward.

- **Limits**: for each window the share used, a bar with an even-pace marker,
  time to reset, how far in reserve or deficit you are, and when the window
  runs out at your current rate. Windows named "Group · Window" (Antigravity's
  Gemini and Claude/GPT) get a section per group.
- **Resets** (Codex): banked resets with their expiry, each with a button.
  Until a limit is 90% used the button is greyed out and reads "Unlocks at
  90%"; after that it is a two-step **Use**.
- **Credits** (Codex): the balance with its dollar value. Resets and credits
  are read through the Codex CLI's `app-server`; no login files are read.
- **Activity**: tokens and session counts for 24 hours, 7 days and 30 days,
  counted from the token usage BB already records for its threads. Sessions
  run outside BB are not counted.
- **Refresh**: re-reads every source and shows when they were last read.

The plugin's settings page shows the same cards for every provider.

## Pace

For a window of known length (five-hour, daily, weekly), following Synara:

- elapsed share = time since the window opened ÷ window length, counted as at
  least 5% so early use does not read as an emergency
- reserve / deficit = used % − elapsed share
- projected = used % ÷ elapsed share: ≤ 80% ahead, ≤ 100% on track, otherwise
  behind, with "runs out in" when that lands before the reset
- a reserve or deficit that rounds to 0% always reads "On pace" and counts as
  on track: no warning colour and no "runs out in"

## Use reset safety

The first click arms the button for four seconds; the second runs it. Each
confirmed attempt gets an idempotency key stored before the request is sent,
so a result that never arrives can only be retried as the same attempt, never
spent twice. The server re-reads usage first and refuses if the account
changed or no limit is at 90% or more. The 90% guard is this plugin's (borrowed
from Synara) so a reset is not wasted while plenty is left; Codex's own client
lets you try at any time and answers "does not need a reset" when it doesn't.

## Design

Colours, type sizes, radii and surfaces come from BB's theme and component
library; motion uses BB's durations and curves (see `lib/motion.ts`). The card
enters and leaves like BB's popovers, opens 100 ms after the pointer arrives
and closes 200 ms after it leaves. Nothing loops in the sidebar, and with
"reduce motion" on only short fades remain.

## Requirements and limits

- Rings show with the **Rail** navigation (BB's default). Top list and compact
  layouts have no rail; the settings page still works.
- The rings mount into BB's rail element
  (`nav[data-sidebar-navigation-placement="rail"]`); if a BB update changes
  it, the rings stop showing and nothing else breaks.
- Codex resets and credits need the `codex` CLI on the BB server's PATH (or `CODEX_BIN`).
- The Antigravity ring needs a provider with `antigravity` in its id registered in
  BB and the `agy` CLI signed in (looked up in `AGY_BIN`, `~/.local/bin`,
  `/opt/homebrew/bin`, `/usr/local/bin`, then PATH).

## Install

Clone this repository, then install it into bb from its folder:

```sh
git clone https://github.com/waiclay-349687/bb-plugin-usage-rings.git
cd bb-plugin-usage-rings
npm install --include=dev
bb plugin build .
bb plugin install "path:$PWD" --yes
```

## Develop

```sh
npm run check            # typecheck + tests + bb plugin build
bb plugin reload usage-rings
```

`lib/token-totals.ts` is adapted from Usage Bar (MIT); see
`THIRD_PARTY_NOTICES.md`.

## License

MIT, see [LICENSE](LICENSE).
