import { getQuickAccessEquipmentApi } from "./quick-access-bridge.js";
import { hasActionStatus, hasPendingWeaponOperation, readEquipmentOperation } from "./equipment-operations.js";
import { ACTION_COSTS, getReloadProgress, readWeaponOperation, supportsWeaponControls } from "./weapon-operations.js";
import {getReloadRequirement, paidReloadAmount, RELOAD_UNITS} from "./reload-rules.js";

const MODULE = "yze-combat-permission-fix";
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[char]));
const costLabels = {free: "Без траты", fast: "Быстрое", slow: "Основное", both: "Оба"};
const setting = key => game.settings.get(MODULE, key);

/** Separate compact groups for identity, combat, loading, traits and commands.
 * A single drawer contains the selected rule/action, never a permanent form per gun.
 */
export function createWeaponRibbon({operations, attacks, onGrip, onPendingChange}) {
  const element = document.createElement("section");
  element.id = "yze-combat-permission-fix-weapon-ribbon";
  element.className = "yze-weapon-ribbon"; element.hidden = true;
  element.setAttribute("aria-label", "Оружие в руках");
  document.body.append(element);
  let actor = null, presentation = null, combat = null, anchor = null, collapsed = false;
  let drawer = null, draft = null, message = "", signature = "", pinned = Boolean(setting("weaponRibbonPinned"));
  const expanded = new Set(), busy = new Set();
  const epoch = () => combat?.started ? {id: combat.id, round: combat.round} : null;
  const item = id => presentation?.items.find(item => item.itemId === id);
  const blocked = () => !presentation?.editable || !actor?.canAct || busy.has(actor?.uuid) || operations.isBusy(actor?.uuid) || hasPendingWeaponOperation(actor) || ["pending", "undoing"].includes(readEquipmentOperation(actor)?.phase);
  const canPay = value => ACTION_COSTS[value]?.every(status => !hasActionStatus(actor, status));
  const stat = (label, value) => value === "" || value === null || value === undefined ? "" : `<div><dt title="${escape(label === "БП" ? "Бронепробитие: оператор и значение" : label)}">${escape(label)}</dt><dd>${escape(value)}</dd></div>`;

  function row(weapon) {
    const hand = weapon.hand === "both" ? "2Р" : weapon.hand === "left" ? "Л" : "П";
    const gun = weapon.firearm, magazine = gun?.magazine;
    const features = expanded.has(weapon.itemId) ? weapon.features : weapon.features.slice(0, 2);
    const progress = getReloadProgress(actor, weapon);
    const topOff = getReloadProgress(actor, weapon, "topOff");
    const active = progress.current && !progress.finished ? {mode: "Зарядка", ...progress} : topOff.current && !topOff.finished ? {mode: "Дозарядка", ...topOff} : null;
    return `<article class="yze-weapon__row" data-weapon-row="${escape(weapon.itemId)}">
      <div class="yze-weapon__main">
        <div class="yze-weapon__identity"><button type="button" class="yze-weapon__hand" data-weapon-grip="${escape(weapon.itemId)}" aria-label="Изменить хват: ${escape(weapon.name)}" title="Изменить хват">${hand}</button><img src="${escape(weapon.img)}" alt=""><button type="button" class="yze-weapon__name" data-weapon-inspect="${escape(weapon.itemId)}" title="${escape(weapon.name)}">${escape(weapon.name)}</button>${weapon.broken ? '<span class="yze-weapon__warning">Сломано</span>' : ""}</div>
        <dl class="yze-weapon__stats" aria-label="Боевые характеристики">${stat("Бонус", weapon.bonus === null ? null : (weapon.bonus >= 0 ? "+" : "") + weapon.bonus)}${stat("Урон", weapon.damage)}${stat("Дальность", weapon.range)}${stat("БП", gun?.armorPiercing ? `${gun.armorPiercing.operator === "*" ? "×" : gun.armorPiercing.operator}${gun.armorPiercing.value}` : null)}${stat("Артефакт", weapon.artifact)}</dl>
        ${gun ? `<dl class="yze-weapon__loading" aria-label="Боеприпасы и перезарядка">${stat("Патроны", magazine ? `${magazine.current}/${magazine.capacity}${magazine.current === 0 ? " · пуст" : ""}` : null)}${stat("Базовая зарядка", gun.reloadType === "MAG" ? null : `${gun.reloadValue} ${{Fast: "быстр.", Slow: "осн.", S: "сек."}[gun.reloadType] ?? gun.reloadType}`.trim())}</dl>` : ""}
      </div>
      <div class="yze-weapon__footer"><div class="yze-weapon__traits" aria-label="Свойства">${features.map(feature => `<button type="button" data-weapon-property="${escape(feature.key)}" data-weapon-id="${escape(weapon.itemId)}">${escape(feature.label)}${feature.value ? ` <span>${escape(feature.value)}</span>` : ""}</button>`).join("")}${weapon.features.length > 2 ? `<button type="button" data-weapon-more="${escape(weapon.itemId)}" aria-expanded="${expanded.has(weapon.itemId)}">${expanded.has(weapon.itemId) ? "Скрыть" : `+${weapon.features.length - 2}`}</button>` : ""}</div>
      <div class="yze-weapon__commands" aria-label="Действия оружия">${weapon.attack ? `<button type="button" data-weapon-action="attack" data-weapon-id="${escape(weapon.itemId)}" ${blocked() || !actor.canAct ? "disabled" : ""}>Атака</button>` : ""}${weapon.reload ? `<button type="button" data-weapon-action="load" data-weapon-id="${escape(weapon.itemId)}" ${blocked() ? "disabled" : ""}>Зарядить</button>` : ""}${gun?.topOff ? `<button type="button" data-weapon-action="topOff" data-weapon-id="${escape(weapon.itemId)}" ${blocked() ? "disabled" : ""}>Дозарядить</button>` : ""}</div></div>
      ${active ? `<div class="yze-weapon__progress"><span>${active.mode}: ${active.current}/${active.target} ${RELOAD_UNITS[active.unit]}</span><progress max="${active.target}" value="${active.current}" aria-label="${active.mode}"></progress></div>` : ""}
    </article>`;
  }

  function costSelect() {
    if (!combat?.started) return '<span class="yze-weapon__outside">Вне боя · без траты</span>';
    return `<label>Стоимость<select data-weapon-cost><option value="">Выбрать…</option>${Object.entries(costLabels).map(([value, label]) => {
      const amount = draft.automatic ? paidReloadAmount(draft.unit, value) : null;
      const incompatible = drawer?.kind !== "attack" && value === "fast" && draft.unit === "slow";
      const reason = !canPay(value) ? " · потрачено" : incompatible ? " · не заменяет S" : amount === 0 ? " · не продвигает" : amount ? ` · +${amount} ${RELOAD_UNITS[draft.unit]}` : "";
      return `<option value="${value}" ${draft.cost === value ? "selected" : ""} ${!canPay(value) || incompatible || amount === 0 ? "disabled" : ""}>${label}${reason}</option>`;
    }).join("")}</select></label>`;
  }
  function reloadForm(weapon, action) {
    const {raw, requirement} = getReloadRequirement(weapon, action);
    const rule = draft.unit === "seconds" ? "Оба действия = 10 секунд. Отдельное F или S не даёт полного шага." : draft.unit === "fast" ? "Быстрое или основное = 1F; оба = 2F." : draft.unit === "slow" ? "Основное = 1S. Быстрое не заменяет основное." : "Укажите величину шага вручную.";
    const hint = draft.automatic || draft.unit === "steps" ? rule : `Ручной шаг для способности. Базовое правило: ${rule}`;
    const labels = {steps: "Ручные шаги", fast: "Быстрые (F)", slow: "Основные (S)", seconds: "Секунды"};
    return `<div class="yze-weapon__rule"><span>${requirement ? `По предмету: ${requirement.target} ${RELOAD_UNITS[requirement.unit]}` : raw ? `Формат «${escape(raw)}» не распознан; задайте вручную.` : "Длительность не задана; используйте ручной шаг."}</span><label>Учёт шага<select data-weapon-calculation><option value="auto" ${draft.automatic ? "selected" : ""} ${draft.unit === "steps" || !combat?.started ? "disabled" : ""}>По выбранным действиям</option><option value="manual" ${!draft.automatic ? "selected" : ""}>Вручную / способность</option></select></label><small>${hint}</small></div><div class="yze-weapon__numbers"><label>Прогресс<input type="number" data-weapon-input="current" min="0" max="999" step="1" value="${draft.current}"></label><label>Всего<input type="number" data-weapon-input="target" min="1" max="999" step="1" value="${draft.target}"></label><label>За операцию<input type="number" data-weapon-input="amount" min="0" max="999" step="1" value="${draft.amount}" ${draft.automatic ? "disabled" : ""}></label><label>Единицы<select data-weapon-unit>${Object.entries(labels).map(([value, label]) => `<option value="${value}" ${draft.unit === value ? "selected" : ""}>${label}</option>`).join("")}</select></label></div><div class="yze-weapon__manual"><button type="button" data-weapon-save-progress ${blocked() ? "disabled" : ""}>Сохранить прогресс вручную</button><span>Без расхода действий и боеприпасов</span></div><div class="yze-weapon__preview" aria-live="polite"></div>`;
  }
  function drawerHtml() {
    const weapon = item(drawer?.itemId);
    if (!weapon) return "";
    const action = drawer.kind;
    let content = "", label = "";
    if (action === "property") {
      const feature = weapon.features.find(feature => feature.key === drawer.key);
      if (!feature) return "";
      label = feature.label;
      content = `<p class="yze-weapon__description">${escape(feature.description || "Описание отсутствует. Полное правило можно посмотреть на листе предмета.")}</p>${feature.source === "fl-firearms" ? `<small>${feature.automated ? "Учитывается FL Firearms" : "Применяется вручную"}</small>` : ""}`;
    } else if (action === "inspect") {
      label = weapon.name;
      content = `<p>Хват: ${weapon.hand === "both" ? "обе руки" : weapon.hand === "left" ? "левая рука" : "правая рука"}${weapon.requiredGrip ? ` · Требуемый хват: ${escape(weapon.requiredGrip)}` : ""}</p><div class="yze-weapon__inspect-tools"><button type="button" data-weapon-open="${escape(weapon.itemId)}">Открыть предмет</button><button type="button" data-weapon-grip="${escape(weapon.itemId)}">Изменить хват</button></div>`;
    } else {
      label = `${action === "attack" ? "Атака" : action === "topOff" ? "Дозарядка" : "Зарядка"} · ${weapon.name}`;
      content = action === "attack" ? '<p>Параметры броска выбираются в штатном диалоге. Отмена окна не тратит действие.</p>' : reloadForm(weapon, action);
      content += `<div class="yze-weapon__payment">${costSelect()}<button type="button" data-weapon-execute>${action === "attack" ? "Открыть бросок" : "Выполнить шаг"}</button></div>`;
    }
    return `<div class="yze-weapon__drawer"><div class="yze-weapon__drawer-head"><strong>${escape(label)}</strong><button type="button" data-weapon-close aria-label="Закрыть подробности">×</button></div>${content}</div>`;
  }

  function recovery() {
    const operation = readWeaponOperation(actor);
    if (!operation || ["complete", "cancelled"].includes(operation.phase)) return "";
    const working = busy.has(actor.uuid) || operations.isBusy(actor.uuid) || attacks.isOpen(actor.uuid);
    const external = operation.phase === "external";
    return `<div class="yze-weapon__recovery" role="alert">${external ? "Ответ о зарядке не подтверждён. Проверьте магазин и ресурс патронов." : operation.kind === "prepareAttack" && working ? "Диалог атаки открыт. Стоимость учитывается при подтверждении броска." : "Операция оружия ожидает завершения."}<div>${external ? `<button type="button" data-weapon-recover="resolveDone" ${working ? "disabled" : ""}>Зарядка выполнена</button><button type="button" data-weapon-recover="resolveNotDone" ${working ? "disabled" : ""}>Не выполнена</button>` : `<button type="button" data-weapon-recover="cancel" ${working ? "disabled" : ""}>${operation.kind === "prepareAttack" && operation.phase === "rolling" ? "Подтвердить: броска не было" : "Отменить операцию"}</button>${operation.kind === "reload" && operation.phase === "pending" ? `<button type="button" data-weapon-recover="resume" ${working ? "disabled" : ""}>Продолжить</button>` : ""}`}</div></div>`;
  }

  function refreshForm() {
    if (!draft || !drawer || !["attack", "load", "topOff"].includes(drawer.kind)) return;
    if (draft.automatic) {
      draft.amount = paidReloadAmount(draft.unit, draft.cost);
      const input = element.querySelector('[data-weapon-input="amount"]');
      if (input) input.value = draft.cost ? draft.amount : "";
    }
    const numbers = [draft.current, draft.target, draft.amount];
    const aligned = !draft.automatic || draft.unit !== "seconds" || !(draft.current % 10 || draft.target % 10);
    const valid = drawer.kind === "attack" || aligned && numbers.every(Number.isSafeInteger) && draft.target >= 1 && draft.target <= 999 && draft.current >= 0 && draft.current <= draft.target && draft.amount >= 0 && draft.amount <= 999 && (draft.amount > 0 || !draft.automatic && draft.current === draft.target);
    const button = element.querySelector("[data-weapon-execute]");
    if (button) button.disabled = blocked() || !valid || drawer.kind !== "attack" && draft.unit === "slow" && draft.cost === "fast" || combat?.started && (!draft.cost || !canPay(draft.cost));
    const manual = element.querySelector("[data-weapon-save-progress]");
    if (manual) manual.disabled = blocked() || !Number.isSafeInteger(draft.current) || !Number.isSafeInteger(draft.target) || draft.target < 1 || draft.target > 999 || draft.current < 0 || draft.current > draft.target;
    const preview = element.querySelector(".yze-weapon__preview");
    if (preview) preview.textContent = valid ? `После шага: ${Math.min(draft.target, draft.current + draft.amount)}/${draft.target} ${RELOAD_UNITS[draft.unit]}${draft.current + draft.amount >= draft.target ? " · завершение зарядки" : ""}` : draft.automatic && !draft.amount ? "Выберите подходящую стоимость или ручной шаг для способности." : !aligned ? "Секундный шаг кратен 10; для способности выберите ручной режим." : "Проверьте числовые значения";
  }

  function render() {
    signature = "";
    const available = Boolean(actor && supportsWeaponControls() && presentation?.items.length);
    element.hidden = !available || collapsed && !(setting("weaponRibbonLayout") === "floating" && pinned);
    onPendingChange?.(hasPendingWeaponOperation(actor));
    if (!available) return;
    const focus = element.contains(document.activeElement) ? {...document.activeElement.dataset} : null;
    element.innerHTML = `<div class="yze-weapon__handle"><i class="fa-solid fa-grip-dots" aria-hidden="true"></i><span>Оружие · ${escape(actor.name)}</span><button type="button" data-weapon-pin aria-pressed="${pinned}" title="Оставлять оружие видимым при свёрнутом виджете" aria-label="Закрепить оружие при свёрнутом виджете">${pinned ? "Закреплено" : "Закрепить"}</button></div><div class="yze-weapon__body">${presentation.items.map(row).join("")}${drawerHtml()}${recovery()}${message ? `<p class="yze-weapon__message" role="alert">${escape(message)}</p>` : ""}</div>`;
    refreshForm(); layout(anchor, collapsed);
    if (focus) [...element.querySelectorAll("button, input, select")].find(candidate => Object.entries(focus).every(([key, value]) => candidate.dataset[key] === value))?.focus({preventScroll: true});
  }

  async function apply(payload) {
    const target = actor;
    busy.add(target.uuid); message = ""; render();
    try {
      await operations.request({actorUuid: target.uuid, id: foundry.utils.randomID(), ...payload});
      if (actor?.uuid === target.uuid) {drawer = null; draft = null;}
    } catch (error) { if (actor?.uuid === target.uuid) message = error.message; }
    finally {
      busy.delete(target.uuid);
      if (actor) presentation = getQuickAccessEquipmentApi()?.getHeldItemPresentation(actor) ?? null;
      render();
    }
  }
  function launchPayload(kind) {
    const weapon = item(drawer.itemId);
    return {kind, itemId: weapon.itemId, mode: drawer.kind, ...drawer.snapshot,
      cost: combat?.started ? draft.cost : "free", calculation: kind === "progress" || !draft.automatic ? "manual" : "auto", current: draft.current, target: draft.target, amount: draft.amount, unit: draft.unit};
  }

  element.addEventListener("input", event => {
    if (!draft || !event.target.matches("[data-weapon-input]")) return;
    draft[event.target.dataset.weaponInput] = event.target.value === "" ? NaN : Number(event.target.value); refreshForm();
  });
  element.addEventListener("change", event => {
    if (!draft) return;
    if (event.target.matches("[data-weapon-cost]")) draft.cost = event.target.value;
    if (event.target.matches("[data-weapon-unit]")) {draft.unit = event.target.value; draft.automatic = false; render(); return;}
    if (event.target.matches("[data-weapon-calculation]")) {draft.automatic = event.target.value === "auto"; render(); return;}
    refreshForm();
  });
  element.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button || button.disabled || !element.contains(button)) return;
    message = "";
    if (button.hasAttribute("data-weapon-grip")) {onGrip?.(button.dataset.weaponGrip); return;}
    if (button.hasAttribute("data-weapon-open")) {actor.items.get(button.dataset.weaponOpen)?.sheet?.render(true); return;}
    if (button.hasAttribute("data-weapon-pin")) {
      pinned = !pinned; game.settings.set(MODULE, "weaponRibbonPinned", pinned).catch(console.warn);
    } else if (button.hasAttribute("data-weapon-more")) {
      const id = button.dataset.weaponMore; expanded.has(id) ? expanded.delete(id) : expanded.add(id);
    } else if (button.hasAttribute("data-weapon-inspect")) {drawer = {kind: "inspect", itemId: button.dataset.weaponInspect}; draft = null;}
    else if (button.hasAttribute("data-weapon-property")) {drawer = {kind: "property", itemId: button.dataset.weaponId, key: button.dataset.weaponProperty}; draft = null;}
    else if (button.hasAttribute("data-weapon-close")) {drawer = null; draft = null;}
    else if (button.hasAttribute("data-weapon-action")) {
      drawer = {kind: button.dataset.weaponAction, itemId: button.dataset.weaponId};
      const weapon = item(drawer.itemId), progress = getReloadProgress(actor, weapon, drawer.kind);
      drawer.snapshot = {equipmentRevision: presentation.equipmentRevision, weaponRevision: weapon.revision, progressRevision: progress.revision, combat: epoch()};
      const {requirement} = getReloadRequirement(weapon, drawer.kind);
      const current = progress.finished ? 0 : progress.current;
      const automatic = drawer.kind !== "attack" && Boolean(combat?.started && progress.unit !== "steps" && (progress.calculation === "auto" || !progress.calculation && requirement && progress.unit === requirement.unit) && (progress.unit !== "seconds" || !(current % 10 || progress.target % 10)));
      draft = {cost: "", current, target: progress.target, amount: progress.amount ?? (progress.unit === "seconds" ? 10 : 1), unit: progress.unit, automatic};
    } else if (button.hasAttribute("data-weapon-save-progress")) {void apply(launchPayload("progress")); return;}
    else if (button.hasAttribute("data-weapon-recover")) {
      const operation = readWeaponOperation(actor);
      if (operation) void apply({kind: button.dataset.weaponRecover, id: operation.id, verifyNoRoll: operation.kind === "prepareAttack" && operation.phase === "rolling"});
      return;
    } else if (button.hasAttribute("data-weapon-execute")) {
      if (drawer.kind !== "attack") {void apply(launchPayload("reload")); return;}
      const target = actor, weapon = item(drawer.itemId);
      void attacks.launch({actorUuid: target.uuid, itemId: weapon.itemId, ...drawer.snapshot, cost: combat?.started ? draft.cost : "free"})
        .catch(error => {if (actor?.uuid === target.uuid) {message = error.message; render();}});
      drawer = null; draft = null;
    }
    render();
  });

  function layout(nextAnchor = anchor, nextCollapsed = collapsed) {
    anchor = nextAnchor; collapsed = nextCollapsed;
    if (!anchor || !actor || !presentation?.items.length) {element.hidden = true; return;}
    const mode = setting("weaponRibbonLayout") ?? "floating";
    element.hidden = anchor.hidden || collapsed && !(mode === "floating" && pinned);
    if (element.hidden) return;
    const margin = 8, box = anchor.getBoundingClientRect(), width = Math.min(620, window.innerWidth - margin * 2);
    element.style.width = `${Math.max(0, width)}px`;
    element.style.maxHeight = `${window.innerHeight - margin * 2}px`;
    let left = box.left, top = box.bottom + 8;
    if (mode === "side") {
      const right = window.innerWidth - box.right - margin - 8, leftRoom = box.left - margin - 8;
      if (Math.max(right, leftRoom) >= 340) {
        const useRight = right >= leftRoom, available = useRight ? right : leftRoom;
        element.style.width = `${Math.min(620, available)}px`;
        left = useRight ? box.right + 8 : box.left - 8 - Math.min(620, available); top = box.top;
      }
    } else if (mode === "floating") {
      const stored = setting("weaponRibbonPosition");
      if (Number.isFinite(stored?.left) && Number.isFinite(stored?.top)) {left = stored.left; top = stored.top;}
      else {
        const above = box.top - margin - 8, below = window.innerHeight - box.bottom - margin - 8;
        if (Math.max(above, below) >= 160) {
          const useAbove = above >= below;
          element.style.maxHeight = `${useAbove ? above : below}px`;
          top = useAbove ? box.top - element.getBoundingClientRect().height - 8 : box.bottom + 8;
        } else top = box.top - element.getBoundingClientRect().height - 8;
      }
    }
    const height = element.getBoundingClientRect().height;
    element.style.left = `${Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - element.getBoundingClientRect().width - margin))}px`;
    element.style.top = `${Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - height - margin))}px`;
  }

  let drag = null;
  element.addEventListener("pointerdown", event => {
    if (setting("weaponRibbonLayout") !== "floating" || event.button !== 0 || !event.target.closest(".yze-weapon__handle") || event.target.closest("button")) return;
    const rect = element.getBoundingClientRect();
    drag = {pointer: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top};
    element.setPointerCapture(event.pointerId); event.preventDefault();
  });
  element.addEventListener("pointermove", event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(window.innerWidth - rect.width - 8, drag.left + event.clientX - drag.x))}px`;
    element.style.top = `${Math.max(8, Math.min(window.innerHeight - rect.height - 8, drag.top + event.clientY - drag.y))}px`;
  });
  const finish = event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    drag = null;
    try {element.releasePointerCapture?.(event.pointerId);} catch (_error) { /* Browser may already have released capture. */ }
    const rect = element.getBoundingClientRect();
    game.settings.set(MODULE, "weaponRibbonPosition", {left: rect.left, top: rect.top}).catch(console.warn);
  };
  element.addEventListener("pointerup", finish); element.addEventListener("pointercancel", finish);

  function update(nextActor, nextCombat, nextAnchor, nextCollapsed) {
    if (actor?.uuid !== nextActor?.uuid) {drawer = null; draft = null; expanded.clear(); message = ""; signature = "";}
    actor = nextActor; combat = nextCombat; anchor = nextAnchor; collapsed = nextCollapsed;
    try {presentation = actor && supportsWeaponControls() ? getQuickAccessEquipmentApi().getHeldItemPresentation(actor) : null;}
    catch (error) {presentation = null; console.warn(`${MODULE} | Weapon presentation failed`, error);}
    if (draft && drawer?.snapshot && !busy.has(actor?.uuid) && !operations.isBusy(actor?.uuid) && !attacks.isOpen(actor?.uuid)) {
      const weapon = item(drawer.itemId);
      const fresh = weapon && {equipmentRevision: presentation.equipmentRevision, weaponRevision: weapon.revision,
        progressRevision: getReloadProgress(actor, weapon, drawer.kind).revision, combat: epoch()};
      if (JSON.stringify(fresh) !== JSON.stringify(drawer.snapshot)) {
        drawer = null; draft = null; message = "Оружие, прогресс или раунд изменились. Выберите действие заново.";
      }
    }
    const next = JSON.stringify([actor?.uuid, actor?.canAct, presentation, epoch(), readEquipmentOperation(actor), readWeaponOperation(actor), actor?.getFlag?.(MODULE, "weaponReload"), actor && [hasActionStatus(actor, "fastAction"), hasActionStatus(actor, "slowAction")], busy.has(actor?.uuid), attacks.isOpen(actor?.uuid)]);
    if (next !== signature) {render(); signature = next;} else layout();
    return Boolean(presentation?.items.length && supportsWeaponControls());
  }
  return {element, update, layout};
}
