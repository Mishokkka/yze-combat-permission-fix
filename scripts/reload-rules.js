/** Only unambiguous whole-field formats are recognized. No talent-name guesses. */
export const RELOAD_UNITS = {steps: "шаг.", seconds: "сек.", fast: "F", slow: "S"};
export function parseReloadRequirement(raw, type = null) {
  const text = String(raw ?? "").trim();
  const typed = {Fast: "fast", Slow: "slow", S: "seconds"}[type];
  const match = text.match(/^(\d+)\s*(F|S|сек\.?|секунд(?:а|ы)?|sec(?:onds)?\.?)?$/i);
  if (!match) return text === "" && ["fast", "slow"].includes(typed) ? {target: 1, unit: typed} : null;
  const suffix = match[2]?.toLowerCase();
  const unit = suffix ? suffix === "f" ? "fast" : suffix === "s" ? "slow" : "seconds" : typed;
  const target = Number(match[1]);
  if (!unit || typed && unit !== typed || !Number.isSafeInteger(target) || target < 1 || target > 999 || unit === "seconds" && target % 10) return null;
  return {target, unit};
}
export function getReloadRequirement(item, mode = "load") {
  if (!["load", "topOff"].includes(mode)) return {raw: "", requirement: null};
  const gun = item?.firearm;
  const raw = mode === "topOff" ? gun?.features?.find(feature => feature.key === "TopOff")?.value : gun?.reloadValue;
  const type = mode === "load" ? gun?.reloadType : null;
  const requirement = parseReloadRequirement(raw, type);
  return {raw: String(raw ?? "").trim(), requirement};
}
export function paidReloadAmount(unit, cost) {
  if (unit === "seconds") return cost === "both" ? 10 : 0;
  if (unit === "fast") return cost === "both" ? 2 : ["fast", "slow"].includes(cost) ? 1 : 0;
  if (unit === "slow") return ["slow", "both"].includes(cost) ? 1 : 0;
  return 0;
}
