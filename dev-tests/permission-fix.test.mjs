import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Exercise the actual runtime functions without publishing internal handlers.
const source = readFileSync(new URL("../scripts/main.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/gm, "");

function fixture() {
  let sequence = 0;
  const gm = { id: "gm", isGM: true, active: true };
  const backupGM = { id: "backup-gm", isGM: true, active: true };
  const owner = { id: "owner", isGM: false, active: true };
  const coOwner = { id: "co-owner", isGM: false, active: true };
  const stranger = { id: "stranger", isGM: false, active: true };
  const users = [gm, backupGM, owner, coOwner, stranger];
  users.get = id => users.find(user => user.id === id);
  users.activeGM = gm;
  const events = [], warnings = [], timers = new Map(), socket = { listener: null, fail: false };
  let executions = 0, coreRenders = 0, yzeRenders = 0;
  let advance = async combat => { combat.round += 1; combat.turn = 0; return combat; };
  class Combat {
    async nextRound(...args) { executions++; return advance(this, args); }
  }
  class CoreTracker { _onRender() { coreRenders++; } }
  class YzeTracker extends CoreTracker {
    _onRender() { yzeRenders++; }
    async _preparePartContext(_part, context) { return context; }
  }
  const actor = { testUserPermission: user => [owner.id, coOwner.id].includes(user.id) };
  const combatant = { actor };
  const combat = Object.assign(new Combat(), {
    id: "combat", started: true, round: 1, turn: 1,
    turns: [{ actor: {} }, combatant], combatant
  });
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    Hooks: { on() {}, once() {}, callAll() {} },
    createCombatReference() {}, createQuickAccessBridge: () => ({}),
    CONFIG: { Combat: { documentClass: Combat }, ui: { combat: YzeTracker } },
    CONST: { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } },
    foundry: { utils: { randomID: () => `request${++sequence}` } },
    ui: { notifications: { warn: message => warnings.push(message) } },
    window: {
      setTimeout: callback => { const id = ++sequence; timers.set(id, callback); return id; },
      clearTimeout: id => timers.delete(id)
    },
    game: {
      user: gm, users, combats: new Map([[combat.id, combat]]),
      socket: {
        on(_channel, listener) { socket.listener = listener; },
        emit(_channel, message) {
          if (socket.fail) throw new Error("socket failed");
          events.push(structuredClone(message));
        }
      }
    }
  });
  new vm.Script(source).runInContext(context);
  context.patchCombatDocument();
  context.installSocketListener();
  return {
    context, gm, backupGM, owner, coOwner, stranger, combat, events, warnings, timers, socket, YzeTracker,
    get executions() { return executions; },
    get renders() { return { core: coreRenders, yze: yzeRenders }; },
    set advance(value) { advance = value; },
    request(user = owner, overrides = {}) {
      return { type: "advance-round-request", requestId: `remote${++sequence}`,
        requesterId: user.id, combatId: combat.id,
        expectedRound: combat.round, expectedTurn: combat.turn, ...overrides };
    }
  };
}

test("a forged requester id or missing server sender cannot execute on the GM", async () => {
  const f = fixture();
  const forged = f.request(f.owner);
  await f.socket.listener(forged, f.stranger.id);
  await f.socket.listener(forged);
  await f.socket.listener(f.request(f.stranger), f.stranger.id);
  assert.equal(f.executions, 0);
  assert.equal(f.combat.round, 1);
});

test("an authenticated owner delegates exactly the original YZE nextRound to the active GM", async () => {
  const f = fixture();
  const message = f.request();
  await f.socket.listener(message, f.owner.id);
  assert.equal(f.executions, 1);
  assert.equal(f.combat.round, 2);
  assert.deepEqual(f.events.at(-1), {
    type: "advance-round-result", requestId: message.requestId, targetUserId: f.owner.id,
    combatId: f.combat.id, ok: true
  });
  await f.socket.listener(message, f.owner.id);
  assert.equal(f.executions, 1, "the stale request must not advance the new round");
});

test("other GMs, offline requesters, inactive combat and non-final turns cannot delegate", async () => {
  const f = fixture();
  f.context.game.user = f.backupGM;
  await f.socket.listener(f.request(), f.owner.id);
  f.context.game.user = f.gm;
  f.owner.active = false;
  await f.socket.listener(f.request(), f.owner.id);
  f.owner.active = true;
  f.combat.started = false;
  await f.socket.listener(f.request(), f.owner.id);
  f.combat.started = true;
  f.combat.turn = 0;
  await f.socket.listener(f.request(), f.owner.id);
  assert.equal(f.executions, 0);
});

test("two owners' concurrent final-turn requests advance only once before the write completes", async () => {
  const f = fixture();
  let finish;
  f.advance = combat => new Promise(resolve => { finish = () => { combat.round++; combat.turn = 0; resolve(combat); }; });
  const first = f.socket.listener(f.request(f.owner), f.owner.id);
  await f.socket.listener(f.request(f.coOwner), f.coOwner.id);
  assert.equal(f.executions, 1);
  assert.equal(f.combat.round, 1, "the first write has deliberately not completed");
  assert.ok(f.events.some(event => !event.ok && event.targetUserId === f.coOwner.id));
  finish();
  await first;
  assert.equal(f.combat.round, 2);
});

test("the GM per-combat guard releases after failure and leaves independent combats usable", async () => {
  const f = fixture();
  const second = Object.assign(Object.create(Object.getPrototypeOf(f.combat)), {
    ...f.combat, id: "other-combat", turns: [...f.combat.turns]
  });
  f.context.game.combats.set(second.id, second);
  let finish;
  f.advance = combat => combat.id === f.combat.id
    ? new Promise((_resolve, reject) => { finish = () => reject(new Error("write failed")); })
    : Promise.resolve(combat);
  const first = f.socket.listener(f.request(), f.owner.id);
  await f.socket.listener(f.request(f.owner, { combatId: second.id }), f.owner.id);
  assert.equal(f.executions, 2);
  finish(); await first;
  f.advance = async combat => { combat.round++; return combat; };
  await f.socket.listener(f.request(), f.owner.id);
  assert.equal(f.combat.round, 2);
});

test("result packets must come from the selected GM and match the pending combat", async () => {
  const f = fixture();
  f.context.game.user = f.owner;
  const pending = f.combat.nextRound();
  const request = f.events.at(-1);
  const result = { type: "advance-round-result", requestId: request.requestId,
    targetUserId: f.owner.id, combatId: f.combat.id, ok: true };
  let settled = false;
  pending.then(() => { settled = true; });
  await f.socket.listener(result, f.stranger.id);
  await f.socket.listener(result);
  await f.socket.listener(result, f.backupGM.id);
  await f.socket.listener({ ...result, combatId: "other" }, f.gm.id);
  await f.socket.listener({ ...result, ok: "true" }, f.gm.id);
  assert.equal(settled, false);
  assert.equal(f.timers.size, 1);
  await f.socket.listener(result, f.gm.id);
  assert.equal(await pending, f.combat);
  assert.equal(f.timers.size, 0);
});

test("client deduplication, timeout and send failure all settle without advancing locally", async () => {
  const f = fixture();
  f.context.game.user = f.owner;
  const first = f.combat.nextRound(), duplicate = f.combat.nextRound();
  assert.equal(first, duplicate);
  assert.equal(f.events.length, 1);
  [...f.timers.values()][0]();
  assert.equal(await first, f.combat);
  f.socket.fail = true;
  assert.equal(await f.combat.nextRound(), f.combat);
  assert.equal(f.executions, 0);
  assert.ok(f.warnings.length >= 2);
});

test("no active GM returns safely, while GM and non-final calls preserve the original method", async () => {
  const f = fixture();
  await f.combat.nextRound("gm-options");
  assert.equal(f.executions, 1);
  f.context.game.user = f.owner;
  await f.combat.nextRound("non-final-options");
  assert.equal(f.executions, 2);
  f.combat.turn = 1;
  f.gm.active = f.backupGM.active = false;
  assert.equal(await f.combat.nextRound(), f.combat);
  assert.equal(f.executions, 2);
  assert.equal(f.events.length, 0);
});

test("player tracker keeps final-turn control and leaves group maintenance to the GM", async () => {
  const f = fixture();
  f.context.patchCombatTracker();
  const tracker = new f.YzeTracker(); tracker.viewed = f.combat;
  f.context.game.user = f.owner;
  assert.equal((await tracker._preparePartContext("footer", {})).control, true);
  await tracker._onRender({}, {});
  assert.deepEqual(f.renders, { core: 1, yze: 0 });
  f.context.game.user = f.gm;
  await tracker._onRender({}, {});
  assert.deepEqual(f.renders, { core: 1, yze: 1 });
});
