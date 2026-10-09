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
access is introduced. Equipment controls themselves are planned for later.

```js
const state = widget.quickAccess.getState();
// null if there is no owned current combatant or compatible equipment provider.
if (state?.editable) {
  await widget.quickAccess.performAction(
    { type: "hold", itemId: state.slots[0].itemId, hand: "right" },
    { expectedRevision: state.revision });
}
```

`getState()` returns the Quick Access snapshot: `version`, `actorUuid`,
`editable`, `capacity`, `slots`, `hands`, `heldItems` and `revision`. It reads the
same current combatant used by the fast/slow buttons (selected owned token,
then active owned combatant, then first living owned combatant). Read errors
return null and are logged without breaking widget rendering.

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
