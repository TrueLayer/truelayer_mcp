# TrueLayer MCP Integration for AI assistants

An experimental project connecting TrueLayer APIs and an AI assistant, like Claude AI.


This project provides a Truelayer Model Context Protocol (MCP) server that enables an AI assistant, like Claude AI, to interact with TrueLayer's financial APIs. It allows the AI assistant to perform various banking and payment operations through TrueLayer's services.

> ⚠️ **DISCLAIMER** ⚠️

> This project is for demonstration purposes only. It is not officially supported or maintained by TrueLayer, does not form a part of the services we contractually provide you with and we are not responsible for the outcome of your use.
> Use at your own risk.
> This integration may break with API changes.

> By using this MCP server with an external LLM you are trusting an external third party with the handling of the data retrieved from the TrueLayer API.



## Features
The integration allows an AI assistant to execute some of the TrueLayer actions directly from the assistant chat.

These functions allow you to perform common payment operations like retrieving account information, creating payment links for customers, sending payouts to beneficiaries, and reviewing transaction history.

Given that AI assistants may not always produce deterministic behaviors, and for safe and isolated testing, we recommend testing the MCP server in the TrueLayer Sandbox environment.

Here are specific TrueLayer functions that an AI assistant can call for you once the MCP server is installed:

- Get merchant account details
- List transaction history
- Create payouts to external accounts
- Generate payment links for banking transactions
- Retrieve payment and payment link details

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

**Payouts & Payment Links:**
- "Create a payout of £100 to account number 12345678 with sort code 01-02-03."
- "Generate a payment link for £50."
- "List all transactions between 2023-01-01 and 2023-01-31."

**VRP Mandates:**
- "Create a VRP sweeping mandate to my merchant account with a £1000 daily limit and £5000 monthly limit."
- "Set up a VRP mandate to external account 12345678 (sort code 01-02-03) for John Smith with max £500 per payment and £2000 per month."
- "Get the details of mandate ID abc123."
- "Create a commercial VRP mandate with weekly limits."

**VRP Payments (using pre-authorized mandates):**
- "Create a payment of £100 using mandate ID abc-123-def."
- "Make a £50 payment on mandate xyz-789 with reference 'Invoice-2024-001'."
- "Send £250 using the authorized mandate abc-123 with retry enabled."
- "Check the status of payment ID payment-xyz-123."

When you ask Claude about these operations, it will use the MCP server to execute them through the TrueLayer API.

## VRP Payment Flow

The Variable Recurring Payments (VRP) flow enables automated, recurring payments without user interaction after initial authorization:

### 1. Create Mandate
Use `truelayer-create-vrp-mandate` to establish a payment mandate with:
- Maximum individual payment amount
- Periodic limits (daily, weekly, monthly, etc.)
- Beneficiary account details
- Validity period

### 2. Authorize Mandate
The PSU (Payment Service User) authorizes the mandate once at their bank. The mandate status transitions to `authorized`.

### 3. Create Payments
Use `truelayer-create-payment-on-mandate` to create payments automatically:
- **No user interaction required** after initial authorization
- Payments execute within mandate constraints
- Real-time validation against limits
- Automatic execution without bank redirects

### 4. Monitor Payments
Use `truelayer-get-payment` to track payment status:
- `authorized` → `executed` → `settled` (success flow)
- `failed` (constraint violation, insufficient funds)

This flow is ideal for:
- Subscription payments
- Automated savings transfers
- Regular bill payments
- Account sweeping between owned accounts

## Available Tools

The MCP server exposes these tools:

### Account & Transaction Management
- `truelayer-get-merchant-account`: Retrieve merchant account details
- `truelayer-list-transactions`: Get a list of transactions for a merchant account (defaults to the last 30 days if no dates provided)

### Payments & Payouts
- `truelayer-get-payment`: Get details of a specific payment
- `truelayer-create-payout`: Create a new payout to an external account
- `truelayer-get-payout`: Get details of a specific payout

### Payment Links
- `truelayer-create-payment-link`: Create a payment link for bank transfers
- `truelayer-get-payment-link`: Get details of a specific payment link

### VRP (Variable Recurring Payments) Mandates
- `truelayer-create-vrp-mandate`: Create a new VRP mandate for sweeping or commercial use cases
  - Supports both `sweeping` (moving funds between own accounts) and `commercial` mandate types
  - Configurable constraints: maximum individual amount, periodic limits (day/week/month/year)
  - Flexible provider selection: user-selected or preselected
  - Beneficiary options: merchant account or external account (UK/IBAN)
  - Optional validity periods and metadata
- `truelayer-get-vrp-mandate`: Get details of a VRP mandate including status, constraints, and authorization state
- `truelayer-create-payment-on-mandate`: Create a payment using a pre-authorized VRP mandate
  - **No user interaction required** - payments execute automatically
  - Automatic constraint validation against mandate limits
  - Optional payment reference for reconciliation
  - Optional retry configuration for failed payments
  - Metadata support for custom tracking