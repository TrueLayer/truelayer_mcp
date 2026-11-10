import { registerDataTools } from "./data.js";
import { registerMerchantAccountTools } from "./merchant-accounts.js";
import { registerPaymentLinkTools } from "./payment-links.js";
import { registerPaymentTools } from "./payments.js";
import { registerPayoutTools } from "./payouts.js";
import type { ToolModule } from "./shared.js";

// One module per TrueLayer product; each registers that product's tools.
export const toolModules: ToolModule[] = [
	registerMerchantAccountTools,
	registerPaymentTools,
	registerPaymentLinkTools,
	registerPayoutTools,
	registerDataTools,
];
