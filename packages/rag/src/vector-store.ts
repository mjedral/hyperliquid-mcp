import Database from 'better-sqlite3';
import { VectorStore, ChunkWithEmbedding, SearchResult } from '@hl/shared';
import { HyperliquidError, ErrorCode } from '@hl/shared';
import * as fs from 'fs-extra';
import * as path from 'path';

/**
 * SQLite-based vector store implementation with cosine similarity search
 */
export class SQLiteVectorStore implements VectorStore {
    private db: Database.Database;
    private dimensions: number;

    constructor(dbPath: string, dimensions: number = 1536) {
        this.dimensions = dimensions;

        // Ensure directory exists
        const dir = path.dirname(dbPath);
        fs.ensureDirSync(dir);

        this.db = new Database(dbPath);
        this.initializeSchema();
    }

    /**
     * Initialize database schema with proper indexing
     */
    private initializeSchema(): void {
        try {
            // Create chunks table
            this.db.exec(`
        CREATE TABLE IF NOT EXISTS chunks (
          id TEXT PRIMARY KEY,
          document_url TEXT NOT NULL,
          content TEXT NOT NULL,
          title TEXT NOT NULL,
          start_offset INTEGER NOT NULL,
          end_offset INTEGER NOT NULL,
          token_count INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

            // Create embeddings table (separate for better performance)
            this.db.exec(`
        CREATE TABLE IF NOT EXISTS embeddings (
          chunk_id TEXT PRIMARY KEY,
          embedding BLOB NOT NULL,
          FOREIGN KEY (chunk_id) REFERENCES chunks (id) ON DELETE CASCADE
        )
      `);

            // Create indexes for better query performance
            this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chunks_document_url ON chunks (document_url);
        CREATE INDEX IF NOT EXISTS idx_chunks_title ON chunks (title);
        CREATE INDEX IF NOT EXISTS idx_chunks_created_at ON chunks (created_at);
      `);

            // Enable foreign key constraints
            this.db.pragma('foreign_keys = ON');

        } catch (error) {
            throw new HyperliquidError(
                ErrorCode.VECTOR_STORE_ERROR,
                'Failed to initialize vector store schema',
                { error: error instanceof Error ? error.message : String(error) }
            );
        }
    }

    /**
     * Upsert chunks with embeddings (insert or update)
     */
    async upsert(chunks: ChunkWithEmbedding[]): Promise<void> {
        if (chunks.length === 0) return;

        // Validate embedding dimensions
        for (const chunk of chunks) {
            if (chunk.embedding.length !== this.dimensions) {
                throw new HyperliquidError(
                    ErrorCode.INVALID_PARAMETER,
                    `Embedding dimension mismatch: expected ${this.dimensions}, got ${chunk.embedding.length}`,
                    { chunkId: chunk.id }
                );
            }
        }

        const transaction = this.db.transaction((chunks: ChunkWithEmbedding[]) => {
            const upsertChunk = this.db.prepare(`
        INSERT OR REPLACE INTO chunks (
          id, document_url, content, title, start_offset, end_offset, token_count, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);

            const upsertEmbedding = this.db.prepare(`
        INSERT OR REPLACE INTO embeddings (chunk_id, embedding) VALUES (?, ?)
      `);

            for (const chunk of chunks) {
                // Insert/update chunk metadata
                upsertChunk.run(
                    chunk.id,
                    chunk.documentUrl,
                    chunk.content,
                    chunk.title,
                    chunk.startOffset,
                    chunk.endOffset,
                    chunk.tokenCount
                );

                // Convert embedding to binary format for storage
                const embeddingBuffer = Buffer.from(new Float32Array(chunk.embedding).buffer);
                upsertEmbedding.run(chunk.id, embeddingBuffer);
            }
        });

        try {
            transaction(chunks);
        } catch (error) {
            throw new HyperliquidError(
                ErrorCode.VECTOR_STORE_ERROR,
                'Failed to upsert chunks',
                { error: error instanceof Error ? error.message : String(error) }
            );
        }
    }

    /**
     * Search for similar chunks using cosine similarity
     */
    async search(query: number[], topK: number): Promise<SearchResult[]> {
        if (query.length !== this.dimensions) {
            throw new HyperliquidError(
                ErrorCode.INVALID_PARAMETER,
                `Query embedding dimension mismatch: expected ${this.dimensions}, got ${query.length}`,
                { queryDimensions: query.length, expectedDimensions: this.dimensions }
            );
        }

        if (topK <= 0 || topK > 1000) {
            throw new HyperliquidError(
                ErrorCode.INVALID_PARAMETER,
                'topK must be between 1 and 1000',
                { topK }
            );
        }

        try {
            // Get all chunks with their embeddings
            const stmt = this.db.prepare(`
        SELECT 
          c.id,
          c.document_url,
          c.content,
          c.title,
          e.embedding
        FROM chunks c
        JOIN embeddings e ON c.id = e.chunk_id
      `);

            const rows = stmt.all() as Array<{
                id: string;
                document_url: string;
                content: string;
                title: string;
                embedding: Buffer;
            }>;

            // Calculate cosine similarity for each chunk
            const results: Array<SearchResult & { score: number }> = [];

            for (const row of rows) {
                // Convert binary embedding back to float array
                const embeddingArray = new Float32Array(row.embedding.buffer);
                const embedding = Array.from(embeddingArray);

                // Calculate cosine similarity
                const similarity = this.cosineSimilarity(query, embedding);

                // Create snippet (first 200 characters)
                const snippet = row.content.length > 200
                    ? row.content.substring(0, 200) + '...'
                    : row.content;

                results.push({
                    title: row.title,
                    snippet,
                    url: row.document_url,
                    score: similarity
                });
            }

            // Sort by similarity score (descending) and return top K
            return results
                .sort((a, b) => b.score - a.score)
                .slice(0, topK);

        } catch (error) {
            throw new HyperliquidError(
                ErrorCode.VECTOR_STORE_ERROR,
                'Failed to search vector store',
                { error: error instanceof Error ? error.message : String(error) }
            );
        }
    }

    /**
     * Calculate cosine similarity between two vectors
     */
    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) {
            throw new Error('Vectors must have the same length');
        }

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            const aVal = a[i]!;
            const bVal = b[i]!;
            dotProduct += aVal * bVal;
            normA += aVal * aVal;
            normB += bVal * bVal;
        }

        normA = Math.sqrt(normA);
        normB = Math.sqrt(normB);

        if (normA === 0 || normB === 0) {
            return 0;
        }

        return dotProduct / (normA * normB);
    }

    /**
     * Get statistics about the vector store
     */
    getStats(): { chunkCount: number; dimensions: number } {
        try {
            const result = this.db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
            return {
                chunkCount: result.count,
                dimensions: this.dimensions
            };
        } catch (error) {
            throw new HyperliquidError(
                ErrorCode.VECTOR_STORE_ERROR,
                'Failed to get vector store statistics',
                { error: error instanceof Error ? error.message : String(error) }
            );
        }
    }

    /**
     * Clear all data from the vector store
     */
    clear(): void {
        try {
            this.db.exec('DELETE FROM embeddings');
            this.db.exec('DELETE FROM chunks');
        } catch (error) {
            throw new HyperliquidError(
                ErrorCode.VECTOR_STORE_ERROR,
                'Failed to clear vector store',
                { error: error instanceof Error ? error.message : String(error) }
            );
        }
    }

    /**
     * Close the database connection
     */
    close(): void {
        this.db.close();
    }
}