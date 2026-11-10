import { z } from "zod";
import { getPayment } from "../api/payments.js";
import { READ_ONLY, run, type ToolModule } from "./shared.js";

export const registerPaymentTools: ToolModule = (server) => {
	server.registerTool(
		"truelayer-get-payment",
		{
			title: "Get payment",
			description: "Retrieve payment details from TrueLayer API",
			inputSchema: {
				paymentId: z.string().describe("ID of the payment to retrieve"),
			},
			annotations: READ_ONLY,
		},
		({ paymentId }) => run("Payment details", "Failed to retrieve payment", () => getPayment(paymentId)),
	);
};
