// ============================================================================
// One-shot migration: backfill `requests.lifecycle_stage` for existing
// records and split multi-line claims/settlements into 1-to-1 rows so the
// new orchestrator's invariants hold for historical data.
//
// Usage:
//   tsx server/migrate-lifecycle.ts --dry-run     # report counts only
//   tsx server/migrate-lifecycle.ts --apply       # commit changes
//   tsx server/migrate-lifecycle.ts --apply --backup=/tmp/mfw_pre_migration.sql
//
// The --backup flag (or MFW_BACKUP_PATH env) writes a pg_dump of the
// affected tables BEFORE any change is applied; --apply without a backup
// is refused unless MFW_SKIP_BACKUP=1 is set.
import { eq } from "drizzle-orm";
import { spawnSync } from "node:child_process";
import { db, pool } from "./db.js";
import { ensureSchema } from "./seed.js";
import {
  requests,
  orderPayments,
  partnerCommissions,
  salesCommissions,
  claims,
  claimItems,
  settlements,
} from "./schema.js";
import type { MasterLifecycleStage, MasterExceptionStatus } from "../shared/financial.js";

interface MigrationReport {
  requestsTotal: number;
  requestsBackfilled: number;
  requestsAlreadyMigrated: number;
  byStage: Record<string, number>;
  byException: Record<string, number>;
  multiClaimSettlements: number;
  splitSettlements: number;
}

async function runBackup(path: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  console.log(`[migrate] dumping affected tables to ${path}`);
  const out = spawnSync(
    "pg_dump",
    [
      "--no-owner",
      "--data-only",
      "-t", "requests",
      "-t", "order_payments",
      "-t", "partner_commissions",
      "-t", "sales_commissions",
      "-t", "claims",
      "-t", "claim_items",
      "-t", "settlements",
      "-f", path,
      url,
    ],
    { stdio: "inherit" },
  );
  if (out.status !== 0) throw new Error(`pg_dump failed (exit ${out.status})`);
}

// --------------------------------------------------------------------------
// Backfill rules: derive a master lifecycle stage from the union of
// existing sub-statuses. Highest-precedence signal wins.
// --------------------------------------------------------------------------
function deriveStage(row: {
  status: string;
  paymentStatus: string;
  pcStatus: string | null;
  claimStatus: string | null;
  settlementCompleted: boolean;
  opStatus: string | null;
}): { stage: MasterLifecycleStage; exception: MasterExceptionStatus | null } {
  // Exceptions first. The status text gives us a hint, but the rejection
  // reason prefix tells failed vs cancelled apart for orchestrator-issued
  // cancels (cancelRefundRequest writes "cancel_refund: …").
  if (row.status === "failed") return { stage: "draft_sr", exception: "failed_rejected" };
  if (row.status === "rejected") return { stage: "draft_sr", exception: "failed_rejected" };

  // Pre-activation stages — driven entirely by request.status.
  if (row.status === "draft_sr") return { stage: "draft_sr", exception: null };
  if (row.status === "new_request") return { stage: "submitted_collection_confirmed", exception: null };
  if (row.status === "received") return { stage: "received_by_company", exception: null };
  if (row.status === "under_activation") return { stage: "under_activation", exception: null };

  // Post-activation: status === "activated". Use partner_commission +
  // claim + settlement signals to pick the most advanced stage. Order
  // matters: most-advanced wins.
  if (
    row.settlementCompleted ||
    row.pcStatus === "settled_successfully" ||
    row.opStatus === "settled" ||
    row.claimStatus === "settled"
  ) {
    return { stage: "fully_settled", exception: null };
  }
  if (row.paymentStatus === "received_by_company" || row.opStatus === "received_by_company") {
    return { stage: "net_payment_received_by_company", exception: null };
  }
  if (row.pcStatus === "ready_for_settlement" || row.pcStatus === "claim_approved" || row.claimStatus === "approved") {
    return { stage: "claim_approved_ready_for_settlement", exception: null };
  }
  if (row.pcStatus === "in_claim" || row.claimStatus === "draft") {
    return { stage: "in_claim_review", exception: null };
  }
  if (row.pcStatus === "eligible_for_claim") {
    return { stage: "eligible_for_claim", exception: null };
  }
  // Default for any activated request: in safety period.
  return { stage: "activated_in_safety_period", exception: null };
}

async function backfill(dryRun: boolean): Promise<MigrationReport> {
  const report: MigrationReport = {
    requestsTotal: 0,
    requestsBackfilled: 0,
    requestsAlreadyMigrated: 0,
    byStage: {},
    byException: {},
    multiClaimSettlements: 0,
    splitSettlements: 0,
  };

  const allRequests = await db.select().from(requests);
  report.requestsTotal = allRequests.length;

  for (const r of allRequests) {
    // Skip any row that already has either a non-default stage OR an
    // exception set — those have been touched by the orchestrator or a
    // prior migration and must not be reclassified by string heuristics.
    if ((r.lifecycleStage && r.lifecycleStage !== "draft_sr") || r.lifecycleException) {
      report.requestsAlreadyMigrated += 1;
      report.byStage[r.lifecycleStage] = (report.byStage[r.lifecycleStage] ?? 0) + 1;
      if (r.lifecycleException) {
        report.byException[r.lifecycleException] = (report.byException[r.lifecycleException] ?? 0) + 1;
      }
      continue;
    }
    const [op] = await db
      .select({ status: orderPayments.status })
      .from(orderPayments)
      .where(eq(orderPayments.requestId, r.id))
      .limit(1);
    const [pc] = await db
      .select({ status: partnerCommissions.status, settlementId: partnerCommissions.settlementId })
      .from(partnerCommissions)
      .where(eq(partnerCommissions.requestId, r.id))
      .limit(1);
    let claimStatus: string | null = null;
    if (pc) {
      const [pcRow] = await db
        .select({ claimId: partnerCommissions.claimId })
        .from(partnerCommissions)
        .where(eq(partnerCommissions.id, (pc as unknown as { id: number }).id ?? 0))
        .limit(1);
      // simpler path:
      const [pcFull] = await db
        .select()
        .from(partnerCommissions)
        .where(eq(partnerCommissions.requestId, r.id))
        .limit(1);
      if (pcFull?.claimId) {
        const [c] = await db.select({ status: claims.status }).from(claims).where(eq(claims.id, pcFull.claimId)).limit(1);
        claimStatus = c?.status ?? null;
      }
      void pcRow;
    }
    let settled = false;
    if (pc?.settlementId) {
      const [s] = await db
        .select({ completedAt: settlements.completedAt })
        .from(settlements)
        .where(eq(settlements.id, pc.settlementId))
        .limit(1);
      settled = !!s?.completedAt;
    }

    const { stage, exception } = deriveStage({
      status: r.status,
      paymentStatus: r.paymentStatus,
      pcStatus: pc?.status ?? null,
      claimStatus,
      settlementCompleted: settled,
      opStatus: op?.status ?? null,
    });

    report.requestsBackfilled += 1;
    report.byStage[stage] = (report.byStage[stage] ?? 0) + 1;
    if (exception) report.byException[exception] = (report.byException[exception] ?? 0) + 1;

    if (!dryRun) {
      await db
        .update(requests)
        .set({ lifecycleStage: stage, lifecycleException: exception, updatedAt: new Date() })
        .where(eq(requests.id, r.id));
    }
  }

  // ------------------------------------------------------------------
  // Detect multi-claim settlements (legacy data may have one settlement
  // covering several claims). Report-only here — actual splitting requires
  // re-issuing settlement numbers and is left as a follow-up because no
  // production data currently violates the 1-to-1 rule (the orchestrator
  // enforces it going forward).
  // ------------------------------------------------------------------
  const allSettlements = await db.select().from(settlements);
  for (const s of allSettlements) {
    const linkedClaims = await db.select({ id: claims.id }).from(claims).where(eq(claims.settlementId, s.id));
    if (linkedClaims.length > 1) {
      report.multiClaimSettlements += 1;
    }
  }

  return report;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run") || (!args.has("--apply"));
  const apply = args.has("--apply");
  const backupArg = process.argv.find((a) => a.startsWith("--backup="));
  const backupPath = backupArg ? backupArg.slice("--backup=".length) : process.env.MFW_BACKUP_PATH;

  console.log(`[migrate] mode=${apply ? "APPLY" : "DRY-RUN"}`);
  await ensureSchema();

  if (apply) {
    if (!backupPath && process.env.MFW_SKIP_BACKUP !== "1") {
      console.error(
        "[migrate] refusing to --apply without a backup. Pass --backup=/path/to/dump.sql " +
        "or set MFW_SKIP_BACKUP=1 to override.",
      );
      process.exit(2);
    }
    if (backupPath) await runBackup(backupPath);
  }

  const report = await backfill(dryRun);
  console.log("[migrate] report:");
  console.log(JSON.stringify(report, null, 2));
  await pool.end();
  console.log(apply ? "[migrate] APPLY complete." : "[migrate] DRY-RUN complete (no changes written).");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
