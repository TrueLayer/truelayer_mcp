import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getPayment, createPayout, createPaymentLink, ListTransactions } from "./truelayer.js";
import { v4 as uuidv4 } from 'uuid';
import { CLIENT_ID, MERCHANT_ACCOUNT_ID } from "./auth.js";


// Create server instance
const server = new McpServer({
	name: "Truelayer MCP",
	version: "1.0.0",
	capabilities: {
		resources: {},
		tools: {},
	},
});


server.tool(
	"get-merchant-account",
	"Get merchant account details",
	{},
	async ({ }) => {
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify({
						merchant_account_id: MERCHANT_ACCOUNT_ID,
						client_id: CLIENT_ID
					})
				}
			],
		};
	}
)

server.tool(
	"get-truelayer-payment",
	"Get payment details from TrueLayer API",
	{
		paymentId: z.string().describe("Payment ID to retrieve"),
	},
	async ({ paymentId }) => {
		try {
			const payment = await getPayment(paymentId);

			return {
				content: [
					{
						type: "text",
						text: `Payment details: ${JSON.stringify(payment, null, 2)}`
					}
				]
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: "Failed to retrieve payment: " + error
					}
				]
			};
		}
	}
);

server.tool(
	"create-truelayer-payout",
	"Create a new payout using TrueLayer API",
	{
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
	async ({ currency, merchant_account_id, amount_in_minor, beneficiary }) => {
		try {
			const payoutRequest = {
				currency,
				amount_in_minor,
				merchant_account_id,
				beneficiary
			};

			const payout = await createPayout(payoutRequest);

			return {
				content: [
					{
						type: "text",
						text: `Payout created successfully: ${JSON.stringify(payout)}`
					}
				]
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: "Failed to create payout: " + error
					}
				]
			};
		}
	}
);


server.tool(
	"create-truelayer-payment-link",
	"Create a new payment link using TrueLayer API",
	{
		amount_in_minor: z.number().describe("Amount in minor currency units"),
		merchant_account_id: z.string().describe("Merchant account ID"),
	},
	async ({ amount_in_minor, merchant_account_id }) => {
		try {
			const paymentLinkRequest = {
				type: "single_payment",
				expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Expires in 24 hrs
				payment_configuration: {
					currency: "GBP",
					amount_in_minor,
					payment_method: {
						type: "bank_transfer",
						provider_selection: {
							type: "user_selected",
						},
						beneficiary: {
							type: "merchant_account",
							merchant_account_id: merchant_account_id,
						}
					},
					user: {
						id: uuidv4(),
						name: uuidv4(),
						email: "truelayer@truelayer.com",
						phone: "+447747405456",
						date_of_birth: "1997-01-20",
						address: {
							address_line1: "hardwick street",
							city: uuidv4(),
							zip: "E142GE",
							state: "london",
							country_code: "GB"
						}
					}
				},
			};

			const paymentLink = await createPaymentLink(paymentLinkRequest);

			return {
				content: [
					{
						type: "text",
						text: `Payment link created successfully: ${JSON.stringify(paymentLink, null, 2)}`
					}
				]
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: "Failed to create payment link: " + error
					}
				]
			};
		}
	}
);

server.tool(
	"list_transactions",
	"Get a list of transactions for a merchant account",
	{
		from: z.string().describe("Start date for transactions (YYYY-MM-DDTHH:MM:SS±HHMM)"),
		to: z.string().describe("End date for transactions (YYYY-MM-DDTHH:MM:SS±HHMM)"),
		merchant_account_id: z.string().describe("Merchant account ID"),
		cursor: z.string().optional().describe("Cursor for pagination"),
	},
	async ({ from, to, merchant_account_id, cursor }) => {
		try {
			let transactions = await ListTransactions(from, to, merchant_account_id, cursor);
			return {
				content: [
					{
						type: "text",
						text: `Transactions: ${JSON.stringify(transactions)}`,
					},
				],
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: "Failed to list transactions: " + error
					}
				]
			};
		}
	}
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