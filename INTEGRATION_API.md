# Action widget integration API

In 1.7.0, weapon attacks call `rolls.open` directly and action marks are manual.
The previous paid-attack journal protocol remains compatible with existing
operations; reloads and physical equipment operations retain explicit costs.
Quick Access 1.7.33 enables `handInventory` selection via `inventoryHands` and
rich property tooltips via `equipmentFeatureTooltips`. No private module imports
are used. Client-only `weaponRibbonVisible` independently hides/restores the
ribbon and does not change Actor equipment. Hidden ribbons fall back to compact
hand buttons in the main widget. The only palette is explicitly dark.

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

- `{ type: "holdInventory", itemId, hand: "left" | "right" | "both" }` with QA 1.7.33 `inventoryHands`: carried weapon/gear, including unslotted heavy Items. Uses the same paid equipment channel and receipt/undo guards in the built-in UI.
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
Since 1.4.0, client-only `actionWidgetCollapsed` hides all content below the
character header. Header tools are owned by the widget; the equipment controller
reports their availability and revalidates undo/swap on invocation. Collapsing
does not cancel a running operation. A pending operation highlights the expansion
button and is included in its accessible name.

## Native roll preparation (1.4.0)

`api.rolls` is an additive version-1 native bridge. Since 1.5.0, the weapon ribbon uses it for attacks; reaction UI remains a later extension.
It exposes `getState()` and async `open({kind, actorUuid, itemId?, expectedRevision?})`.
Kinds are `attack`, `dodge`, and `parry`. Required `actorUuid` binds the request to
the currently selected owned character, including synthetic token Actors.
The detached state contains `actorUuid`, `equipmentRevision`, `available`, `dodge`,
held `items[]` with `attack/parry` eligibility, and optional Roll Dialog Plus status.
Item operations require compatible Quick Access and an Item currently in hand.
Dodge also works without Quick Access. Unsupported system versions, missing
native methods, broken characters/items and pending equipment operations fail closed.

The bridge opens the native Application and returns the native Promise, which settles after a roll with `{roll, message}` or rejects on cancellation. It never
submits a roll or charges YZE actions. Roll Dialog Plus enhances that Application
through its own render hooks; its current public API has no dialog-opening method.
See [ROLL_INTEGRATION.md](ROLL_INTEGRATION.md) for confirmation hooks and cost design.

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

## Weapon operations (1.5.0)

Requires QA heldItemPresentation plus equipmentControls. Equipment/roll API major versions remain 1. Optional `api.weapons.request(payload)` is a low-level journal protocol, not a roll/weapon formula API.

Authenticated QA channel `yze-widget.weapon` validates OWNER and executes at the active GM. Paid work requires GM. Costs: free/fast/slow/both. Starts include stable id, actorUuid, itemId, equipmentRevision, weaponRevision and combat {id, round} or null. Reload/progress include mode load/topOff, progressRevision, integer current/target/amount (0–999, target 1–999), unit steps/seconds.

Kinds: progress (free counter-only edit), reload (one paid step), prepareAttack/reserveAttack/confirmAttack (actual messageId), resume/cancel, resolveDone/resolveNotDone (explicit uncertain external-result recovery). prepareAttack does not itself roll; the built-in controller binds an intent to the exact native Application before reserve/confirm.

Module-owned Actor flags: weaponOperation (v1 journal), weaponReload (per-Item/mode progress), weaponReceipts (last 32 terminal journals). Deleted-Item progress is pruned on writes. Weapon effects carry their own operation tag. Weapon/equipment/manual marks share enqueueActorOperation; original round-transition transport stays separate.

Unfinished work blocks new mutations. Phase external is saved before the public FL API call; an uncertain result cannot be dispatched again by resume/cancel until the user explicitly resolves it. There is no foreign-API idempotency key or common transaction across Actor/Effects/ammo documents. Manual macros/GM writes are outside the queue.

Client settings: weaponRibbonLayout (floating/side/below), weaponRibbonPosition, weaponRibbonPinned (default false). Full collapse hides weapons unless floating pin is enabled. Equipment remains QA-owned.

Internal optional intentId on rolls.open synchronously tags the Application options via temporary getRollOptions wrapping. The sheet method is restored immediately, and unknown deferred wrappers cannot borrow another dialog. The native Promise settles after a roll/cancel; it does not return Application immediately.

## Reload calculation and persistence (1.6.0)

Units: steps/seconds/fast/slow. Optional calculation is manual (legacy default)
or auto. Authority derives automatic amount from cost: F accepts fast/slow +1
or both +2; S rejects fast and accepts slow/both +1; seconds requires both and
advances ten with current/target multiples of ten. Caller amount cannot increase
automatic progress. Free advancement uses explicit manual mode; progress edits
never pay.

calculation and positive amount are stored alongside current/target/unit in
weaponReload. Manual mode/step survive rounds and reloads; old v1 records need
no startup migration. Fingerprints retain the old shape when calculation is
omitted, preserving issued legacy requests.

Whole-record flags are written through flags.yze-combat-permission-fix.==weaponOperation,
flags.yze-combat-permission-fix.==weaponReload and
flags.yze-combat-permission-fix.==equipmentOperation, preserving unrelated flags.
