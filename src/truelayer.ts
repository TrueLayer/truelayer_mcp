import * as tlSigning from "truelayer-signing";
import { v4 as uuidv4 } from 'uuid';
import * as auth from "./auth.js";
import { KID, PRIVATE_KEY_PEM, CLIENT_ID, CLIENT_SECRET, AUTH_URI, BASE_URI } from "./auth.js";

// Scopes requested for the access token. `paydirect` is needed for the payout
// tools; clients without Payouts enabled get `invalid_scope` unless they set
// TOKEN_SCOPE = "payments" in auth.ts. Read through the namespace so existing
// auth.ts files that don't define it keep working.
const DEFAULT_TOKEN_SCOPE = 'paydirect payments';
const tokenScope = (auth as { TOKEN_SCOPE?: string }).TOKEN_SCOPE?.trim() || DEFAULT_TOKEN_SCOPE;

// Configuration with default values that can be overridden
export const config = {
	userAgent: 'truelayer-mcp/1.0.0',
	tokenScope,
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

// Raised when TrueLayer answers with a non-2xx status. The message carries the
// status and the response body (usually a problem+json document), so the
// assistant sees why the call failed instead of an error body passed off as data.
export class TrueLayerApiError extends Error {
	constructor(
		readonly method: string,
		readonly path: string,
		readonly status: number,
		readonly body: string,
	) {
		super(`${method} ${path} failed with HTTP ${status}${body ? `: ${body}` : ""}`);
		this.name = "TrueLayerApiError";
	}
}

async function parseResponse(method: string, path: string, response: Response): Promise<any> {
	const text = await response.text();
	if (!response.ok) {
		throw new TrueLayerApiError(method, path, response.status, text);
	}
	return text ? JSON.parse(text) : {};
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

export async function generateAccessToken(): Promise<AccessResponse> {
	const path = "/connect/token";
	const formData = new URLSearchParams({
		client_id: CLIENT_ID,
		client_secret: CLIENT_SECRET,
		scope: config.tokenScope,
		grant_type: config.tokenGrantType
	}).toString();

	// Headers that will be included in the signature
	const headers = {
		'Content-Type': 'application/x-www-form-urlencoded',
		'User-Agent': config.userAgent
	};

	const signature = tlSigning.sign({
		kid: KID,
		privateKeyPem: PRIVATE_KEY_PEM,
		method: tlSigning.HttpMethod.Post,
		path,
		headers,
		body: formData,
	});

	const response = await fetch(AUTH_URI, {
		method: 'POST',
		headers: { ...headers, 'Tl-Signature': signature },
		body: formData
	});
	return parseResponse('POST', path, response);
}

async function apiGet(path: string): Promise<any> {
	const access_token = await getAccessToken();
	const response = await fetch(`${BASE_URI}${path}`, {
		method: 'GET',
		headers: {
			'Authorization': `Bearer ${access_token}`,
			'Accept': 'application/json; charset=UTF-8',
			'User-Agent': config.userAgent
		}
	});
	return parseResponse('GET', path, response);
}

// Signed POST with a fresh idempotency key, as required by the Payments v3 API.
async function apiSignedPost(path: string, body: unknown): Promise<any> {
	const access_token = await getAccessToken();
	const bodyStr = JSON.stringify(body);

	// Headers that will be included in the signature
	const headers = {
		'Authorization': `Bearer ${access_token}`,
		'Content-Type': 'application/json; charset=UTF-8',
		'Accept': 'application/json; charset=UTF-8',
		'Idempotency-Key': uuidv4(),
		'User-Agent': config.userAgent
	};

	const signature = tlSigning.sign({
		kid: KID,
		privateKeyPem: PRIVATE_KEY_PEM,
		method: tlSigning.HttpMethod.Post,
		path,
		headers,
		body: bodyStr,
	});

	const response = await fetch(`${BASE_URI}${path}`, {
		method: 'POST',
		headers: { ...headers, 'Tl-Signature': signature },
		body: bodyStr
	});
	return parseResponse('POST', path, response);
}

export async function getPayout(payoutId: string): Promise<any> {
	return apiGet(`/v3/payouts/${encodeURIComponent(payoutId)}`);
}

export async function getPayment(paymentId: string): Promise<any> {
	return apiGet(`/v3/payments/${encodeURIComponent(paymentId)}`);
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

export async function createPayout(payoutRequest: PayoutRequest): Promise<any> {
	return apiSignedPost("/v3/payouts", payoutRequest);
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

export async function createPaymentLink(paymentLinkRequest: PaymentLinkRequest): Promise<any> {
	return apiSignedPost("/v3/payment-links", paymentLinkRequest);
}

export async function getPaymentLink(paymentLinkId: string): Promise<any> {
	return apiGet(`/v3/payment-links/${encodeURIComponent(paymentLinkId)}`);
}

export async function listMerchantAccounts(): Promise<any> {
	return apiGet("/v3/merchant-accounts");
}

export async function getMerchantAccount(merchantAccountId: string): Promise<any> {
	return apiGet(`/v3/merchant-accounts/${encodeURIComponent(merchantAccountId)}`);
}

export async function listTransactions(
	from: string,
	to: string,
	merchant_account_id: string,
	cursor?: string
): Promise<any> {
	const params = new URLSearchParams({ from, to });
	if (cursor) {
		params.append('cursor', cursor);
	}
	return apiGet(`/v3/merchant-accounts/${encodeURIComponent(merchant_account_id)}/transactions?${params}`);
}
