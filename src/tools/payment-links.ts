import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { settings } from "../api/client.js";
import { createPaymentLink, getPaymentLink } from "../api/payment-links.js";
import { idempotencyKey, READ_ONLY, run, type ToolModule, WRITES } from "./shared.js";

export const registerPaymentLinkTools: ToolModule = (server) => {
	server.registerTool(
		"truelayer-create-payment-link",
		{
			title: "Create payment link",
			description: "Create a new payment link using TrueLayer API",
			inputSchema: {
				amount_in_minor: z.number().describe("Amount in minor currency units"),
				merchant_account_id: z.string().describe("Merchant account ID"),
				currency: z.string().describe("Currency code"),
				expires_in_hours: z.number().optional().describe("Payment link expiry time in hours"),
				user: z
					.object({
						name: z.string().describe("User's name"),
						email: z.string().describe("User's email address"),
						phone: z.string().describe("User's phone number"),
						date_of_birth: z.string().describe("User's date of birth (YYYY-MM-DD)"),
						address: z
							.object({
								address_line1: z.string().describe("Address line 1"),
								city: z.string().describe("City"),
								zip: z.string().describe("Postal/zip code"),
								state: z.string().describe("State/region"),
								country_code: z.string().describe("Country code (ISO)"),
							})
							.describe("User's address"),
					})
					.describe("User information"),
				idempotency_key: idempotencyKey,
			},
			annotations: WRITES,
		},
		({ amount_in_minor, merchant_account_id, currency, expires_in_hours, user, idempotency_key }) =>
			run("Payment link created successfully", "Failed to create payment link", () => {
				const expiryHours = expires_in_hours || settings.paymentLinkExpiryHours;
				const expiryTime = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

				return createPaymentLink(
					{
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
								},
							},
							user: {
								id: uuidv4(),
								name: user.name,
								email: user.email,
								phone: user.phone,
								date_of_birth: user.date_of_birth,
								address: user.address,
							},
						},
					},
					idempotency_key,
				);
			}),
	);

	server.registerTool(
		"truelayer-get-payment-link",
		{
			title: "Get payment link",
			description: "Retrieve payment link details from TrueLayer API",
			inputSchema: {
				paymentLinkId: z.string().describe("ID of the payment link to retrieve"),
			},
			annotations: READ_ONLY,
		},
		({ paymentLinkId }) =>
			run("Payment link details", "Failed to retrieve payment link", () => getPaymentLink(paymentLinkId)),
	);
};
