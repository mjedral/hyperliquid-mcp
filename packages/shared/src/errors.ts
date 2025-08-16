// Error handling classes placeholder
export enum ErrorCode {
  NETWORK_UNAVAILABLE = 'NETWORK_UNAVAILABLE',
  RATE_LIMITED = 'RATE_LIMITED',
  TIMEOUT = 'TIMEOUT',
  INVALID_SYMBOL = 'INVALID_SYMBOL',
  INVALID_DEPTH = 'INVALID_DEPTH',
  INVALID_CHANNELS = 'INVALID_CHANNELS',
  EMBEDDING_FAILED = 'EMBEDDING_FAILED',
  VECTOR_STORE_ERROR = 'VECTOR_STORE_ERROR',
  CRAWL_FAILED = 'CRAWL_FAILED',
}

export class HyperliquidError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'HyperliquidError';
  }
}
