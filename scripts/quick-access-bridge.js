const QUICK_ACCESS_ID = "fbl-quick-access";

/** Optional contract: never read/write another module's private flags or imports. */
export function getQuickAccessEquipmentApi() {
  const module = game.modules.get(QUICK_ACCESS_ID);
  const api = module?.active ? module.api : null;
  return api?.capabilities?.equipment && api.equipmentApiVersion === 1 &&
    typeof api.getEquipmentState === "function" && typeof api.performEquipmentAction === "function"
    ? api : null;
}

/** Bind commands to the widget's current Actor, resolved afresh for every call. */
export function createQuickAccessBridge(getActor, canModify, onError = console.warn) {
  return Object.freeze({
    apiVersion: 1,
    get available() { return Boolean(getQuickAccessEquipmentApi()); },
    getState() {
      const api = getQuickAccessEquipmentApi();
      const actor = getActor();
      if (!api || !actor) return null;
      try { return api.getEquipmentState(actor); }
      catch (error) {
        onError("Could not read Quick Access equipment", error);
        return null;
      }
    },
    async performAction(action, options) {
      const api = getQuickAccessEquipmentApi();
      const actor = getActor();
      if (!api) throw new Error("A compatible Quick Access equipment API is unavailable.");
      if (!actor || !canModify(actor)) throw new Error("No owned combatant selected.");
      return api.performEquipmentAction(actor, action, options);
    }
  });
}
