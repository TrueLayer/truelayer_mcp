import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getPayout, getPayment, getPaymentLink, createPayout, createPaymentLink, listTransactions, createMandate, getMandate, listMandates, revokeMandate, createPayment } from "./truelayer.js";
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

// ============================================================================
// VRP Mandate Tools
// ============================================================================

server.tool(
	"truelayer-create-vrp-mandate",
	"Create a new VRP (Variable Recurring Payment) mandate for sweeping or commercial use cases",
	{
		mandate_type: z.enum(['sweeping', 'commercial']).describe("Type of VRP mandate: 'sweeping' for moving funds between own accounts, 'commercial' for business payments"),
		currency: z.string().describe("Currency code (e.g., GBP, EUR)"),

		// Provider selection
		provider_selection_type: z.enum(['user_selected', 'preselected']).describe("How the payment provider is selected"),
		provider_id: z.string().optional().describe("Provider ID (required if provider_selection_type is 'preselected')"),
		scheme_id: z.string().optional().describe("Scheme ID (required if provider_selection_type is 'preselected', e.g., 'faster_payments_service')"),
		provider_filter_countries: z.array(z.string()).optional().describe("Filter providers by country codes (e.g., ['GB', 'IE'])"),
		provider_filter_provider_ids: z.array(z.string()).optional().describe("Filter to specific provider IDs"),

		// Beneficiary/Destination
		beneficiary_type: z.enum(['merchant_account', 'external_account']).describe("Type of beneficiary"),
		merchant_account_id: z.string().optional().describe("TrueLayer merchant account ID (required if beneficiary_type is 'merchant_account')"),
		beneficiary_account_holder_name: z.string().optional().describe("Account holder name (required for external_account, optional for merchant_account)"),
		beneficiary_account_identifier_type: z.enum(['sort_code_account_number', 'iban']).optional().describe("Type of account identifier (required for external_account)"),
		beneficiary_sort_code: z.string().optional().describe("UK sort code (required for sort_code_account_number)"),
		beneficiary_account_number: z.string().optional().describe("UK account number (required for sort_code_account_number)"),
		beneficiary_iban: z.string().optional().describe("IBAN (required for iban type)"),

		// Statement reference
		statement_reference: z.string().optional().describe("Custom reference for the mandate (max 18 chars, alphanumeric with special chars: -:().,'+?/)"),

		// User details
		user_id: z.string().optional().describe("User ID (will be generated if not provided)"),
		user_name: z.string().optional().describe("Full name of the user"),
		user_email: z.string().optional().describe("Email address of the user"),
		user_phone: z.string().optional().describe("Phone number with country code (e.g., +447777777777)"),
		user_date_of_birth: z.string().optional().describe("Date of birth (YYYY-MM-DD)"),
		user_address_line1: z.string().optional().describe("Address line 1"),
		user_address_line2: z.string().optional().describe("Address line 2"),
		user_city: z.string().optional().describe("City"),
		user_state: z.string().optional().describe("State or region"),
		user_zip: z.string().optional().describe("Postal/ZIP code"),
		user_country_code: z.string().optional().describe("Country code (e.g., GB, US)"),

		// VRP Constraints
		maximum_individual_amount: z.number().describe("Maximum amount in minor units (pence/cents) for a single payment"),
		constraints_valid_from: z.string().optional().describe("Start date/time for mandate validity (ISO 8601 format)"),
		constraints_valid_to: z.string().optional().describe("End date/time for mandate validity (ISO 8601 format)"),

		// Periodic limits
		day_limit_amount: z.number().optional().describe("Maximum cumulative amount per day in minor units"),
		day_limit_alignment: z.enum(['consent', 'calendar']).optional().describe("Period alignment for daily limit"),
		week_limit_amount: z.number().optional().describe("Maximum cumulative amount per week in minor units"),
		week_limit_alignment: z.enum(['consent', 'calendar']).optional().describe("Period alignment for weekly limit"),
		fortnight_limit_amount: z.number().optional().describe("Maximum cumulative amount per fortnight in minor units (consent alignment only)"),
		month_limit_amount: z.number().optional().describe("Maximum cumulative amount per month in minor units"),
		month_limit_alignment: z.enum(['consent', 'calendar']).optional().describe("Period alignment for monthly limit"),
		half_year_limit_amount: z.number().optional().describe("Maximum cumulative amount per half year in minor units"),
		half_year_limit_alignment: z.enum(['consent', 'calendar']).optional().describe("Period alignment for half year limit"),
		year_limit_amount: z.number().optional().describe("Maximum cumulative amount per year in minor units"),
		year_limit_alignment: z.enum(['consent', 'calendar']).optional().describe("Period alignment for yearly limit"),

		// Metadata
		metadata: z.record(z.string()).optional().describe("Optional metadata as key-value pairs"),
	},
	async (params) => {
		try {
			// Build provider selection
			let provider_selection: any;
			if (params.provider_selection_type === 'user_selected') {
				provider_selection = {
					type: 'user_selected',
					...(params.provider_filter_countries || params.provider_filter_provider_ids ? {
						filter: {
							...(params.provider_filter_countries && { countries: params.provider_filter_countries }),
							...(params.provider_filter_provider_ids && { provider_ids: params.provider_filter_provider_ids }),
						}
					} : {})
				};
			} else {
				if (!params.provider_id || !params.scheme_id) {
					throw new Error("provider_id and scheme_id are required for preselected provider selection");
				}
				provider_selection = {
					type: 'preselected',
					provider_id: params.provider_id,
					scheme_id: params.scheme_id,
				};
			}

			// Build beneficiary
			let beneficiary: any;
			if (params.beneficiary_type === 'merchant_account') {
				if (!params.merchant_account_id) {
					throw new Error("merchant_account_id is required for merchant_account beneficiary type");
				}
				beneficiary = {
					type: 'merchant_account',
					merchant_account_id: params.merchant_account_id,
					...(params.beneficiary_account_holder_name && { account_holder_name: params.beneficiary_account_holder_name })
				};
			} else {
				if (!params.beneficiary_account_holder_name || !params.beneficiary_account_identifier_type) {
					throw new Error("beneficiary_account_holder_name and beneficiary_account_identifier_type are required for external_account");
				}

				let account_identifier: any;
				if (params.beneficiary_account_identifier_type === 'sort_code_account_number') {
					if (!params.beneficiary_sort_code || !params.beneficiary_account_number) {
						throw new Error("beneficiary_sort_code and beneficiary_account_number are required for sort_code_account_number type");
					}
					account_identifier = {
						type: 'sort_code_account_number',
						sort_code: params.beneficiary_sort_code,
						account_number: params.beneficiary_account_number,
					};
				} else {
					if (!params.beneficiary_iban) {
						throw new Error("beneficiary_iban is required for iban type");
					}
					account_identifier = {
						type: 'iban',
						iban: params.beneficiary_iban,
					};
				}

				beneficiary = {
					type: 'external_account',
					account_holder_name: params.beneficiary_account_holder_name,
					account_identifier,
				};
			}

			// Build mandate object
			const mandate: any = {
				type: params.mandate_type,
				provider_selection,
				beneficiary,
				...(params.statement_reference && { statement_reference: params.statement_reference })
			};

			// Build user object
			const user: any = {
				...(params.user_id && { id: params.user_id }),
				...(params.user_name && { name: params.user_name }),
				...(params.user_email && { email: params.user_email }),
				...(params.user_phone && { phone: params.user_phone }),
				...(params.user_date_of_birth && { date_of_birth: params.user_date_of_birth }),
				...(params.user_address_line1 && {
					address: {
						address_line1: params.user_address_line1,
						...(params.user_address_line2 && { address_line2: params.user_address_line2 }),
						city: params.user_city || '',
						state: params.user_state || '',
						zip: params.user_zip || '',
						country_code: params.user_country_code || '',
					}
				})
			};

			// Build constraints with periodic limits
			const periodic_limits: any = {};
			if (params.day_limit_amount && params.day_limit_alignment) {
				periodic_limits.day = {
					maximum_amount: params.day_limit_amount,
					period_alignment: params.day_limit_alignment,
				};
			}
			if (params.week_limit_amount && params.week_limit_alignment) {
				periodic_limits.week = {
					maximum_amount: params.week_limit_amount,
					period_alignment: params.week_limit_alignment,
				};
			}
			if (params.fortnight_limit_amount) {
				periodic_limits.fortnight = {
					maximum_amount: params.fortnight_limit_amount,
					period_alignment: 'consent', // fortnight only supports consent
				};
			}
			if (params.month_limit_amount && params.month_limit_alignment) {
				periodic_limits.month = {
					maximum_amount: params.month_limit_amount,
					period_alignment: params.month_limit_alignment,
				};
			}
			if (params.half_year_limit_amount && params.half_year_limit_alignment) {
				periodic_limits.half_year = {
					maximum_amount: params.half_year_limit_amount,
					period_alignment: params.half_year_limit_alignment,
				};
			}
			if (params.year_limit_amount && params.year_limit_alignment) {
				periodic_limits.year = {
					maximum_amount: params.year_limit_amount,
					period_alignment: params.year_limit_alignment,
				};
			}

			// At least one periodic limit is required
			if (Object.keys(periodic_limits).length === 0) {
				throw new Error("At least one periodic limit (day, week, month, year, etc.) is required");
			}

			const constraints = {
				maximum_individual_amount: params.maximum_individual_amount,
				periodic_limits,
				...(params.constraints_valid_from && { valid_from: params.constraints_valid_from }),
				...(params.constraints_valid_to && { valid_to: params.constraints_valid_to }),
			};

			// Build the complete request
			const mandateRequest: any = {
				mandate,
				currency: params.currency,
				user,
				constraints,
				...(params.metadata && { metadata: params.metadata })
			};

			// Create the mandate
			const result = await createMandate(mandateRequest);

			return {
				content: [
					{
						type: "text",
						text: `VRP Mandate created successfully:\n${JSON.stringify(result, null, 2)}\n\nMandate ID: ${result.id}\nStatus: ${result.status}\nUser ID: ${result.user.id}${result.resource_token ? `\nResource Token: ${result.resource_token}` : ''}\n\nNext steps:\n1. If status is 'authorization_required', use the resource_token to start the authorization flow via POST /v3/mandates/${result.id}/authorization-flow\n2. The PSU must authorize the mandate at their bank\n3. Once authorized, you can create payments against this mandate using POST /v3/payments with payment_method.type='mandate' and payment_method.mandate_id='${result.id}'`
					}
				]
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `Failed to create VRP mandate: ${error}`
					}
				]
			};
		}
	}
);

server.tool(
	"truelayer-get-vrp-mandate",
	"Get details of a VRP mandate",
	{
		mandateId: z.string().describe("ID of the mandate to retrieve"),
	},
	async ({ mandateId }) => {
		try {
			const mandate = await getMandate(mandateId);

			return {
				content: [
					{
						type: "text",
						text: `VRP Mandate details:\n${JSON.stringify(mandate, null, 2)}`
					}
				]
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `Failed to retrieve VRP mandate: ${error}`
					}
				]
			};
		}
	}
);

server.tool(
	"truelayer-list-vrp-mandates",
	"List all VRP mandates for the authenticated client, with optional filtering and pagination",
	{
		user_id: z.string().optional().describe("Optional user ID to filter mandates by specific user"),
		cursor: z.string().optional().describe("Optional pagination cursor from previous response"),
		limit: z.number().optional().describe("Optional limit for number of mandates to return (default determined by API)"),
	},
	async ({ user_id, cursor, limit }) => {
		try {
			const mandates = await listMandates(user_id, cursor, limit);

			// Format the response
			const totalMandates = mandates.items.length;
			const hasMore = mandates.pagination.cursor ? true : false;

			let responseText = `📋 Mandates List (${totalMandates} mandate${totalMandates !== 1 ? 's' : ''} returned)\n\n`;

			if (totalMandates === 0) {
				responseText += "No mandates found.\n";
			} else {
				mandates.items.forEach((mandate: any, index: number) => {
					responseText += `${index + 1}. Mandate ID: ${mandate.id}\n`;
					responseText += `   Type: ${mandate.mandate?.type || 'N/A'}\n`;
					responseText += `   Status: ${mandate.status}\n`;
					responseText += `   Currency: ${mandate.currency || 'N/A'}\n`;
					if (mandate.user?.id) {
						responseText += `   User ID: ${mandate.user.id}\n`;
					}
					responseText += `   Created: ${mandate.created_at || 'N/A'}\n`;
					responseText += '\n';
				});
			}

			// Add pagination info
			if (hasMore) {
				responseText += `\n🔄 More results available. Use cursor: "${mandates.pagination.cursor}" to fetch next page.\n`;
			}

			responseText += `\n📊 Full Response:\n${JSON.stringify(mandates, null, 2)}`;

			return {
				content: [
					{
						type: "text",
						text: responseText
					}
				]
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `Failed to list VRP mandates: ${error}`
					}
				]
			};
		}
	}
);

server.tool(
	"truelayer-revoke-vrp-mandate",
	"Revoke (cancel) a VRP mandate, preventing any future payments from being made against it",
	{
		mandateId: z.string().describe("ID of the mandate to revoke"),
	},
	async ({ mandateId }) => {
		try {
			await revokeMandate(mandateId);

			return {
				content: [
					{
						type: "text",
						text: `✅ Mandate revoked successfully!\n\n📋 Details:\n- Mandate ID: ${mandateId}\n- Status: The mandate has been revoked and can no longer be used for payments\n\n⚠️ Important Notes:\n- All future payments against this mandate will fail\n- The mandate cannot be reactivated once revoked\n- Any pending payments may still be processed\n- Users will need to create a new mandate if they want to resume payments\n\n💡 Next Steps:\n- Use "truelayer-get-vrp-mandate" with mandate ID "${mandateId}" to verify the revoked status\n- If needed, create a new mandate using "truelayer-create-vrp-mandate"`
					}
				]
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `❌ Failed to revoke mandate: ${error}\n\n💡 Common Issues:\n- Mandate ID not found (404)\n- Mandate already revoked or in invalid state (400)\n- Invalid mandate ID format\n- Insufficient permissions (403)\n\n🔍 Troubleshooting:\n1. Verify the mandate ID is correct\n2. Check the mandate status using "truelayer-get-vrp-mandate"\n3. Ensure the mandate is in a revocable state (authorized or authorization_required)\n4. Confirm you have permission to revoke this mandate`
					}
				]
			};
		}
	}
);

// ============================================================================
// Payment Tools (Mandate-based payments)
// ============================================================================

server.tool(
	"truelayer-create-payment-on-mandate",
	"Create a payment using a pre-authorized VRP mandate (no user interaction required)",
	{
		mandate_id: z.string().describe("ID of the authorized VRP mandate to use for this payment"),
		amount_in_minor: z.number().describe("Payment amount in minor currency units (pence/cents). Must comply with mandate constraints."),
		currency: z.string().describe("Currency code (e.g., GBP, EUR). Must match mandate currency."),

		// Optional fields
		payment_reference: z.string().optional().describe("Custom reference for reconciliation (max 18 chars, only for external_account mandates)"),
		user_id: z.string().optional().describe("User ID (typically the same as used in mandate creation)"),

		// Retry options (opt-in feature)
		enable_retry: z.boolean().optional().describe("Enable automatic retry for failed payments (requires feature to be enabled)"),
		retry_type: z.enum(['standard', 'smart']).optional().describe("Type of retry: 'standard' for provider errors, 'smart' for various criteria"),

		// Metadata
		metadata: z.record(z.string()).optional().describe("Optional metadata as key-value pairs"),
	},
	async (params) => {
		try {
			// Build payment method
			const payment_method: any = {
				type: 'mandate',
				mandate_id: params.mandate_id,
			};

			// Add optional reference
			if (params.payment_reference) {
				payment_method.reference = params.payment_reference;
			}

			// Add retry configuration if enabled
			if (params.enable_retry && params.retry_type) {
				payment_method.retry = {
					type: params.retry_type
				};
			}

			// Build user object (minimal for mandate payments)
			const user: any = {};
			if (params.user_id) {
				user.id = params.user_id;
			}

			// Build the payment request
			const paymentRequest: any = {
				amount_in_minor: params.amount_in_minor,
				currency: params.currency,
				payment_method,
				user,
				...(params.metadata && { metadata: params.metadata })
			};

			// Create the payment
			const result = await createPayment(paymentRequest);

			// Format amount for display
			const amountDisplay = (params.amount_in_minor / 100).toFixed(2);

			return {
				content: [
					{
						type: "text",
						text: `✅ Payment created successfully on mandate!\n\n${JSON.stringify(result, null, 2)}\n\n📋 Payment Details:\n- Payment ID: ${result.id}\n- Status: ${result.status}\n- Amount: ${params.currency} ${amountDisplay}\n- Mandate ID: ${params.mandate_id}\n- User ID: ${result.user.id}\n- Resource Token: ${result.resource_token}\n\n💡 Payment Status Meanings:\n- "authorized": Payment is approved and will be executed\n- "authorizing": Payment is being processed\n- "executed": Payment has been sent to the bank\n- "settled": Payment has been completed\n- "failed": Payment failed (check constraints or funds)\n\n🔍 Next Steps:\n- Use "truelayer-get-payment" with payment ID "${result.id}" to check status\n- The payment executes automatically without user interaction\n- Funds will move according to mandate beneficiary settings`
					}
				]
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `❌ Failed to create payment on mandate: ${error}\n\n💡 Common Issues:\n- Mandate not in "authorized" status\n- Payment amount exceeds mandate constraints\n- Periodic limits exceeded (daily/weekly/monthly)\n- Currency mismatch with mandate\n- Insufficient funds in remitter account\n- Invalid mandate ID\n\n🔍 Troubleshooting:\n1. Verify mandate is authorized: use "truelayer-get-vrp-mandate"\n2. Check payment amount is within maximum_individual_amount\n3. Verify periodic limits not exceeded\n4. Confirm currency matches mandate currency`
					}
				]
			};
		}
	}
);

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("Truelayer MCP server running on stdio");
}

main().catch((error) => {
	console.error("Fatal error in main():", error);
	process.exit(1);
});