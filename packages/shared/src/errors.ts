// Comprehensive error codes for all system components
export enum ErrorCode {
  // Validation errors
  INVALID_SYMBOL = 'INVALID_SYMBOL',
  INVALID_DEPTH = 'INVALID_DEPTH',
  INVALID_CHANNELS = 'INVALID_CHANNELS',
  INVALID_PARAMETER = 'INVALID_PARAMETER',
  VALIDATION_FAILED = 'VALIDATION_FAILED',

  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  NETWORK_UNAVAILABLE = 'NETWORK_UNAVAILABLE',
  TIMEOUT = 'TIMEOUT',
  CONNECTION_FAILED = 'CONNECTION_FAILED',

  // Rate limiting
  RATE_LIMITED = 'RATE_LIMITED',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',

  // WebSocket specific
  WS_CONNECTION_FAILED = 'WS_CONNECTION_FAILED',
  WS_DISCONNECTED = 'WS_DISCONNECTED',
  WS_SUBSCRIPTION_FAILED = 'WS_SUBSCRIPTION_FAILED',
  WS_QUEUE_FULL = 'WS_QUEUE_FULL',

  // RAG system errors
  CRAWL_ERROR = 'CRAWL_ERROR',
  CRAWL_FAILED = 'CRAWL_FAILED',
  CHUNKING_FAILED = 'CHUNKING_FAILED',
  EMBEDDING_FAILED = 'EMBEDDING_FAILED',
  VECTOR_STORE_ERROR = 'VECTOR_STORE_ERROR',
  SEARCH_ERROR = 'SEARCH_ERROR',
  SEARCH_FAILED = 'SEARCH_FAILED',
  INDEX_BUILD_ERROR = 'INDEX_BUILD_ERROR',
  INDEX_BUILD_FAILED = 'INDEX_BUILD_FAILED',
  INVALID_INPUT = 'INVALID_INPUT',

  // MCP errors
  MCP_TOOL_ERROR = 'MCP_TOOL_ERROR',
  MCP_VALIDATION_ERROR = 'MCP_VALIDATION_ERROR',
  MCP_SERVER_ERROR = 'MCP_SERVER_ERROR',

  // System errors
  CONFIG_ERROR = 'CONFIG_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
}

export class HyperliquidError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'HyperliquidError';

    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, HyperliquidError.prototype);
  }

  /**
   * Create a validation error
   */
  static validation(
    message: string,
    details?: Record<string, unknown>
  ): HyperliquidError {
    return new HyperliquidError(ErrorCode.VALIDATION_FAILED, message, details);
  }

  /**
   * Create a network error
   */
  static network(
    message: string,
    details?: Record<string, unknown>
  ): HyperliquidError {
    return new HyperliquidError(ErrorCode.NETWORK_ERROR, message, details);
  }

  /**
   * Create a rate limiting error
   */
  static rateLimited(message: string, retryAfter?: number): HyperliquidError {
    return new HyperliquidError(ErrorCode.RATE_LIMITED, message, {
      retryAfter,
    });
  }

  /**
   * Create an invalid symbol error
   */
  static invalidSymbol(symbol: string): HyperliquidError {
    return new HyperliquidError(
      ErrorCode.INVALID_SYMBOL,
      `Invalid symbol: ${symbol}`,
      { symbol }
    );
  }

  /**
   * Check if error is retryable
   */
  isRetryable(): boolean {
    const retryableCodes = [
      ErrorCode.NETWORK_ERROR,
      ErrorCode.TIMEOUT,
      ErrorCode.RATE_LIMITED,
      ErrorCode.TOO_MANY_REQUESTS,
      ErrorCode.WS_CONNECTION_FAILED,
      ErrorCode.WS_DISCONNECTED,
    ];
    return retryableCodes.includes(this.code);
  }

  /**
   * Get retry delay in milliseconds
   */
  getRetryDelay(): number {
    if (this.details?.['retryAfter']) {
      return Number(this.details['retryAfter']) * 1000;
    }

    // Default exponential backoff delays
    switch (this.code) {
      case ErrorCode.RATE_LIMITED:
      case ErrorCode.TOO_MANY_REQUESTS:
        return 5000; // 5 seconds
      case ErrorCode.NETWORK_ERROR:
      case ErrorCode.TIMEOUT:
        return 1000; // 1 second
      default:
        return 1000;
    }
  }
}
