# Action widget integration API

Available in **1.2.0** after Foundry `ready`:

```js
const widget = game.modules.get("yze-combat-permission-fix")?.api;
widget.applied;           // existing permission patch diagnostic
widget.targetVersion;    // still yze-combat 1.6.1
widget.refreshActionWidget();
widget.quickAccess.available;
```

`widget.quickAccess` is an optional bridge with `apiVersion: 1`. It requires an
active `fbl-quick-access` with `capabilities.equipment`, `equipmentApiVersion: 1`,
`getEquipmentState` and `performEquipmentAction` (introduced in Quick Access
1.7.27). Missing, inactive, older and incompatible versions leave the existing
action widget and reference usable. No mandatory dependency or private flag
access is introduced. Full equipment controls are available in widget 1.3.0
with Quick Access 1.7.29's additive `equipmentControls` capability.

```js
const state = widget.quickAccess.getState();
// null if there is no owned current combatant or compatible equipment provider.
const slot = state?.slots.find(slot => slot.available && slot.canHold && slot.itemId);
if (state?.editable && slot) {
  await widget.quickAccess.performAction(
    { type: "hold", itemId: slot.itemId, hand: "right" },
    { expectedRevision: state.revision });
}
```

`getState()` returns the Quick Access snapshot: `version`, `actorUuid`,
`editable`, `capacity`, `slots`, `hands`, `heldItems`, `inventory` (1.7.29+) and `revision`. It reads the
same current combatant used by the fast/slow buttons (selected owned token,
then active owned combatant, then first living owned combatant). Read errors
return null and are logged without breaking widget rendering.
Outside combat, compatible equipment controls follow the selected owned
character token or `game.user.character`.

`performAction(command, options?)` resolves that Actor afresh, checks ownership,
and forwards commands to Quick Access. It rejects unavailable providers,
invalid ownership, provider validation errors and failed persistence. Use the
snapshot revision to reject a command after token selection or equipment changes.
The comparison token is local validation, not a server-side lock across clients.

Supported Quick Access commands:

- `{ type: "hold", itemId, hand: "left" | "right" | "both" }`.
- `{ type: "stow", hand: "left" | "right" | "both" }`.
- `{ type: "swapHands" }`.
- `{ type: "clearSlot", index }` (keeps the Item and its held status).
- Quick Access 1.7.29 adds `assignSlot`, `swapSlots`, `undo`, previews and optional
  atomic `operationId` receipts. See its equipment contract for exact validation.

These only maintain manual equipment marks. They do not spend combat actions or
change native Item carry state. Two-handed grips release both hands when either
side is stowed or replaced. All mutations and validation belong to Quick Access.

Events for future controls:

```js
Hooks.on("yzeCombatPermissionFix.apiReady", api => { /* optional bridge ready */ });
Hooks.on("yzeCombatPermissionFix.widgetUpdated", ({ element, combatant, actor, equipment }) => {
  // Widget is visible and action states are current; equipment may be null.
  // Treat element as module-owned. Add idempotent UI; do not write Actor flags.
});
```

The widget refreshes when the Quick Access API becomes available and when
`fblQuickAccess.equipmentChanged` concerns its current Actor. Updates are
coalesced to one animation frame. It follows document hooks even when character
sheets are closed or their rendering is suppressed.

The collapsible combat reference uses client-only `combatReferenceOpen`; it
contains the GM's supplied house rules and never changes roll modifiers.
Slots use client-only `equipmentOpen`. Both disclosures preserve their state
independently; equipment changes and slot settings are clamped to the viewport.

## Paid equipment operations (1.3.0)

The built-in equipment panel uses `yze-widget.equipment` on Quick Access's
authenticated active-GM channel. The handler validates the authenticated user's
OWNER permission, character UUID, revision, cost and combat membership/round.
Commands and widget action toggles share a per-Actor authority queue. This
operation is unrelated to the module's round-transition socket protocol.

Its durable module-owned Actor journal records the command, explicit cost,
combat epoch and phase (`pending`, `complete`, `undoing`, `undone`). Equipment
uses an atomic Quick Access receipt; paid native Active Effects are tagged with
the operation id. Resume applies only missing pieces, and cancel/undo removes
only the operation's own effects after validating equipment postimages. Free
slot configuration never consumes an action. No-op physical commands do not
start a journal. Pending operations block new commands and manual widget marks.

The legacy bridge intentionally remains an equipment-only API; forwarding a
command through it never silently charges actions. Paid commands are currently
exposed through the built-in UI. Other integrations should retain the existing
bridge contract and inspect additive capabilities before adopting new methods.
