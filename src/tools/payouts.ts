import { z } from "zod";
import { createPayout, getPayout } from "../api/payouts.js";
import { idempotencyKey, MOVES_MONEY, READ_ONLY, run, type ToolModule } from "./shared.js";

export const registerPayoutTools: ToolModule = (server) => {
	server.registerTool(
		"truelayer-get-payout",
		{
			title: "Get payout",
			description: "Get payout details from TrueLayer API",
			inputSchema: {
				payoutId: z.string().describe("Payout ID to retrieve"),
			},
			annotations: READ_ONLY,
		},
		({ payoutId }) => run("Payout details", "Failed to retrieve payout", () => getPayout(payoutId)),
	);

	server.registerTool(
		"truelayer-create-payout",
		{
			title: "Create payout",
			description: "Create a new payout using TrueLayer API. This sends money out of a merchant account.",
			inputSchema: {
				currency: z.string().describe("Currency code (e.g., GBP)"),
				amount_in_minor: z.number().describe("Amount in minor currency units"),
				merchant_account_id: z.string().describe("merchant account"),
				beneficiary: z.object({
					type: z.string().describe("Beneficiary type (e.g., external_account)"),
					account_holder_name: z.string().describe("account holder name"),
					account_identifier: z.object({
						type: z.string().describe("Account identifier type (e.g., sort_code_account_number)"),
						sort_code: z.string().optional().describe("Sort code"),
						account_number: z.string().optional().describe("Account number"),
						iban: z.string().optional().describe("IBAN"),
					}),
					reference: z.string().optional().describe("Payment reference"),
				}),
				idempotency_key: idempotencyKey,
			},
			annotations: MOVES_MONEY,
		},
		({ currency, merchant_account_id, amount_in_minor, beneficiary, idempotency_key }) =>
			run("Payout created successfully", "Failed to create payout", () =>
				createPayout({ currency, amount_in_minor, merchant_account_id, beneficiary }, idempotency_key),
			),
	);
};
