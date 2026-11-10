import { apiGet, apiPath, apiSignedPost } from "./client.js";

export interface PayoutRequest {
	currency: string;
	merchant_account_id: string;
	amount_in_minor: number;
	beneficiary: {
		type: string;
		account_holder_name: string;
		account_identifier: {
			type: string;
			sort_code?: string;
			account_number?: string;
			iban?: string;
		};
		reference?: string;
	};
}

export function createPayout(payoutRequest: PayoutRequest, idempotencyKey?: string): Promise<unknown> {
	return apiSignedPost("/v3/payouts", payoutRequest, idempotencyKey);
}

export function getPayout(payoutId: string): Promise<unknown> {
	return apiGet(apiPath`/v3/payouts/${payoutId}`);
}
