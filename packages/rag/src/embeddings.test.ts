import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIEmbedder, LocalEmbedder, createEmbeddingProvider } from './embeddings';
import { HyperliquidError, ErrorCode } from '@hl/shared';
import OpenAI from 'openai';

// Mock OpenAI
vi.mock('openai');

describe('OpenAIEmbedder', () => {
    let mockClient: any;
    let embedder: OpenAIEmbedder;

    beforeEach(() => {
        mockClient = {
            embeddings: {
                create: vi.fn(),
            },
        };

        vi.mocked(OpenAI).mockImplementation(() => mockClient);
        embedder = new OpenAIEmbedder('test-api-key');
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('constructor', () => {
        it('should throw error when API key is missing', () => {
            expect(() => new OpenAIEmbedder('')).toThrow(HyperliquidError);
            expect(() => new OpenAIEmbedder('')).toThrow('OpenAI API key is required');
        });

        it('should use default model when not specified', () => {
            const embedder = new OpenAIEmbedder('test-key');
            expect(embedder.getDimensions()).toBe(1536); // text-embedding-3-small default
        });

        it('should use specified model', () => {
            const embedder = new OpenAIEmbedder('test-key', 'text-embedding-3-large');
            expect(embedder.getDimensions()).toBe(3072);
        });

        it('should use default dimensions for unknown model', () => {
            const embedder = new OpenAIEmbedder('test-key', 'unknown-model');
            expect(embedder.getDimensions()).toBe(1536);
        });
    });

    describe('embed', () => {
        it('should return empty array for empty input', async () => {
            const result = await embedder.embed([]);
            expect(result).toEqual([]);
            expect(mockClient.embeddings.create).not.toHaveBeenCalled();
        });

        it('should embed single text', async () => {
            const mockEmbedding = [0.1, 0.2, 0.3];
            mockClient.embeddings.create.mockResolvedValue({
                data: [{ embedding: mockEmbedding }],
            });

            const result = await embedder.embed(['test text']);

            expect(result).toEqual([mockEmbedding]);
            expect(mockClient.embeddings.create).toHaveBeenCalledWith({
                model: 'text-embedding-3-small',
                input: ['test text'],
                encoding_format: 'float',
            });
        });

        it('should embed multiple texts', async () => {
            const mockEmbeddings = [
                [0.1, 0.2, 0.3],
                [0.4, 0.5, 0.6],
            ];
            mockClient.embeddings.create.mockResolvedValue({
                data: [
                    { embedding: mockEmbeddings[0] },
                    { embedding: mockEmbeddings[1] },
                ],
            });

            const result = await embedder.embed(['text 1', 'text 2']);

            expect(result).toEqual(mockEmbeddings);
        });

        it('should process large batches in chunks', async () => {
            const texts = Array.from({ length: 3000 }, (_, i) => `text ${i}`);
            const mockEmbedding = [0.1, 0.2, 0.3];

            // First call for batch 1 (2048 items)
            mockClient.embeddings.create.mockResolvedValueOnce({
                data: Array.from({ length: 2048 }, () => ({ embedding: mockEmbedding })),
            });

            // Second call for batch 2 (952 items)
            mockClient.embeddings.create.mockResolvedValueOnce({
                data: Array.from({ length: 952 }, () => ({ embedding: mockEmbedding })),
            });

            const result = await embedder.embed(texts);

            expect(result).toHaveLength(3000);
            expect(mockClient.embeddings.create).toHaveBeenCalledTimes(2);

            // Check first batch call
            expect(mockClient.embeddings.create).toHaveBeenNthCalledWith(1, {
                model: 'text-embedding-3-small',
                input: texts.slice(0, 2048),
                encoding_format: 'float',
            });

            // Check second batch call
            expect(mockClient.embeddings.create).toHaveBeenNthCalledWith(2, {
                model: 'text-embedding-3-small',
                input: texts.slice(2048, 3000),
                encoding_format: 'float',
            });
        });

        it('should handle rate limiting errors', async () => {
            const rateLimitError = {
                status: 429,
                message: 'Rate limit exceeded',
            };
            // Mock as OpenAI.APIError instance
            Object.setPrototypeOf(rateLimitError, OpenAI.APIError.prototype);
            mockClient.embeddings.create.mockRejectedValue(rateLimitError);

            await expect(embedder.embed(['test'])).rejects.toThrow(HyperliquidError);

            try {
                await embedder.embed(['test']);
            } catch (error) {
                expect(error).toBeInstanceOf(HyperliquidError);
                expect((error as HyperliquidError).code).toBe(ErrorCode.RATE_LIMITED);
                expect((error as HyperliquidError).details?.retryAfter).toBe(60);
            }
        });

        it('should handle API errors', async () => {
            const apiError = {
                status: 400,
                message: 'Invalid request',
            };
            // Mock as OpenAI.APIError instance
            Object.setPrototypeOf(apiError, OpenAI.APIError.prototype);
            mockClient.embeddings.create.mockRejectedValue(apiError);

            await expect(embedder.embed(['test'])).rejects.toThrow(HyperliquidError);

            try {
                await embedder.embed(['test']);
            } catch (error) {
                expect(error).toBeInstanceOf(HyperliquidError);
                expect((error as HyperliquidError).code).toBe(ErrorCode.EMBEDDING_FAILED);
                expect((error as HyperliquidError).message).toContain('OpenAI API error');
            }
        });

        it('should handle generic errors', async () => {
            const genericError = new Error('Network error');
            mockClient.embeddings.create.mockRejectedValue(genericError);

            await expect(embedder.embed(['test'])).rejects.toThrow(HyperliquidError);

            try {
                await embedder.embed(['test']);
            } catch (error) {
                expect(error).toBeInstanceOf(HyperliquidError);
                expect((error as HyperliquidError).code).toBe(ErrorCode.EMBEDDING_FAILED);
                expect((error as HyperliquidError).message).toContain('Failed to generate embeddings');
            }
        });
    });

    describe('getDimensions', () => {
        it('should return correct dimensions for different models', () => {
            expect(new OpenAIEmbedder('key', 'text-embedding-3-small').getDimensions()).toBe(1536);
            expect(new OpenAIEmbedder('key', 'text-embedding-3-large').getDimensions()).toBe(3072);
            expect(new OpenAIEmbedder('key', 'text-embedding-ada-002').getDimensions()).toBe(1536);
        });
    });
});

describe('LocalEmbedder', () => {
    let embedder: LocalEmbedder;

    beforeEach(() => {
        embedder = new LocalEmbedder();
    });

    describe('constructor', () => {
        it('should use default dimensions', () => {
            expect(embedder.getDimensions()).toBe(384);
        });

        it('should use specified dimensions', () => {
            const customEmbedder = new LocalEmbedder(512);
            expect(customEmbedder.getDimensions()).toBe(512);
        });
    });

    describe('embed', () => {
        it('should throw not implemented error', async () => {
            await expect(embedder.embed(['test'])).rejects.toThrow(HyperliquidError);

            try {
                await embedder.embed(['test']);
            } catch (error) {
                expect(error).toBeInstanceOf(HyperliquidError);
                expect((error as HyperliquidError).code).toBe(ErrorCode.NOT_IMPLEMENTED);
                expect((error as HyperliquidError).message).toContain('Local embedding provider is not yet implemented');
            }
        });
    });

    describe('getDimensions', () => {
        it('should return configured dimensions', () => {
            expect(embedder.getDimensions()).toBe(384);
        });
    });
});

describe('createEmbeddingProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should create OpenAI provider with API key', () => {
        const provider = createEmbeddingProvider('openai', {
            apiKey: 'test-key',
            model: 'text-embedding-3-small',
        });

        expect(provider).toBeInstanceOf(OpenAIEmbedder);
        expect(provider.getDimensions()).toBe(1536);
    });

    it('should throw error for OpenAI provider without API key', () => {
        expect(() => createEmbeddingProvider('openai')).toThrow(HyperliquidError);
        expect(() => createEmbeddingProvider('openai')).toThrow('OpenAI API key is required');
    });

    it('should create local provider', () => {
        const provider = createEmbeddingProvider('local', {
            dimensions: 512,
        });

        expect(provider).toBeInstanceOf(LocalEmbedder);
        expect(provider.getDimensions()).toBe(512);
    });

    it('should create local provider with default dimensions', () => {
        const provider = createEmbeddingProvider('local');

        expect(provider).toBeInstanceOf(LocalEmbedder);
        expect(provider.getDimensions()).toBe(384);
    });

    it('should throw error for unknown provider', () => {
        expect(() => createEmbeddingProvider('unknown' as any)).toThrow(HyperliquidError);
        expect(() => createEmbeddingProvider('unknown' as any)).toThrow('Unknown embedding provider');
    });
});

describe('EmbeddingProvider contract', () => {
    it('should implement the interface correctly', () => {
        const openaiProvider = new OpenAIEmbedder('test-key');
        const localProvider = new LocalEmbedder();

        // Check that both providers implement the interface
        expect(typeof openaiProvider.embed).toBe('function');
        expect(typeof openaiProvider.getDimensions).toBe('function');
        expect(typeof localProvider.embed).toBe('function');
        expect(typeof localProvider.getDimensions).toBe('function');

        // Check return types
        expect(typeof openaiProvider.getDimensions()).toBe('number');
        expect(typeof localProvider.getDimensions()).toBe('number');
    });
});