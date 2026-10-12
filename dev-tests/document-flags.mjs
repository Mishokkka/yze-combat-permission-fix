import {pathToFileURL} from "node:url";

// Optional native helpers come from the user's Foundry installation, never a
// copied proprietary source. The portable fallback models only flag semantics.
const native = process.env.FOUNDRY_HELPERS ? await import(pathToFileURL(process.env.FOUNDRY_HELPERS)) : null;
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value);
function merge(target, value) {
  for (const [key, entry] of Object.entries(value)) {
    if (plain(entry) && plain(target[key])) merge(target[key], entry);
    else target[key] = structuredClone(entry);
  }
}
export function applyFlagUpdate(flags, data, module) {
  if (native) {
    native.mergeObject({flags: {[module]: flags}}, data, {performDeletions: true});
    return;
  }
  for (const [path, value] of Object.entries(data)) {
    let key = path.split(".").at(-1);
    if (key.startsWith("-=")) {delete flags[key.slice(2)]; continue;}
    if (key.startsWith("==")) {flags[key.slice(2)] = structuredClone(value); continue;}
    if (plain(flags[key]) && plain(value)) merge(flags[key], value);
    else flags[key] = structuredClone(value);
  }
}
