/**
 * Optional demo: host-side ACTION attestation before a privileged TrueLayer MCP tool.
 *
 * This is not part of the TrueLayer MCP runtime. It shows one way a host can
 * gate create-payout / create-payment-link style calls with AffixIO before the
 * agent is allowed to spend. AffixIO is not required to use this project.
 *
 * Know Your Agent (KYA) here means agent capability / spend attestation.
 * It is not person KYC. PII stays on the host.
 *
 * Install separately if you want to run this file:
 *   npm i affixio
 *
 * Docs: https://github.com/AffixIO/SDK
 * npm:  https://www.npmjs.com/package/affixio
 *
 * Run:
 *   AFFIX_API_KEY=aio_demo node examples/optional-affixio-action-gate.mjs
 */

import { AffixSDK, mcpToolGate, spendingPolicy } from "affixio";

const sdk = new AffixSDK({
  apiKey: process.env.AFFIX_API_KEY || "aio_demo",
  licenceOnly: true,
  autoFlush: false,
});

// Example policy: GBP spend cap for payment-style MCP tools.
const policy = spendingPolicy()
  .currency("GBP")
  .maxPerAction(100)
  .allowCategories(["payments"]);

/**
 * Call this on the host before truelayer-create-payout or
 * truelayer-create-payment-link. On deny, do not call TrueLayer.
 */
export async function beforePrivilegedPaymentTool(input) {
  const amountMajor =
    typeof input.amount_in_minor === "number"
      ? input.amount_in_minor / 100
      : Number(input.amount) || 0;

  const gate = await mcpToolGate({
    sdk,
    policy,
    tool: input.tool || "truelayer-create-payout",
    agentId: input.agentId || "agent://truelayer-mcp/demo",
    amount: amountMajor,
    currency: input.currency || "GBP",
    category: "payments",
  });

  return {
    allowed: gate.allowed,
    reason: gate.reason,
    receipt: gate.receipt,
  };
}

const demo = await beforePrivilegedPaymentTool({
  tool: "truelayer-create-payout",
  amount_in_minor: 2500,
  currency: "GBP",
  agentId: "agent://truelayer-mcp/demo",
});

console.log(JSON.stringify(demo, null, 2));

sdk.dispose();
