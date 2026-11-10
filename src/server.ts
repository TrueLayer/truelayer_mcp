import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toolModules } from "./tools/index.js";

export function createServer(): McpServer {
	const server = new McpServer(
		{
			name: "Truelayer MCP",
			version: "1.0.0",
		},
		{
			capabilities: {
				resources: {},
				tools: {},
			},
		},
	);
	for (const register of toolModules) {
		register(server);
	}
	return server;
}
