# YZE Combat: Permission Fix + Action Widget

Version 1.8.0

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

### Fixed dark appearance

The action widget, slots, combat reference, weapon ribbon, GM summary and operation forms
share one fixed **dark** palette: opaque backgrounds, explicit foreground/field/option
colors, bronze accents, 5 px corners and compact spacing. Foundry's client theme
does not change these colors. The widget uses Arial at 12 px, secondary labels at 11 px.
Available actions and held slots have an accent border. Spent actions remain
readable, with a crossed-out title and their explicit status. Weapon labels,
values, ammunition, traits and operation controls remain separate groups.
Primary confirmation buttons share an accent fill; manual progress correction
and recovery stay distinct. Keyboard focus is visible and touch controls keep
at least 44 px targets. Placement, pinning and collapse settings are preserved.
The styling is scoped to the three widget roots and does not restyle Item sheets,
the native roll dialog, or the Quick Access character sheet.

## GM party summary (1.8.0)

The GM has a separate, read-only **Сводка группы** table. Open or hide it with
the **group icon in Token Controls** (the left scene toolbar), or the client
setting **Сводка группы для ГМа**. It starts hidden. Drag the title bar to move
it; the chevron collapses it and × hides it. Visibility, collapse and position
are saved independently of the player's widget, per browser/client.

- Rows include character combatants owned by connected non-GM users, plus their
  assigned characters if not represented in the selected combat. Outside an
  encounter, assigned characters are used. A connected user without an assigned
  character or owned character combatant gets **Персонаж не назначен**.
- In combat, read the actual combatant Actor, including unlinked token Actors;
  never substitute the base Actor or guess another client's selected token.
  Shared Actors appear once; distinct synthetic Actors remain separate. Turn and
  initiative changes do not reorder the table; the current row is highlighted.
- Show **Л / П / 2Р**, held Item names, **Б / О** with available/spent marks,
  optional FL Firearms magazine counts and unfinished reload/top-off progress.
  Empty hands remain neutral. Missing/unreadable Quick Access shows
  **Нет данных о руках**, not free hands. Native action marks still work.
- Click a character or Item name to open its native sheet. The summary itself
  never changes hands, action effects, ammunition, combat or reload progress.
  Action marks are informational; they do not determine whether a proposed
  action is legal or affordable. Outside combat, action marks are hidden.
- Membership, document effects, equipment, ammunition and reload progress update
  through Foundry/Quick Access/FL Firearms hooks, even with player sheets closed.
  The fixed dark table is 420 px wide, fits narrow screens, and scrolls internally
  for larger groups. Pending operations and characters unable to act are labelled.

After upgrading, restart Foundry and reload connected clients so the new manifest
stylesheet is loaded. Quick in-world check: connect a GM and player, open the
summary, change hands/action marks as the player, then hide/reopen the summary.
Repeat with an unlinked token, a magazine change and a player disconnect.

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

`npm test` runs 79 regressions, including the unchanged round permission fix,
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

`node dev-tests/browser-gm-summary.mjs` uses the same `QA_SOURCE`,
`PLAYWRIGHT_MODULE`, `CHROME_PATH` and optional `FOUNDRY_CSS`/`SCREENSHOT_DIR`.
It imports the real Quick Access equipment/presentation readers, with simulated
Foundry Documents and the public firearm data provider. It checks membership,
token identity, live updates, sheets, read-only behaviour, persistence, missing
integrations, escaping, both Foundry themes and narrow/touch layout. On Windows,
an absolute `PLAYWRIGHT_MODULE` should be a `file:///C:/.../index.mjs` URL.

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

### 1.8.0

- Add an optional GM-only party summary table with a Token Controls button,
  independent hide/collapse/position preferences and native sheet links.
- Read connected players' actual combatant Actors, hands, native action marks,
  firearm magazines and reload progress without changing gameplay data.
- Handle shared ownership, unlinked tokens, disconnects, absent equipment APIs
  and out-of-combat characters explicitly; preserve row order across turns.
- Verify the new summary with eight model/control regressions and a browser
  harness using the real Quick Access readers and optional Foundry styles.

### 1.7.0

- Use one explicit dark theme, including text/fields/options, independently of Foundry's sheet theme and font.
- Compact the weapon ribbon to 460 px with inline labeled stats and hover/focus property rules, reusing Quick Access's enriched tooltips and the FL Firearms rule journal.
- Open native attacks directly; action marks are manual. Keep reload prices/progress and the existing permission fix unchanged.
- Send held/selected Items through FBL's native sendToChat, including its visibility flags and roll mode.
- Add Quick Access 1.7.33 inventory grips for carried weapon/gear Items, without the quick-slot weight limit; preserve slots, payment, receipts and undo.
- Hide/restore the weapon ribbon independently via its close control and the main header's weapon button; persist the preference per client.

### 1.6.1

- Apply the selected Warm Tactical style to both panels, slots, reference and operation forms through a shared scoped palette.
- Follow Foundry's light/dark client theme, keep cost options readable, and use consistent focus, primary buttons, typography and touch targets.
- Preserve all action, equipment, roll and reload behavior, public APIs and stored placement/collapse settings.
- Check both palettes and 320/360 px layouts in browser integration harnesses, optionally loading the actual Foundry stylesheet via FOUNDRY_CSS.
- Composite background/text alpha in contrast checks; `node dev-tests/browser-style.mjs` checks seven translucent, nested and unreadable cases (PLAYWRIGHT_MODULE/CHROME_PATH as in other browser checks).

### 1.6.0

- Recognize typed reload counts and TopOff 2F/3S/10 сек; compute progress from explicitly paid F/S pairs, allowing slow-as-fast only.
- Preserve explicit manual ability steps/mode across rounds and reloads, without converting old manual counters.
- Replace module-owned operation/progress flags completely under Foundry v13 merging, verify with native helpers, and restore the missing 1.4.0 changelog entry.

### 1.5.0

- Add a separate compact weapon ribbon with grouped stats/ammo, expandable traits and native attack, load and +1 top-off controls. Floating, side and below layouts are client settings; explicit pinning retains floating weapons when the main widget is collapsed.
- Let players choose the price, current/total progress, progress per operation and steps/seconds; retain progress between rounds. Manual correction spends neither actions nor ammunition.
- Bind paid attacks to the exact native dialog and ChatMessage, preserve FL Firearms/RDP wrappers, deduplicate submission/payment and refund only the operation’s own effects on cancellation.
- Share authority serialization with equipment/manual widget marks. Persist weapon journals, recovery and receipts; do not retry ambiguous external ammo writes.
- Support FL Firearms 0.4.6 void results by checking the normalized magazine postimage, and structured results in 0.4.7. Preserve standalone widget controls and the original round permission fix.


### 1.4.0

- Improve contrast in cost dropdowns, move swap/undo into the compact header, remove redundant labels, and persist full-widget collapse.
- Prepare native attack/Dodge/Parry calls for Forbidden Lands 13.0.5 and document optional Roll Dialog Plus support.

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

## Weapon ribbon and reload progress (1.7.0)

With **Quick Access 1.7.30+**, held Items move into a separate compact ribbon. Identity/grip, inline attack stats, ammo, traits and commands have distinct groups. With **Quick Access 1.7.33+**, hover or focus a property for its enriched rule tooltip; the Item name shows its full tooltip and opens the sheet on click. Properties without available rule text stay plain labels. The same Rich Info Tooltips journal supplies FL Firearms descriptions; private journal/page text is excluded. Other Features is enriched through Quick Access rather than displayed as raw @INFO text. The grip button opens hand controls; **В чат** calls the native Item.sendToChat, preserving its field visibility and roll mode.

Client setting **Weapon ribbon placement** chooses floating (default), side or below. Drag the floating header to save position. Full main collapse hides weapons unless the pin control is enabled. The ribbon's × hides it independently; the weapon button in the main header restores it. This visibility preference persists per client. Narrow screens wrap groups and scroll reload details internally.

**Атака** immediately opens the native dialog, enhanced by RDP when active. Mark Fast/Slow manually in the widget. No intermediate attack panel, action reservation or extra ammo deduction is added; the system/FL Firearms backend owns the roll. The former paid-attack protocol remains available for existing journals/integrations. See [ROLL_INTEGRATION.md](ROLL_INTEGRATION.md).

**Зарядить / Дозарядить** opens current progress, total, progress per action and steps/seconds. Account for abilities manually: e.g. 0/4 with 2 per operation advances to 2/4, then 4/4. Each step has its own selected price; progress survives rounds/reloads. Seconds are a manual counter, not a timer.

**Сохранить прогресс вручную** changes only the counter, without actions/ammo. Setting the goal does not itself load ammo; explicitly perform the final step (zero is allowed at the goal). At completion, MAG load fills the magazine through FL Firearms loadMagazine; TopOff adds **one** round through its API and requires the matching property. Ammo/resource dialogs remain FL-owned. Non-MAG and ordinary slow-reload weapons have manual progress, with no invented loaded flag or arrow consumption.

Paid work needs an active GM. Changed weapon, grip, progress or round invalidates an open draft. Weapon/equipment/manual marks share a queue, separate from the original round fix. Uncertain external load: inspect magazine and ammo resource, then select **Зарядка выполнена** or **Не выполнена**. Such a call is never automatically repeated; completed ammo loads are not automatically reversed.

FL Firearms **0.4.6–0.4.7** are supported. Legacy void returns require an exact normalized magazine postimage; ambiguous/no-op results require recovery. This release does not update that third module.

Browser weapon check: set QA_SOURCE, FBL_SOURCE (local 13.0.5 bundle), PLAYWRIGHT_MODULE and CHROME_PATH, then run `node dev-tests/browser-weapons.mjs`. Actual FBL handler/method are used; Documents, transport, dice and firearm writes are mocked. Live GM/player acceptance: cancel/confirm attack, Push, multi-round load, top-off, manual progress, collapse/pin and end the last turn.

## F/S and ten-second reload rules (1.6.0)

Unambiguous typed reload values and TopOff notation are recognized: 2F, 3S,
10 сек. Numeric reloadValue uses Fast/Slow/seconds type. The typed reloadType
S means seconds; a TopOff suffix 3S means **slow actions**. Conflicting or
compound text is left for manual input.

| Progress unit | Fast | Slow | Both |
| --- | --- | --- | --- |
| F | +1 F | +1 F (slow substitutes) | +2 F |
| S | Unavailable | +1 S | +1 S; fast adds no S |
| Seconds | No full step | No full step | +10 seconds |

**По выбранным действиям** computes the amount at the authority. For seconds,
choose Оба in one operation; single actions are not silently treated as five
seconds or combined across turns. Current/target must be multiples of ten.
This is a counter, not a real-time timer.

**Вручную / способность** retains editable current/total/amount/unit. Mode and
positive manual step persist across rounds/reloads; price is chosen anew.
Use it for abilities that shorten duration or change useful progress. Fast still
cannot replace an S unit; use explicit manual steps for separately agreed rules
without an F/S denomination. Unknown formats and legacy manual counters are
preserved. Counter-only correction never loads/spends ammo.

Own operation/progress flags now use Foundry v13 whole-value replacement,
including the equipment journal, so deleted entries and stale operation fields
do not survive merging. Tests optionally use actual local helpers by setting
FOUNDRY_HELPERS to common/utils/helpers.mjs. Foundry source is not bundled.
