# Environment Setup Guide

This guide explains how to configure environment variables for the Hyperliquid RAG system.

## Quick Start

1. **Copy the example file:**
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` with your OpenAI API key:**
   ```bash
   # Required: Add your OpenAI API key
   OPENAI_API_KEY=sk-your-actual-api-key-here
   ```

3. **Test the configuration:**
   ```bash
   # Test RAG crawler
   pnpm --filter @hl/rag test-crawl
   ```

## Currently Required Variables

### OpenAI API Key (Required)

```bash
OPENAI_API_KEY=sk-your-openai-api-key-here
```

**Cost considerations:**
- `text-embedding-3-small`: ~$0.02 per 1M tokens
- Crawling Hyperliquid docs (~100 pages) costs approximately $0.10-0.50

...