# YZE Combat: Permission Fix + Action Widget

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

Console diagnostic:

```js
game.modules.get("yze-combat-permission-fix").api
```

`applied` should be `true`.
