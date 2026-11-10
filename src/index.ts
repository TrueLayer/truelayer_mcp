import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { config, getPayout, getPayment, getPaymentLink, createPayout, createPaymentLink, listTransactions, getMerchantAccount, listMerchantAccounts } from "./truelayer.js";
import { v4 as uuidv4 } from 'uuid';
import { CLIENT_ID, MERCHANT_ACCOUNT_ID } from "./auth.js";


// Create server instance
const server = new McpServer(
	{
		name: "Truelayer MCP",
		version: "1.0.0",
	},
	{
		capabilities: {
			resources: {},
			tools: {},
		},
	},
);

// Runs a tool body and turns its result into tool output. Failures are reported
// with isError so the assistant can tell a failed call from a successful one.
async function run(label: string, failure: string, fn: () => Promise<unknown>): Promise<CallToolResult> {
	try {
		const result = await fn();
		return { content: [{ type: "text", text: `${label}: ${JSON.stringify(result, null, 2)}` }] };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { content: [{ type: "text", text: `${failure}: ${message}` }], isError: true };
	}
}


server.registerTool(
	"truelayer-get-merchant-account",
	{
		description: "Get a merchant account's details from TrueLayer: currency, account identifiers, account holder name and balances. Defaults to the merchant account configured for this server.",
		inputSchema: {
			merchant_account_id: z.string().optional().describe("Merchant account ID; defaults to the configured merchant account"),
		},
	},
	({ merchant_account_id }) =>
		run("Merchant account", "Failed to retrieve merchant account", async () => ({
			client_id: CLIENT_ID,
			...(await getMerchantAccount(merchant_account_id || MERCHANT_ACCOUNT_ID)),
		}))
)

server.registerTool(
	"truelayer-list-merchant-accounts",
	{
		description: "List all merchant accounts available to this TrueLayer client, with their currencies, identifiers and balances",
	},
	() => run("Merchant accounts", "Failed to list merchant accounts", () => listMerchantAccounts())
)

server.registerTool(
	"truelayer-get-payout",
	{
		description: "Get payout details from TrueLayer API",
		inputSchema: {
			payoutId: z.string().describe("Payout ID to retrieve"),
		},
	},
	({ payoutId }) => run("Payout details", "Failed to retrieve payout", () => getPayout(payoutId))
);

server.registerTool(
	"truelayer-create-payout",
	{
		description: "Create a new payout using TrueLayer API",
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
					iban: z.string().optional().describe("IBAN")
				}),
				reference: z.string().optional().describe("Payment reference")
			})
		},
	},
	({ currency, merchant_account_id, amount_in_minor, beneficiary }) =>
		run("Payout created successfully", "Failed to create payout", () =>
			createPayout({ currency, amount_in_minor, merchant_account_id, beneficiary }))
);


server.registerTool(
	"truelayer-create-payment-link",
	{
		description: "Create a new payment link using TrueLayer API",
		inputSchema: {
			amount_in_minor: z.number().describe("Amount in minor currency units"),
			merchant_account_id: z.string().describe("Merchant account ID"),
			currency: z.string().describe("Currency code"),
			expires_in_hours: z.number().optional().describe("Payment link expiry time in hours"),
			user: z.object({
				name: z.string().describe("User's name"),
				email: z.string().describe("User's email address"),
				phone: z.string().describe("User's phone number"),
				date_of_birth: z.string().describe("User's date of birth (YYYY-MM-DD)"),
				address: z.object({
					address_line1: z.string().describe("Address line 1"),
					city: z.string().describe("City"),
					zip: z.string().describe("Postal/zip code"),
					state: z.string().describe("State/region"),
					country_code: z.string().describe("Country code (ISO)")
				}).describe("User's address")
			}).describe("User information"),
		},
	},
	({ amount_in_minor, merchant_account_id, currency, expires_in_hours, user }) =>
		run("Payment link created successfully", "Failed to create payment link", () => {
			// Calculate expiry time using the config or override parameter
			const expiryHours = expires_in_hours || config.paymentLinkExpiryHours;
			const expiryTime = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

			return createPaymentLink({
				type: "single_payment",
				expires_at: expiryTime,
				payment_configuration: {
					currency,
					amount_in_minor,
					payment_method: {
						type: "bank_transfer",
						provider_selection: {
							type: "user_selected",
						},
						beneficiary: {
							type: "merchant_account",
							merchant_account_id,
						}
					},
					user: {
						id: uuidv4(),
						name: user.name,
						email: user.email,
						phone: user.phone,
						date_of_birth: user.date_of_birth,
						address: user.address
					}
				},
			});
		})
);

server.registerTool(
	"truelayer-get-payment-link",
	{
		description: "Retrieve payment link details from TrueLayer API",
		inputSchema: {
			paymentLinkId: z.string().describe("ID of the payment link to retrieve"),
		},
	},
	({ paymentLinkId }) => run("Payment link details", "Failed to retrieve payment link", () => getPaymentLink(paymentLinkId))
);

server.registerTool(
	"truelayer-get-payment",
	{
		description: "Retrieve payment details from TrueLayer API",
		inputSchema: {
			paymentId: z.string().describe("ID of the payment to retrieve"),
		},
	},
	({ paymentId }) => run("Payment details", "Failed to retrieve payment", () => getPayment(paymentId))
);

server.registerTool(
	"truelayer-list-transactions",
	{
		description: "Get a list of transactions for a merchant account from TrueLayer",
		inputSchema: {
			from: z.string().optional().describe("Start date for transactions (YYYY-MM-DDTHH:MM:SS±HHMM)"),
			to: z.string().optional().describe("End date for transactions (YYYY-MM-DDTHH:MM:SS±HHMM)"),
			merchant_account_id: z.string().describe("Merchant account ID"),
			cursor: z.string().optional().describe("Cursor for pagination"),
		},
	},
	({ from, to, merchant_account_id, cursor }) =>
		run("Transactions", "Failed to list transactions", () => {
			// Set default dates if not provided
			const toDate = to || new Date().toISOString();

			// Calculate from date (30 days before to date)
			const fromDate = from || (() => {
				const date = to ? new Date(to) : new Date();
				date.setDate(date.getDate() - 30);
				return date.toISOString();
			})();

			return listTransactions(fromDate, toDate, merchant_account_id, cursor);
		})
)

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("Truelayer MCP server running on stdio");
}

main().catch((error) => {
	console.error("Fatal error in main():", error);
	process.exit(1);
});
