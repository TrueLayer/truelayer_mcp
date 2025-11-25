import * as tlSigning from "truelayer-signing";
import { v4 as uuidv4 } from 'uuid';
import { KID, PRIVATE_KEY_PEM, CLIENT_ID, CLIENT_SECRET, AUTH_URI, BASE_URI } from "./auth.js";

// Configuration with default values that can be overridden
export const config = {
	userAgent: 'truelayer-mcp/1.0.0',
	tokenScope: 'payments recurring_payments:sweeping recurring_payments:commercial',
	tokenGrantType: 'client_credentials',
	tokenExpiryFallbackSeconds: 1800, // 30 minutes fallback if expires_in is not present
	tokenExpiryBufferMs: 60000, // 60 second buffer for token validity check
	paymentLinkExpiryHours: 24 // Payment links expire after 24 hours by default
};

type AccessResponse = {
	access_token: string;
	expires_in: number;
	token_type: string;
}

// Token cache to avoid unnecessary token requests
const tokenCache = {
	token: null as string | null,
	expiresAt: 0, // timestamp when the token expires
};

// Check if token is valid, with a buffer of 60 seconds to avoid edge cases
const isTokenValid = (): boolean => {
	return (
		tokenCache.token !== null &&
		tokenCache.expiresAt > Date.now() + config.tokenExpiryBufferMs
	);
};

// Get cached token or generate a new one if needed
export async function getAccessToken(): Promise<string> {
	if (isTokenValid()) {
		return tokenCache.token!;
	}

	const tokenResponse = await generateAccessToken();
	tokenCache.token = tokenResponse.access_token;

	// Calculate expiration time in milliseconds
	// Use the expires_in from the response or fallback to configured value
	const expiresIn = tokenResponse.expires_in || config.tokenExpiryFallbackSeconds;
	tokenCache.expiresAt = Date.now() + (expiresIn * 1000);

	return tokenCache.token;
}

// Make the request using native fetch
export async function generateAccessToken(): Promise<AccessResponse> {
	const requestData = {
		client_id: CLIENT_ID,
		client_secret: CLIENT_SECRET,
		scope: config.tokenScope,
		grant_type: config.tokenGrantType
	};

	// Convert to application/x-www-form-urlencoded format
	const formData = new URLSearchParams(requestData).toString();

	// Headers that will be included in the signature
	const headers = {
		'Content-Type': 'application/x-www-form-urlencoded',
		'User-Agent': config.userAgent
	};

	// Create the TrueLayer signature
	const signature = tlSigning.sign({
		kid: KID,
		privateKeyPem: PRIVATE_KEY_PEM,
		method: tlSigning.HttpMethod.Post,
		path: "/connect/token", // Path component of the URL
		headers,
		body: formData, // Body must be a string
	});

	// Prepare request options for fetch
	const requestOptions: RequestInit = {
		method: 'POST',
		headers: {
			...headers,
			'Tl-Signature': signature
		},
		body: formData
	};
	try {
		const response = await fetch(AUTH_URI, requestOptions);

		if (!response.ok) {
			throw new Error(`HTTP error! Status: ${response.status}`);
		}

		const data = await response.json();
		return data;
	} catch (error) {
		console.error("Request failed:", error);
		throw error;
	}
}

export async function getPayout(
	paymentId: string,
): Promise<any> {
	const access_token = await getAccessToken();

	const response = await fetch(`${BASE_URI}/v3/payouts/${paymentId}`, {
		method: 'GET',
		headers: {
			'Authorization': `Bearer ${access_token}`,
			'Accept': 'application/json; charset=UTF-8',
			'User-Agent': config.userAgent
		}
	});

	const data = await response.json();
	return data;
}

export async function getPayment(
	paymentId: string
): Promise<any> {
	const access_token = await getAccessToken();
	const path = `/v3/payments/${paymentId}`;

	const response = await fetch(`${BASE_URI}${path}`, {
		method: 'GET',
		headers: {
			'Authorization': `Bearer ${access_token}`,
			'Accept': 'application/json; charset=UTF-8',
			'User-Agent': config.userAgent
		}
	});

	const data = await response.json();
	return data;
}

export interface PayoutRequest {
	currency: string;
	merchant_account_id: string,
	amount_in_minor: number;
	beneficiary: {
		type: string;
		account_holder_name: string,
		account_identifier: {
			type: string;
			sort_code?: string;
			account_number?: string;
			iban?: string;
		};
		reference?: string;
	};
}

export async function createPayout(
	payoutRequest: PayoutRequest,
): Promise<any> {
	const access_token = await getAccessToken();
	const path = "/v3/payouts";

	// Convert body to string for signing
	const bodyStr = JSON.stringify(payoutRequest);
	const idempotencyKey = uuidv4();

	// Headers that will be included in the signature
	const headers = {
		'Authorization': `Bearer ${access_token}`,
		'Content-Type': 'application/json; charset=UTF-8',
		'Accept': 'application/json; charset=UTF-8',
		'Idempotency-Key': idempotencyKey,
		'User-Agent': config.userAgent
	};

	// Create the TrueLayer signature
	const signature = tlSigning.sign({
		kid: KID,
		privateKeyPem: PRIVATE_KEY_PEM,
		method: tlSigning.HttpMethod.Post,
		path: path,
		headers,
		body: bodyStr,
	});

	const response = await fetch(`${BASE_URI}${path}`, {
		method: 'POST',
		headers: {
			...headers,
			'Tl-Signature': signature
		},
		body: bodyStr
	});

	return await response.json();
}

export interface PaymentLinkRequest {
	type: string;
	expires_at: string,
	payment_configuration: {
		amount_in_minor: number;
		currency: string;
		payment_method: {
			type: string;
			provider_selection: {
				type: string;
			},
			beneficiary: {
				type: string;
				merchant_account_id: string;
			}
		}
		user: {
			id: string;
			name: string;
			email: string;
			phone: string;
			date_of_birth: string;
			address: {
				state: string;
				address_line1: string;
				city: string;
				zip: string;
				country_code: string;
			}
		}
	}
}

export async function createPaymentLink(
	paymentLinkRequest: PaymentLinkRequest
): Promise<any> {
	const access_token = await getAccessToken();
	const path = "/v3/payment-links";

	// Generate idempotency key
	const idempotencyKey = uuidv4();

	const headers = {
		'Authorization': `Bearer ${access_token}`,
		'Content-Type': 'application/json; charset=UTF-8',
		'Accept': 'application/json; charset=UTF-8',
		'Idempotency-Key': idempotencyKey,
		'User-Agent': config.userAgent
	};

	// Create the TrueLayer signature
	const bodyStr = JSON.stringify(paymentLinkRequest);
	const signature = tlSigning.sign({
		kid: KID,
		privateKeyPem: PRIVATE_KEY_PEM,
		method: tlSigning.HttpMethod.Post,
		path: path,
		headers,
		body: bodyStr,
	});

	const response = await fetch(`${BASE_URI}${path}`, {
		method: 'POST',
		headers: {
			...headers,
			'Tl-Signature': signature
		},
		body: bodyStr
	});

	// const data = await response.json();
	return await response.json();
}

export async function getPaymentLink(
	paymentLinkId: string
): Promise<any> {
	const access_token = await getAccessToken();
	const path = `/v3/payment-links/${paymentLinkId}`;

	const response = await fetch(`${BASE_URI}${path}`, {
		method: 'GET',
		headers: {
			'Authorization': `Bearer ${access_token}`,
			'Accept': 'application/json; charset=UTF-8',
			'User-Agent': config.userAgent
		}
	});

	const data = await response.json();
	return data;
}

export async function listTransactions(
	from: string,
	to: string,
	merchant_account_id: string,
	cursor?: string
): Promise<any> {
	const access_token = await getAccessToken();

	const params = new URLSearchParams();
	params.append('from', from);
	params.append('to', to);
	if (cursor) {
		params.append('cursor', cursor);
	}

	const queryString = params.toString();
	const url = `${BASE_URI}/v3/merchant-accounts/${merchant_account_id}/transactions?${queryString}`;

	const response = await fetch(url, {
		method: 'GET',
		headers: {
			'Authorization': `Bearer ${access_token}`,
			'Accept': 'application/json; charset=UTF-8',
			'User-Agent': config.userAgent
		},
	});
	const data = await response.json();
	console.error(data)
	return data;
}

// ============================================================================
// Mandate Types and Interfaces
// ============================================================================

// Account identifier types
export interface SortCodeAccountNumber {
	type: 'sort_code_account_number';
	sort_code: string;
	account_number: string;
}

export interface IbanIdentifier {
	type: 'iban';
	iban: string;
}

export type AccountIdentifier = SortCodeAccountNumber | IbanIdentifier;

// Provider Selection types
export interface ProviderFilter {
	countries?: string[];
	release_channel?: 'general_availability' | 'beta' | 'private_beta';
	customer_segments?: string[];
	provider_ids?: string[];
	excludes?: {
		provider_ids?: string[];
	};
}

export interface MandateProviderSelectionUserSelected {
	type: 'user_selected';
	filter?: ProviderFilter;
}

export interface MandateProviderSelectionPreselected {
	type: 'preselected';
	provider_id: string;
	scheme_id: string;
	remitter?: {
		account_holder_name: string;
		account_identifier: AccountIdentifier;
	};
}

export type MandateProviderSelection =
	| MandateProviderSelectionUserSelected
	| MandateProviderSelectionPreselected;

// Beneficiary/Destination types
export interface MandateDestinationMerchantAccount {
	type: 'merchant_account';
	merchant_account_id: string;
	account_holder_name?: string;
}

export interface MandateDestinationExternalAccount {
	type: 'external_account';
	account_holder_name: string;
	account_identifier: AccountIdentifier;
}

export type MandateBeneficiary =
	| MandateDestinationMerchantAccount
	| MandateDestinationExternalAccount;

// VRP Constraints types
export interface VRPPeriodicLimit {
	period_alignment: 'consent' | 'calendar';
	maximum_amount: number;
}

export interface VRPPeriodicLimits {
	day?: VRPPeriodicLimit;
	week?: VRPPeriodicLimit;
	fortnight?: VRPPeriodicLimit;
	month?: VRPPeriodicLimit;
	half_year?: VRPPeriodicLimit;
	year?: VRPPeriodicLimit;
}

export interface VRPConstraints {
	maximum_individual_amount: number;
	periodic_limits: VRPPeriodicLimits;
	valid_from?: string;
	valid_to?: string;
}

// Mandate type definitions
export interface MandateVRPSweeping {
	type: 'sweeping';
	provider_selection: MandateProviderSelection;
	beneficiary: MandateBeneficiary;
	reference?: string;
	statement_reference?: string;
}

export interface MandateVRPCommercial {
	type: 'commercial';
	provider_selection: MandateProviderSelection;
	beneficiary: MandateBeneficiary;
	reference?: string;
	statement_reference?: string;
}

export type Mandate = MandateVRPSweeping | MandateVRPCommercial;

// User types
export interface Address {
	address_line1: string;
	address_line2?: string;
	city: string;
	state: string;
	zip: string;
	country_code: string;
}

export interface MandateUser {
	id?: string;
	name?: string;
	email?: string;
	phone?: string;
	date_of_birth?: string;
	address?: Address;
}

// Metadata and related products
export interface Metadata {
	[key: string]: string;
}

export interface RelatedProducts {
	signup_plus?: {
		[key: string]: any;
	};
}

export interface SubMerchant {
	reference: string;
	name: string;
	[key: string]: any;
}

export interface SubMerchants {
	sub_merchant_id?: string;
	sub_merchants?: SubMerchant[];
}

// Main CreateMandateRequest interface
export interface CreateMandateRequest {
	mandate: Mandate;
	currency: string;
	user: MandateUser;
	constraints?: VRPConstraints;
	metadata?: Metadata;
	related_products?: RelatedProducts;
	sub_merchants?: SubMerchants;
}

// Response types
export interface MandateCreatedResponse {
	id: string;
	status: 'authorization_required' | 'authorizing';
	resource_token?: string;
	user: {
		id: string;
	};
}

// List Mandates Response types
export interface Pagination {
	cursor?: string;
	limit?: number;
}

export interface ListMandatesResponse {
	items: any[]; // Array of GetMandateWithUserDetails or GetDDMandate
	pagination: Pagination;
}

// ============================================================================
// Mandate API Functions
// ============================================================================

export async function listMandates(
	userId?: string,
	cursor?: string,
	limit?: number
): Promise<ListMandatesResponse> {
	const access_token = await getAccessToken();

	// Build query parameters
	const params = new URLSearchParams();
	if (userId) {
		params.append('user_id', userId);
	}
	if (cursor) {
		params.append('cursor', cursor);
	}
	if (limit) {
		params.append('limit', limit.toString());
	}

	const queryString = params.toString();
	const path = `/v3/mandates${queryString ? `?${queryString}` : ''}`;

	const response = await fetch(`${BASE_URI}${path}`, {
		method: 'GET',
		headers: {
			'Authorization': `Bearer ${access_token}`,
			'Accept': 'application/json; charset=UTF-8',
			'User-Agent': config.userAgent
		}
	});

	if (!response.ok) {
		const errorData = await response.json();
		throw new Error(`Failed to list mandates: ${JSON.stringify(errorData)}`);
	}

	return await response.json();
}

export async function createMandate(
	mandateRequest: CreateMandateRequest
): Promise<MandateCreatedResponse> {
	const access_token = await getAccessToken();
	const path = "/v3/mandates";

	// Convert body to string for signing
	const bodyStr = JSON.stringify(mandateRequest);
	const idempotencyKey = uuidv4();

	// Headers that will be included in the signature
	const headers = {
		'Authorization': `Bearer ${access_token}`,
		'Content-Type': 'application/json; charset=UTF-8',
		'Accept': 'application/json; charset=UTF-8',
		'Idempotency-Key': idempotencyKey,
		'User-Agent': config.userAgent
	};

	// Create the TrueLayer signature
	const signature = tlSigning.sign({
		kid: KID,
		privateKeyPem: PRIVATE_KEY_PEM,
		method: tlSigning.HttpMethod.Post,
		path: path,
		headers,
		body: bodyStr,
	});

	const response = await fetch(`${BASE_URI}${path}`, {
		method: 'POST',
		headers: {
			...headers,
			'Tl-Signature': signature
		},
		body: bodyStr
	});

	if (!response.ok) {
		const errorData = await response.json();
		throw new Error(`Failed to create mandate: ${JSON.stringify(errorData)}`);
	}

	return await response.json();
}

export async function getMandate(
	mandateId: string
): Promise<any> {
	const access_token = await getAccessToken();
	const path = `/v3/mandates/${mandateId}`;

	const response = await fetch(`${BASE_URI}${path}`, {
		method: 'GET',
		headers: {
			'Authorization': `Bearer ${access_token}`,
			'Accept': 'application/json; charset=UTF-8',
			'User-Agent': config.userAgent
		}
	});

	if (!response.ok) {
		const errorData = await response.json();
		throw new Error(`Failed to get mandate: ${JSON.stringify(errorData)}`);
	}

	return await response.json();
}

export async function revokeMandate(
	mandateId: string
): Promise<void> {
	const access_token = await getAccessToken();
	const path = `/v3/mandates/${mandateId}/revoke`;

	// Generate idempotency key
	const idempotencyKey = uuidv4();

	// Headers that will be included in the signature
	const headers = {
		'Authorization': `Bearer ${access_token}`,
		'Content-Type': 'application/json; charset=UTF-8',
		'Accept': 'application/json; charset=UTF-8',
		'Idempotency-Key': idempotencyKey,
		'User-Agent': config.userAgent
	};

	// Create the TrueLayer signature (empty body for POST with no request body)
	const signature = tlSigning.sign({
		kid: KID,
		privateKeyPem: PRIVATE_KEY_PEM,
		method: tlSigning.HttpMethod.Post,
		path: path,
		headers,
		body: '', // Empty body
	});

	const response = await fetch(`${BASE_URI}${path}`, {
		method: 'POST',
		headers: {
			...headers,
			'Tl-Signature': signature
		}
	});

	if (!response.ok) {
		// For 204 responses, there's no body to parse
		if (response.status !== 204) {
			const errorData = await response.json();
			throw new Error(`Failed to revoke mandate: ${JSON.stringify(errorData)}`);
		}
	}

	// No return value for 204 No Content
}

// ============================================================================
// Payment Types and Interfaces (for mandate-based payments)
// ============================================================================

// Retry configuration
export interface RetryStandard {
	type: 'standard';
}

export interface RetrySmart {
	type: 'smart';
}

export type Retry = RetryStandard | RetrySmart;

// Payment Method - Mandate
export interface PaymentMethodMandate {
	type: 'mandate';
	mandate_id: string;
	reference?: string;
	retry?: Retry;
}

// Payment Method - Bank Transfer (for completeness, though we focus on mandate)
export interface BankTransferProviderSelection {
	type: 'user_selected' | 'preselected';
	provider_id?: string;
	scheme_id?: string;
	filter?: ProviderFilter;
}

export interface BankTransferBeneficiary {
	type: 'merchant_account' | 'external_account';
	merchant_account_id?: string;
	account_holder_name?: string;
	account_identifier?: AccountIdentifier;
	reference?: string;
}

export interface PaymentMethodBankTransfer {
	type: 'bank_transfer';
	provider_selection: BankTransferProviderSelection;
	beneficiary: BankTransferBeneficiary;
}

export type PaymentMethod = PaymentMethodMandate | PaymentMethodBankTransfer;

// User for payments (simpler than mandate user)
export interface PaymentUser {
	id?: string;
	name?: string;
	email?: string;
	phone?: string;
	date_of_birth?: string;
	address?: Address;
	political_exposure?: 'current' | 'none';
}

// Risk assessment
export interface RiskAssessment {
	[key: string]: any;
}

// User consent
export interface UserConsentRequest {
	[key: string]: any;
}

// Main CreatePaymentRequest interface
export interface CreatePaymentRequest {
	amount_in_minor: number;
	currency: string;
	payment_method: PaymentMethod;
	user: PaymentUser;
	metadata?: Metadata;
	related_products?: RelatedProducts;
	sub_merchants?: SubMerchants;
	risk_assessment?: RiskAssessment;
	user_consent?: UserConsentRequest;
}

// Payment response types
export interface PaymentCreatedResponse {
	id: string;
	status: 'authorization_required' | 'authorizing' | 'authorized' | 'failed';
	user: {
		id: string;
	};
	resource_token: string;
	hosted_page?: {
		uri: string;
	};
}

// ============================================================================
// Payment API Functions
// ============================================================================

export async function createPayment(
	paymentRequest: CreatePaymentRequest
): Promise<PaymentCreatedResponse> {
	const access_token = await getAccessToken();
	const path = "/v3/payments";

	// Convert body to string for signing
	const bodyStr = JSON.stringify(paymentRequest);
	const idempotencyKey = uuidv4();

	// Headers that will be included in the signature
	const headers = {
		'Authorization': `Bearer ${access_token}`,
		'Content-Type': 'application/json; charset=UTF-8',
		'Accept': 'application/json; charset=UTF-8',
		'Idempotency-Key': idempotencyKey,
		'User-Agent': config.userAgent
	};

	// Create the TrueLayer signature
	const signature = tlSigning.sign({
		kid: KID,
		privateKeyPem: PRIVATE_KEY_PEM,
		method: tlSigning.HttpMethod.Post,
		path: path,
		headers,
		body: bodyStr,
	});

	const response = await fetch(`${BASE_URI}${path}`, {
		method: 'POST',
		headers: {
			...headers,
			'Tl-Signature': signature
		},
		body: bodyStr
	});

	if (!response.ok) {
		const errorData = await response.json();
		throw new Error(`Failed to create payment: ${JSON.stringify(errorData)}`);
	}

	return await response.json();
}

