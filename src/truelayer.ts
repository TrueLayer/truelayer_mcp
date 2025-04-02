import * as tlSigning from "truelayer-signing";
import { v4 as uuidv4 } from 'uuid';
import { KID, PRIVATE_KEY_PEM, CLIENT_ID, CLIENT_SECRET, AUTH_URI, BASE_URI } from "./auth.js";
type AccessResponse = {
	access_token: string;
	token_type: string;
	expires_in: number;
	scope: string;
}

// Make the request using native fetch
export async function generateAccessToken(): Promise<AccessResponse> {
	const requestData = {
		client_id: CLIENT_ID,
		client_secret: CLIENT_SECRET,
		scope: 'paydirect payments',
		grant_type: 'client_credentials'
	};

	// Convert to application/x-www-form-urlencoded format
	const formData = new URLSearchParams(requestData).toString();

	// Headers that will be included in the signature
	const headers = {
		'Content-Type': 'application/x-www-form-urlencoded'
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


export async function getPayment(
	paymentId: string,
	accessToken: string,
): Promise<any> {
	const response = await fetch(`${BASE_URI}/v3/payouts/${paymentId}`, {
		method: 'GET',
		headers: {
			'Authorization': `Bearer ${accessToken}`,
			'Accept': 'application/json; charset=UTF-8'
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
	accessToken: string,
	payoutRequest: PayoutRequest,
): Promise<any> {
	const path = "/v3/payouts";

	// Convert body to string for signing
	const bodyStr = JSON.stringify(payoutRequest);
	const idempotencyKey = uuidv4();

	// Headers that will be included in the signature
	const headers = {
		'Authorization': `Bearer ${accessToken}`,
		'Content-Type': 'application/json; charset=UTF-8',
		'Accept': 'application/json; charset=UTF-8',
		'Idempotency-Key': idempotencyKey
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
	accessToken: string,
	paymentLinkRequest: PaymentLinkRequest
): Promise<any> {
	const path = "/v3/payment-links";

	// Generate idempotency key
	const idempotencyKey = uuidv4();

	const headers = {
		'Authorization': `Bearer ${accessToken}`,
		'Content-Type': 'application/json; charset=UTF-8',
		'Accept': 'application/json; charset=UTF-8',
		'Idempotency-Key': idempotencyKey
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

export async function ListTransactions(
	from: string,
	to: string,
	merchant_account_id: string,
	access_token: string,
	cursor?: string
): Promise<any> {
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
			'Accept': 'application/json; charset=UTF-8'
		},
	});
	const data = await response.json();
	console.error(data)
	return data;
}

