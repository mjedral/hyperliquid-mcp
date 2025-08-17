// Core branded types for type safety
export type Brand<K, T> = K & { __brand: T };

// Hyperliquid-specific branded types
export type Symbol = Brand<string, 'Symbol'>;
export type IntRange<Min extends number, Max extends number> = Brand<
  number,
  `IntRange<${Min},${Max}>`
>;

// Common data models
export interface Document {
  url: string;
  title: string;
  content: string;
  lastModified: Date;
  contentHash: string;
}

export interface Chunk {
  id: string;
  documentUrl: string;
  content: string;
  title: string;
  startOffset: number;
  endOffset: number;
  tokenCount: number;
}

export interface ChunkWithEmbedding extends Chunk {
  embedding: number[];
}

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
  score: number;
}

// Market data models
export interface MarketSummary {
  symbol: Symbol;
  baseAsset: string;
  quoteAsset: string;
  status: 'active' | 'inactive';
  tickSize: number;
  minSize: number;
}

export interface TickerData {
  symbol: Symbol;
  price: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  timestamp: number;
}

export interface OrderbookData {
  symbol: Symbol;
  bids: [number, number][]; // [price, size]
  asks: [number, number][];
  timestamp: number;
}

export interface WsEvent {
  channel: string;
  data: unknown;
  timestamp: number;
}

// Error response format
export interface ErrorResponse {
  code: string;
  message: string;
  details?: {
    symbol?: string;
    parameter?: string;
    retryAfter?: number;
    [key: string]: unknown;
  };
}

// Configuration interfaces
export interface RAGConfig {
  baseUrl: string;
  embeddingProvider: 'openai' | 'local';
  embeddingModel: string;
  openaiApiKey?: string;
}

export interface MCPConfig {
  network: 'testnet' | 'mainnet';
  httpUrl?: string;
  wsUrl?: string;
}

// Common interfaces for RAG and MCP components
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  getDimensions(): number;
}

export interface VectorStore {
  upsert(chunks: ChunkWithEmbedding[]): Promise<void>;
  search(query: number[], topK: number): Promise<SearchResult[]>;
}

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: string[] | undefined;
}
