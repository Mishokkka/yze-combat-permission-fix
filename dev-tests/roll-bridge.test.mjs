import test from "node:test";
import assert from "node:assert/strict";
import { createRollBridge } from "../scripts/roll-bridge.js";

function fixture() {
  const calls = [];
  const item = (id, type = "weapon", system = {}) => ({ id, type, system, name: id, getRollData: () => ({ isBroken: false }) });
  let actor = {
    uuid: "Scene.one.Token.pc.Actor.pc", type: "character", isOwner: true, canAct: true,
    items: new Map([item("sword"), item("shield", "armor", { part: "shield" }), item("torch", "gear")].map(x => [x.id, x])),
    sheet: { rollAction: (...args) => { calls.push(["action", ...args]); return "dialog"; },
      rollGear: (...args) => { calls.push(["gear", ...args]); return "dialog"; } },
  };
  let equipment = { actorUuid: actor.uuid, revision: "r1", hands: { left: "sword", right: "shield" } };
  let busy = false;
  globalThis.game = { system: { id: "forbidden-lands", version: "13.0.5" }, modules: new Map(), settings: { get: () => true } };
  const bridge = createRollBridge({ getActor: () => actor, getEquipmentState: () => equipment, isBusy: () => busy });
  return { bridge, calls, get actor() { return actor; }, set actor(value) { actor = value; },
    get equipment() { return equipment; }, set equipment(value) { equipment = value; }, set busy(value) { busy = value; } };
}

test("native weapon attack, Dodge and Parry open dialogs without writing/spending/submitting", async () => {
  const f = fixture();
  const request = { actorUuid: f.actor.uuid, expectedRevision: "r1" };
  assert.equal(await f.bridge.open({ ...request, kind: "attack", itemId: "sword" }), "dialog");
  await f.bridge.open({ ...request, kind: "dodge" });
  await f.bridge.open({ ...request, kind: "parry", itemId: "shield" });
  assert.deepEqual(f.calls, [["gear", "sword"], ["action", "dodge"], ["action", "parry", "shield"]]);
  assert.deepEqual(f.equipment.hands, { left: "sword", right: "shield" });
});

test("only held usable weapons/shields are exposed; detached snapshots do not change equipment", async () => {
  const f = fixture();
  const state = f.bridge.getState();
  assert.deepEqual(state.items.map(x => [x.itemId, x.attack, x.parry]), [["sword", true, true], ["shield", false, true]]);
  state.items[0].name = "changed";
  assert.equal(f.actor.items.get("sword").name, "sword");
  f.equipment.hands.right = "torch";
  for (const kind of ["attack", "parry"]) await assert.rejects(f.bridge.open({ kind, actorUuid: f.actor.uuid, itemId: "torch" }), /не подходит/);
  f.actor.items.get("sword").getRollData = () => ({ isBroken: true });
  await assert.rejects(f.bridge.open({ kind: "attack", actorUuid: f.actor.uuid, itemId: "sword" }), /не подходит/);
  assert.equal(f.calls.length, 0);
});

test("Actor selection, equipment revision, stale/missing held Item and unknown kind fail closed", async () => {
  const f = fixture(), request = { kind: "attack", actorUuid: f.actor.uuid, itemId: "sword", expectedRevision: "r1" };
  await assert.rejects(f.bridge.open({ ...request, actorUuid: "Actor.other" }), /персонаж изменился/);
  await assert.rejects(f.bridge.open({ ...request, actorUuid: undefined }), /персонаж изменился/);
  await assert.rejects(f.bridge.open({ ...request, expectedRevision: "old" }), /Экипировка изменилась/);
  await assert.rejects(f.bridge.open({ ...request, kind: "spell" }), /Неизвестный/);
  await assert.rejects(f.bridge.open({ ...request, kind: "dodge" }), /предмет не требуется/);
  f.equipment.hands.left = null;
  await assert.rejects(f.bridge.open(request), /должен находиться в руках/);
  f.equipment.hands.left = "sword"; f.actor.items.delete("sword");
  await assert.rejects(f.bridge.open(request), /не подходит/);
  f.equipment.actorUuid = "Actor.other";
  assert.deepEqual(f.bridge.getState().items, []);
  assert.equal(f.calls.length, 0);
});

test("permission, broken Actor, pending operation, unsupported system/version/method disable rolls", async () => {
  for (const mutate of [f => { f.actor.isOwner = false; }, f => { f.actor.canAct = false; },
    f => { f.busy = true; }, f => { f.actor.type = "monster"; },
    () => { game.system.id = "other"; }, () => { game.system.version = "13.0.6"; },
    f => { delete f.actor.sheet.rollAction; }]) {
    const f = fixture(); mutate(f);
    assert.equal(f.bridge.getState().available, false);
    await assert.rejects(f.bridge.open({ kind: "dodge", actorUuid: f.actor.uuid }), /Броски недоступны/);
    assert.equal(f.calls.length, 0);
  }
});

test("absent/inactive/disabled Roll Dialog Plus and absent Quick Access preserve native Dodge", async () => {
  const f = fixture(); f.equipment = null;
  assert.equal(f.bridge.getState().rollDialogPlus.enabled, false);
  assert.deepEqual(f.bridge.getState().items, []);
  for (const module of [{ active: false, version: "0.7.1" }, { active: true, version: "0.7.1" }]) {
    game.modules.set("fbl-roll-dialog-plus", module);
    game.settings.get = () => false;
    assert.equal(f.bridge.getState().rollDialogPlus.enabled, false);
    await f.bridge.open({ kind: "dodge", actorUuid: f.actor.uuid });
  }
  game.settings.get = () => { throw new Error("not registered"); };
  assert.equal(f.bridge.getState().rollDialogPlus.enabled, false);
  game.settings.get = () => true;
  assert.equal(f.bridge.getState().rollDialogPlus.enabled, true);
  await assert.rejects(f.bridge.open({ kind: "attack", actorUuid: f.actor.uuid, itemId: "sword" }), /должен находиться в руках/);
});

test("native failures propagate without fallback rolls; throwing Item data disables that Item", async () => {
  const f = fixture();
  f.actor.sheet.rollAction = async () => { throw new Error("native failure"); };
  await assert.rejects(f.bridge.open({ kind: "dodge", actorUuid: f.actor.uuid }), /native failure/);
  f.actor.items.get("sword").getRollData = () => { throw new Error("bad item"); };
  assert.equal(f.bridge.getState().items[0].attack, false);
  assert.equal(f.calls.length, 0);
});
