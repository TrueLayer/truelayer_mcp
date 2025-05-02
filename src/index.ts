import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getPayout, getPayment, getPaymentLink, createPayout, createPaymentLink, listTransactions } from "./truelayer.js";
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
	"truelayer-get-merchant-account",
	"Get merchant account details from TrueLayer",
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
	"truelayer-get-payout",
	"Get payout details from TrueLayer API",
	{
		payoutId: z.string().describe("Payout ID to retrieve"),
	},
	async ({ payoutId }) => {
		try {
			const payout = await getPayout(payoutId);

			return {
				content: [
					{
						type: "text",
						text: `Payout details: ${JSON.stringify(payout, null, 2)}`
					}
				]
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: "Failed to retrieve payout: " + error
					}
				]
			};
		}
	}
);

server.tool(
	"truelayer-create-payout",
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
	"truelayer-create-payment-link",
	"Create a new payment link using TrueLayer API",
	{
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
	async ({ amount_in_minor, merchant_account_id, currency, expires_in_hours, user }) => {
		try {
			// Import the config
			const { config } = await import("./truelayer.js");

			// Calculate expiry time using the config or override parameter
			const expiryHours = expires_in_hours || config.paymentLinkExpiryHours;
			const expiryTime = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

			const paymentLinkRequest = {
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
	"truelayer-get-payment-link",
	"Retrieve payment link details from TrueLayer API",
	{
		paymentLinkId: z.string().describe("ID of the payment link to retrieve"),
	},
	async ({ paymentLinkId }) => {
		try {
			const paymentLink = await getPaymentLink(paymentLinkId);

			return {
				content: [
					{
						type: "text",
						text: `Payment link details: ${JSON.stringify(paymentLink, null, 2)}`
					}
				]
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: "Failed to retrieve payment link: " + error
					}
				]
			};
		}
	}
);

server.tool(
	"truelayer-get-payment",
	"Retrieve payment details from TrueLayer API",
	{
		paymentId: z.string().describe("ID of the payment to retrieve"),
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
	"truelayer-list-transactions",
	"Get a list of transactions for a merchant account from TrueLayer",
	{
		from: z.string().optional().describe("Start date for transactions (YYYY-MM-DDTHH:MM:SS±HHMM)"),
		to: z.string().optional().describe("End date for transactions (YYYY-MM-DDTHH:MM:SS±HHMM)"),
		merchant_account_id: z.string().describe("Merchant account ID"),
		cursor: z.string().optional().describe("Cursor for pagination"),
	},
	async ({ from, to, merchant_account_id, cursor }) => {
		try {
			// Set default dates if not provided
			const toDate = to || new Date().toISOString();

			// Calculate from date (30 days before to date)
			const fromDate = from || (() => {
				const date = to ? new Date(to) : new Date();
				date.setDate(date.getDate() - 30);
				return date.toISOString();
			})();

			let transactions = await listTransactions(fromDate, toDate, merchant_account_id, cursor);
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