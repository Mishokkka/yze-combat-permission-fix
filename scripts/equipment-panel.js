import { getQuickAccessEquipmentApi } from "./quick-access-bridge.js";
import { supportsEquipmentControls, readEquipmentOperation, hasActionStatus, equipmentUndoError } from "./equipment-operations.js";

const MODULE_ID = "yze-combat-permission-fix";
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const costs = { free: "Без траты", fast: "Быстрое", slow: "Основное", both: "Оба" };
const statusCosts = { free: [], fast: ["fastAction"], slow: ["slowAction"], both: ["fastAction", "slowAction"] };

/** Keep all menus bound to an Actor UUID; render read-only snapshots through the public API. */
export function createEquipmentPanel({ operations, onLayout }) {
  const element = document.createElement("div");
  element.className = "yze-equipment";
  // Native details.toggle does not bubble. Slot settings can increase the
  // height too, so capture every disclosure and clamp after its layout change.
  element.addEventListener("toggle", () => onLayout?.(), true);
  let actor = null, state = null, combat = null, selected = null, slotIndex = null;
  let command = null, cost = "", revision = null, roundKey = "", message = "", busy = false, signature = "";
  let open = Boolean(game.settings.get(MODULE_ID, "equipmentOpen"));

  const name = id => state?.inventory?.find(item => item.id === id)?.name ??
    state?.slots?.find(slot => slot.itemId === id)?.item?.name ??
    Object.values(state?.heldItems ?? {}).find(item => item?.id === id)?.name ?? "Свободна";
  const item = id => state?.inventory?.find(item => item.id === id) ??
    state?.slots?.find(slot => slot.itemId === id)?.item ?? Object.values(state?.heldItems ?? {}).find(item => item?.id === id);
  const epoch = () => combat?.started ? { id: combat.id, round: combat.round } : null;
  const canPay = value => statusCosts[value]?.every(status => !hasActionStatus(actor, status));
  const id = () => foundry.utils.randomID();

  function preview() {
    if (!command) return null;
    try { return getQuickAccessEquipmentApi().previewEquipmentAction(actor, command); }
    catch (error) { return { changed: false, error: error.message }; }
  }

  function reset() { selected = null; slotIndex = null; command = null; cost = ""; message = ""; }
  function render() {
    signature = "";
    if (!actor || !state || !supportsEquipmentControls()) { element.hidden = true; return; }
    element.hidden = false;
    const editable = state.editable && !busy && !operations.isBusy(actor.uuid);
    const operation = readEquipmentOperation(actor);
    const pending = ["pending", "undoing"].includes(operation?.phase);
    const undoError = operation?.phase === "complete" ? equipmentUndoError(actor) : "";
    const blocked = !editable || pending;
    const both = state.hands.left && state.hands.left === state.hands.right;
    const handButton = hand => {
      const held = state.hands[hand === "both" ? "left" : hand];
      return `<button type="button" class="yze-equipment__hand ${hand === "both" ? "is-both" : ""}" data-select-item="${escape(held ?? "")}" ${held ? `data-item-id="${escape(held)}" data-equipment-item="true"` : ""} ${!held || busy ? "disabled" : ""} title="${hand === "both" ? "Обе руки" : hand === "left" ? "Левая рука" : "Правая рука"}: ${escape(name(held))}"><small>${hand === "both" ? "Обе" : hand === "left" ? "Л" : "П"}</small><span>${escape(name(held))}</span></button>`;
    };
    const transition = preview();
    const previewText = transition?.error ?? (transition ?
      `${transition.displaced.length ? `Убрать: ${transition.displaced.map(i => i.name).join(", ")}. ` : ""}${transition.hands.left && transition.hands.left === transition.hands.right ? `Обе руки: ${name(transition.hands.left)}` : `Л: ${name(transition.hands.left)} · П: ${name(transition.hands.right)}`}${transition.changed ? "" : " · без изменений"}` : "Выберите манипуляцию");
    const slots = state.slots.slice(0, 10).map(slot => {
      const held = slot.itemId && state.hands.left === slot.itemId && state.hands.right === slot.itemId ? "2Р" : slot.itemId && state.hands.left === slot.itemId ? "Л" : slot.itemId && state.hands.right === slot.itemId ? "П" : "";
      const label = slot.missing ? "Удалён" : slot.item?.name ?? "Пусто";
      const hint = `${slot.index + 1}: ${label}${held ? ` · ${held === "2Р" ? "обе руки" : held === "Л" ? "левая рука" : "правая рука"}` : ""}${!slot.available ? " · вне вместимости" : slot.item && !slot.canHold ? " · не подходит для быстрого доступа" : ""}`;
      return `<button type="button" class="yze-equipment__slot ${slot.available ? "" : "is-overflow"}" data-slot="${slot.index}" data-item-id="${escape(slot.itemId)}" ${slot.item ? 'data-equipment-item="true"' : ""} title="${escape(hint)}" aria-label="${escape(hint)}" aria-pressed="${slotIndex === slot.index}" ${busy ? "disabled" : ""}><span class="yze-equipment__slot-top"><small>${slot.index + 1}</small>${slot.item ? `<img src="${escape(slot.item.img)}" alt="">` : "<span aria-hidden=\"true\">+</span>"}<small>${held}</small></span><span class="yze-equipment__slot-name">${escape(label)}</span></button>`;
    }).join("");
    let menu = "";
    if (selected || command?.type === "swapHands") {
      const heldHand = state.hands.left === selected ? "left" : state.hands.right === selected ? "right" : null;
      const selectedItem = item(selected);
      const canHold = selectedItem && (state.slots.some(s => s.itemId === selected && s.canHold) || state.inventory.some(i => i.id === selected) && heldHand);
      menu = `<div class="yze-equipment__menu"><div class="yze-equipment__menu-head"><strong>${escape(command?.type === "swapHands" ? "Поменять руки" : name(selected))}</strong>${selected ? '<button type="button" data-open-item>Открыть</button>' : ""}<button type="button" data-close aria-label="Закрыть меню предмета">×</button></div>
        ${command?.type === "swapHands" ? "" : `<div class="yze-equipment__commands">${[["left", "Левая"], ["right", "Правая"], ["both", "Обе"], ["stow", "Убрать"]].map(([hand, label]) => `<button type="button" data-grip="${hand}" aria-label="${hand === "stow" ? "Убрать из рук" : `Взять: ${label}`}" aria-pressed="${command?.hand === hand || hand === "stow" && command?.type === "stow"}" ${blocked || (hand === "stow" ? !heldHand : !canHold) ? "disabled" : ""}>${label}</button>`).join("")}</div>`}
        <div class="yze-equipment__preview" aria-live="polite">${escape(previewText)}</div>
        <label class="yze-equipment__price-label" for="yze-equipment-price">${combat?.started ? "Цена операции" : "Вне боя · без траты"}</label><div class="yze-equipment__price-row">${combat?.started ? `<select id="yze-equipment-price" data-cost aria-label="Цена операции" ${!command || blocked || !transition?.changed ? "disabled" : ""}><option value="">Выбрать…</option>${Object.entries(costs).map(([value, label]) => `<option value="${value}" ${cost === value ? "selected" : ""} ${!canPay(value) ? "disabled" : ""}>${label}${canPay(value) ? "" : " — потрачено"}</option>`).join("")}</select>` : ""}<button type="button" data-apply ${blocked || !transition?.changed || combat?.started && (!cost || !canPay(cost)) ? "disabled" : ""}>Применить</button></div></div>`;
    }
    const selectedSlot = state.slots.find(s => s.index === slotIndex);
    const settings = selectedSlot ? `<details class="yze-equipment__settings"><summary>Настройка слота ${slotIndex + 1}</summary>
      ${selectedSlot.available ? `<label>Предмет<select data-assign-item aria-label="Предмет для слота"><option value="">Выбрать…</option>${state.inventory.map(i => `<option value="${escape(i.id)}">${escape(i.name)}</option>`).join("")}</select></label><button type="button" data-assign ${blocked ? "disabled" : ""}>Назначить</button>` : ""}
      <label>Переставить в<select data-move-to aria-label="Целевой слот">${state.slots.filter(s => s.available && s.index !== slotIndex).map(s => `<option value="${s.index}">${s.index + 1}: ${escape(s.item?.name ?? "Пусто")}</option>`).join("")}</select></label><button type="button" data-move ${blocked || !state.slots.some(s => s.available && s.index !== slotIndex) ? "disabled" : ""}>Переставить</button>
      <button type="button" data-clear-slot ${blocked || !selectedSlot.itemId ? "disabled" : ""}>Освободить слот</button></details>` : "";
    element.innerHTML = `<div class="yze-equipment__hands-block"><div class="yze-equipment__hands-head"><span>В руках</span><button type="button" data-swap-hands ${blocked || state.hands.left === state.hands.right ? "disabled" : ""}>Поменять руки</button></div><div class="yze-equipment__hands">${both ? handButton("both") : handButton("left") + handButton("right")}</div></div>${menu}
      <details class="yze-equipment__slots" ${open ? "open" : ""}><summary>Быстрый доступ · ${state.capacity} слотов${state.slots.length > state.capacity ? " · есть избыток" : ""}</summary><div class="yze-equipment__grid" style="--equipment-columns:${Math.max(1, Math.ceil(Math.min(state.slots.length, 10) / 2))}">${slots || '<span class="yze-equipment__empty">Нет доступных слотов</span>'}</div>${state.slots.length > 10 ? `<p>Ещё ${state.slots.length - 10} сохранённых привязок. Настройте их на листе.</p>` : ""}${settings}</details>
      ${pending ? `<div class="yze-equipment__recovery" role="alert">${operation.phase === "undoing" ? "Отмена ожидает завершения" : "Операция ожидает завершения"}<div><button type="button" data-resume ${busy ? "disabled" : ""}>Продолжить</button><button type="button" data-cancel ${busy ? "disabled" : ""}>Отменить операцию</button></div></div>` : operation?.phase === "complete" && operation.changed ? `<button type="button" class="yze-equipment__undo" data-undo title="${escape(undoError || "Вернуть прежнюю экипировку и стоимость этой операции")}" ${blocked || undoError ? "disabled" : ""}>Отменить последнюю операцию</button>` : ""}
      <div class="yze-equipment__message" ${message ? 'role="alert"' : 'aria-live="polite"'}>${escape(busy ? "Применение…" : message)}</div>`;
    const details = element.querySelector(".yze-equipment__slots");
    details.addEventListener("toggle", () => {
      if (!details.isConnected || open === details.open) return;
      open = details.open;
      game.settings.set(MODULE_ID, "equipmentOpen", open).catch(console.warn);
      onLayout?.();
    });
    const api = getQuickAccessEquipmentApi();
    api.setupEquipmentItemTooltips?.(actor, element);
    onLayout?.();
  }

  async function apply(payload) {
    const target = actor;
    busy = true; message = ""; render();
    try {
      const result = await operations.request({ actorUuid: target.uuid, ...payload });
      if (actor?.uuid !== target.uuid) return;
      command = null; cost = "";
      message = result.changed ? "Применено" : "Без изменений";
    } catch (error) {
      if (actor?.uuid === target.uuid) message = error.message;
    } finally {
      busy = false;
      // Hooks may render on the next animation frame. Accept our committed
      // revision now so that deferred refresh does not discard the selection.
      try { state = actor ? getQuickAccessEquipmentApi()?.getEquipmentState(actor) ?? null : null; }
      catch (error) { state = null; message = error.message; }
      revision = state?.revision;
      render();
    }
  }

  element.addEventListener("change", event => {
    if (!event.target.matches("[data-cost]")) return;
    cost = event.target.value;
    const button = element.querySelector("[data-apply]");
    if (button) button.disabled = !state.editable || busy || !preview()?.changed || !cost || !canPay(cost);
  });
  element.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button || button.disabled || !element.contains(button)) return;
    message = "";
    if (button.hasAttribute("data-slot") || button.hasAttribute("data-select-item")) {
      selected = button.dataset.itemId || button.dataset.selectItem || null;
      slotIndex = button.hasAttribute("data-slot") ? Number(button.dataset.slot) : null;
      command = null; cost = "";
    } else if (button.hasAttribute("data-grip")) {
      const hand = button.dataset.grip;
      command = hand === "stow" ? { type: "stow", hand: state.hands.left === selected ? "left" : "right" } : { type: "hold", itemId: selected, hand };
      cost = "";
    } else if (button.hasAttribute("data-swap-hands")) {
      selected = null; slotIndex = null; command = { type: "swapHands" }; cost = "";
    } else if (button.hasAttribute("data-open-item")) {
      actor.items.get(selected)?.sheet?.render(true); return;
    } else if (button.hasAttribute("data-close")) reset();
    else if (button.hasAttribute("data-apply")) {
      const transition = preview();
      if (!transition?.changed || combat?.started && (!cost || !canPay(cost))) return;
      void apply({ kind: "start", id: id(), command, cost: combat?.started ? cost : "free", combat: epoch(), expectedRevision: state.revision }); return;
    } else if (button.hasAttribute("data-assign")) {
      const itemId = element.querySelector("[data-assign-item]").value;
      if (!itemId) { message = "Выберите предмет"; render(); return; }
      void apply({ kind: "start", id: id(), command: { type: "assignSlot", index: slotIndex, itemId }, cost: "free", combat: epoch(), expectedRevision: state.revision }); return;
    } else if (button.hasAttribute("data-move")) {
      const to = element.querySelector("[data-move-to]").value;
      if (!to) return;
      void apply({ kind: "start", id: id(), command: { type: "swapSlots", from: slotIndex, to: Number(to) }, cost: "free", combat: epoch(), expectedRevision: state.revision }); return;
    } else if (button.hasAttribute("data-clear-slot")) {
      void apply({ kind: "start", id: id(), command: { type: "clearSlot", index: slotIndex }, cost: "free", combat: epoch(), expectedRevision: state.revision }); return;
    } else {
      const operation = readEquipmentOperation(actor);
      if (!operation) return;
      const kind = button.hasAttribute("data-resume") ? "resume" : button.hasAttribute("data-cancel") ? "cancel" : button.hasAttribute("data-undo") ? "undo" : null;
      if (!kind) return;
      void apply({ kind, id: operation.id }); return;
    }
    render();
  });

  function update(nextActor, nextState, nextCombat) {
    const nextRoundKey = JSON.stringify(nextCombat?.started ? [nextCombat.id, nextCombat.round] : null);
    if (actor?.uuid !== nextActor?.uuid) { reset(); revision = null; }
    else if ((nextState?.revision !== revision || nextRoundKey !== roundKey) && !busy && !operations.isBusy(nextActor?.uuid)) { command = null; cost = ""; selected = null; slotIndex = null; }
    actor = nextActor; state = nextState; combat = nextCombat; revision = state?.revision;
    roundKey = nextRoundKey;
    const nextSignature = JSON.stringify([actor?.uuid, state, epoch(), readEquipmentOperation(actor), actor && [hasActionStatus(actor, "fastAction"), hasActionStatus(actor, "slowAction")], operations.isBusy(actor?.uuid)]);
    if (nextSignature === signature) return;
    render(); signature = nextSignature;
  }
  return { element, update, get busy() { return busy; } };
}
