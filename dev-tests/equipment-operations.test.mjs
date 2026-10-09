import test from "node:test";
import assert from "node:assert/strict";
import { createEquipmentOperations, OPERATION_FLAG, equipmentUndoError } from "../scripts/equipment-operations.js";

const MODULE = "yze-combat-permission-fix";
function fixture() {
  const owner = { id: "owner", active: true }, gm = { id: "gm", active: true, isGM: true };
  const flags = {}, receipts = new Map(), handlers = new Map();
  let activeGM = gm, nextEffect = 0, handWrites = 0, journalWrites = 0;
  const actor = {
    uuid: "Actor.pc", documentName: "Actor", type: "character", effects: [], hands: { left: null, right: null },
    statuses: new Set(), owned: true, getFlag: (m,k) => flags[`${m}.${k}`],
    testUserPermission: user => actor.owned && user.id === owner.id,
    async update(data) {
      journalWrites++;
      if (actor.failJournal?.(journalWrites)) throw new Error("journal unavailable");
      for (const [key,value] of Object.entries(data)) flags[key.slice(6)] = structuredClone(value);
      return actor;
    },
    refreshStatuses() { actor.statuses = new Set(actor.effects.flatMap(e => e.disabled ? [] : [...e.statuses])); },
    async createEmbeddedDocuments(_type, data) {
      if (actor.failFee?.(data[0].statuses[0])) throw new Error("fee unavailable");
      const results = data.map(d => ({ ...structuredClone(d), id: `effect${++nextEffect}`, statuses: new Set(d.statuses), getFlag(m,k) { return this.flags?.[m]?.[k]; } }));
      actor.effects.push(...results); actor.refreshStatuses();
      actor.afterFee?.();
      if (actor.loseFeeAck) { actor.loseFeeAck = false; throw new Error("fee ack lost"); }
      return results;
    },
    async deleteEmbeddedDocuments(_type, ids) {
      if (actor.cancelDelete) { actor.cancelDelete = false; return []; }
      actor.effects = actor.effects.filter(e => !ids.includes(e.id)); actor.refreshStatuses(); return ids;
    },
    async toggleStatusEffect(id, {active}) {
      if (active) await actor.createEmbeddedDocuments("ActiveEffect", [{statuses:[id],flags:{}}]);
      else await actor.deleteEmbeddedDocuments("ActiveEffect", actor.effects.filter(e=>e.statuses.has(id)).map(e=>e.id));
    }
  };
  const combat = { id: "combat", round: 1, started: true, combatants: [{actor}] };
  globalThis.game = { user: gm, users: new Map([[owner.id,owner],[gm.id,gm]]), combat, combats: new Map([[combat.id,combat]]) };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: {OWNER:3} };
  globalThis.getDocumentClass = () => ({ fromStatusEffect: async id => ({ toObject: () => ({ _id: "native", statuses:[id],flags:{},name:id }) }) });
  const state = () => ({ revision: JSON.stringify(actor.hands), hands: structuredClone(actor.hands) });
  const api = {
    capabilities: {equipmentControls:true}, getActiveGM: () => activeGM, getEquipmentState: state,
    getQuickAccessSlots: () => [], getEquipmentReceipt: (_a,id) => structuredClone(receipts.get(id) ?? null),
    previewEquipmentAction(_a, command) {
      if (command.type === "undo") {
        const receipt = receipts.get(command.receiptId);
        if (!receipt || JSON.stringify(actor.hands) !== JSON.stringify(receipt.after.hands)) throw new Error("equipment changed");
        return {changed:true,hands:receipt.before.hands};
      }
      const hands = command.type === "stow" ? {left:null,right:null} : command.type === "swapHands" ? {left:actor.hands.right,right:actor.hands.left} : {left:command.itemId ?? "sword",right:null};
      return {changed:JSON.stringify(hands)!==JSON.stringify(actor.hands),hands};
    },
    async performEquipmentAction(_a,command,options) {
      if (receipts.has(options.operationId)) return {changed:true,receipt:api.getEquipmentReceipt(actor,options.operationId)};
      if (options.expectedRevision !== undefined && options.expectedRevision !== state().revision) throw new Error("stale revision");
      const plan = api.previewEquipmentAction(actor,command), before = structuredClone(actor.hands);
      actor.hands = structuredClone(plan.hands); handWrites++;
      const receipt = {changed:true,command,before:{hands:before},after:{hands:structuredClone(actor.hands)}};
      receipts.set(options.operationId,receipt);
      actor.afterHands?.();
      if (actor.loseHandAck) { actor.loseHandAck=false; throw new Error("hand ack lost"); }
      return {changed:true,receipt};
    },
    registerSocketHandler: (key,fn) => handlers.set(key,fn),
    executeAsActiveGM: (_key,payload) => engine.execute(payload,{requestUser:owner})
  };
  const engine = createEquipmentOperations({ getApi:()=>api,resolveActor:async uuid=>uuid===actor.uuid?actor:null });
  const payload = (cost="fast",id="op") => ({kind:"start",id,actorUuid:actor.uuid,command:{type:"hold",itemId:"sword",hand:"left"},cost,combat:{id:combat.id,round:combat.round},expectedRevision:state().revision});
  const execute = p => engine.execute(p,{requestUser:owner});
  const recover = kind => execute({kind,id:"op",actorUuid:actor.uuid});
  return {actor,owner,gm,combat,api,engine,payload,execute,recover,flags,receipts,
    get handWrites(){return handWrites;}, get journalWrites(){return journalWrites;},
    set activeGM(value){activeGM=value;}, operation:()=>flags[`${MODULE}.${OPERATION_FLAG}`]};
}

test("a paid command and its retry write equipment and native cost only once", async () => {
  const f=fixture(), p=f.payload("both");
  await f.execute(p); await f.execute(p);
  assert.equal(f.handWrites,1); assert.equal(f.actor.effects.length,2);
  assert.deepEqual([...f.actor.statuses],["fastAction","slowAction"]);
  assert.equal(f.operation().phase,"complete");
});
test("no-op, stale, spent, malformed and unauthorized commands never start a journal", async () => {
  const f=fixture(); f.actor.hands.left="sword";
  assert.equal((await f.execute(f.payload())).changed,false);
  f.actor.hands.left=null;
  await assert.rejects(f.execute({...f.payload(),expectedRevision:"stale"}),/изменилась/);
  await assert.rejects(f.execute({...f.payload(),cost:"auto"}),/стоимость/);
  f.actor.statuses.add("fastAction"); await assert.rejects(f.execute(f.payload()),/потрачено/);
  f.actor.owned=false; await assert.rejects(f.execute(f.payload()),/прав/);
  assert.equal(f.journalWrites,0); assert.equal(f.handWrites,0);
});
for (const loss of ["loseHandAck","loseFeeAck"]) test(`${loss} recovers committed state without duplicate writes`, async () => {
  const f=fixture(); f.actor[loss]=true;
  await assert.rejects(f.execute(f.payload()),/ack lost/);
  assert.equal(f.operation().phase,"pending");
  await f.recover("resume");
  assert.equal(f.handWrites,1); assert.equal(f.actor.effects.length,1); assert.equal(f.operation().phase,"complete");
});
test("partial both-cost payment resumes only the missing effect", async () => {
  const f=fixture(); f.actor.failFee=id=>id==="slowAction";
  await assert.rejects(f.execute(f.payload("both")),/fee unavailable/);
  assert.equal(f.actor.effects.length,1); f.actor.failFee=null;
  await f.recover("resume"); assert.equal(f.actor.effects.length,2); assert.equal(f.handWrites,1);
});
test("cancel restores equipment and removes only this operation's partial payment", async () => {
  const f=fixture(); f.actor.failFee=id=>id==="slowAction";
  await assert.rejects(f.execute(f.payload("both")),/fee/); f.actor.failFee=null;
  await f.actor.createEmbeddedDocuments("ActiveEffect",[{statuses:["foreign"],flags:{}}]);
  await f.recover("cancel"); await f.recover("cancel");
  assert.deepEqual(f.actor.hands,{left:null,right:null}); assert.deepEqual([...f.actor.statuses],["foreign"]);
  assert.equal(f.operation().phase,"undone"); assert.equal(f.handWrites,2);
});
test("undo and interrupted refund are idempotent", async () => {
  const f=fixture(); await f.execute(f.payload()); f.actor.cancelDelete=true;
  await assert.rejects(f.recover("undo"),/Отмена отметок/);
  assert.equal(f.operation().phase,"undoing"); assert.equal(f.handWrites,2);
  await f.recover("resume"); assert.equal(f.handWrites,2); assert.equal(f.actor.effects.length,0);
});
test("unsafe undo preserves another owner's equipment and action marks", async () => {
  const f=fixture(); await f.execute(f.payload()); f.actor.hands.left="shield";
  assert.match(equipmentUndoError(f.actor,f.api),/equipment changed/);
  await assert.rejects(f.recover("undo"),/equipment changed/); assert.equal(f.actor.effects.length,1);
});
test("round advance during payment cleans its own fee and requires cancellation", async () => {
  const f=fixture(); f.actor.afterFee=()=>f.combat.round++;
  await assert.rejects(f.execute(f.payload("both")),/Раунд изменился/);
  assert.equal(f.actor.effects.length,0); assert.equal(f.operation().phase,"pending");
  await assert.rejects(f.recover("resume"),/Раунд изменился/);
  await f.recover("cancel"); assert.equal(f.actor.hands.left,null);
});
test("a removed combatant or GM handover stops payment after a committed grip", async () => {
  for (const change of [f=>f.combat.combatants=[],f=>f.activeGM={id:"new-gm"}]) {
    const f=fixture(); f.actor.afterHands=()=>change(f);
    await assert.rejects(f.execute(f.payload()),/не участвует|GM изменился/);
    assert.equal(f.actor.effects.length,0); assert.equal(f.operation().phase,"pending");
  }
});
test("without a GM free changes work, paid start/recovery/refund remain blocked", async () => {
  const f=fixture(); await f.execute(f.payload()); f.activeGM=null; game.user=f.owner;
  for (const kind of ["resume","undo","cancel"]) await assert.rejects(f.engine.request({kind,id:"op",actorUuid:f.actor.uuid}),/активный GM/);
  await assert.rejects(f.engine.request(f.payload("both","new")),/активный GM/);
  const p={...f.payload("free","free"),command:{type:"stow",hand:"both"}};
  await f.engine.request(p); assert.equal(f.actor.hands.left,null);
});
test("co-owner commands are serialized and reject stale competing revisions", async () => {
  const f=fixture(), first=f.payload("free","first"), second={...f.payload("free","second"),command:{type:"hold",itemId:"shield",hand:"left"}};
  const a=f.execute(first), b=f.execute(second); await a; await assert.rejects(b,/изменилась/);
  assert.equal(f.handWrites,1);
});
test("manual marking cannot interleave a pending equipment operation", async () => {
  const f=fixture(); f.actor.loseHandAck=true; await assert.rejects(f.execute(f.payload()),/ack/);
  await assert.rejects(f.execute({kind:"toggle",actorUuid:f.actor.uuid,statusId:"fastAction",expectedSpent:false,combat:{id:"combat",round:1}}),/Сначала/);
  await f.recover("cancel");
});
test("failed journal commit never changes hands and failed final commit recovers safely", async () => {
  const f=fixture(); f.actor.failJournal=n=>n===1;
  await assert.rejects(f.execute(f.payload()),/journal/); assert.equal(f.handWrites,0);
  f.actor.failJournal=n=>n===3; await assert.rejects(f.execute(f.payload()),/journal/);
  assert.equal(f.handWrites,1); assert.equal(f.actor.effects.length,1);
  f.actor.failJournal=null; await f.recover("resume"); assert.equal(f.handWrites,1); assert.equal(f.actor.effects.length,1);
});

test("replaying an older receipt after another operation cannot charge again", async () => {
  const f=fixture(); f.actor.hands={left:"sword",right:"shield"};
  const first={...f.payload(),command:{type:"swapHands"}}; await f.execute(first);
  await f.execute({...f.payload("free","second"),command:{type:"hold",itemId:"bow",hand:"left"}});
  f.actor.hands={left:"shield",right:"sword"};
  await f.actor.deleteEmbeddedDocuments("ActiveEffect",f.actor.effects.map(e=>e.id));
  const writes=f.journalWrites;
  await assert.rejects(f.execute({...first,expectedRevision:f.api.getEquipmentState(f.actor).revision}),/уже выполнялась/);
  assert.equal(f.journalWrites,writes); assert.equal(f.actor.effects.length,0);
});
