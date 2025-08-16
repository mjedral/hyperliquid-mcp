# Hyperliquid RAG-MCP

TypeScript monorepo providing RAG system for Hyperliquid documentation and MCP tools for market data access.

## Packages

- `@hl/shared` - Shared types, utilities, and error handling
- `@hl/rag` - RAG system for GitBook documentation search
- `@hl/mcp-hyperliquid` - MCP server for Hyperliquid market data

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Lint code
pnpm lint

# Type check
pnpm type-check
```

## Requirements

- Node.js >= 18.0.0
- pnpm >= 8.0.0

## License

MIT