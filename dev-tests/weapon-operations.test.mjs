import test from "node:test";
import assert from "node:assert/strict";
import {createWeaponOperations, getReloadProgress, readWeaponOperation, WEAPON_OPERATION} from "../scripts/weapon-operations.js";
import {createEquipmentOperations} from "../scripts/equipment-operations.js";

const MODULE = "yze-combat-permission-fix";
function fixture() {
  const owner = {id: "owner", active: true}, gm = {id: "gm", active: true, isGM: true};
  const flags = {}, handlers = new Map(), gun = {id: "gun"};
  let sequence = 0, ammo = 0, loads = 0, topOffs = 0, activeGM = gm;
  const actor = {id: "pc", uuid: "Actor.pc", documentName: "Actor", type: "character", isOwner: true, canAct: true,
    items: new Map([[gun.id, gun]]), effects: [], statuses: new Set(), sheet: {rollGear() {}},
    getFlag: (_m, key) => flags[key], testUserPermission: user => actor.owned !== false && user.id === owner.id,
    async update(data) {
      if (actor.cancelWrite) {actor.cancelWrite = false; return undefined;}
      if (actor.failComplete && data[`flags.${MODULE}.${WEAPON_OPERATION}`]?.phase === "complete") throw new Error("journal unavailable");
      for (const [path, value] of Object.entries(data)) flags[path.split(".").at(-1)] = structuredClone(value);
      actor.afterWrite?.(); return actor;
    },
    refresh() {actor.statuses = new Set(actor.effects.filter(effect => !effect.disabled).flatMap(effect => [...effect.statuses]));},
    async createEmbeddedDocuments(_type, data) {
      if (actor.failFee === data[0].statuses[0]) throw new Error("fee unavailable");
      const result = data.map(value => ({...structuredClone(value), id: `effect${++sequence}`, statuses: new Set(value.statuses),
        getFlag(module, key) {return this.flags?.[module]?.[key];}}));
      actor.effects.push(...result); actor.refresh(); actor.afterFee?.(); return result;
    },
    async deleteEmbeddedDocuments(_type, ids) {actor.effects = actor.effects.filter(effect => !ids.includes(effect.id)); actor.refresh(); return ids;},
  };
  const combat = {id: "combat", started: true, round: 1, combatants: [{actor}]};
  globalThis.game = {user: gm, users: new Map([[owner.id, owner], [gm.id, gm]]), combat, combats: new Map([[combat.id, combat]]), modules: new Map(), messages: new Map()};
  globalThis.CONST = {DOCUMENT_OWNERSHIP_LEVELS: {OWNER: 3}};
  globalThis.getDocumentClass = () => ({fromStatusEffect: async id => ({toObject: () => ({statuses: [id], flags: {}})})});
  const api = {capabilities: {equipmentControls: true, heldItemPresentation: true}, getActiveGM: () => activeGM,
    getEquipmentState: () => ({revision: "equipment", hands: {right: "gun", left: null}}),
    getQuickAccessSlots: () => [], getEquipmentReceipt: () => null, previewEquipmentAction: () => ({}),
    registerSocketHandler: (key, callback) => handlers.set(key, callback), executeAsActiveGM: (key, payload) => handlers.get(key)(payload, {requestUser: owner}),
    getHeldItemPresentation() {
      const item = {itemId: "gun", name: "Gun", broken: false, attack: true, reload: true,
        firearm: {reloadType: "MAG", reloadValue: "", magazine: {current: ammo, capacity: 6}, topOff: true}};
      if (actor.nonMagazine) item.firearm = {reloadType: "Slow", reloadValue: "2", magazine: null};
      item.revision = JSON.stringify([item, actor.weaponEdit ?? 0]);
      return {equipmentRevision: "equipment", items: actor.stowed ? [] : [item]};
    },
  };
  game.modules.set("fl-firearms", {active: true, api: {
    async loadMagazine() {loads++; const oldAmmo = ammo; ammo = 6; if (actor.loseLoadAck) throw new Error("load ack lost"); return {oldAmmo, newAmmo: ammo};},
    async topOffMagazine() {topOffs++; const oldAmmo = ammo; ammo++; return {oldAmmo, newAmmo: ammo};},
  }});
  const operations = createWeaponOperations({getApi: () => api, resolveActor: async uuid => uuid === actor.uuid ? actor : null});
  const snapshot = () => api.getHeldItemPresentation().items[0];
  const payload = (kind = "reload", id = `operation${++sequence}`, cost = "fast", mode = "load") => ({kind, id, cost, mode, actorUuid: actor.uuid, itemId: "gun", combat: {id: combat.id, round: combat.round},
    equipmentRevision: "equipment", weaponRevision: snapshot().revision, progressRevision: getReloadProgress(actor, snapshot(), mode).revision,
    target: 2, current: getReloadProgress(actor, snapshot(), mode).current, amount: 1, unit: "steps"});
  const execute = value => operations.execute(value, {requestUser: owner});
  const follow = (kind, extra = {}) => execute({kind, id: readWeaponOperation(actor).id, actorUuid: actor.uuid, ...extra});
  const message = (extra = {}) => {
    const operation = readWeaponOperation(actor);
    const result = {id: `message${++sequence}`, author: owner, rolls: [{pushed: false, options: {isAttack: true, actorId: actor.id, itemId: "gun",
      yzeWidgetAttack: {id: operation.id, actorUuid: actor.uuid, itemId: "gun", combat: operation.combat}, ...extra}}]};
    game.messages.set(result.id, result); return result;
  };
  return {actor, api, operations, payload, execute, follow, message, snapshot, owner, combat, flags,
    get loads() {return loads;}, get topOffs() {return topOffs;}, get ammo() {return ammo;}, set activeGM(value) {activeGM = value;}};
}

test("multi-round reload advances once per paid step; final step calls FL once and old receipts deduplicate", async () => {
  const f = fixture(), first = f.payload(); await f.execute(first);
  assert.equal(getReloadProgress(f.actor, f.snapshot()).current, 1); assert.equal(f.loads, 0);
  assert.equal(f.actor.effects.length, 1);
  await f.execute(first); assert.equal(f.actor.effects.length, 1);
  f.combat.round++; f.actor.effects = []; f.actor.refresh();
  const second = f.payload(); await f.execute(second);
  assert.equal(f.loads, 1); assert.equal(f.ammo, 6); assert.equal(getReloadProgress(f.actor, f.snapshot()).finished, true);
  await f.execute(second); await f.execute(first); assert.equal(f.loads, 1); assert.equal(f.actor.effects.length, 1);
});
test("manual current/target changes spend neither ammo nor actions; finishing is explicit", async () => {
  const f = fixture(); await f.execute({...f.payload("progress"), current: 3, target: 3});
  assert.equal(f.loads, 0); assert.equal(f.actor.effects.length, 0);
  await f.execute({...f.payload("reload", "finish", "free"), target: 3, current: 3, amount: 0});
  assert.equal(f.loads, 1); assert.equal(f.actor.effects.length, 0);
});
test("abilities can change total and progress per action without guessed talent rules", async () => {
  const f = fixture(); f.actor.nonMagazine = true;
  await f.execute({...f.payload(), target: 4, amount: 2});
  assert.equal(getReloadProgress(f.actor, f.snapshot()).current, 2); assert.equal(f.loads, 0);
  f.combat.round++; f.actor.effects = []; f.actor.refresh();
  await f.execute({...f.payload(), current: 2, target: 3, amount: 1});
  assert.equal(getReloadProgress(f.actor, f.snapshot()).finished, true); assert.equal(f.loads, 0);
});
test("top-off calls the public +1 API only on the final step", async () => {
  const f = fixture(); await f.execute({...f.payload("reload", "top", "free", "topOff"), target: 1});
  assert.equal(f.topOffs, 1); assert.equal(f.loads, 0); assert.equal(f.ammo, 1);
});
test("partial both-cost payment resumes only its missing effect and increments progress once", async () => {
  const f = fixture(); f.actor.failFee = "slowAction";
  await assert.rejects(f.execute(f.payload("reload", "partial", "both")), /fee/);
  assert.equal(f.actor.effects.length, 1); assert.equal(getReloadProgress(f.actor, f.snapshot()).current, 0);
  f.actor.failFee = null; await f.follow("resume");
  assert.equal(f.actor.effects.length, 2); assert.equal(getReloadProgress(f.actor, f.snapshot()).current, 1);
  await f.follow("resume"); assert.equal(getReloadProgress(f.actor, f.snapshot()).current, 1);
});
test("cancel refunds only owned effects, preserving an unrelated manually marked action", async () => {
  const f = fixture(); f.actor.failFee = "slowAction";
  await assert.rejects(f.execute(f.payload("reload", "partial", "both")));
  f.actor.failFee = null;
  await f.actor.createEmbeddedDocuments("ActiveEffect", [{statuses: ["slowAction"], flags: {}}]);
  await f.follow("cancel");
  assert.deepEqual([...f.actor.statuses], ["slowAction"]); assert.equal(f.loads, 0);
});
test("an uncertain external commit is not repeated/refunded until its result is explicitly checked", async () => {
  const f = fixture(); f.actor.loseLoadAck = true;
  await assert.rejects(f.execute({...f.payload(), target: 1}), /ack lost/);
  assert.equal(f.ammo, 6); assert.equal(readWeaponOperation(f.actor).phase, "external");
  await assert.rejects(f.follow("resume"), /повтор не выполнен/);
  await assert.rejects(f.follow("cancel"), /Проверьте магазин/);
  await f.follow("resolveDone"); assert.equal(f.loads, 1); assert.equal(readWeaponOperation(f.actor).phase, "complete");
});
test("legacy void-returning FL 0.4.6 is confirmed by an exact normalized magazine postimage", async () => {
  const f = fixture(), api = game.modules.get("fl-firearms").api, load = api.loadMagazine;
  api.loadMagazine = async () => {await load();}; api.getMagazineProfile = () => ({current: f.ammo, capacity: 6});
  await f.execute({...f.payload(), target: 1});
  assert.equal(readWeaponOperation(f.actor).phase, "complete"); assert.equal(f.loads, 1);
  assert.equal(readWeaponOperation(f.actor).outcome.legacyPostimage, true);
});
test("a legacy load that makes no change stays uncertain and cannot be repeated automatically", async () => {
  const f = fixture(), api = game.modules.get("fl-firearms").api;
  api.loadMagazine = async () => {}; api.getMagazineProfile = () => ({current: 0, capacity: 6});
  await assert.rejects(f.execute({...f.payload(), target: 1}), /не подтверждён/);
  assert.equal(readWeaponOperation(f.actor).phase, "external");
  await assert.rejects(f.follow("resume"), /повтор не выполнен/);
});
test("cancelled initial writes, stale snapshots, nonowners and stowed Items never spend costs/ammo", async () => {
  for (const mutate of [f => f.actor.cancelWrite = true, f => f.actor.owned = false, f => f.actor.stowed = true, f => f.actor.weaponEdit = 1]) {
    const f = fixture(), payload = f.payload(); mutate(f);
    await assert.rejects(f.execute(payload)); assert.equal(f.loads, 0); assert.equal(f.actor.effects.length, 0);
  }
});
test("round/authority changes stop payment and cannot spend a new round's action", async () => {
  for (const change of [f => f.combat.round++, f => f.activeGM = {id: "newGM"}]) {
    const f = fixture(); f.actor.afterWrite = () => {f.actor.afterWrite = null; change(f);};
    await assert.rejects(f.execute(f.payload())); assert.equal(f.actor.effects.length, 0); assert.equal(f.loads, 0);
  }
});
test("prepared attack costs nothing; reservation is idempotent and a confirmed roll does not repay in a later round", async () => {
  const f = fixture(); await f.execute(f.payload("prepareAttack", "attack", "slow"));
  assert.equal(f.actor.effects.length, 0);
  await f.follow("reserveAttack"); await f.follow("reserveAttack"); assert.equal(f.actor.effects.length, 1);
  const message = f.message(); f.combat.round++; f.actor.effects = []; f.actor.refresh();
  await f.follow("confirmAttack", {messageId: message.id}); await f.follow("confirmAttack", {messageId: message.id});
  assert.equal(f.actor.effects.length, 0); assert.equal(readWeaponOperation(f.actor).messageId, message.id);
});
test("attack confirmation rejects wrong authors/items/Actors/Push; cancellation cannot refund a confirmed roll", async () => {
  const f = fixture(); await f.execute(f.payload("prepareAttack", "attack", "slow")); await f.follow("reserveAttack");
  for (const extra of [{actorId: "other"}, {itemId: "other"}, {yzeWidgetAttack: {id: "wrong"}}]) {
    const bad = f.message(extra); await assert.rejects(f.follow("confirmAttack", {messageId: bad.id}));
  }
  const pushed = f.message(); pushed.rolls[0].pushed = true;
  await assert.rejects(f.follow("confirmAttack", {messageId: pushed.id}));
  const wrong = f.message(); wrong.author = {id: "stranger"}; await assert.rejects(f.follow("confirmAttack", {messageId: wrong.id}));
  const good = f.message(); await f.follow("cancel", {verifyNoRoll: true});
  assert.equal(readWeaponOperation(f.actor).messageId, good.id); assert.equal(f.actor.effects.length, 1);
});
test("unsubmitted/dry attacks refund own reservation; paid requests need an active GM", async () => {
  const f = fixture(); await f.execute(f.payload("prepareAttack", "attack", "slow")); await f.follow("reserveAttack");
  await f.follow("cancel", {verifyNoRoll: true}); assert.equal(f.actor.effects.length, 0);
  f.activeGM = null; game.user = f.owner;
  await assert.rejects(f.operations.request(f.payload("prepareAttack", "noGM", "slow")), /активный GM/);
});
test("weapon, equipment and manual status operations share a queue and pending guard", async () => {
  const f = fixture(); await f.execute(f.payload("prepareAttack", "attack", "free"));
  const equipment = createEquipmentOperations({getApi: () => f.api, resolveActor: async () => f.actor});
  await assert.rejects(equipment.execute({kind: "toggle", actorUuid: f.actor.uuid, statusId: "fastAction", expectedSpent: false, combat: {id: "combat", round: 1}}, {requestUser: f.owner}), /операцию оружия/);
  await f.follow("cancel");
  f.flags.equipmentOperation = {version: 1, phase: "pending"};
  await assert.rejects(f.execute(f.payload()), /экипировки/);
});
test("competing owners' reload steps reject the stale progress snapshot", async () => {
  const f = fixture(), first = f.payload("reload", "first", "free"), second = f.payload("reload", "second", "free");
  await f.execute(first); await assert.rejects(f.execute(second), /Прогресс уже/);
  assert.equal(getReloadProgress(f.actor, f.snapshot()).current, 1);
});
test("synthetic Actor confirmations require the exact scene/token, including replayed receipts", async () => {
  const f = fixture(); f.actor.isToken = true; f.actor.token = {id: "token", parent: {id: "scene"}};
  await f.execute(f.payload("prepareAttack", "attack", "free")); await f.follow("reserveAttack");
  const wrong = f.message({tokenId: "other", sceneId: "scene"});
  await assert.rejects(f.follow("confirmAttack", {messageId: wrong.id}));
  const good = f.message({tokenId: "token", sceneId: "scene"});
  await f.follow("confirmAttack", {messageId: good.id});
  await f.execute(f.payload("progress", "next", "free"));
  await f.execute({kind: "confirmAttack", id: "attack", actorUuid: f.actor.uuid, messageId: good.id});
  await assert.rejects(f.execute({kind: "confirmAttack", id: "attack", actorUuid: f.actor.uuid, messageId: wrong.id}));
  assert.equal(f.actor.effects.length, 0);
});
