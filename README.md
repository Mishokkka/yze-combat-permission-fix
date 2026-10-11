# YZE Combat: Permission Fix + Action Widget

Version 1.4.0

Target environment:

- Foundry VTT 13.351
- Forbidden Lands 13.0.5
- Year Zero Engine: Combat 1.6.1

## Permission fixes

1. A player who owns the active combatant can finish the final turn of a round.
   The round transition is delegated over a module socket to the active GM, so
   YZE Combat's `history` flag is written with GM permission.
2. Non-GM combat tracker renders no longer run YZE Combat's automatic group
   leader repair. That maintenance remains GM-only, preventing repeated
   permission errors on player clients.

The GM authorizes the request using the sender ID supplied by Foundry's server
as the second module-socket callback argument. The claimed `requesterId` must
match that sender. Player replies must likewise come from the GM selected for
the pending request and match its combat. Missing sender metadata is rejected.
This transport was verified against Foundry 13.351's `registerCustomSocket` and
`handleCustomSocket`; no server modification or Quick Access dependency is needed.

Only one delegated round advance per combat can run on the responsible GM at
a time. The guard releases after success or failure, and the original YZE Combat
`nextRound` still handles history, initiative and action resets. It does not lock
manual GM actions or provide a transaction across different GM clients.

## Action widget

Normal players get a small collapsible widget while combat is active and
YZE Combat's **Slow & Fast Actions** mode is enabled.

- **БЫСТРОЕ** corresponds to YZE Combat `fastAction`.
- **ОСНОВНОЕ** corresponds to YZE Combat `slowAction`.
- `ЕСТЬ` means the action is available.
- `ПОТРАЧЕНО` means the action has been marked as used.
- Click a button to toggle the same status effect that YZE Combat uses in its
  combat tracker. There is no separate action counter or duplicated state.
- Drag the small title bar to put the widget anywhere on screen. Its position is
  stored per browser/client.
- The header chevron collapses the entire widget to the character name and compact
  tools. This state survives reloads; slots and reference keep their own states.
  Header buttons do not start dragging. Swap hands opens the cost preview; undo
  expands the widget so that any error is visible. Neither runs a hidden new charge.
- The widget is hidden for the GM. With compatible Quick Access it also shows equipment outside combat for a selected owned character token or the player's assigned character; action buttons are hidden there.
- If a player owns several combatants, selecting one of their tokens makes the
  widget follow that token. Otherwise it prefers the player's active combatant.

The widget does not require the Combat Tracker to be open.

## Combat reference

Players can expand **Памятка: дистанции и движение** below the action buttons.
It contains the table's supplied AL/N/S/L/D distances, escape/shooting/stealth
modifiers, open/closed-space escape modifiers and movement conversions in both
directions. Shooting at Arms Length retains the conscious-opponent condition.
The supplied overlapping Long/Distant ranges and cell/meter values are preserved.
The accepted Arms Length and Near meter ranges are **0–2 m** and **2–6 m**.

The reference is closed by default, scrolls inside the widget, supports keyboard
navigation and remembers its disclosure state per client. Opening it keeps the
widget inside the screen. It is informational and does not modify rolls.

## Optional Quick Access integration

Quick Access **1.7.29+** enables the completed equipment controls. Older 1.7.27+
still supports the public read/command bridge; equipment UI is hidden safely.
Quick Access owns slots and manual grips. No private imports or duplicated
equipment storage are used.
See [INTEGRATION_API.md](INTEGRATION_API.md) for methods and events.

- Hands stay visible while the widget is expanded. Collapse the compact slots independently of the memo;
  the client remembers both states. Desktop width is 268 px, slot height 44 px.
- Select a slot/held item, then **Левая / Правая / Обе / Убрать**. The preview
  explains which items will be stowed and shows the resulting hands. **Открыть**
  opens the native Item sheet for free; rich tooltips come from Quick Access.
- In combat choose **Без траты / Быстрое / Основное / Оба** for each physical
  operation, then **Применить**. No automatic rule price or default is assumed.
  Spent costs are disabled. No-op commands never charge; outside combat changes
  are free. Out-of-turn manipulations are allowed.
- **Настройка слота** assigns an eligible inventory item, exchanges slots or
  clears a binding for free. Clearing a slot keeps the Item and its grip. A held
  item outside slots can still change grip. Overflow bindings remain stored;
  new holds from unavailable slots are refused.
- **Отменить последнюю операцию** restores only the touched equipment fields
  and that operation's own native action effects. It is disabled if equipment,
  Items, round or paid marks changed so that restoration would be unsafe.
- Swap hands and undo are compact header icons with accessible names and tooltips.
  The redundant hands heading and success message are removed. Cost/setup menus
  use explicitly contrasting option colors, including unavailable costs.

Paid operations require an active GM and run through Quick Access's existing
authenticated GM execution channel, independently of the round-transition fix.
Commands and widget status clicks are serialized per Actor there. A durable
operation record, atomic Quick Access receipt and tagged native YZE action effects
make retries idempotent. A partial failure shows **Продолжить / Отменить операцию**;
new commands are blocked until it is settled. A round change prevents charging
the new round; cancellation can restore the recorded equipment and remove only
the failed operation's remaining effects. Payment/refund recovery also requires
a GM. Free equipment commands remain available without one.

External macros, tracker edits and manual GM round changes do not share the
widget queue. Conflicting state is checked and reported; there is no database
transaction or distributed lock across clients. Grips are manual marks and do
not alter native carry state or enforce weapon rules. Attacks, consumables,
drop/transfer and loadouts are separate future features.

## Future rolls

The additive `api.rolls` bridge prepares native weapon attacks, Dodge and Parry
for future widget buttons. It checks the current owned Actor UUID, equipment
revision (when supplied), held Item, system version and pending operation before
opening the same dialog as the character sheet. Roll Dialog Plus **0.7.1** enhances
these dialogs automatically when active/enabled; without it the native dialog works.
There are no roll buttons or automatic action charges in this release.
See [ROLL_INTEGRATION.md](ROLL_INTEGRATION.md) for the researched contract and next steps.

## Verification

`npm test` runs 36 regressions, including the unchanged round permission fix,
partial hand/effect acknowledgements, payment, safe undo, concurrency and GM
handover. The companion Quick Access suite passes 237 tests.

For the browser integration harness, install Playwright and run
`QA_SOURCE=/path/to/fbl-quick-access node dev-tests/browser-equipment.mjs`.
On Windows set `QA_SOURCE` as an environment variable first. Optional
`PLAYWRIGHT_MODULE` and `CHROME_PATH` select an existing installation.
The harness imports the real runtime modules but simulates Foundry Documents
and transport. It checks desktop/narrow/touch layout, mandatory cost selection,
payment/recovery/undo, slot setup, Actor guards, whole-widget persistence, header
tools, contrasting dropdown options, memo and optional integration.
A live GM/player session remains the final in-world acceptance check.

The action buttons, permission fixes and reference work without Quick Access or with older
versions. Neither module requires the other.

## Installation

Extract the `yze-combat-permission-fix` folder into `Data/modules/`, restart
Foundry, then enable **YZE Combat: Permission Fix + Action Widget** in the world.

Keep **Year Zero Engine: Combat 1.6.1** enabled. The patch deliberately disables
itself on any other YZE Combat version instead of guessing against changed code.

## Quick test

1. Connect one GM and one normal Player.
2. Start a combat containing the player's owned token.
3. The action widget should appear for the Player even with the Combat Tracker closed.
4. Click **БЫСТРОЕ** and **ОСНОВНОЕ**. Their state should match the corresponding
   YZE Combat statuses/buttons and reset when YZE Combat resets actions.
5. Drag the widget, reload the browser, and confirm the position persists.
6. Put the player's token last in initiative and end the turn. The combat should
   advance to the next round without a permission error.
7. Expand the reference near the screen edge, scroll through it and collapse it.
   Reload and confirm that the last disclosure state persists.
8. With and without Quick Access enabled, verify that the actions/reference work.
   With Quick Access 1.7.27, `api.quickAccess.getState()` should follow the selected
   owned combat token, including an unlinked token's synthetic Actor.
9. With Quick Access 1.7.29+, select equipment and a manipulation. Confirm that
   hands do not change until an explicit cost is chosen and applied. Check native
   YZE action marks, undo, free slot setup and grip changes outside combat.

Console diagnostic:

```js
game.modules.get("yze-combat-permission-fix").api
```

`applied` should be `true`.

## Changelog

### 1.3.0

- Ship the agreed compact equipment controls with persistent collapsible slots,
  visible grips, previews, native Item sheets/tooltips and free slot setup.
- Require a price for each combat manipulation; coordinate equipment and native
  action effects on the active GM with durable receipts, recovery and guarded undo.
- Preserve standalone actions/memo even when Quick Access is unavailable during
  a pending equipment operation. Keep the round permission socket separate.
- Correct Arms Length/Near memo ranges to 0–2 m / 2–6 m; support free equipment
  management outside combat and desktop/narrow/touch layouts.
- Add 15 operation regressions (30 total) and a browser integration harness.

### 1.2.1

- Authenticate round requests and replies with Foundry's server-supplied sender
  metadata instead of trusting socket payload identities.
- Reject simultaneous delegated advances of the same combat before awaiting the
  first write; always release the guard after failure.
- Settle failed socket sends immediately so a retry is not blocked by a timer.
- Correct the equipment example to select an eligible nonempty slot.
- Add 9 behavioral permission/round-transition regressions (15 tests total).
