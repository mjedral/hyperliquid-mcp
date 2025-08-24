import { GitBookCrawler } from './crawler.js';
import { DocumentChunker } from './chunker.js';
import { OpenAIEmbedder } from './embeddings.js';
import { SQLiteVectorStore } from './vector-store.js';
import { SearchResult, EmbeddingProvider, ChunkWithEmbedding } from '@hl/shared';
import { HyperliquidError, ErrorCode } from '@hl/shared';
import * as path from 'path';

export interface RAGConfig {
  baseUrl: string;
  embeddingProvider: 'openai' | 'local';
  embeddingModel: string;
  openaiApiKey?: string;
  cacheDir: string;
  dbPath: string;
  maxPages: number;
  rateLimitMs: number;
}

export interface BuildIndexOptions {
  config?: Partial<RAGConfig>;
  onProgress?: (stage: string, progress: number, total: number) => void;
}

export interface SearchOptions {
  topK?: number;
  config?: Partial<RAGConfig>;
}

/**
 * Build the RAG index by orchestrating crawl→chunk→embed→store pipeline
 */
export async function buildIndex(options: BuildIndexOptions = {}): Promise<void> {
  const config = getConfig(options.config);
  const onProgress = options.onProgress || (() => { });

  try {
    // Stage 1: Crawl documents
    onProgress('crawling', 0, 4);
    console.log('Crawling GitBook documentation...');

    const crawler = new GitBookCrawler({
      baseUrl: config.baseUrl,
      cacheDir: config.cacheDir || path.join(process.cwd(), '.cache', 'rag'),
      maxPages: config.maxPages || 1000,
      rateLimitMs: config.rateLimitMs || 1000,
    });

    const crawlResult = await crawler.crawlSite();

    if (crawlResult.documents.length === 0) {
      throw new HyperliquidError(
        ErrorCode.CRAWL_FAILED,
        'No documents found during crawling',
        { baseUrl: config.baseUrl, errors: crawlResult.errors }
      );
    }

    console.log(`Found ${crawlResult.documents.length} documents`);
    if (crawlResult.errors.length > 0) {
      console.warn(`${crawlResult.errors.length} pages failed to crawl`);
    }

    // Stage 2: Chunk documents
    onProgress('chunking', 1, 4);
    console.log('Chunking documents...');

    const chunker = new DocumentChunker({
      minTokens: 500,
      maxTokens: 1000,
      overlapTokens: 75,
    });

    const allChunks = crawlResult.documents.flatMap(doc => chunker.chunkDocument(doc));
    console.log(`Created ${allChunks.length} chunks`);

    // Stage 3: Generate embeddings
    onProgress('embedding', 2, 4);
    console.log('Generating embeddings...');

    const embeddingProvider = createEmbeddingProvider(config);
    const texts = allChunks.map(chunk => chunk.content);
    const embeddings = await embeddingProvider.embed(texts);

    const chunksWithEmbeddings: ChunkWithEmbedding[] = allChunks.map((chunk, i) => ({
      ...chunk,
      embedding: embeddings[i] || [],
    }));

    console.log(`Generated ${embeddings.length} embeddings`);

    // Stage 4: Store in vector database
    onProgress('storing', 3, 4);
    console.log('Storing in vector database...');

    const vectorStore = new SQLiteVectorStore(config.dbPath || path.join(process.cwd(), '.cache', 'rag', 'vectors.db'), embeddingProvider.getDimensions());
    await vectorStore.upsert(chunksWithEmbeddings);

    onProgress('complete', 4, 4);
    console.log('Index built successfully');
    console.log(`Indexed ${chunksWithEmbeddings.length} chunks from ${crawlResult.documents.length} documents`);

  } catch (error) {
    if (error instanceof HyperliquidError) {
      throw error;
    }
    throw new HyperliquidError(
      ErrorCode.INDEX_BUILD_FAILED,
      'Failed to build index',
      { originalError: error instanceof Error ? error.message : String(error) }
    );
  }
}

/**
 * Search the RAG index with configurable top-k results
 */
export async function search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
  const config = getConfig(options.config);
  const topK = options.topK || 5;

  if (!query.trim()) {
    throw new HyperliquidError(
      ErrorCode.INVALID_INPUT,
      'Search query cannot be empty'
    );
  }

  if (topK < 1 || topK > 100) {
    throw new HyperliquidError(
      ErrorCode.INVALID_INPUT,
      'topK must be between 1 and 100',
      { topK }
    );
  }

  try {
    // Generate embedding for query
    const embeddingProvider = createEmbeddingProvider(config);
    const queryEmbeddings = await embeddingProvider.embed([query]);
    const queryEmbedding = queryEmbeddings[0] || [];

    // Search vector store
    const vectorStore = new SQLiteVectorStore(config.dbPath || path.join(process.cwd(), '.cache', 'rag', 'vectors.db'), embeddingProvider.getDimensions());
    const results = await vectorStore.search(queryEmbedding, topK);

    return results;

  } catch (error) {
    if (error instanceof HyperliquidError) {
      throw error;
    }
    throw new HyperliquidError(
      ErrorCode.SEARCH_FAILED,
      'Failed to search index',
      { query, originalError: error instanceof Error ? error.message : String(error) }
    );
  }
}

/**
 * Get configuration from environment variables and options
 */
function getConfig(overrides: Partial<RAGConfig> = {}): RAGConfig {
  const baseConfig: RAGConfig = {
    baseUrl: process.env['RAG_BASE_URL'] || 'https://hyperliquid.gitbook.io/hyperliquid-docs',
    embeddingProvider: (process.env['EMBEDDING_PROVIDER'] as 'openai' | 'local') || 'openai',
    embeddingModel: process.env['EMBEDDING_MODEL'] || 'text-embedding-3-small',
    cacheDir: process.env['RAG_CACHE_DIR'] || path.join(process.cwd(), '.cache', 'rag'),
    dbPath: process.env['RAG_DB_PATH'] || path.join(process.cwd(), '.cache', 'rag', 'vectors.db'),
    maxPages: parseInt(process.env['RAG_MAX_PAGES'] || '1000'),
    rateLimitMs: parseInt(process.env['RAG_RATE_LIMIT_MS'] || '1000'),
  };

  // Add openaiApiKey only if it exists
  if (process.env['OPENAI_API_KEY']) {
    (baseConfig as any).openaiApiKey = process.env['OPENAI_API_KEY'];
  }

  return { ...baseConfig, ...overrides };
}

/**
 * Create embedding provider based on configuration
 */
function createEmbeddingProvider(config: RAGConfig): EmbeddingProvider {
  switch (config.embeddingProvider) {
    case 'openai':
      if (!config.openaiApiKey) {
        throw new HyperliquidError(
          ErrorCode.CONFIG_ERROR,
          'OpenAI API key is required for OpenAI embedding provider',
          { provider: 'openai' }
        );
      }
      return new OpenAIEmbedder(config.openaiApiKey, config.embeddingModel);

    case 'local':
      throw new HyperliquidError(
        ErrorCode.NOT_IMPLEMENTED,
        'Local embedding provider not yet implemented',
        { provider: 'local' }
      );

    default:
      throw new HyperliquidError(
        ErrorCode.CONFIG_ERROR,
        'Invalid embedding provider',
        { provider: config.embeddingProvider }
      );
  }
}
