import { after, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { closePool, createIsolatedFixture, createTestRequest, db, setupSchema } from "./_helpers.js";
import { approveClaim, createClaim, createSettlement, onRequestActivated, rejectClaim } from "../server/financial.js";
import { claimItems, claims, financialItems, settlements } from "../server/schema.js";

after(async () => {
  await closePool();
});

test("unified financial item lifecycle: activation, claims, settlement, and void indicators", async () => {
  await setupSchema();
  const fx = await createIsolatedFixture({ salesCommissionEnabled: true, salesCommissionPct: "5", safetyPeriodDays: 0 });
  try {
    const requestId = await createTestRequest(fx, { activated: true });
    await onRequestActivated({ requestId, userId: fx.userId });

    const items = await db.select().from(financialItems).where(eq(financialItems.relatedRequestId, requestId));
    assert.equal(items.length, 3, "activation should create payment + partner + sales items");

    const partnerItem = items.find((i) => i.type === "partner_commission_item");
    const paymentItem = items.find((i) => i.type === "payment_item");
    assert.ok(partnerItem);
    assert.ok(paymentItem);
    assert.equal(partnerItem.isClaimable, true, "partner commission item should be claimable at creation");
    assert.ok(partnerItem.eligibleForClaimAt, "eligible timing should be persisted");

    const createdClaim = await createClaim({ type: "partner_commission_claim", partnerId: fx.partnerId, itemIds: [partnerItem.id], userId: fx.userId });
    const [draftClaim] = await db.select().from(claims).where(eq(claims.id, createdClaim.id));
    assert.equal(draftClaim.status, "draft");

    await approveClaim(createdClaim.id, fx.userId);
    const [approvedClaim] = await db.select().from(claims).where(eq(claims.id, createdClaim.id));
    assert.equal(approvedClaim.status, "approved");

    const st = await createSettlement({ claimId: createdClaim.id, userId: fx.userId });
    const [settlement] = await db.select().from(settlements).where(eq(settlements.id, st.id));
    assert.equal(settlement.type, "partner_commission_settlement");
    const [settledItem] = await db.select().from(financialItems).where(eq(financialItems.id, partnerItem.id));
    assert.equal(settledItem.status, "settled");

    const rejected = await createClaim({ type: "payment_claim", partnerId: fx.partnerId, itemIds: [paymentItem.id], userId: fx.userId });
    await rejectClaim(rejected.id, fx.userId, "test rejection");
    const [rejectedItem] = await db.select().from(financialItems).where(eq(financialItems.id, paymentItem.id));
    assert.equal(rejectedItem.status, "not_added_to_claim", "rejected claim should return item to claimable queue");

    await db.update(financialItems).set({ isVoided: true, voidReason: "manual adjustment" }).where(eq(financialItems.id, paymentItem.id));
    const [voided] = await db.select().from(financialItems).where(eq(financialItems.id, paymentItem.id));
    assert.equal(voided.isVoided, true, "void/adjustment indicator should be derivable from financial_items");

    const ci = await db.select().from(claimItems).where(and(eq(claimItems.claimId, createdClaim.id), eq(claimItems.financialItemId, partnerItem.id)));
    assert.equal(ci.length, 1, "claim items should point to financial_item_id");
  } finally {
    await fx.cleanup();
  }
});
