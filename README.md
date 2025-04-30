# TrueLayer MCP Integration for Claude

This project provides a Truelayer Model Context Protocol (MCP) server that enables Claude AI to interact with TrueLayer's financial APIs. It allows Claude to perform various banking and payment operations through TrueLayer's services.

> ⚠️ **DISCLAIMER** ⚠️
> 
> This project is intended for demonstration purposes only. It is not officially supported or maintained by TrueLayer.
> Use at your own risk. 
> This integration may break with API changes and should not be used in production environments.
> 
> Also, given that AI assistants may not always produce deterministic behaviors, and for safe and isolated testing, we strongly recommend using the MCP server in the TrueLayer Sandbox environment.
>
> By using this MCP server with an external LLM you are trusting an external third party with the handling of the data retrieved from the TrueLayer API.



## Features

- Generate TrueLayer access tokens
- Create payouts to external accounts
- Generate payment links for banking transactions
- Retrieve payment details
- List transaction history
- Get merchant account details

## Setup

### Prerequisites

- Node.js (v14 or later)
- npm or yarn
- A TrueLayer account with API credentials

### Installation

1. Clone this repository:
```bash
git clone <repository-url>
cd truelayer_mcp
```

2. Install dependencies:
```bash
npm install
```

3. Configure your TrueLayer credentials:
   - Copy `src/auth.example.ts` to `src/auth.ts`
   - Fill in your TrueLayer credentials (KID, private key, client ID, client secret, and merchant account ID)

```typescript
export const KID = "your-key-id"; 
export const PRIVATE_KEY_PEM = `your-private-key-in-pem-format`
export const CLIENT_ID = "your-client-id";
export const CLIENT_SECRET = "your-client-secret";
export const MERCHANT_ACCOUNT_ID = "your-merchant-account-id";

export const AUTH_URI = "https://auth.truelayer.com/connect/token";
export const BASE_URI = "https://api.truelayer.com";
```

4. Build the project:
```bash
npm run build
```

## Configuration with Claude Desktop

To use this MCP server with Claude Desktop:

1. Locate your Claude Desktop configuration file:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the TrueLayer MCP server to your configuration:

```json
{
  "mcpServers": {
    "truelayer": {
      "command": "node",
      "args": [
        "/path/to/truelayer_mcp/build/index.js"
      ]
    }
  }
}
```

Replace `/path/to/truelayer_mcp` with the actual path to this project on your system.

## Using with Claude

Once configured, you can ask Claude to perform TrueLayer operations. Here are some example prompts:

- "Generate a TrueLayer access token for me."
- "Create a payout of £100 to account number 12345678 with sort code 01-02-03."
- "Generate a payment link for £50."
- "List all transactions between 2023-01-01 and 2023-01-31."

When you ask Claude about these operations, it will use the MCP server to execute them through the TrueLayer API.

## Available Tools

The MCP server exposes these tools to Claude:

- `get-merchant-account`: Retrieve merchant account details
- `get-truelayer-access-token`: Generate a TrueLayer access token
- `get-truelayer-payment`: Get details of a specific payment
- `create-truelayer-payout`: Create a new payout to an external account
- `create-truelayer-payment-link`: Create a payment link for bank transfers
- `list_transactions`: Get a list of transactions for a merchant account