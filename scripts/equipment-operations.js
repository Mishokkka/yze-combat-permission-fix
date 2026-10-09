import { getQuickAccessEquipmentApi } from "./quick-access-bridge.js";

export const EQUIPMENT_OPERATION = "yze-widget.equipment";
export const OPERATION_FLAG = "equipmentOperation";
const MODULE_ID = "yze-combat-permission-fix";
const COSTS = { free: [], fast: ["fastAction"], slow: ["slowAction"], both: ["fastAction", "slowAction"] };
const FREE_COMMANDS = new Set(["assignSlot", "swapSlots", "clearSlot"]);
const queues = new Map();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = value => structuredClone(value);

export function hasActionStatus(actor, id) {
  return Boolean(actor.statuses?.has?.(id) || actor.effects?.some(effect =>
    !effect.disabled && !effect.isSuppressed && (effect.statuses?.has?.(id) || effect.statuses?.includes?.(id))));
}

export function supportsEquipmentControls(api = getQuickAccessEquipmentApi()) {
  return Boolean(api?.capabilities?.equipmentControls &&
    ["previewEquipmentAction", "getEquipmentReceipt", "getQuickAccessSlots", "executeAsActiveGM", "registerSocketHandler", "getActiveGM"].every(key => typeof api[key] === "function"));
}

export function readEquipmentOperation(actor) {
  const value = actor?.getFlag?.(MODULE_ID, OPERATION_FLAG);
  return value?.version === 1 ? clone(value) : null;
}

function effectsFor(actor, id) {
  return Array.from(actor.effects ?? []).filter(effect => effect.getFlag?.(MODULE_ID, OPERATION_FLAG) === id);
}

function requireSameRound(operation, actor) {
  if (!operation.combat) return;
  if (typeof operation.combat.id !== "string" || !Number.isInteger(operation.combat.round) || operation.combat.round < 1) throw new Error("Некорректный раунд боя.");
  const combat = game.combats?.get(operation.combat.id) ?? game.combat;
  if (!combat?.started || combat.id !== operation.combat.id || combat.round !== operation.combat.round) {
    throw new Error("Раунд изменился. Отмените незавершённую операцию; действия нового раунда не расходуются.");
  }
  if (actor && !Array.from(combat.combatants ?? []).some(c => (c.actor ?? c.token?.actor)?.uuid === actor.uuid)) throw new Error("Персонаж больше не участвует в этом бою.");
}

async function saveOperation(actor, operation, guard) {
  guard();
  if (!await actor.update({ [`flags.${MODULE_ID}.${OPERATION_FLAG}`]: operation }, { render: false, fblqaEquipmentOnly: true })) {
    throw new Error("Запись операции отменена. Перечитайте состояние персонажа.");
  }
}

function verifyReceiptState(actor, api, receipt) {
  const state = api.getEquipmentState(actor);
  for (const [key, value] of Object.entries(receipt.after)) {
    const current = key === "hands" ? state.hands : api.getQuickAccessSlots(actor);
    if (!same(current, value)) throw new Error("Экипировка изменена другим действием. Перечитайте состояние.");
  }
}

async function createPaidEffect(actor, statusId, operationId, guard) {
  const Effect = getDocumentClass("ActiveEffect");
  const effect = await Effect.fromStatusEffect(statusId);
  const data = effect.toObject();
  delete data._id;
  data.flags ??= {};
  data.flags[MODULE_ID] = { ...(data.flags[MODULE_ID] ?? {}), [OPERATION_FLAG]: operationId };
  guard();
  const created = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  if (!created?.length || !hasActionStatus(actor, statusId)) throw new Error("Не удалось отметить стоимость действия. Операция ожидает завершения.");
}

async function removePaidEffects(actor, operationId, guard) {
  const ids = effectsFor(actor, operationId).map(effect => effect.id);
  guard();
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  if (effectsFor(actor, operationId).length) throw new Error("Отмена отметок действий не завершена. Повторите отмену операции.");
}

export function equipmentUndoError(actor, api = getQuickAccessEquipmentApi()) {
  const operation = readEquipmentOperation(actor);
  try {
    if (operation?.phase !== "complete" || !operation.changed) throw new Error("Нет операции для отмены.");
    if (operation.cost !== "free") requireSameRound(operation, actor);
    api.previewEquipmentAction(actor, { type: "undo", receiptId: operation.id });
    for (const status of COSTS[operation.cost]) {
      if (!effectsFor(actor, operation.id).some(effect => !effect.disabled && !effect.isSuppressed && effect.statuses?.has?.(status)) ||
          Array.from(actor.effects ?? []).some(effect => !effect.disabled && !effect.isSuppressed && effect.statuses?.has?.(status) && effect.getFlag?.(MODULE_ID, OPERATION_FLAG) !== operation.id)) {
        throw new Error("Отметки действий изменились; отмена небезопасна.");
      }
    }
    return "";
  } catch (error) { return error.message; }
}

/** Serialize equipment and manual action clicks on the authority, including co-owners. */
export function createEquipmentOperations({ getApi = getQuickAccessEquipmentApi, resolveActor = uuid => fromUuid(uuid) } = {}) {
  const registered = new WeakSet();
  const busy = new Set();

  async function execute(payload, context) {
    payload = clone(payload);
    const api = getApi();
    const authority = api?.getActiveGM?.()?.id ?? null;
    const guardAuthority = () => {
      if ((api.getActiveGM()?.id ?? null) !== authority || authority && game.user.id !== authority) throw new Error("Активный GM изменился. Перечитайте состояние операции.");
    };
    if (!supportsEquipmentControls(api)) throw new Error("Обновите Quick Access для управления экипировкой.");
    if (typeof payload?.actorUuid !== "string" || payload.actorUuid.length > 512) throw new Error("Некорректный персонаж.");
    const actor = await resolveActor(payload.actorUuid);
    const user = context?.requestUser ?? game.users?.get?.(context?.requesterId);
    if (!actor || actor.documentName !== "Actor" || actor.type !== "character" || actor.uuid !== payload.actorUuid ||
        !user?.active || !actor.testUserPermission?.(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) {
      throw new Error("Нет прав на изменение этого персонажа.");
    }
    const prior = queues.get(actor.uuid) ?? Promise.resolve();
    const task = prior.catch(() => {}).then(() => run(actor, api, payload, user, guardAuthority));
    queues.set(actor.uuid, task);
    try { return await task; }
    finally { if (queues.get(actor.uuid) === task) queues.delete(actor.uuid); }
  }

  async function run(actor, api, payload, user, guardAuthority) {
    // Recheck after waiting: another owner or a permission edit may have intervened.
    if (!user.active || !actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) throw new Error("Права персонажа изменились.");
    const guard = () => {
      guardAuthority();
      if (!user.active || !actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) throw new Error("Права персонажа изменились.");
    };
    guard();
    let operation = readEquipmentOperation(actor);
    if (payload.kind === "toggle") {
      if (operation?.phase === "pending" || operation?.phase === "undoing") throw new Error("Сначала завершите или отмените операцию экипировки.");
      if (!["fastAction", "slowAction"].includes(payload.statusId)) throw new Error("Некорректное действие.");
      if (!payload.combat) throw new Error("Отметки действий доступны в бою.");
      requireSameRound({ combat: payload.combat }, actor);
      if (hasActionStatus(actor, payload.statusId) !== payload.expectedSpent) throw new Error("Отметка действия уже изменилась.");
      await actor.toggleStatusEffect(payload.statusId, { active: !payload.expectedSpent });
      if (hasActionStatus(actor, payload.statusId) === payload.expectedSpent) throw new Error("Изменение отметки действия отменено.");
      return { changed: true };
    }
    if (typeof payload.id !== "string" || !/^[a-zA-Z0-9_-]{1,56}$/.test(payload.id)) throw new Error("Некорректный идентификатор операции.");
    if (payload.kind === "start") {
      const command = Object.fromEntries(["type", "hand", "itemId", "index", "from", "to"].filter(key => payload.command?.[key] !== undefined).map(key => [key, payload.command[key]]));
      if (!["hold", "stow", "swapHands", ...FREE_COMMANDS].includes(command.type)) throw new Error("Некорректная команда экипировки.");
      if (!Object.hasOwn(COSTS, payload.cost) || (FREE_COMMANDS.has(command.type) && payload.cost !== "free")) throw new Error("Выберите стоимость операции.");
      const fingerprint = JSON.stringify([command, payload.cost, payload.combat ?? null]);
      if (operation?.id === payload.id) {
        if (operation.fingerprint !== fingerprint) throw new Error("Идентификатор уже использован для другой операции.");
        if (operation.phase === "complete" || operation.phase === "undone") return { changed: operation.changed, operation };
      } else {
        if (["pending", "undoing"].includes(operation?.phase)) throw new Error("Другая операция ожидает завершения.");
        if (api.getEquipmentReceipt(actor, payload.id)) throw new Error("Эта операция уже выполнялась. Перечитайте состояние и выберите новую команду.");
        requireSameRound({ combat: payload.combat }, actor);
        const state = api.getEquipmentState(actor);
        if (state.revision !== payload.expectedRevision) throw new Error("Экипировка изменилась. Выберите команду заново.");
        const preview = api.previewEquipmentAction(actor, command);
        if (!preview.changed) return { changed: false };
        if (payload.cost !== "free" && !payload.combat) throw new Error("Вне боя стоимость не списывается.");
        for (const status of COSTS[payload.cost]) if (hasActionStatus(actor, status)) throw new Error("Выбранное действие уже потрачено.");
        operation = { version: 1, id: payload.id, fingerprint, command, cost: payload.cost, combat: clone(payload.combat ?? null),
          expectedRevision: state.revision, phase: "pending", requestedBy: user.id, changed: null };
        await saveOperation(actor, operation, guard);
      }
    } else if (!operation || operation.id !== payload.id) throw new Error("Операция больше не доступна.");
    if (payload.kind === "resume" && ["complete", "undone"].includes(operation.phase)) return { changed: false, operation };

    if (payload.kind === "undo" || payload.kind === "cancel" || operation.phase === "undoing") {
      if (operation.phase === "undone") return { changed: false, operation };
      const receipt = api.getEquipmentReceipt(actor, operation.id);
      const undoId = `${operation.id}_undo`;
      if (!api.getEquipmentReceipt(actor, undoId) && receipt) {
        // Preview checks postimages and surviving Items before refunding anything.
        api.previewEquipmentAction(actor, { type: "undo", receiptId: operation.id });
      }
      if (operation.phase !== "undoing") {
        // Complete operations are only refundable while their own effects still exist.
        if (operation.phase === "complete") {
          const reason = equipmentUndoError(actor, api);
          if (reason) throw new Error(reason);
        }
        operation.phase = "undoing";
        await saveOperation(actor, operation, guard);
      }
      guard();
      if (receipt) await api.performEquipmentAction(actor, { type: "undo", receiptId: operation.id }, { operationId: undoId });
      const undone = api.getEquipmentReceipt(actor, undoId);
      if (undone) verifyReceiptState(actor, api, undone);
      await removePaidEffects(actor, operation.id, guard);
      operation.phase = "undone";
      await saveOperation(actor, operation, guard);
      return { changed: Boolean(receipt), operation };
    }
    if (!["start", "resume"].includes(payload.kind) || operation.phase !== "pending") throw new Error("Некорректное продолжение операции.");
    requireSameRound(operation, actor);
    guard();
    const result = await api.performEquipmentAction(actor, operation.command, { expectedRevision: operation.expectedRevision, operationId: operation.id });
    operation.changed = result.changed;
    if (result.changed) {
      verifyReceiptState(actor, api, result.receipt);
      for (const status of COSTS[operation.cost]) {
        requireSameRound(operation, actor);
        guard();
        const own = effectsFor(actor, operation.id).some(effect => !effect.disabled && !effect.isSuppressed && effect.statuses?.has?.(status));
        if (own) continue;
        if (hasActionStatus(actor, status)) throw new Error("Отметка действия изменена извне. Завершите операцию после проверки или отмените её.");
        await createPaidEffect(actor, status, operation.id, guard);
        try { requireSameRound(operation, actor); }
        catch (error) { await removePaidEffects(actor, operation.id, guard); throw error; }
      }
    }
    operation.phase = "complete";
    await saveOperation(actor, operation, guard);
    return { changed: result.changed, operation };
  }

  function register() {
    const api = getApi();
    if (!supportsEquipmentControls(api) || registered.has(api)) return;
    api.registerSocketHandler(EQUIPMENT_OPERATION, execute);
    registered.add(api);
  }

  async function request(payload) {
    const api = getApi();
    if (!supportsEquipmentControls(api)) throw new Error("Для экипировки требуется Quick Access 1.7.29 или новее.");
    if (busy.has(payload.actorUuid)) throw new Error("Дождитесь завершения операции.");
    register();
    busy.add(payload.actorUuid);
    try {
      if (api.getActiveGM()) return await api.executeAsActiveGM(EQUIPMENT_OPERATION, payload);
      const stored = payload.kind === "start" ? null : readEquipmentOperation(await resolveActor(payload.actorUuid));
      if (payload.cost && payload.cost !== "free" || stored?.cost && stored.cost !== "free" || payload.kind === "toggle") throw new Error("Для оплаты и возврата действий нужен активный GM. Отметки можно менять штатным способом YZE Combat.");
      return await execute(payload, { requestUser: game.user });
    } finally { busy.delete(payload.actorUuid); }
  }
  return Object.freeze({ register, request, execute, isBusy: uuid => busy.has(uuid) });
}
