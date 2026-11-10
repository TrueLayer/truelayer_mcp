import { z } from "zod";

// Input schemas for the Payments API v3 tools. Field names, enums, patterns and
// limits follow the API reference, so invalid input is rejected before it
// reaches TrueLayer.

export const countryCode = z.enum([
	"AT",
	"BE",
	"DE",
	"DK",
	"ES",
	"FI",
	"FR",
	"GB",
	"IE",
	"IT",
	"LT",
	"NL",
	"NO",
	"PL",
	"PT",
	"RO",
]);

export const releaseChannel = z
	.enum(["general_availability", "public_beta", "private_beta"])
	.describe(
		"Least stable release stage to include, along with every more stable one: public_beta also returns general_availability providers. Many EUR providers are in public_beta or private_beta.",
	);

export const customerSegment = z.enum(["retail", "business", "corporate"]);

const reference = (max: number) =>
	z
		.string()
		.max(max)
		.regex(/^[a-zA-Z0-9-:().,'+ ?/]+$/, "Allowed characters: letters, digits, space and - : ( ) . , ' + ? /");

const holderName = (max: number) =>
	z
		.string()
		.max(max)
		.regex(/^[^()]+$/, "Must not contain parentheses");

export const accountIdentifier = z
	.discriminatedUnion("type", [
		z.object({
			type: z.literal("sort_code_account_number"),
			sort_code: z.string().regex(/^[0-9]{6}$/, "6 digits, no spaces or dashes"),
			account_number: z.string().regex(/^[0-9]{8}$/, "8 digits"),
		}),
		z.object({
			type: z.literal("iban"),
			iban: z.string().regex(/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/, "IBAN without spaces"),
		}),
		z.object({ type: z.literal("bban"), bban: z.string().describe("BBAN without spaces") }),
		z.object({ type: z.literal("nrb"), nrb: z.string().describe("Polish NRB without spaces") }),
	])
	.describe("Account identifier");

const allowRemitterFee = z
	.boolean()
	.optional()
	.describe("Allow providers that may charge the payer a fee (default false: free schemes only)");

const schemeSelectionOptions = [
	z.object({
		type: z.literal("instant_only").describe("Only providers that support instant payments"),
		allow_remitter_fee: allowRemitterFee,
	}),
	z.object({
		type: z.literal("instant_preferred").describe("Prefer instant payments, fall back to non-instant"),
		allow_remitter_fee: allowRemitterFee,
	}),
	z.object({ type: z.literal("user_selected").describe("The payer chooses the scheme") }),
] as const;

export const providerFilter = z
	.object({
		countries: z.array(countryCode).optional().describe("Only providers from these countries"),
		release_channel: releaseChannel.optional(),
		customer_segments: z.array(customerSegment).optional().describe("Default: retail only"),
		provider_ids: z
			.array(z.string())
			.optional()
			.describe("Offer only these providers, e.g. mock-payments-gb-redirect; the other filters still apply"),
		excludes: z
			.object({ provider_ids: z.array(z.string()).optional() })
			.optional()
			.describe("Providers to exclude"),
	})
	.describe("Constrains which providers the payer can choose from");

export const providerSelection = z
	.discriminatedUnion("type", [
		z.object({
			type: z.literal("user_selected").describe("The payer chooses their bank"),
			filter: providerFilter.optional(),
			scheme_selection: z.discriminatedUnion("type", [...schemeSelectionOptions]).optional(),
			remitter: z
				.object({ account_holder_name: holderName(80) })
				.optional()
				.describe("The payer's account holder name, if the provider requires it"),
		}),
		z.object({
			type: z.literal("preselected").describe("You choose the bank (see truelayer-search-payments-providers)"),
			provider_id: z.string().describe("Provider ID, e.g. from truelayer-search-payments-providers"),
			scheme_selection: z
				.discriminatedUnion("type", [
					...schemeSelectionOptions,
					z.object({ type: z.literal("preselected"), scheme_id: z.string().describe("e.g. faster_payments_service") }),
				])
				.default({ type: "instant_preferred" })
				.describe("Payment scheme; defaults to instant_preferred"),
			branch_selection: z
				.discriminatedUnion("type", [
					z.object({ type: z.literal("preselected"), branch_id: z.string() }),
					z.object({ type: z.literal("user_selected") }),
				])
				.optional(),
			remitter: z
				.object({
					account_holder_name: holderName(80).optional(),
					account_identifier: accountIdentifier.optional(),
				})
				.optional()
				.describe("The payer's account, if known; required by some providers"),
			data_access_token: z
				.string()
				.max(10000)
				.optional()
				.describe("Data API token, for providers that allow only one active consent across data and payments"),
		}),
	])
	.describe("How the payer's bank is chosen; defaults to user_selected");

export const beneficiary = z
	.discriminatedUnion("type", [
		z.object({
			type: z.literal("merchant_account").describe("Pay into one of your merchant accounts"),
			merchant_account_id: z.string().optional().describe("Defaults to the configured merchant account"),
			account_holder_name: holderName(40).optional().describe("Name shown on the payer's statement"),
			reference: reference(100).optional().describe("Reference for the payment, not shown to the payer"),
			statement_reference: reference(18).optional().describe("Reference on the payer's statement, where supported"),
			verification: z
				.object({
					type: z.literal("automated"),
					remitter_name: z.boolean().optional(),
					remitter_date_of_birth: z.boolean().optional(),
				})
				.optional()
				.describe("Verify the payer's name and/or date of birth against their bank account"),
		}),
		z.object({
			type: z
				.literal("external_account")
				.describe("Pay into a bank account outside TrueLayer, such as your own business account"),
			account_holder_name: holderName(40),
			account_identifier: accountIdentifier,
			reference: reference(18),
		}),
	])
	.describe("Where the money goes; defaults to the configured merchant account");

export const address = z.object({
	address_line1: z.string().max(50),
	address_line2: z.string().max(50).optional(),
	city: z.string().max(50),
	state: z.string().max(50).optional(),
	zip: z.string().max(20),
	country_code: z.string().length(2).describe("ISO 3166-1 alpha-2"),
});

export const paymentUser = z
	.object({
		id: z.string().optional().describe("Your ID for the user; TrueLayer creates one if omitted"),
		name: z
			.string()
			.regex(/^[^()]+$/)
			.optional()
			.describe("Full first and last name; required unless you have your own PISP licence"),
		email: z.string().optional().describe("Email; email or phone is required unless you have your own PISP licence"),
		phone: z.string().optional().describe("Phone number including the country calling code"),
		date_of_birth: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
			.optional(),
		address: address.optional(),
		political_exposure: z.enum(["current", "none"]).optional(),
	})
	.describe("The payer");

export const metadata = z
	.record(z.string().max(40), z.string().max(500))
	.refine((m) => Object.keys(m).length <= 10, "At most 10 key-value pairs")
	.optional()
	.describe("Up to 10 custom key-value pairs (keys up to 40 characters, values up to 500)");

const aisScopes = z.array(z.enum(["accounts", "balance"]));

const providerSelectionCapability = z
	.object({
		icon: z
			.object({
				type: z.enum(["default", "extended", "extended_small", "extended_medium", "extended_large"]).optional(),
			})
			.optional(),
		branches: z.object({}).optional().describe("Include to support branch selection inside provider selection"),
	})
	.describe("Include if the UI can show a provider selection screen");

const formCapability = z
	.object({ input_types: z.array(z.enum(["text", "text_with_image", "select"])).min(1) })
	.describe("Include if the UI can render form inputs some providers require");

const consentCapability = z
	.object({
		action_type: z.enum(["explicit", "adjacent"]).optional(),
		requirements: z.object({ pis: z.object({}), ais: z.object({ scopes: aisScopes }).optional() }).optional(),
	})
	.describe("Include if the UI captures the payer's consent itself");

// Declares what the integrating UI can do during a payment's authorization
// flow. Empty objects mean "supported". There's no user_account_selection: the
// flow would then ask for an action the tools can't submit.
export const authorizationFlowCapabilities = {
	provider_selection: providerSelectionCapability.optional(),
	scheme_selection: z.object({}).optional().describe("Include ({}) if the UI can show a scheme selection screen"),
	branch_selection: z.object({}).optional().describe("Include ({}) if the UI can show a branch selection screen"),
	redirect: z
		.object({
			return_uri: z.url().describe("Where the bank sends the payer back; must be registered in Console"),
			direct_return_uri: z.url().optional().describe("Regulated clients only: direct return from UK providers"),
		})
		.optional()
		.describe("Include if the UI can redirect the payer to their bank"),
	form: formCapability.optional(),
	consent: consentCapability.optional(),
};

// The providers search takes a narrower configuration than the authorization
// flow: four capabilities, and redirect without return URIs.
export const searchFlowConfiguration = z
	.object({
		provider_selection: providerSelectionCapability.optional(),
		redirect: z.object({}).optional().describe("Include ({}) if the UI can redirect the payer to their bank"),
		form: formCapability.optional(),
		consent: consentCapability.optional(),
	})
	.describe(
		"Your UI's capabilities; only providers it can handle are returned. Defaults to redirect, provider selection and all form input types",
	);

export const hostedPage = z
	.object({
		return_uri: z.url().describe("Where the payer goes after the hosted page; must be registered in Console"),
		country_code: z
			.string()
			.regex(/^[A-Z]{2}$/)
			.optional()
			.describe("The payer's country (ISO 3166-1 alpha-2, e.g. GB), which decides the banks the page shows first"),
		language_code: z
			.string()
			.regex(/^[a-z]{2}$/)
			.optional()
			.describe("Overrides the browser language"),
		max_wait_for_result: z
			.number()
			.int()
			.min(0)
			.max(60)
			.optional()
			.describe("Seconds the hosted page waits for the payment's result after the payer authorises it"),
	})
	.describe("Return a hosted payment page link (hosted_page.uri) to send the payer to");

export const subMerchants = z
	.object({
		ultimate_counterparty: z.discriminatedUnion("type", [
			z.object({ type: z.literal("business_division"), id: z.string(), name: z.string() }),
			z.object({
				type: z.literal("business_client"),
				id: z.string(),
				trading_name: z.string().max(70),
				commercial_name: z.string().max(100).optional(),
				url: z.string().max(100).optional(),
				mcc: z
					.string()
					.regex(/^[0-9]{4}$/)
					.optional(),
				registration_number: z.string().max(35).optional().describe("Required if address is not provided"),
				address: address.optional(),
			}),
		]),
	})
	.describe("The sub-merchant the payment is ultimately for");

export const userConsent = z
	.discriminatedUnion("type", [
		z.object({ type: z.literal("precaptured"), captured_at: z.string().describe("When consent was captured (UTC)") }),
		z.object({ type: z.literal("authorization_flow_captured") }),
	])
	.describe("How the payer's consent is captured");

export const authorizationAction = z
	.discriminatedUnion("type", [
		z.object({
			type: z.literal("provider_selection"),
			provider_id: z.string(),
			branch_id: z.string().optional(),
		}),
		z.object({ type: z.literal("scheme_selection"), scheme_id: z.string() }),
		z.object({ type: z.literal("branch_selection"), branch_id: z.string() }),
		z.object({
			type: z.literal("form"),
			inputs: z.record(z.string(), z.string()).describe("Values keyed by the input IDs from the form action"),
			consent_captured: z
				.object({ ais_scopes: aisScopes.optional() })
				.optional()
				.describe("Report that consent was captured alongside the form (adjacent consent)"),
		}),
		z.object({
			type: z.literal("consent"),
			ais_scopes: aisScopes.optional().describe("Data scopes the payer also consented to, if any"),
		}),
	])
	.describe("The action to submit, matching the `next` action the flow returned");
