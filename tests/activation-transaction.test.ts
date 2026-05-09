import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { setupSchema, createIsolatedFixture, createTestRequest, db, closePool } from "./_helpers.js";
import { onRequestActivated } from "../server/financial.js";
import { requests, orderPayments, partnerCommissions } from "../server/schema.js";

after(async () => {
  await closePool();
});

// This test exercises the atomicity guarantee added by wrapping the request
// activation flow + financial bootstrap in a single db.transaction. We
// simulate a mid-flow failure by clearing the request's packageId before
// onRequestActivated runs — that helper throws `request_missing_package`
// which must roll the entire transaction back, leaving the request
// unactivated and no order_payment / partner_commission rows behind.
test("activation transaction rolls back the status flip when financial bootstrap fails", async () => {
  await setupSchema();
  const fx = await createIsolatedFixture({ partnerCommissionPct: "20" });
  try {
    const requestId = await createTestRequest(fx, { activated: false });

    // Sanity: request starts unactivated.
    const [before] = await db.select().from(requests).where(eq(requests.id, requestId));
    assert.equal(before.status, "new_request");
    assert.equal(before.activatedAt, null);

    // Force a failure mid-flow by removing the package association inside
    // the same transaction, after we've already flipped the status. The
    // helper will then throw, which must roll the whole tx back.
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx
          .update(requests)
          .set({ status: "activated", activatedAt: new Date(), packageId: null })
          .where(eq(requests.id, requestId));
        await onRequestActivated({ requestId, userId: fx.userId }, tx);
      }),
      /request_missing_package/,
    );

    // Request must be untouched: no status flip persisted, no finance rows.
    const [after] = await db.select().from(requests).where(eq(requests.id, requestId));
    assert.equal(after.status, "new_request", "status must remain unactivated after rollback");
    assert.equal(after.activatedAt, null, "activatedAt must remain null after rollback");
    assert.equal(after.packageId, fx.packageId, "packageId must remain unchanged after rollback");

    const ops = await db.select().from(orderPayments).where(eq(orderPayments.requestId, requestId));
    const pcs = await db.select().from(partnerCommissions).where(eq(partnerCommissions.requestId, requestId));
    assert.equal(ops.length, 0, "no order_payment rows should be created when tx rolls back");
    assert.equal(pcs.length, 0, "no partner_commission rows should be created when tx rolls back");
  } finally {
    await fx.cleanup();
  }
});

// Companion happy-path test: when nothing throws, the same transactional
// pattern commits both the status flip and all financial rows together.
test("activation transaction commits status flip and financial rows together", async () => {
  await setupSchema();
  const fx = await createIsolatedFixture({ partnerCommissionPct: "20" });
  try {
    const requestId = await createTestRequest(fx, { activated: false });

    await db.transaction(async (tx) => {
      await tx
        .update(requests)
        .set({ status: "activated", activatedAt: new Date() })
        .where(eq(requests.id, requestId));
      await onRequestActivated({ requestId, userId: fx.userId }, tx);
    });

    const [r] = await db.select().from(requests).where(eq(requests.id, requestId));
    assert.equal(r.status, "activated");
    assert.notEqual(r.activatedAt, null);

    const ops = await db.select().from(orderPayments).where(eq(orderPayments.requestId, requestId));
    const pcs = await db.select().from(partnerCommissions).where(eq(partnerCommissions.requestId, requestId));
    assert.equal(ops.length, 1);
    assert.equal(pcs.length, 1);
  } finally {
    await fx.cleanup();
  }
});
