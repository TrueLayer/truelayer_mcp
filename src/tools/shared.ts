import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export type ToolModule = (server: McpServer) => void;

// Runs a tool body and turns its result into tool output. Failures are reported
// with isError so the assistant can tell a failed call from a successful one.
export async function run(label: string, failure: string, fn: () => Promise<unknown>): Promise<CallToolResult> {
	try {
		const result = await fn();
		return { content: [{ type: "text", text: `${label}: ${JSON.stringify(result, null, 2)}` }] };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { content: [{ type: "text", text: `${failure}: ${message}` }], isError: true };
	}
}

// Tool annotations tell MCP clients how risky a tool is, so they can decide
// when to ask the user before running it. Every tool talks to TrueLayer, so all
// of them are open-world.

// Reads data and changes nothing.
export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: true };

// Creates or changes a resource without moving money by itself (for example a
// payment that the end user still has to authorise at their bank).
export const WRITES: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: true,
};

// Moves money or can't be undone (payouts, refunds, cancellations, and the
// authorization steps that can authorise a payment).
export const MOVES_MONEY: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: false,
	openWorldHint: true,
};

export const idempotencyKey = z
	.string()
	.min(1)
	.max(255)
	.optional()
	.describe(
		"Idempotency key for safe retries. TrueLayer stores the response to each key for 30 days and replays it. Reuse the key when retrying the same operation after a failure without Tl-Should-Retry: false, so TrueLayer doesn't perform it twice. Use a new key (or omit it to generate one) after a failure with Tl-Should-Retry: false, which would only replay the same error, or after changing the input, which a reused key rejects with HTTP 422.",
	);
