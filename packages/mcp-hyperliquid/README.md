# Hyperliquid MCP Server

MCP server for accessing Hyperliquid market data through HTTP API.

## Features

- **Market Data**: Get all available markets with metadata
- **Ticker Data**: Real-time price information for symbols
- **Orderbook Data**: Level 2 orderbook with configurable depth
- **Error Handling**: Comprehensive error handling with retry logic
- **Type Safety**: Full TypeScript support with branded types
- **Network Support**: Both testnet and mainnet endpoints

## Installation

```bash
pnpm install
pnpm build
```

## Usage

### Basic Usage

```typescript
import { HyperliquidHttpClient } from '@hl/mcp-hyperliquid';

const client = new HyperliquidHttpClient({
  network: 'testnet', // or 'mainnet'
  timeout: 10000,
  maxRetries: 3,
});

// Get all markets
const markets = await client.getMarkets();

// Get ticker for a symbol
const ticker = await client.getTicker('BTC-USD');

// Get orderbook with depth
const orderbook = await client.getOrderbook('BTC-USD', 10);
```

### Configuration Options

```typescript
interface HyperliquidHttpClientConfig {
  network: 'testnet' | 'mainnet';
  httpUrl?: string;        // Custom API URL (optional)
  timeout?: number;        // Request timeout in ms (default: 10000)
  maxRetries?: number;     // Max retry attempts (default: 3)
}
```

## Testing

### Unit Tests

```bash
pnpm test
```

### Live API Testing

Test against real Hyperliquid endpoints:

```bash
# Test testnet endpoints (recommended)
pnpm test:live

# Test mainnet endpoints
pnpm test:live:mainnet

# Simple endpoint test
pnpm test:endpoints

# Interactive testing CLI
pnpm test:interactive
```

### Manual Testing

Create a test file and run it:

```bash
pnpm exec tsx manual-test.ts
```

## API Reference

### getMarkets()

Fetches all available markets.

```typescript
const markets = await client.getMarkets();
// Returns: MarketSummary[]
```

### getTicker(symbol)

Gets ticker data for a specific symbol.

```typescript
const ticker = await client.getTicker('BTC-USD');
// Returns: TickerData
```

### getOrderbook(symbol, depth?)

Gets orderbook data with optional depth parameter (1-100).

```typescript
const orderbook = await client.getOrderbook('BTC-USD', 5);
// Returns: OrderbookData
```

## Error Handling

The client includes comprehensive error handling:

- **Validation Errors**: Invalid symbols, parameters
- **Network Errors**: Connection issues, timeouts
- **Rate Limiting**: Automatic retry with exponential backoff
- **API Errors**: HTTP error responses

```typescript
try {
  const ticker = await client.getTicker('INVALID_SYMBOL');
} catch (error) {
  if (error instanceof HyperliquidError) {
    console.log(`Error code: ${error.code}`);
    console.log(`Retryable: ${error.isRetryable()}`);
  }
}
```

## Development

### Type Checking

```bash
pnpm type-check
```

### Linting

```bash
pnpm lint
pnpm lint:fix
```

### Building

```bash
pnpm build
```

## Network Endpoints

- **Testnet**: `https://api.hyperliquid-testnet.xyz`
- **Mainnet**: `https://api.hyperliquid.xyz`

## License

MIT