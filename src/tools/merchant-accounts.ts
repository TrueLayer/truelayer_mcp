import { z } from "zod";
import { getMerchantAccount, listMerchantAccounts, listTransactions } from "../api/merchant-accounts.js";
import { getConfig } from "../config.js";
import { READ_ONLY, run, type ToolModule } from "./shared.js";

export const registerMerchantAccountTools: ToolModule = (server) => {
	server.registerTool(
		"truelayer-get-merchant-account",
		{
			title: "Get merchant account",
			description:
				"Get a merchant account's details from TrueLayer: currency, account identifiers, account holder name and balances. Defaults to the merchant account configured for this server.",
			inputSchema: {
				merchant_account_id: z
					.string()
					.optional()
					.describe("Merchant account ID; defaults to the configured merchant account"),
			},
			annotations: READ_ONLY,
		},
		({ merchant_account_id }) =>
			run("Merchant account", "Failed to retrieve merchant account", async () => ({
				client_id: getConfig().clientId,
				...(await getMerchantAccount(merchant_account_id || getConfig().merchantAccountId)),
			})),
	);

	server.registerTool(
		"truelayer-list-merchant-accounts",
		{
			title: "List merchant accounts",
			description:
				"List all merchant accounts available to this TrueLayer client, with their currencies, identifiers and balances",
			annotations: READ_ONLY,
		},
		() => run("Merchant accounts", "Failed to list merchant accounts", () => listMerchantAccounts()),
	);

	server.registerTool(
		"truelayer-list-transactions",
		{
			title: "List merchant account transactions",
			description: "Get a list of transactions for a merchant account from TrueLayer",
			inputSchema: {
				from: z.string().optional().describe("Start date for transactions (YYYY-MM-DDTHH:MM:SS±HHMM)"),
				to: z.string().optional().describe("End date for transactions (YYYY-MM-DDTHH:MM:SS±HHMM)"),
				merchant_account_id: z.string().describe("Merchant account ID"),
				cursor: z.string().optional().describe("Cursor for pagination"),
			},
			annotations: READ_ONLY,
		},
		({ from, to, merchant_account_id, cursor }) =>
			run("Transactions", "Failed to list transactions", () => {
				// Default to the 30 days before `to` (or now)
				const toDate = to || new Date().toISOString();
				const fromDate =
					from ||
					(() => {
						const date = to ? new Date(to) : new Date();
						date.setDate(date.getDate() - 30);
						return date.toISOString();
					})();

				return listTransactions(fromDate, toDate, merchant_account_id, cursor);
			}),
	);
};
