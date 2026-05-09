import { test, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { setupSchema, createIsolatedFixture, createTestRequest, db, closePool } from "./_helpers.js";
import { onRequestActivated, runFinancialHousekeep } from "../server/financial.js";
import { partnerCommissions, claims } from "../server/schema.js";

after(async () => {
  await closePool();
});

test("two parallel housekeep runs only create one claim per partner", async () => {
  await setupSchema();
  const fx = await createIsolatedFixture({
    claimCycleType: "auto",
    claimCycleDays: 1,
    safetyPeriodDays: 14,
    partnerCommissionPct: "20",
  });
  try {
    // Create + activate one request, then move its commission to
    // eligible_for_claim by backdating safety_ends_at.
    const requestId = await createTestRequest(fx, { activated: true });
    await onRequestActivated({ requestId, userId: fx.userId });

    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db
      .update(partnerCommissions)
      .set({ safetyEndsAt: past })
      .where(eq(partnerCommissions.requestId, requestId));

    // Run two housekeep cycles in parallel — the advisory lock should
    // serialize them so only one creates the claim.
    const [a, b] = await Promise.all([runFinancialHousekeep(), runFinancialHousekeep()]);

    const total = a.claimsCreated + b.claimsCreated;
    assert.equal(total, 1, `expected exactly one claim across parallel runs, got ${total}`);

    const partnerClaims = await db.select().from(claims).where(eq(claims.partnerId, fx.partnerId));
    assert.equal(partnerClaims.length, 1, "expected exactly one claim row for the partner");
  } finally {
    await fx.cleanup();
  }
});
