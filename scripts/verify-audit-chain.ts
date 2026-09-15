#!/usr/bin/env tsx
/**
 * Audit Trail Cryptographic Hash-Chain Verification Script
 *
 * Walks the audit_events table in sequence, verifies the SHA-256 hash chaining
 * from genesis, and asserts that no historical row has been modified, deleted,
 * or spliced.
 *
 * Usage:
 *   npx tsx scripts/verify-audit-chain.ts [--tenant <tenantId>]
 */
import { AuditService } from "@cloudops/audit";
import { closeDatabase } from "@cloudops/database";

async function main() {
  const args = process.argv.slice(2);
  let tenantId: string | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--tenant" && i + 1 < args.length) {
      tenantId = args[++i];
    }
  }

  console.log(`[Audit Chain Verifier] Starting verification${tenantId ? ` for tenant: ${tenantId}` : " across all tenants"}...`);

  const auditService = new AuditService();
  try {
    const result = await auditService.verifyChain(tenantId);
    if (result.valid) {
      console.log(`[Audit Chain Verifier] SUCCESS: Cryptographic chain is intact!`);
      console.log(`[Audit Chain Verifier] Total rows verified: ${result.totalChecked}`);
      process.exit(0);
    } else {
      console.error(`[Audit Chain Verifier] FAILED: Hash-chain corruption detected!`);
      console.error(`[Audit Chain Verifier] Broken row: ${result.brokenRowId}`);
      console.error(`[Audit Chain Verifier] Reason: ${result.error}`);
      console.error(`[Audit Chain Verifier] Rows checked before failure: ${result.totalChecked}`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`[Audit Chain Verifier] Fatal error during verification: ${err.message}`);
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

main();
