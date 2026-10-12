import test from "node:test";
import assert from "node:assert/strict";
import {parseReloadRequirement, getReloadRequirement, paidReloadAmount} from "../scripts/reload-rules.js";

test("typed reload counts and TopOff notation distinguish F/S actions from seconds", () => {
  for (const [raw, type, target, unit] of [["2", "Fast", 2, "fast"], ["3", "Slow", 3, "slow"], ["30", "S", 30, "seconds"], ["2F", null, 2, "fast"], ["3 S", null, 3, "slow"], ["10 сек", null, 10, "seconds"], ["20 seconds", null, 20, "seconds"], ["", "Slow", 1, "slow"]]) {
    assert.deepEqual(parseReloadRequirement(raw, type), {target, unit});
  }
  assert.deepEqual(getReloadRequirement({firearm: {reloadType: "MAG", features: [{key: "TopOff", value: "2F"}]}}, "topOff").requirement, {target: 2, unit: "fast"});
  assert.equal(getReloadRequirement({firearm: {reloadType: "Slow", reloadValue: "3S"}}, "attack").requirement, null);
});
test("ambiguous, conflicting, partial, non-10-second and huge values fall back to manual", () => {
  for (const raw of ["2F+1S", "быстро", "10 секунд и ещё", "0F", "1000S", "5 сек", "", "12"]) assert.equal(parseReloadRequirement(raw), null);
  assert.equal(parseReloadRequirement("2F", "Slow"), null);
  assert.equal(parseReloadRequirement("10S", "S"), null); // S suffix means slow, typed S means seconds.
});
test("slow replaces fast; fast never replaces slow; a full pair advances ten seconds", () => {
  assert.deepEqual(["fast", "slow", "both", "free"].map(cost => paidReloadAmount("fast", cost)), [1, 1, 2, 0]);
  assert.deepEqual(["fast", "slow", "both", "free"].map(cost => paidReloadAmount("slow", cost)), [0, 1, 1, 0]);
  assert.deepEqual(["fast", "slow", "both", "free"].map(cost => paidReloadAmount("seconds", cost)), [0, 0, 10, 0]);
});
