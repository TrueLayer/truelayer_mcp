import * as tlSigning from "truelayer-signing";
import { v4 as uuidv4 } from 'uuid';
import { KID, PRIVATE_KEY_PEM, CLIENT_ID, CLIENT_SECRET, AUTH_URI, BASE_URI } from "./auth.js";

// Configuration with default values that can be overridden
export const config = {
	userAgent: 'truelayer-mcp/1.0.0',
	tokenScope: 'paydirect payments',
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

