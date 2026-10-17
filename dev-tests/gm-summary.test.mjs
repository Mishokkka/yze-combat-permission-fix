import test from "node:test";
import assert from "node:assert/strict";
import { addGMSummaryControl, collectGMSummaryCharacters, readGMSummaryRow } from "../scripts/gm-summary.js";

function actor(id, uuid = `Actor.${id}`, owners = ["alice"]) {
  const flags = {};
  return {id, uuid, type: "character", name: id, canAct: true, statuses: new Set(), effects: [], items: new Map(),
    flags, getFlag: (_module, key) => flags[key], testUserPermission: user => owners.includes(user.id)};
}
function user(id, character, active = true) { return {id, name: id, character, active, isGM: false}; }
function fixture() {
  const base = actor("hero"), synthetic = actor("hero", "Scene.map.Token.one.Actor.hero");
  const other = actor("scout", "Actor.scout", ["bob"]);
  const alice = user("alice", base), bob = user("bob", other);
  const combatants = [{id: "one", actor: synthetic, name: "Герой на карте"}, {id: "two", actor: other, name: "Разведчик"}];
  const combat = {started: true, round: 2, combatants, turns: [...combatants], combatant: combatants[0]};
  return {base, synthetic, other, alice, bob, combat};
}

test("GM summary uses actual token Actors, excludes offline users/GMs/NPCs, and never duplicates the base character", () => {
  const f = fixture();
  const npc = {...actor("npc"), type: "monster"};
  f.combat.combatants.push({id: "npc", actor: npc});
  const offline = user("offline", actor("offline"), false), gm = {...user("gm", actor("gm")), isGM: true};
  const rows = collectGMSummaryCharacters([f.bob, offline, gm, f.alice], f.combat);
  assert.deepEqual(rows.map(row => row.actor), [f.synthetic, f.other]);
  assert.equal(rows[0].combatants[0], f.combat.combatants[0]);
  assert.equal(rows.some(row => row.actor === f.base), false);
});

test("shared ownership produces one row; multiple synthetic tokens remain distinct and turn changes never reorder rows", () => {
  const f = fixture();
  const second = actor("hero", "Scene.map.Token.two.Actor.hero", ["alice", "bob"]);
  f.synthetic.testUserPermission = () => true;
  f.combat.combatants.push({id: "three", actor: second});
  const users = [f.alice, f.bob], before = collectGMSummaryCharacters(users, f.combat);
  assert.deepEqual(before.map(row => row.actor.uuid), [f.synthetic.uuid, second.uuid, f.other.uuid]);
  assert.deepEqual(before[0].users.map(user => user.id), ["alice", "bob"]);
  f.combat.combatant = f.combat.combatants[2];
  f.combat.turns.reverse();
  f.combat.combatants.reverse();
  assert.deepEqual(collectGMSummaryCharacters(users, f.combat).map(row => row.key), before.map(row => row.key));
});

test("outside combat uses assigned characters, while missing assignments and online membership remain explicit", () => {
  const f = fixture(), unassigned = user("unassigned", null);
  let rows = collectGMSummaryCharacters([f.alice, f.bob, unassigned], null);
  assert.deepEqual(rows.map(row => row.actor), [f.base, f.other, null]);
  f.bob.active = false;
  rows = collectGMSummaryCharacters([f.alice, f.bob, unassigned], null);
  assert.deepEqual(rows.map(row => row.key), [f.base.uuid, "User.unassigned"]);
  assert.equal(readGMSummaryRow(rows[0], {actionsEnabled: true}).actions, null);
});

test("assigned characters absent from a running combat show no stale action availability", () => {
  const f = fixture();
  f.combat.combatants.pop();
  f.other.statuses.add("fastAction");
  const rows = collectGMSummaryCharacters([f.alice, f.bob], f.combat);
  const result = readGMSummaryRow(rows[1], {combat: f.combat, actionsEnabled: true});
  assert.equal(result.inCombat, false);
  assert.equal(result.actions, null);
});

test("action marks follow native effects, disabled tracking stays unknown, and current turn belongs to the token", () => {
  const f = fixture();
  f.synthetic.effects.push({statuses: new Set(["fastAction"])}, {disabled: true, statuses: new Set(["slowAction"])});
  const entry = collectGMSummaryCharacters([f.alice], f.combat)[0];
  const result = readGMSummaryRow(entry, {combat: f.combat, actionsEnabled: true});
  assert.deepEqual(result.actions, {fast: false, slow: true});
  assert.equal(result.current, true);
  assert.equal(result.name, "Герой на карте");
  assert.equal(readGMSummaryRow(entry, {combat: f.combat, actionsEnabled: false}).actions, null);
  f.synthetic.canAct = false;
  assert.equal(readGMSummaryRow(entry, {combat: f.combat, actionsEnabled: true}).unable, true);
});

test("two-handed gear, zero magazine and multi-round progress are read without writes or duplicate items", () => {
  const f = fixture(), item = {id: "gun", name: "Карабин"};
  f.synthetic.items.set(item.id, item);
  f.synthetic.flags.weaponReload = {"gun:load": {version: 1, current: 2, target: 4, unit: "fast", finished: false}};
  const entry = collectGMSummaryCharacters([f.alice], f.combat)[0], calls = [];
  const api = {capabilities: {heldItemPresentation: true},
    getEquipmentState(actor) { calls.push(actor); return {hands: {left: "gun", right: "gun"}, heldItems: {left: item, right: item}}; },
    getHeldItemPresentation(actor) { calls.push(actor); return {items: [{itemId: "gun", firearm: {magazine: {current: 0, capacity: 6}}}]}; },
    performEquipmentAction() { throw new Error("Read-only summary attempted a write"); }};
  const result = readGMSummaryRow(entry, {combat: f.combat, actionsEnabled: true, api});
  assert.deepEqual(calls, [f.synthetic, f.synthetic]);
  assert.equal(result.hands.length, 1);
  assert.equal(result.hands[0].hand, "both");
  assert.deepEqual(result.hands[0].magazine, {current: 0, capacity: 6});
  assert.deepEqual(result.hands[0].progress, [{mode: "load", current: 2, target: 4, unit: "fast"}]);
  f.combat.round++;
  assert.equal(readGMSummaryRow(entry, {combat: f.combat, api}).hands[0].progress[0].current, 2);
  f.synthetic.flags.weaponReload["gun:load"].finished = true;
  assert.deepEqual(readGMSummaryRow(entry, {combat: f.combat, api}).hands[0].progress, []);
});

test("missing or failing integrations never masquerade as free hands or lose native action marks", () => {
  const f = fixture(), entry = collectGMSummaryCharacters([f.alice], f.combat)[0];
  const options = {combat: f.combat, actionsEnabled: true};
  assert.equal(readGMSummaryRow(entry, options).equipment, "unavailable");
  assert.equal(readGMSummaryRow(entry, {...options, api: {getEquipmentState() { throw new Error("unavailable"); }}}).equipment, "error");
  const api = {capabilities: {heldItemPresentation: true}, getEquipmentState: () => ({hands: {left: null, right: null}}), getHeldItemPresentation() { throw new Error("optional data failed"); }};
  const result = readGMSummaryRow(entry, {...options, api});
  assert.equal(result.equipment, "ready");
  assert.ok(result.hands.every(hand => !hand.occupied));
  assert.deepEqual(result.actions, {fast: true, slow: true});
});

test("scene control is a v13 button for GMs only and does not change the selected canvas tool", () => {
  const controls = {tokens: {activeTool: "select", tools: {select: {order: 0}, target: {order: 3}}}};
  let toggles = 0;
  globalThis.game = {user: {isGM: false}};
  addGMSummaryControl(controls, () => toggles++);
  assert.equal(controls.tokens.tools.yzeGMSummary, undefined);
  game.user.isGM = true;
  addGMSummaryControl(controls, () => toggles++);
  assert.equal(controls.tokens.tools.yzeGMSummary.button, true);
  assert.equal(controls.tokens.tools.yzeGMSummary.order, 4);
  controls.tokens.tools.yzeGMSummary.onChange();
  assert.equal(toggles, 1);
  assert.equal(controls.tokens.activeTool, "select");
});
