import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createQuickAccessBridge, getQuickAccessEquipmentApi } from "../scripts/quick-access-bridge.js";
import { createCombatReference } from "../scripts/combat-reference.js";

globalThis.game = { modules: new Map() };

test("missing, inactive, legacy and incompatible Quick Access disable only the bridge", () => {
  for (const module of [undefined, { active: false }, { active: true, api: { getQuickAccessSlots() {} } },
    { active: true, api: { capabilities: { equipment: true }, equipmentApiVersion: 2 } }]) {
    game.modules.set("fbl-quick-access", module);
    assert.equal(getQuickAccessEquipmentApi(), null);
    assert.equal(createQuickAccessBridge(() => null, () => false).getState(), null);
  }
});

test("bridge follows the current Actor and forwards snapshot guards without private flag access", async () => {
  let actor = { uuid: "Scene.one.Token.pc.Actor.pc" };
  const calls = [];
  game.modules.set("fbl-quick-access", { active: true, api: {
    capabilities: { equipment: true }, equipmentApiVersion: 1,
    getEquipmentState: actor => ({ actorUuid: actor.uuid }),
    performEquipmentAction: async (...args) => { calls.push(args); return { changed: true }; }
  } });
  const bridge = createQuickAccessBridge(() => actor, () => true);
  assert.equal(bridge.available, true);
  assert.equal(bridge.getState().actorUuid, actor.uuid);
  actor = { uuid: "Actor.other" };
  const command = { type: "swapHands" }, options = { expectedRevision: "revision" };
  assert.deepEqual(await bridge.performAction(command, options), { changed: true });
  assert.deepEqual(calls, [[actor, command, options]]);
});

test("equipment read failures are isolated from rendering, while command failures remain visible", async () => {
  const errors = [];
  game.modules.set("fbl-quick-access", { active: true, api: {
    capabilities: { equipment: true }, equipmentApiVersion: 1,
    getEquipmentState() { throw new Error("private actor"); },
    performEquipmentAction() { throw new Error("write failed"); }
  } });
  const bridge = createQuickAccessBridge(() => ({}), () => true, (...args) => errors.push(args));
  assert.equal(bridge.getState(), null);
  assert.equal(errors.length, 1);
  await assert.rejects(bridge.performAction({ type: "swapHands" }), /write failed/);
});

test("bridge rejects commands without an owned current combatant", async () => {
  const bridge = createQuickAccessBridge(() => null, () => false);
  await assert.rejects(bridge.performAction({ type: "swapHands" }), /owned combatant/);
  game.modules.clear();
  await assert.rejects(bridge.performAction({ type: "swapHands" }), /unavailable/);
});

test("reference restores client state and reports only actual disclosure changes", () => {
  const events = [];
  const handlers = new Map();
  globalThis.document = { createElement: tag => ({ tag, open: false, addEventListener: (name, fn) => handlers.set(name, fn) }) };
  const reference = createCombatReference({ open: true, onToggle: value => events.push(value) });
  assert.equal(reference.tag, "details");
  assert.equal(reference.open, true);
  handlers.get("toggle")();
  assert.deepEqual(events, []);
  reference.open = false;
  handlers.get("toggle")();
  handlers.get("toggle")();
  assert.deepEqual(events, [false]);
});

test("manifest targets remain unchanged and every runtime import exists", () => {
  const manifest = JSON.parse(readFileSync(new URL("../module.json", import.meta.url)));
  assert.equal(manifest.relationships.requires[0].id, "yze-combat");
  assert.equal(manifest.relationships.requires[0].compatibility.maximum, "1.6.1");
  assert.equal(manifest.relationships.requires.some(x => x.id === "fbl-quick-access"), false);
  for (const path of [...manifest.esmodules, ...manifest.styles, "scripts/combat-reference.js", "scripts/quick-access-bridge.js"]) {
    assert.ok(readFileSync(new URL(`../${path}`, import.meta.url)).length);
  }
});
