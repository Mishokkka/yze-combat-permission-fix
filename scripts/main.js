import { createCombatReference } from "./combat-reference.js";
import { createQuickAccessBridge } from "./quick-access-bridge.js";
import { createEquipmentOperations, supportsEquipmentControls, readEquipmentOperation } from "./equipment-operations.js";
import { createEquipmentPanel } from "./equipment-panel.js";
import { createRollBridge } from "./roll-bridge.js";

const MODULE_ID = "yze-combat-permission-fix";
const TARGET_MODULE_ID = "yze-combat";
const TARGET_VERSION = "1.6.1";
const SOCKET = `module.${MODULE_ID}`;
const REQUEST_TIMEOUT_MS = 10000;

const WIDGET_ID = `${MODULE_ID}-action-widget`;
const WIDGET_POSITION_SETTING = "actionWidgetPosition";
const REFERENCE_OPEN_SETTING = "combatReferenceOpen";
const WIDGET_COLLAPSED_SETTING = "actionWidgetCollapsed";
const FAST_ACTION = "fastAction";
const SLOW_ACTION = "slowAction";

const pendingRoundRequests = new Map();
const gmAdvancing = new Set();

let originalNextRound = null;
let patchApplied = false;
let widgetRefreshQueued = false;
let widgetMutationBusy = false;
let equipmentOperations = null;
const equipmentPanels = new WeakMap();

const quickAccess = createQuickAccessBridge(
  () => {
    return getWidgetActor();
  },
  actor => Boolean(actor?.isOwner),
  (...args) => warn(...args)
);
const rolls = createRollBridge({
  getActor: getWidgetActor,
  getEquipmentState: () => quickAccess.getState(),
  isBusy: actor => widgetMutationBusy || equipmentPanels.get(document.getElementById(WIDGET_ID))?.busy ||
    equipmentOperations?.isBusy(actor.uuid) ||
    supportsEquipmentControls() && ["pending", "undoing"].includes(readEquipmentOperation(actor)?.phase),
});

function log(...args) {
  console.log(`${MODULE_ID} |`, ...args);
}

function warn(...args) {
  console.warn(`${MODULE_ID} |`, ...args);
}

function getResponsibleGM() {
  // Foundry exposes activeGM on the Users collection in v13. Keep a deterministic
  // fallback for worlds in which that getter is unavailable for some reason.
  const activeGM = game.users?.activeGM;
  if (activeGM?.active && activeGM.isGM) return activeGM;

  return [...(game.users ?? [])]
    .filter(user => user.active && user.isGM)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] ?? null;
}

function userOwnsCombatant(user, combatant) {
  if (!user || !combatant) return false;
  if (user.isGM) return true;

  const actor = combatant.actor ?? combatant.token?.actor;
  const ownerLevel = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;

  try {
    if (actor?.testUserPermission?.(user, ownerLevel)) return true;
  }
  catch (error) {
    warn("Could not test actor ownership", error);
  }

  const explicit = actor?.ownership?.[user.id];
  const fallback = actor?.ownership?.default;
  if ((explicit ?? fallback ?? 0) >= ownerLevel) return true;

  // Year Zero Combat exposes a combatant.players getter. Keep this fallback in
  // case the actor is synthetic or an integration changes ownership handling.
  try {
    if (Array.isArray(combatant.players) && combatant.players.some(player => player?.id === user.id)) {
      return true;
    }
  }
  catch (_error) {
    // Ignore and return false below.
  }

  return false;
}

/* ========================================================================== */
/*  Permission fix                                                            */
/* ========================================================================== */

function requestRoundAdvance(combat) {
  const gm = getResponsibleGM();
  if (!gm) {
    ui.notifications?.warn("Невозможно передать ход: в игре нет активного GM.");
    return Promise.resolve(combat);
  }

  // Do not send duplicate requests while the previous one is still in flight.
  const existing = [...pendingRoundRequests.values()].find(entry => entry.combatId === combat.id);
  if (existing) return existing.promise;

  const requestId = foundry.utils.randomID();
  let resolveRequest;
  const promise = new Promise(resolve => {
    resolveRequest = resolve;
  });

  const timeout = window.setTimeout(() => {
    const pending = pendingRoundRequests.get(requestId);
    if (!pending) return;
    pendingRoundRequests.delete(requestId);
    ui.notifications?.warn("GM не подтвердил переход раунда. Попробуйте ещё раз.");
    pending.resolve(combat);
  }, REQUEST_TIMEOUT_MS);

  pendingRoundRequests.set(requestId, {
    combatId: combat.id,
    gmId: gm.id,
    promise,
    resolve: resolveRequest,
    timeout,
  });

  try {
    game.socket.emit(SOCKET, {
      type: "advance-round-request",
      requestId,
      combatId: combat.id,
      requesterId: game.user.id,
      expectedRound: combat.round,
      expectedTurn: combat.turn,
    });
  }
  catch (error) {
    window.clearTimeout(timeout);
    pendingRoundRequests.delete(requestId);
    warn("Could not send round advance request", error);
    ui.notifications?.warn("Не удалось передать запрос GM. Попробуйте ещё раз.");
    resolveRequest(combat);
  }

  return promise;
}

/** Authorize with the sender appended by Foundry's server, never with payload identity. */
async function handleRoundAdvanceRequest(message, senderUserId) {
  if (!game.user.isGM) return;

  const responsibleGM = getResponsibleGM();
  if (!responsibleGM || responsibleGM.id !== game.user.id) return;

  if (typeof senderUserId !== "string" || message.requesterId !== senderUserId) return;
  const requester = game.users.get(senderUserId);
  const combat = game.combats.get(message.combatId);

  const reject = reason => {
    game.socket.emit(SOCKET, {
      type: "advance-round-result",
      requestId: message.requestId,
      targetUserId: senderUserId,
      combatId: message.combatId,
      ok: false,
      error: reason,
    });
  };

  if (!requester || requester.isGM || !requester.active) {
    reject("Недействительный запрос игрока.");
    return;
  }

  if (!combat?.started || !combat.turns?.length) {
    reject("Бой уже не активен.");
    return;
  }

  // Reject stale or duplicated clicks. The state must still be exactly the state
  // from which the player asked to end the final turn.
  if (combat.round !== message.expectedRound || combat.turn !== message.expectedTurn) {
    reject("Ход уже изменился.");
    return;
  }

  const isLastTurn = combat.turn === combat.turns.length - 1;
  const activeCombatant = combat.combatant ?? combat.turns[combat.turn];

  if (!isLastTurn || !userOwnsCombatant(requester, activeCombatant)) {
    reject("Нет права завершить этот ход.");
    return;
  }

  // Client-side click deduplication cannot protect against another owner's client.
  // Acquire synchronously before the first await and release even after failure.
  if (gmAdvancing.has(combat.id)) {
    reject("Переход раунда уже выполняется.");
    return;
  }
  gmAdvancing.add(combat.id);

  try {
    // Run YZE Combat's original nextRound() on the GM client. This preserves its
    // history flags, initiative reset logic and action cleanup, but the document
    // writes are now performed by an authorized user.
    await originalNextRound.call(combat);

    game.socket.emit(SOCKET, {
      type: "advance-round-result",
      requestId: message.requestId,
      targetUserId: senderUserId,
      combatId: message.combatId,
      ok: true,
    });
  }
  catch (error) {
    console.error(`${MODULE_ID} | GM round transition failed`, error);
    reject(error?.message ?? "Не удалось перейти к следующему раунду.");
  }
  finally {
    gmAdvancing.delete(combat.id);
  }
}

/** Only the originally selected GM may settle this client's pending request. */
function handleRoundAdvanceResult(message, senderUserId) {
  if (message.targetUserId !== game.user.id) return;

  const pending = pendingRoundRequests.get(message.requestId);
  if (!pending) return;
  if (senderUserId !== pending.gmId || !game.users.get(senderUserId)?.isGM ||
      message.combatId !== pending.combatId || typeof message.ok !== "boolean") return;

  window.clearTimeout(pending.timeout);
  pendingRoundRequests.delete(message.requestId);

  if (!message.ok) {
    ui.notifications?.warn(message.error ?? "Не удалось перейти к следующему раунду.");
  }

  pending.resolve(game.combats.get(message.combatId) ?? null);
}

function installSocketListener() {
  // Foundry 13.351 registerCustomSocket -> handleCustomSocket appends this.user.id
  // from the server connection as the second listener argument. Fail closed when
  // that authenticated metadata is absent; never fall back to requesterId.
  game.socket.on(SOCKET, async (message, senderUserId) => {
    if (!message || typeof message !== "object") return;

    if (message.type === "advance-round-request") {
      await handleRoundAdvanceRequest(message, senderUserId);
    }
    else if (message.type === "advance-round-result") {
      handleRoundAdvanceResult(message, senderUserId);
    }
  });
}

function patchCombatDocument() {
  const CombatClass = CONFIG.Combat?.documentClass;
  const proto = CombatClass?.prototype;

  if (!proto || typeof proto.nextRound !== "function") {
    throw new Error("YZE Combat document class was not found.");
  }

  originalNextRound = proto.nextRound;

  proto.nextRound = function patchedNextRound(...args) {
    if (game.user.isGM) return originalNextRound.apply(this, args);

    // YZE Combat 1.6.1 writes flags.yze-combat.history before Core advances the
    // round. Players cannot write that flag, so delegate only the round boundary
    // to the active GM. Normal non-final nextTurn() calls remain untouched.
    const isLastTurn = this.turn === this.turns?.length - 1;
    if (isLastTurn && userOwnsCombatant(game.user, this.combatant ?? this.turns?.[this.turn])) {
      return requestRoundAdvance(this);
    }

    return originalNextRound.apply(this, args);
  };
}

function patchCombatTracker() {
  const TrackerClass = CONFIG.ui?.combat;
  const proto = TrackerClass?.prototype;
  const coreProto = proto ? Object.getPrototypeOf(proto) : null;

  if (!proto || !coreProto) {
    throw new Error("YZE Combat tracker class was not found.");
  }

  const originalPreparePartContext = proto._preparePartContext;
  if (typeof originalPreparePartContext !== "function") {
    throw new Error("Combat tracker _preparePartContext() was not found.");
  }

  proto._preparePartContext = async function patchedPreparePartContext(partId, context, options) {
    const data = await originalPreparePartContext.call(this, partId, context, options);

    // YZE Combat 1.6.1 deliberately hides turn controls from a non-GM on the
    // final turn to avoid its history permission error. The document patch above
    // makes that transition safe, so restore the control only for the owner of
    // the currently acting combatant.
    if (partId === "footer" && !game.user.isGM) {
      const combat = this.viewed;
      const isLastTurn = combat?.turn === combat?.turns?.length - 1;
      const activeCombatant = combat?.combatant ?? combat?.turns?.[combat?.turn];
      if (isLastTurn && userOwnsCombatant(game.user, activeCombatant)) {
        data.control = true;
      }
    }

    return data;
  };

  const originalOnRender = proto._onRender;
  const coreOnRender = coreProto._onRender;

  if (typeof originalOnRender !== "function" || typeof coreOnRender !== "function") {
    throw new Error("Combat tracker _onRender() was not found.");
  }

  proto._onRender = async function patchedOnRender(context, options) {
    if (game.user.isGM) {
      return originalOnRender.call(this, context, options);
    }

    // In YZE Combat 1.6.1, the only extra work in _onRender() is automatic group
    // repair when a defeated group leader is detected. That path updates combatant
    // documents and must not run independently on every player client. Players use
    // the Core render path; the active GM remains responsible for group repair.
    return coreOnRender.call(this, context, options);
  };
}

/* ========================================================================== */
/*  Lightweight action widget                                                 */
/* ========================================================================== */

function slowAndFastActionsEnabled() {
  try {
    return Boolean(game.settings.get(TARGET_MODULE_ID, "slowAndFastActions"));
  }
  catch (_error) {
    return false;
  }
}

function getOwnedCombatants(combat = game.combat) {
  if (!combat?.started) return [];
  return combat.combatants.filter(combatant => userOwnsCombatant(game.user, combatant));
}

function getWidgetCombatant() {
  const combat = game.combat;
  if (!combat?.started) return null;

  const owned = getOwnedCombatants(combat);
  if (!owned.length) return null;

  // If the player selected one of their combat tokens, the widget follows it.
  // This keeps multi-character ownership usable without adding another selector.
  const selectedTokenIds = new Set((canvas?.tokens?.controlled ?? []).map(token => token.id));
  const selected = owned.find(combatant => selectedTokenIds.has(combatant.tokenId));
  if (selected) return selected;

  // Prefer the currently acting owned combatant, otherwise fall back to the first
  // owned living combatant. For normal one-PC players this is always their PC.
  const current = combat.combatant ?? combat.turns?.[combat.turn];
  if (current && userOwnsCombatant(game.user, current)) return current;

  return owned.find(combatant => !combatant.isDefeated) ?? owned[0] ?? null;
}

function actorHasActionStatus(actor, statusId) {
  if (!actor) return false;

  try {
    if (actor.statuses?.has?.(statusId)) return true;
    if (Array.isArray(actor.statuses) && actor.statuses.includes(statusId)) return true;
  }
  catch (_error) {
    // Fall through to embedded effects lookup.
  }

  return actor.effects?.some(effect => {
    if (effect.disabled || effect.isSuppressed) return false;
    if (effect.statuses?.has?.(statusId)) return true;
    if (Array.isArray(effect.statuses) && effect.statuses.includes(statusId)) return true;
    return effect.statuses === statusId;
  }) ?? false;
}

function getWidgetActor() {
  const combatant = getWidgetCombatant();
  if (combatant) return combatant.actor ?? combatant.token?.actor ?? null;
  if (game.combat?.started) return null;
  const selected = (canvas?.tokens?.controlled ?? []).map(token => token.actor).find(actor => actor?.isOwner && actor.type === "character");
  return selected ?? (game.user.character?.isOwner && game.user.character.type === "character" ? game.user.character : null);
}

function getStatusEffect(statusId) {
  return CONFIG.statusEffects?.find(effect => effect.id === statusId) ?? null;
}

function defaultWidgetPosition(element) {
  const rect = element.getBoundingClientRect();
  return {
    left: Math.max(12, Math.round((window.innerWidth - rect.width) / 2)),
    top: Math.max(12, Math.round(window.innerHeight - rect.height - 96)),
  };
}

function clampWidgetPosition(element, left, top) {
  const rect = element.getBoundingClientRect();
  const margin = 8;
  return {
    left: Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - rect.width - margin)),
    top: Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - rect.height - margin)),
  };
}

function applyStoredWidgetPosition(element) {
  const stored = game.settings.get(MODULE_ID, WIDGET_POSITION_SETTING) ?? {};
  let position;

  if (Number.isFinite(stored.left) && Number.isFinite(stored.top)) {
    position = clampWidgetPosition(element, stored.left, stored.top);
  }
  else {
    position = defaultWidgetPosition(element);
  }

  element.style.left = `${position.left}px`;
  element.style.top = `${position.top}px`;
}

async function saveWidgetPosition(element) {
  const rect = element.getBoundingClientRect();
  const position = clampWidgetPosition(element, rect.left, rect.top);
  element.style.left = `${position.left}px`;
  element.style.top = `${position.top}px`;
  await game.settings.set(MODULE_ID, WIDGET_POSITION_SETTING, position);
}

function installWidgetDragging(element) {
  const handle = element.querySelector(".yze-action-widget__handle");
  if (!handle) return;

  let drag = null;

  const onPointerMove = event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();

    const position = clampWidgetPosition(
      element,
      drag.left + event.clientX - drag.clientX,
      drag.top + event.clientY - drag.clientY
    );
    element.style.left = `${position.left}px`;
    element.style.top = `${position.top}px`;
  };

  const finishDrag = async event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    handle.classList.remove("is-dragging");
    try {
      handle.releasePointerCapture?.(event.pointerId);
    }
    catch (_error) {
      // Pointer capture may already be released by the browser.
    }
    await saveWidgetPosition(element);
  };

  handle.addEventListener("pointerdown", event => {
    if (event.button !== 0 || event.target.closest("button")) return;
    const rect = element.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      left: rect.left,
      top: rect.top,
    };
    handle.classList.add("is-dragging");
    handle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", finishDrag);
  handle.addEventListener("pointercancel", finishDrag);
}

async function toggleActionFromWidget(statusId) {
  if (widgetMutationBusy) return;

  const combatant = getWidgetCombatant();
  const actor = combatant?.actor ?? combatant?.token?.actor;
  if (!combatant || !actor || !userOwnsCombatant(game.user, combatant)) return;

  const effect = getStatusEffect(statusId);
  if (!effect) {
    ui.notifications?.warn(`YZE Combat: не найден статус действия ${statusId}.`);
    return;
  }

  const currentlySpent = actorHasActionStatus(actor, statusId);
  if (equipmentOperations?.isBusy(actor.uuid)) return;
  if (supportsEquipmentControls() && ["pending", "undoing"].includes(readEquipmentOperation(actor)?.phase)) return;
  widgetMutationBusy = true;

  try {
    // YZE Combat itself represents a spent action with an Active Effect/status.
    // Use exactly that state, so the tracker and this widget stay synchronized.
    if (supportsEquipmentControls() && game.modules.get("fbl-quick-access")?.api.getActiveGM()) {
      await equipmentOperations.request({ kind: "toggle", actorUuid: actor.uuid, statusId: effect.id,
        expectedSpent: currentlySpent, combat: { id: game.combat.id, round: game.combat.round } });
    } else await actor.toggleStatusEffect(effect.id, { active: !currentlySpent });
  }
  catch (error) {
    console.error(`${MODULE_ID} | Could not toggle ${statusId}`, error);
    ui.notifications?.error("Не удалось изменить состояние действия. См. консоль F12.");
  }
  finally {
    widgetMutationBusy = false;
    refreshActionWidget();
  }
}

function createActionButton(statusId, label, icon, hint) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "yze-action-widget__action";
  button.dataset.action = statusId;
  button.title = hint;
  button.innerHTML = `
    <span class="yze-action-widget__icon"><img src="${icon}" alt=""></span>
    <span class="yze-action-widget__text">
      <span class="yze-action-widget__label">${label}</span>
      <span class="yze-action-widget__state"></span>
    </span>
  `;
  button.addEventListener("click", () => toggleActionFromWidget(statusId));
  return button;
}

function createActionWidget() {
  let element = document.getElementById(WIDGET_ID);
  if (element) return element;

  element = document.createElement("section");
  element.id = WIDGET_ID;
  element.className = "yze-action-widget";
  element.hidden = true;
  element.innerHTML = `
    <div class="yze-action-widget__handle" title="Перетащить">
      <i class="fa-solid fa-grip-dots"></i>
      <span class="yze-action-widget__name">Действия</span>
      <button type="button" class="yze-action-widget__tool" data-swap-hands hidden title="Поменять руки" aria-label="Поменять руки">⇄</button>
      <button type="button" class="yze-action-widget__tool" data-undo hidden title="Отменить последнюю операцию" aria-label="Отменить последнюю операцию">↶</button>
      <button type="button" class="yze-action-widget__tool" data-collapse aria-controls="${WIDGET_ID}-actions ${WIDGET_ID}-body"></button>
    </div>
    <div class="yze-action-widget__actions"></div>
  `;

  const actions = element.querySelector(".yze-action-widget__actions");
  actions.id = `${WIDGET_ID}-actions`;
  actions.append(
    createActionButton(
      FAST_ACTION,
      "БЫСТРОЕ",
      `modules/${TARGET_MODULE_ID}/assets/icons/fast-action.svg`,
      "Быстрое действие. Нажмите, чтобы отметить его потраченным или вернуть."
    ),
    createActionButton(
      SLOW_ACTION,
      "ОСНОВНОЕ",
      `modules/${TARGET_MODULE_ID}/assets/icons/slow-action.svg`,
      "Основное действие. Нажмите, чтобы отметить его потраченным или вернуть."
    )
  );

  const body = document.createElement("div");
  body.id = `${WIDGET_ID}-body`;
  body.className = "yze-action-widget__body";
  const onLayout = () => {
    if (!element.isConnected || element.hidden) return;
    const rect = element.getBoundingClientRect();
    const position = clampWidgetPosition(element, rect.left, rect.top);
    element.style.left = `${position.left}px`;
    element.style.top = `${position.top}px`;
  };
  const updateCollapseButton = () => {
    const collapsed = element.classList.contains("is-collapsed");
    const button = element.querySelector("[data-collapse]");
    button.textContent = collapsed ? "▾" : "▴";
    const label = collapsed ? "Раскрыть виджет" : "Свернуть виджет";
    button.title = button.ariaLabel = label + (button.classList.contains("has-pending-operation") ? ". Есть незавершённая операция" : "");
    button.setAttribute("aria-expanded", String(!collapsed));
  };
  const setCollapsed = (collapsed, persist = true) => {
    element.classList.toggle("is-collapsed", collapsed);
    body.hidden = collapsed;
    actions.hidden = collapsed || !game.combat?.started;
    updateCollapseButton();
    onLayout();
    if (persist) game.settings.set(MODULE_ID, WIDGET_COLLAPSED_SETTING, collapsed)
      .catch(error => warn("Could not save widget disclosure state", error));
  };
  const panel = createEquipmentPanel({ operations: equipmentOperations, onLayout, onControlsChange(controls) {
    const swap = element.querySelector("[data-swap-hands]");
    swap.hidden = !controls.available; swap.disabled = controls.swapDisabled;
    const undo = element.querySelector("[data-undo]");
    undo.hidden = !controls.undoVisible; undo.disabled = controls.undoDisabled;
    undo.title = controls.undoReason || "Отменить последнюю операцию: вернуть экипировку и её стоимость";
    // A collapsed widget must still expose an interrupted operation to its owner.
    element.querySelector("[data-collapse]").classList.toggle("has-pending-operation", controls.pending);
    updateCollapseButton();
  } });
  equipmentPanels.set(element, panel);
  element.querySelector("[data-collapse]").addEventListener("click", () => setCollapsed(!element.classList.contains("is-collapsed")));
  element.querySelector("[data-swap-hands]").addEventListener("click", () => {
    if (panel.swapHands()) { setCollapsed(false); onLayout(); }
  });
  element.querySelector("[data-undo]").addEventListener("click", () => {
    setCollapsed(false);
    void panel.undoLast();
  });
  body.append(panel.element);
  body.append(createCombatReference({
    open: game.settings.get(MODULE_ID, REFERENCE_OPEN_SETTING),
    onToggle(open) {
      game.settings.set(MODULE_ID, REFERENCE_OPEN_SETTING, open)
        .catch(error => warn("Could not save combat reference state", error));
      // Opening the reference increases the widget height. Keep its handle in view.
      requestAnimationFrame(() => {
        if (element.isConnected && !element.hidden) {
          saveWidgetPosition(element).catch(error => warn("Could not reposition combat reference", error));
        }
      });
    }
  }));
  element.append(body);
  setCollapsed(Boolean(game.settings.get(MODULE_ID, WIDGET_COLLAPSED_SETTING)), false);

  document.body.append(element);
  installWidgetDragging(element);
  return element;
}

function updateActionButton(element, statusId, spent) {
  const button = element.querySelector(`.yze-action-widget__action[data-action="${statusId}"]`);
  if (!button) return;

  button.classList.toggle("is-spent", spent);
  button.classList.toggle("is-available", !spent);
  button.setAttribute("aria-pressed", String(spent));

  const state = button.querySelector(".yze-action-widget__state");
  if (state) state.textContent = spent ? "ПОТРАЧЕНО" : "ЕСТЬ";
}

function refreshActionWidgetNow() {
  widgetRefreshQueued = false;

  if (game.user?.isGM) {
    document.getElementById(WIDGET_ID)?.remove();
    return;
  }

  const element = createActionWidget();
  const combatant = getWidgetCombatant();
  const actor = getWidgetActor();
  const shouldShow = Boolean(
    patchApplied &&
    ((slowAndFastActionsEnabled() && game.combat?.started && combatant) ||
      (!game.combat?.started && supportsEquipmentControls())) &&
    actor
  );

  element.hidden = !shouldShow;
  if (!shouldShow) return;

  // A hidden widget has no measurable dimensions. Clamp after making it visible.
  if (element.dataset.positionReady !== "true") {
    applyStoredWidgetPosition(element);
    element.dataset.positionReady = "true";
  }
  const rect = element.getBoundingClientRect();
  const position = clampWidgetPosition(element, rect.left, rect.top);
  element.style.left = `${position.left}px`;
  element.style.top = `${position.top}px`;

  const name = element.querySelector(".yze-action-widget__name");
  if (name) name.textContent = combatant?.name ?? actor.name ?? "Действия";

  element.querySelector(".yze-action-widget__actions").hidden = !game.combat?.started || element.classList.contains("is-collapsed");

  updateActionButton(element, FAST_ACTION, actorHasActionStatus(actor, FAST_ACTION));
  updateActionButton(element, SLOW_ACTION, actorHasActionStatus(actor, SLOW_ACTION));
  const equipment = quickAccess.getState();
  equipmentPanels.get(element)?.update(actor, equipment, game.combat);
  const operation = readEquipmentOperation(actor);
  const disabled = widgetMutationBusy || supportsEquipmentControls() &&
    (equipmentOperations?.isBusy(actor.uuid) || ["pending", "undoing"].includes(operation?.phase));
  for (const button of element.querySelectorAll(".yze-action-widget__action")) button.disabled = Boolean(disabled);
  Hooks.callAll("yzeCombatPermissionFix.widgetUpdated", {
    element, combatant, actor, equipment
  });
}

function refreshActionWidget() {
  if (widgetRefreshQueued) return;
  widgetRefreshQueued = true;
  requestAnimationFrame(refreshActionWidgetNow);
}

function installActionWidgetHooks() {
  const refreshHooks = [
    "createCombat",
    "updateCombat",
    "deleteCombat",
    "createCombatant",
    "updateCombatant",
    "deleteCombatant",
    "createActiveEffect",
    "updateActiveEffect",
    "deleteActiveEffect",
    "canvasReady",
    "controlToken",
    "fblQuickAccess.apiReady",
  ];

  for (const hook of refreshHooks) Hooks.on(hook, refreshActionWidget);
  Hooks.on("fblQuickAccess.equipmentChanged", actor => {
    const current = getWidgetActor();
    if (current && actor?.uuid === current.uuid) refreshActionWidget();
  });

  window.addEventListener("resize", () => {
    const element = document.getElementById(WIDGET_ID);
    if (!element || element.hidden) return;
    saveWidgetPosition(element).catch(error => warn("Could not save widget position after resize", error));
  });
}

/* ========================================================================== */
/*  Lifecycle                                                                 */
/* ========================================================================== */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, WIDGET_POSITION_SETTING, {
    scope: "client",
    config: false,
    type: Object,
    default: {},
  });
  game.settings.register(MODULE_ID, REFERENCE_OPEN_SETTING, {
    scope: "client", config: false, type: Boolean, default: false,
  });
  game.settings.register(MODULE_ID, WIDGET_COLLAPSED_SETTING, {
    scope: "client", config: false, type: Boolean, default: false,
  });
  game.settings.register(MODULE_ID, "equipmentOpen", {
    scope: "client", config: false, type: Boolean, default: true,
  });
});

Hooks.once("ready", () => {
  equipmentOperations = createEquipmentOperations();
  const yzeCombat = game.modules.get(TARGET_MODULE_ID);
  if (!yzeCombat?.active) {
    warn("Year Zero Engine: Combat is not active; patch not applied.");
    return;
  }

  if (yzeCombat.version !== TARGET_VERSION) {
    ui.notifications?.warn(
      `YZE Combat: Permission Fix рассчитан на yze-combat ${TARGET_VERSION}; обнаружена ${yzeCombat.version}. Патч отключён.`
    );
    warn(`Unsupported yze-combat version ${yzeCombat.version}; expected ${TARGET_VERSION}.`);
    return;
  }

  try {
    patchCombatDocument();
    patchCombatTracker();
    installSocketListener();
    patchApplied = true;
    equipmentOperations.register();
    Hooks.on("fblQuickAccess.apiReady", () => equipmentOperations.register());
    installActionWidgetHooks();
    refreshActionWidget();
    log(`Applied for yze-combat ${TARGET_VERSION}.`);
  }
  catch (error) {
    console.error(`${MODULE_ID} | Failed to apply compatibility patch`, error);
    ui.notifications?.error("YZE Combat: Permission Fix не удалось применить. См. консоль F12.");
  }
});

Hooks.once("shutdown", () => {
  for (const pending of pendingRoundRequests.values()) {
    window.clearTimeout(pending.timeout);
    pending.resolve(null);
  }
  pendingRoundRequests.clear();
});

// Preserve diagnostics and publish the optional equipment bridge for future UI.
Hooks.once("ready", () => {
  const module = game.modules.get(MODULE_ID);
  if (module) {
    module.api = Object.freeze({
      get applied() {
        return patchApplied;
      },
      get targetVersion() {
        return TARGET_VERSION;
      },
      refreshActionWidget,
      quickAccess,
      rolls,
    });
    Hooks.callAll("yzeCombatPermissionFix.apiReady", module.api);
  }
});
