const SYSTEM_ID = "forbidden-lands";
const SYSTEM_VERSION = "13.0.5";
const ROLL_DIALOG_ID = "fbl-roll-dialog-plus";

function dialogSupport() {
  const module = game.modules.get(ROLL_DIALOG_ID);
  let enabled = false;
  try { enabled = Boolean(module?.active && game.settings.get(ROLL_DIALOG_ID, "enabled")); }
  catch (_error) { /* Optional module/settings may not be initialized yet. */ }
  return { active: Boolean(module?.active), enabled, version: module?.version ?? null };
}

function canUseItem(item, kind) {
  if (!item || item.isBroken) return false;
  try { if (item.getRollData?.().isBroken) return false; }
  catch (_error) { return false; }
  return kind === "attack" ? item.type === "weapon" :
    item.type === "weapon" || item.type === "armor" && item.system?.part === "shield";
}

/** Future widget buttons open the same native dialogs as the character sheet.
 * Roll Dialog Plus enhances these through its render hooks; no private imports,
 * replacement dice math, action payment, or forced submission belong here.
 */
export function createRollBridge({ getActor, getEquipmentState, isBusy = () => false }) {
  function context() {
    const actor = getActor();
    const supported = game.system?.id === SYSTEM_ID && game.system?.version === SYSTEM_VERSION;
    const available = Boolean(supported && actor?.type === "character" && actor.isOwner &&
      actor.canAct && !isBusy(actor) && typeof actor.sheet?.rollAction === "function");
    const equipment = available ? getEquipmentState() : null;
    return { actor, available, equipment: equipment?.actorUuid === actor?.uuid ? equipment : null };
  }
  function getState() {
    const { actor, available, equipment } = context();
    const ids = [...new Set(Object.values(equipment?.hands ?? {}).filter(Boolean))];
    const items = ids.map(id => actor.items.get(id)).filter(Boolean).map(item => ({
      itemId: item.id, name: item.name,
      attack: typeof actor.sheet?.rollGear === "function" && canUseItem(item, "attack"),
      parry: canUseItem(item, "parry"),
    }));
    return {
      actorUuid: actor?.uuid ?? null, equipmentRevision: equipment?.revision ?? null,
      available, dodge: available, items, rollDialogPlus: dialogSupport(),
    };
  }
  async function open({ kind, actorUuid, itemId, expectedRevision } = {}) {
    if (!["attack", "dodge", "parry"].includes(kind)) throw new Error("Неизвестный вид броска.");
    const { actor, available, equipment } = context();
    if (!available) throw new Error("Броски недоступны для текущего персонажа или версии системы.");
    // UUID is required: a token selection change must never roll another PC.
    if (actorUuid !== actor.uuid) throw new Error("Выбранный персонаж изменился.");
    if (expectedRevision !== undefined && expectedRevision !== equipment?.revision)
      throw new Error("Экипировка изменилась. Выберите предмет заново.");
    if (kind === "dodge") {
      if (itemId) throw new Error("Для уклонения предмет не требуется.");
      return actor.sheet.rollAction("dodge");
    }
    if (!equipment || !itemId || !Object.values(equipment.hands).includes(itemId))
      throw new Error("Предмет должен находиться в руках текущего персонажа.");
    const item = actor.items.get(itemId);
    if (!canUseItem(item, kind)) throw new Error("Этот предмет не подходит для выбранного броска.");
    if (kind === "parry") return actor.sheet.rollAction("parry", itemId);
    if (typeof actor.sheet.rollGear !== "function") throw new Error("Системный бросок оружия недоступен.");
    return actor.sheet.rollGear(itemId);
  }
  return Object.freeze({ apiVersion: 1, getState, open });
}
