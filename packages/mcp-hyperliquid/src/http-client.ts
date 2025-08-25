import {
    Symbol,
    IntRange,
    MarketSummary,
    TickerData,
    OrderbookData,
    HyperliquidError,
    ErrorCode,
    validateSymbol,
    validateDepth,
} from '@hl/shared';

export interface HyperliquidHttpClientConfig {
    network: 'testnet' | 'mainnet';
    httpUrl?: string;
    timeout?: number;
    maxRetries?: number;
}

export class HyperliquidHttpClient {
    private readonly baseUrl: string;
    private readonly timeout: number;
    private readonly maxRetries: number;

    constructor(config: HyperliquidHttpClientConfig) {
        this.timeout = config.timeout ?? 10000; // 10 seconds default
        this.maxRetries = config.maxRetries ?? 3;

        // Set default URLs based on network
        if (config.httpUrl) {
            this.baseUrl = config.httpUrl;
        } else {
            this.baseUrl =
                config.network === 'testnet'
                    ? 'https://api.hyperliquid-testnet.xyz'
                    : 'https://api.hyperliquid.xyz';
        }
    }

    /**
     * Get all available markets
     */
    async getMarkets(): Promise<MarketSummary[]> {
        const response = await this.makeRequest('/info', {
            type: 'meta',
        });

        return this.parseMarketsResponse(response);
    }

    /**
     * Get ticker data for a specific symbol
     */
    async getTicker(symbol: Symbol): Promise<TickerData> {
        const validation = validateSymbol(symbol);
        if (!validation.success) {
            throw HyperliquidError.invalidSymbol(symbol);
        }

        const response = await this.makeRequest('/info', {
            type: 'allMids',
        });

        return this.parseTickerResponse(response, symbol);
    }

    /**
     * Get orderbook data for a specific symbol
     */
    async getOrderbook(
        symbol: Symbol,
        depth?: IntRange<1, 100>
    ): Promise<OrderbookData> {
        const symbolValidation = validateSymbol(symbol);
        if (!symbolValidation.success) {
            throw HyperliquidError.invalidSymbol(symbol);
        }

        if (depth !== undefined) {
            const depthValidation = validateDepth(depth);
            if (!depthValidation.success) {
                throw new HyperliquidError(
                    ErrorCode.INVALID_DEPTH,
                    `Invalid depth: ${depth}. Must be between 1 and 100.`,
                    { depth }
                );
            }
        }

        const response = await this.makeRequest('/info', {
            type: 'l2Book',
            coin: symbol,
            nSigFigs: depth ?? 5,
        });

        return this.parseOrderbookResponse(response, symbol);
    }

    /**
     * Make HTTP request with retry logic and timeout handling
     */
    private async makeRequest(
        endpoint: string,
        body: Record<string, unknown>
    ): Promise<any> {
        const url = `${this.baseUrl}${endpoint}`;
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), this.timeout);

                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': '@hl/mcp-hyperliquid/1.0.0',
                    },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw await this.handleHttpError(response);
                }

                const data = await response.json();
                return data;
            } catch (error) {
                lastError = error as Error;

                // Don't retry on validation errors or non-retryable errors
                if (error instanceof HyperliquidError && !error.isRetryable()) {
                    throw error;
                }

                // Don't retry on the last attempt
                if (attempt === this.maxRetries) {
                    break;
                }

                // Calculate delay with exponential backoff and jitter
                const baseDelay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
                const jitter = Math.random() * 1000; // 0-1s jitter
                const delay = Math.min(baseDelay + jitter, 30000); // Max 30s

                await this.sleep(delay);
            }
        }

        // If we get here, all retries failed
        if (lastError instanceof HyperliquidError) {
            throw lastError;
        }

        throw new HyperliquidError(
            ErrorCode.NETWORK_ERROR,
            `Request failed after ${this.maxRetries + 1} attempts: ${lastError?.message}`,
            { originalError: lastError?.message }
        );
    }

    /**
     * Handle HTTP error responses
     */
    private async handleHttpError(response: Response): Promise<HyperliquidError> {
        const status = response.status;
        let errorMessage = `HTTP ${status}: ${response.statusText}`;

        try {
            const errorBody = await response.text();
            if (errorBody) {
                errorMessage += ` - ${errorBody}`;
            }
        } catch {
            // Ignore JSON parsing errors
        }

        switch (status) {
            case 400:
                return new HyperliquidError(
                    ErrorCode.VALIDATION_FAILED,
                    errorMessage,
                    { status }
                );
            case 429:
                const retryAfter = response.headers.get('Retry-After');
                return HyperliquidError.rateLimited(
                    errorMessage,
                    retryAfter ? parseInt(retryAfter, 10) : undefined
                );
            case 500:
            case 502:
            case 503:
            case 504:
                return new HyperliquidError(
                    ErrorCode.NETWORK_ERROR,
                    errorMessage,
                    { status }
                );
            default:
                return new HyperliquidError(
                    ErrorCode.NETWORK_ERROR,
                    errorMessage,
                    { status }
                );
        }
    }

    /**
     * Parse markets response from Hyperliquid API
     */
    private parseMarketsResponse(response: any): MarketSummary[] {
        if (!response || !Array.isArray(response.universe)) {
            throw new HyperliquidError(
                ErrorCode.VALIDATION_FAILED,
                'Invalid markets response format'
            );
        }

        return response.universe
            .filter((market: any) => !market.isDelisted) // Filter out delisted markets
            .map((market: any) => {
                // Calculate tick size and min size based on szDecimals
                // szDecimals represents the number of decimal places for size
                const tickSize = market.szDecimals !== undefined
                    ? Math.pow(10, -market.szDecimals)
                    : 0.01;

                const minSize = tickSize; // Minimum size is typically the same as tick size

                return {
                    symbol: market.name as Symbol,
                    baseAsset: market.name.split('-')[0] || market.name,
                    quoteAsset: market.name.split('-')[1] || 'USD',
                    status: market.isDelisted ? 'inactive' as const : 'active' as const,
                    tickSize,
                    minSize,
                };
            });
    }



    /**
     * Parse ticker response from Hyperliquid API
     */
    private parseTickerResponse(allMidsResponse: any, symbol: Symbol): TickerData {
        if (!allMidsResponse || typeof allMidsResponse !== 'object') {
            throw new HyperliquidError(
                ErrorCode.VALIDATION_FAILED,
                'Invalid ticker response format'
            );
        }

        // Get price directly using symbol name
        const priceStr = allMidsResponse[symbol];

        if (priceStr === undefined) {
            throw HyperliquidError.invalidSymbol(symbol);
        }

        // Note: Hyperliquid's allMids endpoint only provides current price
        // For complete ticker data, we'd need to combine with 24h stats
        return {
            symbol,
            price: parseFloat(priceStr),
            change24h: 0, // Would need 24h stats endpoint
            volume24h: 0, // Would need 24h stats endpoint
            high24h: 0, // Would need 24h stats endpoint
            low24h: 0, // Would need 24h stats endpoint
            timestamp: Date.now(),
        };
    }

    /**
     * Parse orderbook response from Hyperliquid API
     */
    private parseOrderbookResponse(response: any, symbol: Symbol): OrderbookData {
        if (!response || !Array.isArray(response.levels) || response.levels.length !== 2) {
            throw new HyperliquidError(
                ErrorCode.VALIDATION_FAILED,
                'Invalid orderbook response format - expected levels array with 2 elements'
            );
        }

        const bids: [number, number][] = [];
        const asks: [number, number][] = [];

        // First array in levels is bids (buy orders)
        const bidLevels = response.levels[0];
        if (Array.isArray(bidLevels)) {
            bidLevels.forEach((level: any) => {
                const price = parseFloat(level.px);
                const size = parseFloat(level.sz);
                if (!isNaN(price) && !isNaN(size)) {
                    bids.push([price, size]);
                }
            });
        }

        // Second array in levels is asks (sell orders)
        const askLevels = response.levels[1];
        if (Array.isArray(askLevels)) {
            askLevels.forEach((level: any) => {
                const price = parseFloat(level.px);
                const size = parseFloat(level.sz);
                if (!isNaN(price) && !isNaN(size)) {
                    asks.push([price, size]);
                }
            });
        }

        // Sort bids descending (highest price first)
        bids.sort((a, b) => b[0] - a[0]);
        // Sort asks ascending (lowest price first)
        asks.sort((a, b) => a[0] - b[0]);

        return {
            symbol,
            bids,
            asks,
            timestamp: response.time || Date.now(),
        };
    }

    /**
     * Sleep for specified milliseconds
     */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}