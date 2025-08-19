import { EmbeddingProvider } from '@hl/shared';
import { HyperliquidError, ErrorCode } from '@hl/shared';
import OpenAI from 'openai';

/**
 * OpenAI embedding provider implementation
 */
export class OpenAIEmbedder implements EmbeddingProvider {
    private client: OpenAI;
    private model: string;
    private dimensions: number;

    constructor(apiKey: string, model: string = 'text-embedding-3-small') {
        if (!apiKey) {
            throw new HyperliquidError(
                ErrorCode.CONFIG_ERROR,
                'OpenAI API key is required'
            );
        }

        this.client = new OpenAI({ apiKey });
        this.model = model;

        // Set dimensions based on model
        this.dimensions = this.getModelDimensions(model);
    }

    /**
     * Embed multiple texts in batches
     */
    async embed(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) {
            return [];
        }

        try {
            // Process in batches to respect API limits
            const batchSize = 2048; // OpenAI allows up to 2048 inputs per request
            const results: number[][] = [];

            for (let i = 0; i < texts.length; i += batchSize) {
                const batch = texts.slice(i, i + batchSize);
                const batchResults = await this.embedBatch(batch);
                results.push(...batchResults);
            }

            return results;
            // TOFIX: types error
        } catch (error: unknown) {
            if (error instanceof OpenAI.APIError) {
                const apiError = error;
                if (apiError.status === 429) {
                    throw new HyperliquidError(
                        ErrorCode.RATE_LIMITED,
                        'OpenAI API rate limit exceeded',
                        { retryAfter: 60 }
                    );
                }
                throw new HyperliquidError(
                    ErrorCode.EMBEDDING_FAILED,
                    `OpenAI API error: ${apiError.message}`,
                    { status: apiError.status }
                );
            }

            throw new HyperliquidError(
                ErrorCode.EMBEDDING_FAILED,
                `Failed to generate embeddings: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * Get embedding dimensions for the model
     */
    getDimensions(): number {
        return this.dimensions;
    }

    /**
     * Process a single batch of texts
     */
    private async embedBatch(texts: string[]): Promise<number[][]> {
        const response = await this.client.embeddings.create({
            model: this.model,
            input: texts,
            encoding_format: 'float',
        });

        return response.data.map((item: { embedding: any; }) => item.embedding);
    }

    /**
     * Get dimensions for different OpenAI models
     */
    private getModelDimensions(model: string): number {
        const modelDimensions: Record<string, number> = {
            'text-embedding-3-small': 1536,
            'text-embedding-3-large': 3072,
            'text-embedding-ada-002': 1536,
        };

        return modelDimensions[model] || 1536; // Default to 1536
    }
}

/**
 * Placeholder local embedding provider for future implementation
 */
export class LocalEmbedder implements EmbeddingProvider {
    private dimensions: number;

    constructor(dimensions: number = 384) {
        this.dimensions = dimensions;
    }

    /**
     * Placeholder implementation - will be replaced with actual local model
     */
    async embed(_texts: string[]): Promise<number[][]> {
        throw new HyperliquidError(
            ErrorCode.NOT_IMPLEMENTED,
            'Local embedding provider is not yet implemented. Use OpenAI provider instead.'
        );
    }

    /**
     * Get embedding dimensions
     */
    getDimensions(): number {
        return this.dimensions;
    }
}

/**
 * Factory function to create embedding providers based on configuration
 */
export function createEmbeddingProvider(
    provider: 'openai' | 'local',
    config: {
        apiKey?: string;
        model?: string;
        dimensions?: number;
    } = {}
): EmbeddingProvider {
    switch (provider) {
        case 'openai':
            if (!config.apiKey) {
                throw new HyperliquidError(
                    ErrorCode.CONFIG_ERROR,
                    'OpenAI API key is required for OpenAI embedding provider'
                );
            }
            return new OpenAIEmbedder(config.apiKey, config.model);

        case 'local':
            return new LocalEmbedder(config.dimensions);

        default:
            throw new HyperliquidError(
                ErrorCode.CONFIG_ERROR,
                `Unknown embedding provider: ${provider}`
            );
    }
}