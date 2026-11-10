import { apiGet, apiPath } from "./client.js";

export function getPayment(paymentId: string): Promise<unknown> {
	return apiGet(apiPath`/v3/payments/${paymentId}`);
}
