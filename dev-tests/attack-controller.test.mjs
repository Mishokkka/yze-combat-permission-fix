import test from "node:test";
import assert from "node:assert/strict";
import {createAttackController} from "../scripts/attack-controller.js";
import {createRollBridge} from "../scripts/roll-bridge.js";

function fixture({firearms = false} = {}) {
  let nextHook = 0, app, resolveRoll, rejectRoll, resolveReservation, nativeCalls = 0, ammoCalls = 0, phase = null, selected;
  const hooks = new Map(), requests = [];
  globalThis.Hooks = {
    on(name, callback) {const id = ++nextHook; hooks.set(id, {name, callback}); return id;},
    off(_name, id) {hooks.delete(id);},
    callAll(name, ...args) {for (const {name: event, callback} of hooks.values()) if (name === event) callback(...args);},
  };
  globalThis.foundry = {utils: {randomID: () => "intent1"}};
  globalThis.ui = {notifications: {error() {}}};
  const actor = {id: "pc", uuid: "Actor.pc", type: "character", isOwner: true, canAct: true,
    items: new Map([["gun", {id: "gun", name: "Gun", type: "weapon", system: {damage: 2}}]])};
  selected = actor;
  const originalOptions = () => ({actorId: "pc", actorType: "character"});
  actor.sheet = {rollAction() {}, getRollOptions: originalOptions,
    rollGear() {
      const options = this.getRollOptions();
      const promise = new Promise((resolve, reject) => {resolveRoll = resolve; rejectRoll = reject;});
      app = {options, getRollOptions: () => ({actorId: "pc", itemId: "gun", isAttack: true}),
        async executeRoll() {
          nativeCalls++;
          const options = app.getRollOptions();
          return {roll: {options}, message: {id: "message", rolls: [{options}]}};
        }};
      if (firearms) {
        const execute = app.executeRoll, get = app.getRollOptions;
        app.getRollOptions = () => ({...get(), flFirearmsContext: {nonce: "firearm"}});
        app.executeRoll = async function (...args) {ammoCalls++; return execute.apply(this, args);};
      }
      // Another native window with the same Actor/Item must not be captured.
      Hooks.callAll("renderApplication", {options: {}, getRollOptions: app.getRollOptions, executeRoll() {throw new Error("unrelated window captured");}});
      Hooks.callAll("renderApplication", app);
      return promise;
    },
  };
  globalThis.game = {system: {id: "forbidden-lands", version: "13.0.5"}, modules: new Map()};
  const equipment = {actorUuid: actor.uuid, revision: "equipment", hands: {right: "gun", left: null}};
  const rolls = createRollBridge({getActor: () => selected, getEquipmentState: () => equipment});
  const operations = {async request(payload) {
    requests.push(payload);
    if (payload.kind === "prepareAttack") phase = "prepared";
    if (payload.kind === "reserveAttack") {
      if (operations.holdReservation) await new Promise(resolve => resolveReservation = resolve);
      phase = "rolling";
    }
    if (payload.kind === "confirmAttack") phase = "complete";
    if (payload.kind === "cancel" && phase !== "complete") phase = "cancelled";
    return {operation: {phase}};
  }};
  const controller = createAttackController({operations, rolls, getActor: () => selected});
  return {actor, controller, operations, requests, hooks, originalOptions,
    launch: () => controller.launch({actorUuid: actor.uuid, itemId: "gun", equipmentRevision: "equipment", weaponRevision: "weapon", cost: "slow", combat: {id: "combat", round: 1}}),
    async opened() {while (!app) await new Promise(resolve => setImmediate(resolve));},
    submit: () => app.executeRoll().then(result => {resolveRoll(result); return result;}, error => {rejectRoll(error); throw error;}),
    close() {Hooks.callAll("closeApplication", app); rejectRoll(new Error("Roll cancelled"));},
    release: () => resolveReservation(), get app() {return app;}, get phase() {return phase;},
    get nativeCalls() {return nativeCalls;}, get ammoCalls() {return ammoCalls;}, set selected(value) {selected = value;},
  };
}

test("native completion carries this exact intent and preserves firearms options without a second ammo call", async () => {
  const f = fixture({firearms: true}), pending = f.launch(); await f.opened();
  assert.equal(f.actor.sheet.getRollOptions, f.originalOptions);
  assert.equal(f.phase, "prepared"); assert.equal(f.nativeCalls, 0);
  const result = await f.submit(); assert.equal(await pending, result);
  assert.equal(f.nativeCalls, 1); assert.equal(f.ammoCalls, 1); assert.equal(f.phase, "complete");
  assert.deepEqual(result.roll.options.yzeWidgetAttack, {id: "intent1", actorUuid: "Actor.pc", itemId: "gun", combat: {id: "combat", round: 1}});
  assert.deepEqual(result.roll.options.flFirearmsContext, {nonce: "firearm"});
  assert.equal(f.hooks.size, 0);
});
test("closing an unsubmitted native promise cancels without reserving actions", async () => {
  const f = fixture(), pending = f.launch(); await f.opened(); f.close();
  assert.equal(await pending, null); assert.equal(f.phase, "cancelled");
  assert.equal(f.requests.some(payload => payload.kind === "reserveAttack"), false); assert.equal(f.nativeCalls, 0);
});
test("duplicate submissions await the same result and never resolve the native dialog prematurely", async () => {
  const f = fixture(), pending = f.launch(); await f.opened(); f.operations.holdReservation = true;
  const first = f.submit(), second = f.submit();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.controller.isOpen(f.actor.uuid), true); assert.equal(f.nativeCalls, 0);
  f.release();
  assert.equal(await first, await second); await pending;
  assert.equal(f.nativeCalls, 1); assert.equal(f.requests.filter(payload => payload.kind === "reserveAttack").length, 1);
});
test("closing while payment is in flight cancels before dice/ammo and waits for its reservation", async () => {
  const f = fixture(), pending = f.launch(); await f.opened(); f.operations.holdReservation = true;
  const submitted = f.submit(); await new Promise(resolve => setImmediate(resolve)); f.close();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.controller.isOpen(f.actor.uuid), true);
  f.release(); assert.equal(await submitted, null); assert.equal(await pending, null);
  assert.equal(f.nativeCalls, 0); assert.equal(f.phase, "cancelled");
});
test("Actor selection changes reject submission before its reservation/native backend", async () => {
  const f = fixture(), pending = f.launch(); await f.opened();
  const settled = assert.rejects(pending, /персонаж изменился/);
  f.selected = {...f.actor, uuid: "Actor.other"};
  await assert.rejects(f.submit(), /персонаж изменился/); await settled;
  assert.equal(f.nativeCalls, 0); assert.equal(f.phase, "cancelled");
});
test("a second widget launch for the same Actor is refused while the first dialog is open", async () => {
  const f = fixture(), pending = f.launch(); await f.opened();
  await assert.rejects(f.launch(), /уже открыт/); f.close(); await pending;
  assert.equal(f.requests.filter(payload => payload.kind === "prepareAttack").length, 1);
});
