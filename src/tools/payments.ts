import { z } from "zod";
import {
	type AuthorizationAction,
	cancelPayment,
	createPayment,
	createRefund,
	getPayment,
	getProvider,
	getRefund,
	listRefunds,
	searchProviders,
	startAuthorizationFlow,
	submitAuthorizationAction,
	submitProviderReturn,
} from "../api/payments.js";
import { getConfig } from "../config.js";
import {
	authorizationAction,
	authorizationFlowCapabilities,
	beneficiary,
	countryCode,
	customerSegment,
	hostedPage,
	metadata,
	paymentUser,
	providerSelection,
	releaseChannel,
	searchFlowConfiguration,
	subMerchants,
	userConsent,
} from "./payment-schemas.js";
import { idempotencyKey, MOVES_MONEY, READ_ONLY, run, type ToolModule, WRITES } from "./shared.js";

const paymentId = z.string().min(1).describe("Payment ID, as returned by truelayer-create-payment");

// Maps a submitted action to its endpoint and request body.
function actionRequest(action: z.infer<typeof authorizationAction>): { path: AuthorizationAction; body: unknown } {
	const pisConsent = (aisScopes?: string[]) => ({ pis: {}, ...(aisScopes ? { ais: { scopes: aisScopes } } : {}) });
	switch (action.type) {
		case "provider_selection":
			return { path: "provider-selection", body: { provider_id: action.provider_id, branch_id: action.branch_id } };
		case "scheme_selection":
			return { path: "scheme-selection", body: { scheme_id: action.scheme_id } };
		case "branch_selection":
			return { path: "branch-selection", body: { branch_id: action.branch_id } };
		case "form":
			return {
				path: "form",
				body: {
					inputs: action.inputs,
					...(action.consent_captured
						? { adjacent: { consent: { captured: pisConsent(action.consent_captured.ais_scopes) } } }
						: {}),
				},
			};
		case "consent":
			// Omitting `captured` means a standard payment consent.
			return { path: "consent", body: action.ais_scopes ? { captured: pisConsent(action.ais_scopes) } : {} };
	}
}

// Providers can carry dozens of schemes and requirements; by default the search
// returns what's needed to pick one.
function summarizeProvider(provider: Record<string, unknown>) {
	const capabilities = (provider.capabilities ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
	const bankTransfer = capabilities.payments?.bank_transfer as
		| { release_channel?: string; availability?: { recommended_status?: string }; schemes?: { id: string }[] }
		| undefined;
	return {
		id: provider.id,
		display_name: provider.display_name,
		country_code: provider.country_code,
		bank_transfer: bankTransfer && {
			release_channel: bankTransfer.release_channel,
			availability: bankTransfer.availability?.recommended_status,
			schemes: bankTransfer.schemes?.map((s) => s.id),
		},
		mandates: capabilities.mandates ? Object.keys(capabilities.mandates) : undefined,
	};
}

export const registerPaymentTools: ToolModule = (server) => {
	server.registerTool(
		"truelayer-create-payment",
		{
			title: "Create payment",
			description:
				"Create a single bank transfer payment (pay by bank). No money moves until the payer authorises the payment at their bank: send them to the hosted payment page (set hosted_page to get hosted_page.uri), or drive the flow with truelayer-start-payment-authorization. Without a beneficiary the money goes to the configured merchant account, which holds one currency: pass a merchant_account_id in the payment's currency if it differs. Returns the payment ID, status and resource_token.",
			inputSchema: {
				amount_in_minor: z.number().int().min(1).describe("Amount in minor units, e.g. 100 = £1.00"),
				currency: z.enum(["GBP", "EUR"]),
				beneficiary: beneficiary.optional(),
				provider_selection: providerSelection.optional(),
				user: paymentUser,
				metadata,
				retry: z.boolean().optional().describe("Enable payment retries (GBP only; must be enabled for your client)"),
				hosted_page: hostedPage.optional(),
				authorization_flow: z
					.object(authorizationFlowCapabilities)
					.optional()
					.describe(
						"Start the authorization flow straight away with these UI capabilities; can't be combined with hosted_page",
					),
				risk_assessment: z
					.object({ segment: z.string().regex(/^[^()]+$/) })
					.optional()
					.describe("Risk segment; contact TrueLayer before using"),
				sub_merchants: subMerchants.optional(),
				user_consent: userConsent.optional(),
				idempotency_key: idempotencyKey,
			},
			annotations: WRITES,
		},
		(input) =>
			run("Payment created", "Failed to create payment", async () => {
				if (input.hosted_page && input.authorization_flow) {
					throw new Error("hosted_page and authorization_flow can't be combined: use one of them");
				}
				const target = input.beneficiary ?? { type: "merchant_account" as const };
				return createPayment(
					{
						amount_in_minor: input.amount_in_minor,
						currency: input.currency,
						payment_method: {
							type: "bank_transfer",
							provider_selection: input.provider_selection ?? { type: "user_selected" },
							beneficiary:
								target.type === "merchant_account"
									? { ...target, merchant_account_id: target.merchant_account_id ?? getConfig().merchantAccountId }
									: target,
							...(input.retry ? { retry: {} } : {}),
						},
						user: input.user,
						metadata: input.metadata,
						hosted_page: input.hosted_page,
						authorization_flow: input.authorization_flow,
						risk_assessment: input.risk_assessment,
						sub_merchants: input.sub_merchants,
						user_consent: input.user_consent,
					},
					input.idempotency_key,
				);
			}),
	);

	server.registerTool(
		"truelayer-get-payment",
		{
			title: "Get payment",
			description: "Retrieve payment details from TrueLayer API",
			inputSchema: {
				payment_id: paymentId,
			},
			annotations: READ_ONLY,
		},
		({ payment_id }) => run("Payment details", "Failed to retrieve payment", () => getPayment(payment_id)),
	);

	server.registerTool(
		"truelayer-start-payment-authorization",
		{
			title: "Start payment authorization",
			description:
				"Start the authorization flow for a payment in status authorization_required, declaring what your UI can do (at minimum `redirect` with a return_uri registered in Console). The response's authorization_flow.actions.next says what to do next: provider_selection, scheme_selection, branch_selection, form or consent (answer with truelayer-submit-payment-action), redirect (send the payer to `uri`), or wait.",
			inputSchema: {
				payment_id: paymentId,
				...authorizationFlowCapabilities,
				idempotency_key: idempotencyKey,
			},
			annotations: WRITES,
		},
		({ payment_id, idempotency_key, ...capabilities }) =>
			run("Authorization flow", "Failed to start the authorization flow", () =>
				startAuthorizationFlow(payment_id, capabilities, idempotency_key),
			),
	);

	server.registerTool(
		"truelayer-submit-payment-action",
		{
			title: "Submit payment authorization action",
			description:
				"Answer the next action of a payment's authorization flow: provider_selection (the payer's bank), scheme_selection, branch_selection, form (values keyed by input ID) or consent. Returns the following action, until the flow reaches redirect or wait. With some banks a form carries the payer's credentials or one-time code, and submitting it authorises the payment.",
			inputSchema: {
				payment_id: paymentId,
				action: authorizationAction,
				idempotency_key: idempotencyKey,
			},
			annotations: MOVES_MONEY,
		},
		({ payment_id, action, idempotency_key }) =>
			run("Authorization flow", "Failed to submit the action", () => {
				const { path, body } = actionRequest(action);
				return submitAuthorizationAction(payment_id, path, body, idempotency_key);
			}),
	);

	server.registerTool(
		"truelayer-cancel-payment",
		{
			title: "Cancel payment",
			description:
				"Cancel a payment that hasn't been authorised yet. TrueLayer accepts the request asynchronously; check the outcome with truelayer-get-payment (the payment fails with failure_reason canceled).",
			inputSchema: {
				payment_id: paymentId,
				idempotency_key: idempotencyKey,
			},
			annotations: MOVES_MONEY,
		},
		({ payment_id, idempotency_key }) =>
			run("Cancellation", "Failed to cancel payment", async () => {
				await cancelPayment(payment_id, idempotency_key);
				return { payment_id, cancellation_requested: true };
			}),
	);

	server.registerTool(
		"truelayer-submit-payment-provider-return",
		{
			title: "Submit provider return parameters",
			description:
				"Regulated clients using a direct_return_uri only: submit the query and/or fragment the bank appended when returning the payer, so TrueLayer can complete the payment.",
			inputSchema: {
				query: z.string().optional().describe("Query string the payer returned with, e.g. ?code=…&state=…"),
				fragment: z.string().optional().describe("Fragment the payer returned with, e.g. #code=…&state=…"),
				idempotency_key: idempotencyKey,
			},
			annotations: MOVES_MONEY,
		},
		({ query, fragment, idempotency_key }) =>
			run("Provider return", "Failed to submit provider return parameters", async () => {
				if (!query && !fragment) throw new Error("Provide query, fragment or both");
				return submitProviderReturn({ query, fragment }, idempotency_key);
			}),
	);

	server.registerTool(
		"truelayer-create-refund",
		{
			title: "Refund payment",
			description:
				"Refund a settled payment that was made into a merchant account, in full or in part. The money goes back to the payer's account from the merchant account.",
			inputSchema: {
				payment_id: paymentId,
				amount_in_minor: z.number().int().min(1).optional().describe("Amount to refund; omit for a full refund"),
				reference: z.string().min(1).describe("Your reference for the refund, such as a return or order number"),
				metadata,
				idempotency_key: idempotencyKey,
			},
			annotations: MOVES_MONEY,
		},
		({ payment_id, amount_in_minor, reference, metadata, idempotency_key }) =>
			run("Refund created", "Failed to create refund", () =>
				createRefund(payment_id, { amount_in_minor, reference, metadata }, idempotency_key),
			),
	);

	server.registerTool(
		"truelayer-get-refunds",
		{
			title: "Get refunds",
			description: "List a payment's refunds with their status, or get one refund by ID.",
			inputSchema: {
				payment_id: paymentId,
				refund_id: z.string().min(1).optional().describe("Get only this refund"),
			},
			annotations: READ_ONLY,
		},
		({ payment_id, refund_id }) =>
			run(refund_id ? "Refund" : "Refunds", "Failed to retrieve refunds", () =>
				refund_id ? getRefund(payment_id, refund_id) : listRefunds(payment_id),
			),
	);

	server.registerTool(
		"truelayer-search-payments-providers",
		{
			title: "Search payments providers",
			description:
				"Find banks (providers) that can be used for payments, e.g. to preselect the payer's bank in truelayer-create-payment. Returns each provider's ID, name, country, availability and payment schemes; set detailed for the full API response.",
			inputSchema: {
				countries: z.array(countryCode).optional(),
				currencies: z.array(z.enum(["GBP", "EUR", "PLN"])).optional(),
				release_channel: releaseChannel.optional(),
				customer_segments: z.array(customerSegment).optional(),
				capability: z
					.enum(["bank_transfer", "vrp_sweeping", "vrp_commercial", "direct_debit"])
					.default("bank_transfer")
					.describe("What the provider must support; defaults to single payments (bank_transfer)"),
				authorization_flow: searchFlowConfiguration.optional(),
				detailed: z.boolean().optional().describe("Return the full provider objects"),
			},
			annotations: READ_ONLY,
		},
		({ capability, authorization_flow, detailed, ...filters }) =>
			run("Payments providers", "Failed to search payments providers", async () => {
				const capabilities =
					capability === "bank_transfer" ? { payments: { bank_transfer: {} } } : { mandates: { [capability]: {} } };
				const result = (await searchProviders({
					...filters,
					capabilities,
					authorization_flow: {
						configuration: authorization_flow ?? {
							provider_selection: {},
							redirect: {},
							form: { input_types: ["text", "text_with_image", "select"] },
						},
					},
				})) as { items?: Record<string, unknown>[] };
				if (detailed || !Array.isArray(result.items)) return result;
				return { count: result.items.length, items: result.items.map(summarizeProvider) };
			}),
	);

	server.registerTool(
		"truelayer-get-payments-provider",
		{
			title: "Get payments provider",
			description:
				"Get one payments provider's details and capabilities, including schemes and the capabilities available to this client.",
			inputSchema: {
				provider_id: z.string().min(1).describe("Provider ID, e.g. mock-payments-gb-redirect"),
				icon_type: z.enum(["default", "extended", "extended_small", "extended_medium", "extended_large"]).optional(),
			},
			annotations: READ_ONLY,
		},
		({ provider_id, icon_type }) =>
			run("Payments provider", "Failed to retrieve payments provider", () => getProvider(provider_id, icon_type)),
	);
};
