import { getQuickAccessEquipmentApi } from "./quick-access-bridge.js";
import { enqueueActorOperation, hasActionStatus, readEquipmentOperation, supportsEquipmentControls, requireSameRound, createPaidEffect, removePaidEffects, effectsFor } from "./equipment-operations.js";

const MODULE = "yze-combat-permission-fix";
export const WEAPON_OPERATION = "weaponOperation";
export const WEAPON_SOCKET = "yze-widget.weapon";
const RELOAD_FLAG = "weaponReload";
const RECEIPTS = "weaponReceipts";
export const ACTION_COSTS = {free: [], fast: ["fastAction"], slow: ["slowAction"], both: ["fastAction", "slowAction"]};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = value => structuredClone(value);
const terminal = operation => !operation || ["complete", "cancelled"].includes(operation.phase);

export function supportsWeaponControls(api = getQuickAccessEquipmentApi()) {
  return supportsEquipmentControls(api) && api?.capabilities?.heldItemPresentation && typeof api.getHeldItemPresentation === "function";
}
export function readWeaponOperation(actor) {
  const value = actor?.getFlag?.(MODULE, WEAPON_OPERATION);
  return value?.version === 1 ? clone(value) : null;
}
export function weaponPending(actor) { return !terminal(readWeaponOperation(actor)); }

function reloadKey(itemId, mode) { return `${itemId}:${mode}`; }
function storedReload(actor, itemId, mode) {
  const entries = actor?.getFlag?.(MODULE, RELOAD_FLAG);
  const key = reloadKey(itemId, mode);
  return entries && Object.hasOwn(entries, key) ? clone(entries[key]) : null;
}
function integer(value, min, max) { return Number.isSafeInteger(value) && value >= min && value <= max; }
export function getReloadProgress(actor, item, mode = "load") {
  const raw = storedReload(actor, item.itemId, mode);
  const value = item.firearm?.reloadValue;
  const suggested = mode === "load" && /^\d+$/.test(value ?? "") && integer(Number(value), 1, 999) ? Number(value) : 1;
  const valid = raw?.version === 1 && integer(raw.target, 1, 999) && integer(raw.current, 0, raw.target);
  return {
    target: valid ? raw.target : suggested, current: valid ? raw.current : 0,
    unit: valid && ["steps", "seconds"].includes(raw.unit) ? raw.unit : item.firearm?.reloadType === "S" ? "seconds" : "steps",
    finished: valid && raw.finished === true, revision: JSON.stringify(raw),
  };
}

function allReceipts(actor) { const value = actor.getFlag(MODULE, RECEIPTS); return Array.isArray(value) ? value : []; }
function progressEntries(actor, itemId, mode, value) {
  const stored = actor.getFlag(MODULE, RELOAD_FLAG) ?? {};
  // Drop records for deleted Items; do not grow a permanent per-shot history.
  const entries = Object.fromEntries(Object.entries(stored).filter(([key]) => actor.items.get(key.split(":")[0])));
  const key = reloadKey(itemId, mode);
  if (value === null) delete entries[key]; else entries[key] = clone(value);
  return entries;
}

export function createWeaponOperations({ getApi = getQuickAccessEquipmentApi, resolveActor = uuid => fromUuid(uuid) } = {}) {
  const registered = new WeakSet(), busy = new Set();

  async function execute(input, context) {
    const payload = clone(input), api = getApi();
    if (!supportsWeaponControls(api)) throw new Error("Для оружия требуется обновлённый Quick Access.");
    if (typeof payload?.actorUuid !== "string" || payload.actorUuid.length > 512 ||
        typeof payload.id !== "string" || !/^[a-zA-Z0-9_-]{1,56}$/.test(payload.id)) throw new Error("Некорректная операция оружия.");
    const actor = await resolveActor(payload.actorUuid);
    const user = context?.requestUser ?? game.users?.get?.(context?.requesterId);
    if (!actor || actor.documentName !== "Actor" || actor.type !== "character" || actor.uuid !== payload.actorUuid || !user?.active) throw new Error("Персонаж недоступен.");
    const authority = api.getActiveGM()?.id ?? null;
    const guard = () => {
      if (!user.active || !actor.testUserPermission?.(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) throw new Error("Права персонажа изменились.");
      if ((api.getActiveGM()?.id ?? null) !== authority || authority && game.user.id !== authority) throw new Error("Активный GM изменился. Проверьте операцию.");
    };
    return enqueueActorOperation(actor.uuid, () => run(actor, api, payload, user, guard));
  }

  async function save(actor, operation, guard, progress) {
    guard();
    const update = {[`flags.${MODULE}.${WEAPON_OPERATION}`]: operation};
    if (progress !== undefined) update[`flags.${MODULE}.${RELOAD_FLAG}`] = progress;
    if (terminal(operation)) update[`flags.${MODULE}.${RECEIPTS}`] = [...allReceipts(actor).filter(entry => entry.id !== operation.id).slice(-31), clone(operation)];
    const result = await actor.update(update, {render: false, fblqaEquipmentOnly: true});
    if (!result || !same(readWeaponOperation(actor), operation)) throw new Error("Запись операции не подтверждена. Проверьте состояние.");
    if (progress !== undefined && !same(actor.getFlag(MODULE, RELOAD_FLAG), progress)) throw new Error("Прогресс изменён извне. Проверьте состояние.");
  }

  function held(actor, api, itemId) {
    if (!actor.canAct) throw new Error("Персонаж сейчас не может действовать.");
    const presentation = api.getHeldItemPresentation(actor);
    const item = presentation.items.find(item => item.itemId === itemId);
    if (!item || item.broken) throw new Error("Исправный предмет должен находиться в руках.");
    return {presentation, item};
  }

  async function pay(actor, operation, guard) {
    requireSameRound(operation, actor);
    for (const status of ACTION_COSTS[operation.cost]) {
      requireSameRound(operation, actor); guard();
      const own = effectsFor(actor, operation.id, WEAPON_OPERATION).some(effect => !effect.disabled && !effect.isSuppressed && effect.statuses?.has?.(status));
      if (own) continue;
      if (hasActionStatus(actor, status)) throw new Error("Выбранное действие уже потрачено. Отмените операцию или проверьте отметки.");
      await createPaidEffect(actor, status, operation.id, guard, WEAPON_OPERATION);
    }
    requireSameRound(operation, actor);
  }

  function confirmedMessage(actor, operation, messageId) {
    const message = game.messages?.get?.(messageId);
    const author = message?.author?.id ?? message?.user?.id ?? message?.user;
    const roll = message?.rolls?.[0], options = roll?.options;
    const marker = options?.yzeWidgetAttack;
    const ids = Array.isArray(options?.itemId) ? options.itemId : [options?.itemId];
    if (!message?.id || author !== operation.requestedBy || roll.pushed || options?.isAttack !== true ||
        marker?.id !== operation.id || marker.actorUuid !== actor.uuid || marker.itemId !== operation.itemId ||
        !same(marker.combat, operation.combat) || !ids.includes(operation.itemId) || options.actorId !== actor.id ||
        actor.isToken && (options.tokenId !== actor.token?.id || options.sceneId !== actor.token?.parent?.id)) throw new Error("Сообщение не подтверждает эту атаку.");
    return message;
  }

  function findAttackMessage(actor, operation) {
    return Array.from(game.messages?.contents ?? game.messages?.values?.() ?? []).find(message => {
      try { return Boolean(confirmedMessage(actor, operation, message.id)); } catch (_error) { return false; }
    });
  }

  async function run(actor, api, payload, user, guard) {
    guard();
    if (["pending", "undoing"].includes(readEquipmentOperation(actor)?.phase)) throw new Error("Сначала завершите операцию экипировки.");
    let operation = readWeaponOperation(actor);
    const starting = ["reload", "progress", "prepareAttack"].includes(payload.kind);
    if (starting) {
      const receipt = allReceipts(actor).find(entry => entry.id === payload.id);
      const fingerprint = JSON.stringify([payload.kind, payload.itemId, payload.mode, payload.cost, payload.target, payload.current, payload.amount, payload.unit, payload.combat ?? null]);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new Error("Идентификатор уже использован для другой операции.");
        return {operation: clone(receipt), replayed: true};
      }
      if (operation?.id === payload.id) {
        if (operation.fingerprint !== fingerprint) throw new Error("Идентификатор уже использован для другой операции.");
      } else {
        if (!terminal(operation)) throw new Error("Другая операция оружия ещё не завершена.");
        if (api.getEquipmentReceipt(actor, payload.id) || readEquipmentOperation(actor)?.id === payload.id) throw new Error("Идентификатор операции уже занят.");
        const {presentation, item} = held(actor, api, payload.itemId);
        if (presentation.equipmentRevision !== payload.equipmentRevision || item.revision !== payload.weaponRevision) throw new Error("Оружие или экипировка изменились. Выберите действие заново.");
        const cost = payload.kind === "progress" ? "free" : payload.cost;
        if (!Object.hasOwn(ACTION_COSTS, cost)) throw new Error("Выберите стоимость действия.");
        if (cost !== "free" && !payload.combat) throw new Error("Вне боя действие не оплачивается.");
        requireSameRound({combat: payload.combat ?? null}, actor);
        for (const status of ACTION_COSTS[cost]) if (hasActionStatus(actor, status)) throw new Error("Выбранное действие уже потрачено.");
        operation = {version: 1, id: payload.id, fingerprint, requestedBy: user.id, itemId: item.itemId, kind: payload.kind,
          cost, combat: clone(payload.combat ?? null), equipmentRevision: presentation.equipmentRevision, weaponRevision: item.revision,
          phase: payload.kind === "prepareAttack" ? "prepared" : "pending"};
        if (payload.kind === "prepareAttack") {
          if (!item.attack || typeof actor.sheet?.rollGear !== "function") throw new Error("Атака этим предметом недоступна.");
        } else {
          const mode = payload.mode;
          if (!["load", "topOff"].includes(mode) || mode === "load" && !item.reload || mode === "topOff" && !item.firearm?.topOff) throw new Error("Эта перезарядка недоступна.");
          const previous = getReloadProgress(actor, item, mode);
          if (previous.revision !== payload.progressRevision) throw new Error("Прогресс уже изменился.");
          if (!integer(payload.target, 1, 999) || !["steps", "seconds"].includes(payload.unit)) throw new Error("Укажите от 1 до 999 шагов или секунд.");
          const current = payload.current ?? (previous.finished ? 0 : previous.current);
          if (!integer(current, 0, payload.target) || payload.kind === "reload" && (!integer(payload.amount, 0, 999) || payload.amount === 0 && current < payload.target)) throw new Error("Некорректный прогресс перезарядки.");
          operation.mode = mode; operation.before = storedReload(actor, item.itemId, mode);
          operation.after = {version: 1, current: payload.kind === "progress" ? current : Math.min(payload.target, current + payload.amount),
            target: payload.target, unit: payload.unit, finished: false, operationId: operation.id};
          operation.magazine = clone(item.firearm?.magazine ?? null);
          if (payload.kind === "reload" && operation.magazine && operation.magazine.capacity <= 0) throw new Error("У оружия не указана ёмкость магазина.");
          if (payload.kind === "reload" && operation.magazine && operation.magazine.current >= operation.magazine.capacity) throw new Error("Магазин уже полон.");
          if (payload.kind === "progress") operation.phase = "complete";
        }
        await save(actor, operation, guard, payload.kind === "progress" ? progressEntries(actor, operation.itemId, operation.mode, operation.after) : undefined);
      }
      if (payload.kind === "progress" || payload.kind === "prepareAttack") return {operation};
    } else {
      if (operation?.id !== payload.id) {
        const receipt = allReceipts(actor).find(entry => entry.id === payload.id);
        if (receipt && ["confirmAttack", "cancel", "resume"].includes(payload.kind)) {
          if (payload.kind === "confirmAttack") {
            const message = confirmedMessage(actor, receipt, payload.messageId);
            if (receipt.phase !== "complete" || receipt.messageId !== message.id) throw new Error("Сообщение не подтверждает завершённую атаку.");
          }
          return {operation: clone(receipt), replayed: true};
        }
        throw new Error("Операция больше не доступна.");
      }
    }

    if (payload.kind === "confirmAttack") {
      const message = confirmedMessage(actor, operation, payload.messageId);
      if (operation.phase === "complete" && operation.messageId === message.id) return {operation, replayed: true};
      if (operation.phase !== "rolling") throw new Error("Атака не была подтверждена к выполнению.");
      operation.phase = "complete"; operation.messageId = message.id;
      // Payment was reserved before the roll. Never create effects in a later round.
      await save(actor, operation, guard); return {operation};
    }
    if (payload.kind === "cancel") {
      if (terminal(operation)) return {operation, replayed: true};
      if (operation.phase === "external") throw new Error("Проверьте магазин и явно подтвердите результат перед отменой.");
      if (operation.kind === "prepareAttack") {
        const message = findAttackMessage(actor, operation);
        if (message) {
          operation.phase = "complete"; operation.messageId = message.id;
          await save(actor, operation, guard); return {operation};
        }
        if (operation.phase === "rolling" && payload.verifyNoRoll !== true) throw new Error("Сначала закройте диалог или подтвердите, что бросок не состоялся.");
      }
      let progress;
      if (operation.progressApplied) {
        if (!same(storedReload(actor, operation.itemId, operation.mode), operation.after)) throw new Error("Прогресс изменён извне; отмена небезопасна.");
        progress = progressEntries(actor, operation.itemId, operation.mode, operation.before);
      }
      operation.phase = "cancelling"; await save(actor, operation, guard);
      await removePaidEffects(actor, operation.id, guard, WEAPON_OPERATION);
      operation.phase = "cancelled"; await save(actor, operation, guard, progress); return {operation};
    }
    if (payload.kind === "resolveDone" || payload.kind === "resolveNotDone") {
      if (operation.phase !== "external") throw new Error("Результат уже определён.");
      if (payload.kind === "resolveDone") {
        operation.phase = "complete"; operation.manuallyConfirmed = true; operation.after.finished = true;
      } else operation.phase = "pending";
      await save(actor, operation, guard, progressEntries(actor, operation.itemId, operation.mode, operation.after));
      return {operation}; // An uncertain external call is never automatically repeated.
    }
    if (terminal(operation)) return {operation, replayed: true};

    if (payload.kind === "reserveAttack") {
      if (operation.kind !== "prepareAttack" || !["prepared", "reserved", "rolling"].includes(operation.phase)) throw new Error("Атака больше не доступна.");
      if (operation.phase === "rolling") return {operation, replayed: true};
      const {presentation, item} = held(actor, api, operation.itemId);
      if (presentation.equipmentRevision !== operation.equipmentRevision || item.revision !== operation.weaponRevision) throw new Error("Оружие изменилось после открытия диалога.");
      operation.phase = "reserved"; await save(actor, operation, guard);
      await pay(actor, operation, guard);
      operation.phase = "rolling"; await save(actor, operation, guard); return {operation};
    }
    if (!["reload", "resume"].includes(payload.kind) || operation.kind !== "reload" || operation.phase !== "pending") throw new Error("Проверьте незавершённую операцию; повтор не выполнен.");
    requireSameRound(operation, actor);
    const {presentation, item} = held(actor, api, operation.itemId);
    if (presentation.equipmentRevision !== operation.equipmentRevision || item.revision !== operation.weaponRevision) throw new Error("Оружие изменилось. Проверьте или отмените операцию.");
    await pay(actor, operation, guard);
    if (!operation.progressApplied) {
      if (!same(storedReload(actor, operation.itemId, operation.mode), operation.before)) throw new Error("Прогресс изменён извне.");
      operation.progressApplied = true;
      await save(actor, operation, guard, progressEntries(actor, operation.itemId, operation.mode, operation.after));
    }
    if (operation.after.current === operation.after.target && operation.magazine) {
      const module = game.modules.get("fl-firearms"), firearmApi = module?.active ? module.api : null;
      const method = operation.mode === "topOff" ? "topOffMagazine" : "loadMagazine";
      if (typeof firearmApi?.[method] !== "function") throw new Error("FL Firearms недоступен. Зарядка ещё не выполнена.");
      requireSameRound(operation, actor); guard();
      operation.phase = "external"; await save(actor, operation, guard);
      // Public FL API has no caller-supplied idempotency key. After dispatch, an
      // ambiguous error stays external until the player checks the actual magazine.
      const result = await firearmApi[method](actor, actor.items.get(operation.itemId));
      if (result?.notice) {
        operation.phase = "pending"; operation.notice = String(result.notice);
        await save(actor, operation, guard);
        throw new Error(operation.notice);
      }
      let outcome = result;
      if (result === undefined && typeof firearmApi.getMagazineProfile === "function") {
        // FL Firearms 0.4.6 returns void on success. Confirm only an exact public
        // postimage; a failed/no-op/cancelled legacy call remains uncertain.
        const current = firearmApi.getMagazineProfile(actor.items.get(operation.itemId)).current;
        const expected = operation.mode === "topOff" ? Math.min(operation.magazine.current + 1, operation.magazine.capacity) : operation.magazine.capacity;
        if (current === expected && current > operation.magazine.current) outcome = {oldAmmo: operation.magazine.current, newAmmo: current, legacyPostimage: true};
      }
      if (!Number.isFinite(outcome?.newAmmo) || outcome.newAmmo <= outcome.oldAmmo) throw new Error("Результат зарядки не подтверждён. Проверьте магазин.");
      operation.outcome = {oldAmmo: outcome.oldAmmo, newAmmo: outcome.newAmmo, legacyPostimage: outcome.legacyPostimage === true};
    }
    operation.after.finished = operation.after.current === operation.after.target;
    operation.phase = "complete";
    await save(actor, operation, guard, progressEntries(actor, operation.itemId, operation.mode, operation.after));
    return {operation};
  }

  function register() {
    const api = getApi();
    if (!supportsWeaponControls(api) || registered.has(api)) return;
    api.registerSocketHandler(WEAPON_SOCKET, execute); registered.add(api);
  }
  async function request(payload) {
    const api = getApi();
    if (!supportsWeaponControls(api)) throw new Error("Обновите Quick Access для действий оружия.");
    if (busy.has(payload.actorUuid)) throw new Error("Дождитесь завершения операции оружия.");
    register(); busy.add(payload.actorUuid);
    try {
      if (api.getActiveGM()) return await api.executeAsActiveGM(WEAPON_SOCKET, payload);
      const actor = await resolveActor(payload.actorUuid);
      const operation = readWeaponOperation(actor);
      if (payload.cost && payload.cost !== "free" || operation?.id === payload.id && operation.cost !== "free") throw new Error("Для оплаты и возврата действий нужен активный GM.");
      return await execute(payload, {requestUser: game.user});
    } finally { busy.delete(payload.actorUuid); }
  }
  function confirmMessage(message) {
    const marker = message?.rolls?.[0]?.options?.yzeWidgetAttack;
    const api = getApi();
    if (!marker?.actorUuid || !supportsWeaponControls(api) || api.getActiveGM()?.id !== game.user.id) return;
    const userId = message.author?.id ?? message.user?.id ?? message.user;
    void execute({kind: "confirmAttack", actorUuid: marker.actorUuid, id: marker.id, messageId: message.id}, {requesterId: userId})
      .catch(error => console.warn(`${MODULE} | Attack confirmation requires recovery`, error));
  }
  return Object.freeze({register, request, execute, confirmMessage, isBusy: uuid => busy.has(uuid)});
}
