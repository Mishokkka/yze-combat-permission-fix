import { getQuickAccessEquipmentApi } from "./quick-access-bridge.js";
import { hasActionStatus, hasPendingWeaponOperation, readEquipmentOperation } from "./equipment-operations.js";
import { getReloadProgress } from "./weapon-operations.js";
import { RELOAD_UNITS } from "./reload-rules.js";

const MODULE = "yze-combat-permission-fix";
const ID = `${MODULE}-gm-summary`;
const VISIBLE = "gmSummaryVisible";
const COLLAPSED = "gmSummaryCollapsed";
const POSITION = "gmSummaryPosition";
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[char]));

export function registerGMSummarySettings(onChange) {
  game.settings.register(MODULE, VISIBLE, {
    name: "Сводка группы для ГМа", hint: "Показывать руки и действия подключённых игроков. Также переключается кнопкой группы в инструментах токенов.",
    scope: "client", config: true, restricted: true, type: Boolean, default: false, onChange,
  });
  game.settings.register(MODULE, COLLAPSED, {scope: "client", config: false, type: Boolean, default: false, onChange});
  game.settings.register(MODULE, POSITION, {scope: "client", config: false, type: Object, default: {}});
}

/** Foundry v13 prepares this record before ready and reuses it on later renders. */
export function addGMSummaryControl(controls, toggle) {
  if (!game.user?.isGM || !controls.tokens?.tools) return;
  const tools = controls.tokens.tools;
  tools.yzeGMSummary = {
    name: "yzeGMSummary", title: "Сводка группы: показать / скрыть", icon: "fa-solid fa-users",
    order: Math.max(0, ...Object.values(tools).map(tool => Number(tool.order) || 0)) + 1,
    button: true, onChange: toggle,
  };
}

function owns(user, combatant) {
  const actor = combatant.actor ?? combatant.token?.actor;
  const owner = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  try { if (actor?.testUserPermission?.(user, owner)) return true; } catch (_) { /* Fall back to document ownership. */ }
  if ((actor?.ownership?.[user.id] ?? actor?.ownership?.default ?? 0) >= owner) return true;
  return combatant.players?.some?.(player => player.id === user.id) ?? false;
}

/** Use actual combatant Actors, including synthetic ones; never infer another client's selected token. */
export function collectGMSummaryCharacters(users, combat) {
  const connected = [...(users ?? [])].filter(user => user.active && !user.isGM)
    .sort((a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)) || String(a.id).localeCompare(String(b.id)));
  const combatants = [...(combat?.combatants ?? [])];
  const rows = new Map();
  function add(actor, user, combatant = null) {
    const key = actor?.uuid ?? `User.${user.id}`;
    let row = rows.get(key);
    if (!row) {
      row = {key, actor, users: [], combatants: []};
      rows.set(key, row);
    }
    if (!row.users.some(entry => entry.id === user.id)) row.users.push(user);
    if (combatant && !row.combatants.includes(combatant)) row.combatants.push(combatant);
  }
  for (const user of connected) {
    const owned = combatants.filter(entry => (entry.actor ?? entry.token?.actor)?.type === "character" && owns(user, entry))
      .sort((a, b) => String(a.actor?.uuid ?? a.token?.actor?.uuid).localeCompare(String(b.actor?.uuid ?? b.token?.actor?.uuid)) || String(a.id).localeCompare(String(b.id)));
    for (const entry of owned) add(entry.actor ?? entry.token.actor, user, entry);
    const assigned = user.character?.type === "character" ? user.character : null;
    // A synthetic token and its base character have different UUIDs but the same Actor id.
    if (assigned && !owned.some(entry => (entry.actor ?? entry.token?.actor)?.id === assigned.id)) add(assigned, user);
    if (!assigned && !owned.length) add(null, user);
  }
  return [...rows.values()];
}

/** Detached display state. All reads use public QA data and this module's own reload records. */
export function readGMSummaryRow(entry, {combat, actionsEnabled, api} = {}) {
  const {actor} = entry;
  const current = combat?.combatant ?? combat?.turns?.[combat.turn];
  const inCombat = Boolean(combat?.started && entry.combatants.length);
  const row = {
    key: entry.key, name: entry.combatants[0]?.name ?? actor?.name ?? entry.users[0]?.name ?? "Игрок",
    players: entry.users.map(user => user.name ?? user.id).join(", "), hasActor: Boolean(actor),
    current: inCombat && entry.combatants.some(candidate => candidate === current || candidate.id && candidate.id === current?.id),
    inCombat, actions: actor && inCombat && actionsEnabled
      ? {fast: !hasActionStatus(actor, "fastAction"), slow: !hasActionStatus(actor, "slowAction")} : null,
    unable: actor?.canAct === false, defeated: inCombat && entry.combatants.every(candidate => candidate.isDefeated),
    pending: Boolean(actor && (hasPendingWeaponOperation(actor) || ["pending", "undoing"].includes(readEquipmentOperation(actor)?.phase))),
    equipment: "unavailable", hands: [],
  };
  if (!actor || !api) return row;
  let state;
  try { state = api.getEquipmentState(actor); }
  catch (_) { row.equipment = "error"; return row; }
  if (!state?.hands) { row.equipment = "error"; return row; }
  row.equipment = "ready";
  let presentation;
  try {
    if (api.capabilities?.heldItemPresentation && typeof api.getHeldItemPresentation === "function") {
      presentation = api.getHeldItemPresentation(actor);
    }
  } catch (_) { /* Hands and action marks remain useful when optional weapon data fails. */ }
  const hands = state.hands.left && state.hands.left === state.hands.right ? ["both"] : ["left", "right"];
  for (const hand of hands) {
    const side = hand === "both" ? "left" : hand;
    const itemId = state.hands[side];
    const item = itemId ? actor.items?.get(itemId) : null;
    const weapon = presentation?.items?.find(value => value.itemId === itemId);
    const magazine = weapon?.firearm?.magazine;
    const progress = [];
    if (itemId) {
      for (const mode of ["load", "topOff"]) {
        const value = getReloadProgress(actor, weapon ?? {itemId}, mode);
        if (value.current > 0 && !value.finished) progress.push({mode, current: value.current, target: value.target, unit: value.unit});
      }
    }
    row.hands.push({
      hand, itemId: item?.id ?? null, name: itemId ? state.heldItems?.[side]?.name ?? item?.name ?? "Предмет недоступен" : "Свободна",
      occupied: Boolean(itemId), broken: weapon?.broken === true, progress,
      magazine: magazine && Number.isFinite(magazine.current) && Number.isFinite(magazine.capacity)
        ? {current: magazine.current, capacity: magazine.capacity} : null,
    });
  }
  return row;
}

export function createGMSummary() {
  let element = null, signature = "", queued = false, disposed = false;
  let frame = null, drag = null;
  const hooks = [];
  const setting = key => game.settings.get(MODULE, key);

  async function save(key, value) {
    try { await game.settings.set(MODULE, key, value); refresh(); }
    catch (error) {
      console.warn(`${MODULE} | Could not save GM summary preference`, error);
      ui.notifications?.warn("Не удалось сохранить настройку сводки группы.");
    }
  }

  function clamp(left, top) {
    if (!element || element.hidden) return;
    const rect = element.getBoundingClientRect(), margin = 8;
    element.style.left = `${Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - rect.width - margin))}px`;
    element.style.top = `${Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - rect.height - margin))}px`;
  }

  function position() {
    if (!element || element.hidden || drag) return;
    const stored = setting(POSITION) ?? {};
    clamp(Number.isFinite(stored.left) ? stored.left : 110, Number.isFinite(stored.top) ? stored.top : 90);
  }

  function create() {
    element = document.createElement("section");
    element.id = ID;
    element.setAttribute("aria-label", "Сводка группы для ГМа");
    element.innerHTML = `<header class="yze-gm__header"><i class="fa-solid fa-grip-dots" aria-hidden="true"></i><span class="yze-gm__title"></span><span class="yze-gm__round"></span><button type="button" data-gm-collapse class="yze-gm__tool" aria-controls="${ID}-body"></button><button type="button" data-gm-hide class="yze-gm__tool" title="Скрыть. Вернуть: инструменты токенов → Сводка группы" aria-label="Скрыть сводку группы">×</button></header><div class="yze-gm__body" id="${ID}-body"></div><footer class="yze-gm__footer"><span>Б — быстрое · О — основное</span><span>✓ есть · × потрачено</span></footer>`;
    document.body.append(element);
    element.addEventListener("click", async event => {
      const button = event.target.closest("button");
      if (!button || !game.user?.isGM) return;
      if (button.hasAttribute("data-gm-hide")) { void save(VISIBLE, false); return; }
      if (button.hasAttribute("data-gm-collapse")) { void save(COLLAPSED, !setting(COLLAPSED)); return; }
      const key = button.closest("[data-gm-row]")?.dataset.gmRow;
      const entry = collectGMSummaryCharacters(game.users, game.combat).find(value => value.key === key);
      if (!entry?.actor) return;
      try {
        if (button.hasAttribute("data-gm-actor")) await entry.actor.sheet?.render(true);
        else if (button.dataset.gmItem) await entry.actor.items.get(button.dataset.gmItem)?.sheet?.render(true);
      } catch (error) {
        console.warn(`${MODULE} | Could not open summary sheet`, error);
        ui.notifications?.warn("Не удалось открыть лист из сводки группы.");
      }
    });
    const handle = element.querySelector(".yze-gm__header");
    handle.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.target.closest("button")) return;
      const rect = element.getBoundingClientRect();
      drag = {id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top};
      handle.setPointerCapture(event.pointerId);
      handle.classList.add("is-dragging");
      event.preventDefault();
    });
    handle.addEventListener("pointermove", event => {
      if (!drag || event.pointerId !== drag.id) return;
      clamp(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
    });
    const finish = event => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null;
      handle.classList.remove("is-dragging");
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      const rect = element.getBoundingClientRect();
      void save(POSITION, {left: rect.left, top: rect.top});
    };
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) handle.addEventListener(type, finish);
  }

  function equipment(row) {
    if (!row.hasActor) return '<span class="yze-gm__muted">Персонаж не назначен</span>';
    if (row.equipment !== "ready") return `<span class="yze-gm__muted" title="${row.equipment === "error" ? "Не удалось прочитать состояние Quick Access" : "Нужен включённый Quick Access с API экипировки"}">Нет данных о руках</span>`;
    if (row.hands.every(hand => !hand.occupied)) return '<span class="yze-gm__muted">Руки свободны</span>';
    return row.hands.map(hand => {
      const label = {left: "Л", right: "П", both: "2Р"}[hand.hand];
      const item = hand.itemId ? `<button type="button" class="yze-gm__link" data-gm-item="${escape(hand.itemId)}" title="Открыть: ${escape(hand.name)}">${escape(hand.name)}</button>` : `<span class="yze-gm__muted">${escape(hand.name)}</span>`;
      const ammo = hand.magazine ? `<span class="yze-gm__ammo${hand.magazine.current === 0 ? " is-empty" : ""}" title="Патроны: ${hand.magazine.current} из ${hand.magazine.capacity}${hand.magazine.current === 0 ? " · магазин пуст" : ""}">${hand.magazine.current}/${hand.magazine.capacity}</span>` : "";
      const progress = hand.progress.map(value => `<span class="yze-gm__progress">${value.mode === "topOff" ? "Дозарядка" : "Зарядка"}: ${value.current}/${value.target} ${escape(RELOAD_UNITS[value.unit])}</span>`).join("");
      return `<div class="yze-gm__hand"><span class="yze-gm__grip" title="${{left: "Левая рука", right: "Правая рука", both: "Обе руки"}[hand.hand]}">${label}</span>${item}${ammo}</div>${hand.broken ? '<span class="yze-gm__warning">Сломано</span>' : ""}${progress}`;
    }).join("");
  }

  function action(label, full, available) {
    return `<span class="yze-gm__action ${available ? "is-available" : "is-spent"}" title="${full}: ${available ? "есть" : "потрачено"}" aria-label="${full}: ${available ? "есть" : "потрачено"}">${label} ${available ? "✓" : "×"}</span>`;
  }

  function render() {
    queued = false; frame = null;
    if (disposed) return;
    if (!game.user?.isGM) { element?.remove(); element = null; signature = ""; return; }
    if (!setting(VISIBLE)) { if (element) element.hidden = true; return; }
    if (!element) create();
    element.hidden = false;
    const combat = game.combat;
    const actionsEnabled = Boolean(game.settings.get("yze-combat", "slowAndFastActions"));
    const api = getQuickAccessEquipmentApi();
    const rows = collectGMSummaryCharacters(game.users, combat).map(entry => readGMSummaryRow(entry, {combat, actionsEnabled, api}));
    const collapsed = Boolean(setting(COLLAPSED));
    const round = combat?.started ? `Раунд ${combat.round}` : "Вне боя";
    const next = JSON.stringify([rows, collapsed, round, actionsEnabled]);
    if (next !== signature) {
      const body = element.querySelector(".yze-gm__body"), scroll = body.scrollTop;
      const focused = element.contains(document.activeElement) ? document.activeElement : null;
      const focus = focused && {key: focused.closest("[data-gm-row]")?.dataset.gmRow, itemId: focused.dataset.gmItem, actor: focused.hasAttribute("data-gm-actor")};
      element.querySelector(".yze-gm__title").textContent = `Группа · ${rows.length}`;
      element.querySelector(".yze-gm__round").textContent = round;
      const collapse = element.querySelector("[data-gm-collapse]");
      collapse.textContent = collapsed ? "▸" : "▾";
      collapse.title = collapsed ? "Развернуть сводку" : "Свернуть сводку";
      collapse.setAttribute("aria-label", collapse.title);
      collapse.setAttribute("aria-expanded", String(!collapsed));
      body.hidden = collapsed;
      element.classList.toggle("is-collapsed", collapsed);
      element.querySelector(".yze-gm__footer").hidden = collapsed || !rows.some(row => row.actions);
      const actionColumn = Boolean(combat?.started);
      body.innerHTML = rows.length ? `<table aria-label="Предметы в руках и действия группы"><colgroup><col class="yze-gm__identity-col"><col>${actionColumn ? '<col class="yze-gm__actions-col">' : ""}</colgroup><thead><tr><th scope="col">Персонаж</th><th scope="col">В руках</th>${actionColumn ? '<th scope="col">Действия</th>' : ""}</tr></thead><tbody>${rows.map(row => `<tr data-gm-row="${escape(row.key)}"${row.current ? ' class="is-current" aria-current="true"' : ""}><td>${row.hasActor ? `<button type="button" class="yze-gm__link yze-gm__name" data-gm-actor title="Открыть: ${escape(row.name)} · ${escape(row.players)}">${escape(row.name)}</button>` : `<span>${escape(row.name)}</span>`}${row.current ? '<span class="yze-gm__turn">◂ ходит</span>' : ""}${row.unable || row.defeated ? `<span class="yze-gm__warning">${row.unable ? "Не может действовать" : "Побеждён"}</span>` : ""}${row.pending ? '<span class="yze-gm__warning">Операция не завершена</span>' : ""}</td><td>${equipment(row)}</td>${actionColumn ? `<td>${row.actions ? `<div class="yze-gm__actions">${action("Б", "Быстрое", row.actions.fast)}${action("О", "Основное", row.actions.slow)}</div>` : `<span class="yze-gm__muted">${!row.hasActor ? "—" : row.inCombat ? "Учёт выключен" : "Вне боя"}</span>`}</td>` : ""}</tr>`).join("")}</tbody></table>` : '<p class="yze-gm__empty">Нет подключённых игроков</p>';
      body.scrollTop = scroll;
      if (focus?.key) {
        const target = [...body.querySelectorAll("[data-gm-row]")].find(row => row.dataset.gmRow === focus.key);
        [...(target?.querySelectorAll("button") ?? [])].find(button => focus.actor ? button.hasAttribute("data-gm-actor") : button.dataset.gmItem === focus.itemId)?.focus({preventScroll: true});
      }
      signature = next;
    }
    position();
  }

  function refresh() {
    if (queued || disposed) return;
    queued = true;
    frame = requestAnimationFrame(render);
  }

  for (const name of [
    "userConnected", "createUser", "updateUser", "deleteUser", "createActor", "updateActor", "deleteActor",
    "createCombat", "updateCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant",
    "createToken", "updateToken", "deleteToken", "canvasReady",
    "createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "createItem", "updateItem", "deleteItem",
    "fblQuickAccess.apiReady", "fblQuickAccess.equipmentChanged", "fl-firearms.magazineChanged", "updateSetting",
  ]) hooks.push([name, Hooks.on(name, refresh)]);
  window.addEventListener("resize", position);
  refresh();
  return Object.freeze({
    refresh,
    show: () => game.user?.isGM ? save(VISIBLE, true) : undefined,
    hide: () => game.user?.isGM ? save(VISIBLE, false) : undefined,
    toggle: () => game.user?.isGM ? save(VISIBLE, !setting(VISIBLE)) : undefined,
    destroy() {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      for (const [name, id] of hooks) Hooks.off(name, id);
      window.removeEventListener("resize", position);
      element?.remove(); element = null;
    },
  });
}
