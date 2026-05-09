import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { setupSchema, createIsolatedFixture, createTestRequest, db, closePool } from "./_helpers.js";
import { onRequestActivated } from "../server/financial.js";
import { orderPayments, partnerCommissions, salesCommissions } from "../server/schema.js";

after(async () => {
  await closePool();
});

test("onRequestActivated is idempotent: calling twice creates one row of each type", async () => {
  await setupSchema();
  const fx = await createIsolatedFixture({
    salesCommissionEnabled: false,
    partnerCommissionPct: "20",
  });
  try {
    const requestId = await createTestRequest(fx, { activated: true });

    const r1 = await onRequestActivated({ requestId, userId: fx.userId });
    const r2 = await onRequestActivated({ requestId, userId: fx.userId });

    // Returned ids must be stable across calls.
    assert.equal(r1.orderPaymentId, r2.orderPaymentId);
    assert.equal(r1.partnerCommissionId, r2.partnerCommissionId);

    const ops = await db.select().from(orderPayments).where(eq(orderPayments.requestId, requestId));
    const pcs = await db.select().from(partnerCommissions).where(eq(partnerCommissions.requestId, requestId));
    assert.equal(ops.length, 1, "expected exactly one order_payment row per request");
    assert.equal(pcs.length, 1, "expected exactly one partner_commission row per request");

    // Math sanity: 1000 base * 20% = 200 partner commission. Net due = 1140 - 200 = 940.
    assert.equal(Number(pcs[0].baseAmount), 1000);
    assert.equal(Number(pcs[0].pct), 20);
    assert.equal(Number(pcs[0].amount), 200);
    assert.equal(Number(ops[0].grossAmount), 1140);
    assert.equal(Number(ops[0].partnerCommissionAmount), 200);
    assert.equal(Number(ops[0].netDueToCompany), 940);
  } finally {
    await fx.cleanup();
  }
});

test("onRequestActivated with sales commission enabled creates one sales_commission row, idempotent", async () => {
  await setupSchema();
  const fx = await createIsolatedFixture({
    salesCommissionEnabled: true,
    salesCommissionPct: "5",
    partnerCommissionPct: "20",
  });
  try {
    // We need a request with a sales user — reuse the fixture user as sales rep.
    const requestId = await createTestRequest(fx, { activated: true });
    // Patch sales user.
    const { requests } = await import("../server/schema.js");
    await db.update(requests).set({ salesUserId: fx.userId }).where(eq(requests.id, requestId));

    await onRequestActivated({ requestId, userId: fx.userId });
    await onRequestActivated({ requestId, userId: fx.userId });

    const scs = await db.select().from(salesCommissions).where(eq(salesCommissions.requestId, requestId));
    assert.equal(scs.length, 1, "expected exactly one sales_commission row per request");
    // 1000 base * 5% = 50.
    assert.equal(Number(scs[0].amount), 50);
  } finally {
    await fx.cleanup();
  }
});
