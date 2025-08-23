import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildIndex, search } from './api.js';
import { HyperliquidError, ErrorCode } from '@hl/shared';
import * as fs from 'fs-extra';
import * as path from 'path';

// Mock the external dependencies
vi.mock('./crawler.js');
vi.mock('./embeddings.js');
vi.mock('./vector-store.js');

const mockCrawler = {
  crawlSite: vi.fn(),
};

const mockEmbedder = {
  embed: vi.fn(),
  getDimensions: vi.fn().mockReturnValue(1536),
};

const mockVectorStore = {
  upsert: vi.fn(),
  search: vi.fn(),
};

// Mock the classes
vi.mocked(await import('./crawler.js')).GitBookCrawler = vi.fn().mockImplementation(() => mockCrawler);
vi.mocked(await import('./embeddings.js')).OpenAIEmbedder = vi.fn().mockImplementation(() => mockEmbedder);
vi.mocked(await import('./vector-store.js')).SQLiteVectorStore = vi.fn().mockImplementation(() => mockVectorStore);

describe('RAG API Integration Tests', () => {
  const testCacheDir = path.join(__dirname, '..', '.test-cache');
  const testDbPath = path.join(testCacheDir, 'test-vectors.db');

  beforeEach(async () => {
    // Clean up test directory
    await fs.remove(testCacheDir);

    // Reset all mocks
    vi.clearAllMocks();
    mockCrawler.crawlSite.mockReset();
    mockEmbedder.embed.mockReset();
    mockEmbedder.getDimensions.mockReturnValue(1536);
    mockVectorStore.upsert.mockReset();
    mockVectorStore.search.mockReset();

    // Set up environment variables for testing
    process.env.RAG_BASE_URL = 'https://test.gitbook.io/docs';
    process.env.EMBEDDING_PROVIDER = 'openai';
    process.env.EMBEDDING_MODEL = 'text-embedding-3-small';
    process.env.OPENAI_API_KEY = 'test-api-key';
    process.env.RAG_CACHE_DIR = testCacheDir;
    process.env.RAG_DB_PATH = testDbPath;
  });

  afterEach(async () => {
    // Clean up test directory
    await fs.remove(testCacheDir);

    // Clean up environment variables
    delete process.env.RAG_BASE_URL;
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.EMBEDDING_MODEL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.RAG_CACHE_DIR;
    delete process.env.RAG_DB_PATH;
  });

  describe('buildIndex', () => {
    it('should successfully build index with complete pipeline', async () => {
      // Mock successful crawl result
      const mockDocuments = [
        {
          url: 'https://test.gitbook.io/docs/page1',
          title: 'Test Page 1',
          content: 'This is test content for page 1. It contains information about trading APIs and how to use them effectively.',
          lastModified: new Date(),
          contentHash: 'hash1',
        },
        {
          url: 'https://test.gitbook.io/docs/page2',
          title: 'Test Page 2',
          content: 'This is test content for page 2. It explains the WebSocket connections and real-time data streaming.',
          lastModified: new Date(),
          contentHash: 'hash2',
        },
      ];

      mockCrawler.crawlSite.mockResolvedValue({
        documents: mockDocuments,
        errors: [],
      });

      // Mock embeddings
      mockEmbedder.embed.mockResolvedValue([
        [0.1, 0.2, 0.3], // embedding for chunk 1
        [0.4, 0.5, 0.6], // embedding for chunk 2
        [0.7, 0.8, 0.9], // embedding for chunk 3
      ]);

      // Mock vector store upsert
      mockVectorStore.upsert.mockResolvedValue(undefined);

      const progressStages: string[] = [];
      const onProgress = (stage: string) => {
        progressStages.push(stage);
      };

      await buildIndex({ onProgress });

      // Verify crawler was called
      expect(mockCrawler.crawlSite).toHaveBeenCalledOnce();

      // Verify embeddings were generated
      expect(mockEmbedder.embed).toHaveBeenCalledOnce();
      expect(mockEmbedder.embed).toHaveBeenCalledWith(expect.any(Array));

      // Verify vector store was updated
      expect(mockVectorStore.upsert).toHaveBeenCalledOnce();
      expect(mockVectorStore.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            content: expect.any(String),
            embedding: expect.any(Array),
          }),
        ])
      );

      // Verify progress tracking
      expect(progressStages).toEqual(['crawling', 'chunking', 'embedding', 'storing', 'complete']);
    });

    it('should handle crawl errors gracefully', async () => {
      mockCrawler.crawlSite.mockResolvedValue({
        documents: [],
        errors: [
          { url: 'https://test.gitbook.io/docs/page1', error: 'Not found' },
        ],
      });

      await expect(buildIndex()).rejects.toThrow(HyperliquidError);
      await expect(buildIndex()).rejects.toThrow('No documents found during crawling');
    });

    it('should handle embedding errors', async () => {
      mockCrawler.crawlSite.mockResolvedValue({
        documents: [
          {
            url: 'https://test.gitbook.io/docs/page1',
            title: 'Test Page',
            content: 'Test content',
            lastModified: new Date(),
            contentHash: 'hash1',
          },
        ],
        errors: [],
      });

      mockEmbedder.embed.mockRejectedValue(new Error('API quota exceeded'));

      await expect(buildIndex()).rejects.toThrow(HyperliquidError);
      await expect(buildIndex()).rejects.toThrow('Failed to build index');
    });

    it('should validate configuration', async () => {
      delete process.env.OPENAI_API_KEY;

      // Set up crawler mock to return documents so we get to the embedding stage
      mockCrawler.crawlSite.mockResolvedValue({
        documents: [
          {
            url: 'https://test.gitbook.io/docs/page1',
            title: 'Test Page',
            content: 'Test content',
            lastModified: new Date(),
            contentHash: 'hash1',
          },
        ],
        errors: [],
      });

      try {
        await buildIndex();
        expect.fail('Expected buildIndex to throw an error');
      } catch (error) {
        expect(error).toBeInstanceOf(HyperliquidError);
        const hyperliquidError = error as HyperliquidError;
        // The error should be thrown directly as CONFIG_ERROR
        expect(hyperliquidError.code).toBe(ErrorCode.CONFIG_ERROR);
        expect(hyperliquidError.message).toContain('OpenAI API key is required');
      }
    });

    it('should support custom configuration overrides', async () => {
      const customConfig = {
        baseUrl: 'https://custom.docs.com',
        embeddingModel: 'text-embedding-ada-002',
        maxPages: 50,
      };

      mockCrawler.crawlSite.mockResolvedValue({
        documents: [
          {
            url: 'https://custom.docs.com/page1',
            title: 'Custom Page',
            content: 'Custom content',
            lastModified: new Date(),
            contentHash: 'hash1',
          },
        ],
        errors: [],
      });

      mockEmbedder.embed.mockResolvedValue([[0.1, 0.2, 0.3]]);
      mockVectorStore.upsert.mockResolvedValue(undefined);

      await buildIndex({ config: customConfig });

      // Verify crawler was called with custom config
      expect(vi.mocked(await import('./crawler.js')).GitBookCrawler).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'https://custom.docs.com',
          maxPages: 50,
        })
      );

      // Verify embedder was called with custom model
      expect(vi.mocked(await import('./embeddings.js')).OpenAIEmbedder).toHaveBeenCalledWith(
        'test-api-key',
        'text-embedding-ada-002'
      );
    });
  });

  describe('search', () => {
    it('should successfully search and return results', async () => {
      const mockResults = [
        {
          title: 'Trading API Guide',
          snippet: 'Learn how to use the trading API for placing orders...',
          url: 'https://test.gitbook.io/docs/trading-api',
          score: 0.95,
        },
        {
          title: 'WebSocket Connections',
          snippet: 'Real-time data streaming using WebSocket connections...',
          url: 'https://test.gitbook.io/docs/websocket',
          score: 0.87,
        },
      ];

      mockEmbedder.embed.mockResolvedValue([[0.1, 0.2, 0.3]]);
      mockVectorStore.search.mockResolvedValue(mockResults);

      const results = await search('trading API');

      expect(results).toEqual(mockResults);
      expect(mockEmbedder.embed).toHaveBeenCalledWith(['trading API']);
      expect(mockVectorStore.search).toHaveBeenCalledWith([0.1, 0.2, 0.3], 5);
    });

    it('should validate search query', async () => {
      await expect(search('')).rejects.toThrow(HyperliquidError);
      await expect(search('')).rejects.toThrow('Search query cannot be empty');

      await expect(search('   ')).rejects.toThrow(HyperliquidError);
      await expect(search('   ')).rejects.toThrow('Search query cannot be empty');
    });

    it('should validate topK parameter', async () => {
      // Test topK = 0
      await expect(search('test', { topK: 0 })).rejects.toThrow(HyperliquidError);

      // Test topK = 101
      await expect(search('test', { topK: 101 })).rejects.toThrow(HyperliquidError);
    });

    it('should handle custom topK values', async () => {
      mockEmbedder.embed.mockResolvedValue([[0.1, 0.2, 0.3]]);
      mockVectorStore.search.mockResolvedValue([]);

      await search('test query', { topK: 10 });

      expect(mockVectorStore.search).toHaveBeenCalledWith([0.1, 0.2, 0.3], 10);
    });

    it('should handle embedding errors during search', async () => {
      mockEmbedder.embed.mockRejectedValue(new Error('API error'));

      await expect(search('test query')).rejects.toThrow(HyperliquidError);
      await expect(search('test query')).rejects.toThrow('Failed to search index');
    });

    it('should handle vector store errors during search', async () => {
      mockEmbedder.embed.mockResolvedValue([[0.1, 0.2, 0.3]]);
      mockVectorStore.search.mockRejectedValue(new Error('Database error'));

      await expect(search('test query')).rejects.toThrow(HyperliquidError);
      await expect(search('test query')).rejects.toThrow('Failed to search index');
    });

    it('should support custom configuration for search', async () => {
      const customConfig = {
        embeddingModel: 'text-embedding-ada-002',
      };

      mockEmbedder.embed.mockResolvedValue([[0.1, 0.2, 0.3]]);
      mockVectorStore.search.mockResolvedValue([]);

      await search('test query', { config: customConfig });

      expect(vi.mocked(await import('./embeddings.js')).OpenAIEmbedder).toHaveBeenCalledWith(
        'test-api-key',
        'text-embedding-ada-002'
      );
    });
  });

  describe('Configuration Management', () => {
    it('should use environment variables as defaults', async () => {
      process.env.RAG_BASE_URL = 'https://env.docs.com';
      process.env.EMBEDDING_MODEL = 'text-embedding-ada-002';
      process.env.RAG_MAX_PAGES = '500';

      mockCrawler.crawlSite.mockResolvedValue({
        documents: [
          {
            url: 'https://env.docs.com/page1',
            title: 'Env Page',
            content: 'Env content',
            lastModified: new Date(),
            contentHash: 'hash1',
          },
        ],
        errors: [],
      });

      mockEmbedder.embed.mockResolvedValue([[0.1, 0.2, 0.3]]);
      mockVectorStore.upsert.mockResolvedValue(undefined);

      await buildIndex();

      expect(vi.mocked(await import('./crawler.js')).GitBookCrawler).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'https://env.docs.com',
          maxPages: 500,
        })
      );

      expect(vi.mocked(await import('./embeddings.js')).OpenAIEmbedder).toHaveBeenCalledWith(
        'test-api-key',
        'text-embedding-ada-002'
      );
    });

    it('should handle missing OpenAI API key', async () => {
      delete process.env.OPENAI_API_KEY;

      // Set up crawler mock to return documents so we get to the embedding stage
      mockCrawler.crawlSite.mockResolvedValue({
        documents: [
          {
            url: 'https://test.gitbook.io/docs/page1',
            title: 'Test Page',
            content: 'Test content',
            lastModified: new Date(),
            contentHash: 'hash1',
          },
        ],
        errors: [],
      });

      try {
        await buildIndex();
        expect.fail('Expected buildIndex to throw an error');
      } catch (error) {
        expect(error).toBeInstanceOf(HyperliquidError);
        const hyperliquidError = error as HyperliquidError;
        expect(hyperliquidError.code).toBe(ErrorCode.CONFIG_ERROR);
        expect(hyperliquidError.message).toContain('OpenAI API key is required');
      }
    });

    it('should handle invalid embedding provider', async () => {
      await expect(
        buildIndex({
          config: { embeddingProvider: 'invalid' as any },
        })
      ).rejects.toThrow(HyperliquidError);
    });

    it('should handle local embedding provider (not implemented)', async () => {
      // Set up crawler mock to return documents so we get to the embedding stage
      mockCrawler.crawlSite.mockResolvedValue({
        documents: [
          {
            url: 'https://test.gitbook.io/docs/page1',
            title: 'Test Page',
            content: 'Test content',
            lastModified: new Date(),
            contentHash: 'hash1',
          },
        ],
        errors: [],
      });

      try {
        await buildIndex({
          config: { embeddingProvider: 'local' },
        });
        expect.fail('Expected buildIndex to throw an error');
      } catch (error) {
        expect(error).toBeInstanceOf(HyperliquidError);
        const hyperliquidError = error as HyperliquidError;
        expect(hyperliquidError.code).toBe(ErrorCode.NOT_IMPLEMENTED);
        expect(hyperliquidError.message).toContain('Local embedding provider not yet implemented');
      }
    });
  });
});