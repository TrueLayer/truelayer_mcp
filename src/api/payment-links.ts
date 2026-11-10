import { apiGet, apiPath, apiSignedPost } from "./client.js";

export interface PaymentLinkRequest {
	type: string;
	expires_at: string;
	payment_configuration: {
		amount_in_minor: number;
		currency: string;
		payment_method: {
			type: string;
			provider_selection: {
				type: string;
			};
			beneficiary: {
				type: string;
				merchant_account_id: string;
			};
		};
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
			};
		};
	};
}

export function createPaymentLink(paymentLinkRequest: PaymentLinkRequest, idempotencyKey?: string): Promise<unknown> {
	return apiSignedPost("/v3/payment-links", paymentLinkRequest, idempotencyKey);
}

export function getPaymentLink(paymentLinkId: string): Promise<unknown> {
	return apiGet(apiPath`/v3/payment-links/${paymentLinkId}`);
}
