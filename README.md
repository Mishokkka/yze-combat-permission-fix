# YZE Combat: Permission Fix + Action Widget

Version 1.2.1

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

Normal players get a small always-on-screen widget while combat is active and
YZE Combat's **Slow & Fast Actions** mode is enabled.

- **БЫСТРОЕ** corresponds to YZE Combat `fastAction`.
- **ОСНОВНОЕ** corresponds to YZE Combat `slowAction`.
- `ЕСТЬ` means the action is available.
- `ПОТРАЧЕНО` means the action has been marked as used.
- Click a button to toggle the same status effect that YZE Combat uses in its
  combat tracker. There is no separate action counter or duplicated state.
- Drag the small title bar to put the widget anywhere on screen. Its position is
  stored per browser/client.
- The widget is hidden for the GM and outside active combat.
- If a player owns several combatants, selecting one of their tokens makes the
  widget follow that token. Otherwise it prefers the player's active combatant.

The widget does not require the Combat Tracker to be open.

## Combat reference

Players can expand **Памятка: дистанции и движение** below the action buttons.
It contains the table's supplied AL/N/S/L/D distances, escape/shooting/stealth
modifiers, open/closed-space escape modifiers and movement conversions in both
directions. Shooting at Arms Length retains the conscious-opponent condition.
The supplied overlapping Long/Distant ranges and cell/meter values are preserved.

The reference is closed by default, scrolls inside the widget, supports keyboard
navigation and remembers its disclosure state per client. Opening it keeps the
widget inside the screen. It is informational and does not modify rolls.

## Optional Quick Access integration

Quick Access **1.7.27+**, with equipment API version 1, supplies the foundation
for future slot/item and hand controls. The widget exposes a public bridge for
reading current slots/held items and issuing validated equipment commands.
Quick Access owns that state; no private files or duplicate storage are used.
See [INTEGRATION_API.md](INTEGRATION_API.md) for methods and events.

The equipment list/buttons will be added in a later release. The current action
buttons, permission fixes and reference work without Quick Access or with older
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

Console diagnostic:

```js
game.modules.get("yze-combat-permission-fix").api
```

`applied` should be `true`.

## Changelog

### 1.2.1

- Authenticate round requests and replies with Foundry's server-supplied sender
  metadata instead of trusting socket payload identities.
- Reject simultaneous delegated advances of the same combat before awaiting the
  first write; always release the guard after failure.
- Settle failed socket sends immediately so a retry is not blocked by a timer.
- Correct the equipment example to select an eligible nonempty slot.
- Add 9 behavioral permission/round-transition regressions (15 tests total).
