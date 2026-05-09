import { test } from "node:test";
import assert from "node:assert/strict";
import { commissionBase, calcCommission } from "../shared/financial.js";

test("commissionBase returns before-tax amount when base is before_tax", () => {
  assert.equal(commissionBase(1000, 1140, "before_tax"), 1000);
});

test("commissionBase returns after-tax amount when base is after_tax", () => {
  assert.equal(commissionBase(1000, 1140, "after_tax"), 1140);
});

test("commissionBase handles zero tax", () => {
  assert.equal(commissionBase(500, 500, "before_tax"), 500);
  assert.equal(commissionBase(500, 500, "after_tax"), 500);
});

test("calcCommission computes percentage of base, rounded to 2 decimals", () => {
  assert.equal(calcCommission(1000, 20), 200);
  assert.equal(calcCommission(1140, 20), 228);
  assert.equal(calcCommission(1000, 5), 50);
  assert.equal(calcCommission(0, 20), 0);
  assert.equal(calcCommission(1000, 0), 0);
});

test("calcCommission rounds half-cent values to nearest cent", () => {
  // 333.33 * 7.5% = 24.99975 → 25.00
  assert.equal(calcCommission(333.33, 7.5), 25);
  // 100 * 3.333% = 3.333 → 3.33
  assert.equal(calcCommission(100, 3.333), 3.33);
});

test("before-tax vs after-tax base produces different commission amounts", () => {
  const before = commissionBase(1000, 1140, "before_tax");
  const after = commissionBase(1000, 1140, "after_tax");
  const pct = 20;
  assert.equal(calcCommission(before, pct), 200);
  assert.equal(calcCommission(after, pct), 228);
  assert.notEqual(calcCommission(before, pct), calcCommission(after, pct));
});
