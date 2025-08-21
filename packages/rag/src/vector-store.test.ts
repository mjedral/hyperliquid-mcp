import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteVectorStore } from './vector-store';
import { ChunkWithEmbedding } from '@hl/shared';
import { HyperliquidError, ErrorCode } from '@hl/shared';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

describe('SQLiteVectorStore', () => {
    let vectorStore: SQLiteVectorStore;
    let tempDbPath: string;

    beforeEach(() => {
        // Create temporary database file
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-store-test-'));
        tempDbPath = path.join(tempDir, 'test.db');
        vectorStore = new SQLiteVectorStore(tempDbPath, 3); // Use 3 dimensions for testing
    });

    afterEach(() => {
        vectorStore.close();
        // Clean up temp files
        fs.removeSync(path.dirname(tempDbPath));
    });

    describe('constructor and initialization', () => {
        it('should create database file and initialize schema', () => {
            expect(fs.existsSync(tempDbPath)).toBe(true);

            const stats = vectorStore.getStats();
            expect(stats.chunkCount).toBe(0);
            expect(stats.dimensions).toBe(3);
        });

        it('should create directory if it does not exist', () => {
            const nestedPath = path.join(path.dirname(tempDbPath), 'nested', 'path', 'test.db');
            const nestedVectorStore = new SQLiteVectorStore(nestedPath, 3);

            expect(fs.existsSync(nestedPath)).toBe(true);
            nestedVectorStore.close();
        });
    });

    describe('upsert', () => {
        it('should insert new chunks with embeddings', async () => {
            const chunks: ChunkWithEmbedding[] = [
                {
                    id: 'chunk1',
                    documentUrl: 'https://example.com/doc1',
                    content: 'This is the first chunk content',
                    title: 'Document 1',
                    startOffset: 0,
                    endOffset: 32,
                    tokenCount: 8,
                    embedding: [0.1, 0.2, 0.3]
                },
                {
                    id: 'chunk2',
                    documentUrl: 'https://example.com/doc2',
                    content: 'This is the second chunk content',
                    title: 'Document 2',
                    startOffset: 0,
                    endOffset: 33,
                    tokenCount: 8,
                    embedding: [0.4, 0.5, 0.6]
                }
            ];

            await vectorStore.upsert(chunks);

            const stats = vectorStore.getStats();
            expect(stats.chunkCount).toBe(2);
        });

        it('should update existing chunks', async () => {
            const initialChunk: ChunkWithEmbedding = {
                id: 'chunk1',
                documentUrl: 'https://example.com/doc1',
                content: 'Original content',
                title: 'Original Title',
                startOffset: 0,
                endOffset: 16,
                tokenCount: 4,
                embedding: [0.1, 0.2, 0.3]
            };

            await vectorStore.upsert([initialChunk]);

            const updatedChunk: ChunkWithEmbedding = {
                id: 'chunk1',
                documentUrl: 'https://example.com/doc1-updated',
                content: 'Updated content',
                title: 'Updated Title',
                startOffset: 0,
                endOffset: 15,
                tokenCount: 4,
                embedding: [0.7, 0.8, 0.9]
            };

            await vectorStore.upsert([updatedChunk]);

            const stats = vectorStore.getStats();
            expect(stats.chunkCount).toBe(1); // Should still be 1 (updated, not inserted)

            // Verify the content was updated by searching
            const results = await vectorStore.search([0.7, 0.8, 0.9], 1);
            expect(results[0].title).toBe('Updated Title');
            expect(results[0].url).toBe('https://example.com/doc1-updated');
        });

        it('should handle empty chunks array', async () => {
            await vectorStore.upsert([]);
            const stats = vectorStore.getStats();
            expect(stats.chunkCount).toBe(0);
        });

        it('should throw error for wrong embedding dimensions', async () => {
            const chunk: ChunkWithEmbedding = {
                id: 'chunk1',
                documentUrl: 'https://example.com/doc1',
                content: 'Test content',
                title: 'Test',
                startOffset: 0,
                endOffset: 12,
                tokenCount: 3,
                embedding: [0.1, 0.2] // Wrong dimensions (2 instead of 3)
            };

            await expect(vectorStore.upsert([chunk])).rejects.toThrow(HyperliquidError);
            await expect(vectorStore.upsert([chunk])).rejects.toThrow('Embedding dimension mismatch');
        });
    });

    describe('search', () => {
        beforeEach(async () => {
            // Set up test data
            const chunks: ChunkWithEmbedding[] = [
                {
                    id: 'chunk1',
                    documentUrl: 'https://example.com/doc1',
                    content: 'This is about machine learning and artificial intelligence',
                    title: 'AI Basics',
                    startOffset: 0,
                    endOffset: 56,
                    tokenCount: 10,
                    embedding: [1.0, 0.0, 0.0] // Orthogonal vectors for testing
                },
                {
                    id: 'chunk2',
                    documentUrl: 'https://example.com/doc2',
                    content: 'This discusses natural language processing and NLP techniques',
                    title: 'NLP Guide',
                    startOffset: 0,
                    endOffset: 59,
                    tokenCount: 10,
                    embedding: [0.0, 1.0, 0.0]
                },
                {
                    id: 'chunk3',
                    documentUrl: 'https://example.com/doc3',
                    content: 'Computer vision and image recognition are important topics',
                    title: 'Computer Vision',
                    startOffset: 0,
                    endOffset: 57,
                    tokenCount: 10,
                    embedding: [0.0, 0.0, 1.0]
                }
            ];

            await vectorStore.upsert(chunks);
        });

        it('should return results ranked by cosine similarity', async () => {
            // Query vector closest to chunk1's embedding
            const results = await vectorStore.search([0.9, 0.1, 0.1], 3);

            expect(results).toHaveLength(3);
            expect(results[0].title).toBe('AI Basics'); // Should be most similar
            expect(results[0].score).toBeGreaterThan(results[1].score);
            expect(results[1].score).toBeGreaterThanOrEqual(results[2].score);
        });

        it('should limit results to topK', async () => {
            const results = await vectorStore.search([0.5, 0.5, 0.0], 2);
            expect(results).toHaveLength(2);
        });

        it('should include proper snippet truncation', async () => {
            // Add a chunk with long content
            const longChunk: ChunkWithEmbedding = {
                id: 'long-chunk',
                documentUrl: 'https://example.com/long',
                content: 'A'.repeat(300), // 300 characters
                title: 'Long Document',
                startOffset: 0,
                endOffset: 300,
                tokenCount: 50,
                embedding: [0.5, 0.5, 0.5]
            };

            await vectorStore.upsert([longChunk]);

            const results = await vectorStore.search([0.5, 0.5, 0.5], 1);
            expect(results[0].snippet).toHaveLength(203); // 200 chars + '...'
            expect(results[0].snippet.endsWith('...')).toBe(true);
        });

        it('should not truncate short content', async () => {
            const results = await vectorStore.search([1.0, 0.0, 0.0], 1);
            expect(results[0].snippet).toBe('This is about machine learning and artificial intelligence');
            expect(results[0].snippet.endsWith('...')).toBe(false);
        });

        it('should throw error for wrong query dimensions', async () => {
            await expect(vectorStore.search([0.1, 0.2], 5)).rejects.toThrow(HyperliquidError);
            await expect(vectorStore.search([0.1, 0.2], 5)).rejects.toThrow('Query embedding dimension mismatch');
        });

        it('should throw error for invalid topK values', async () => {
            await expect(vectorStore.search([0.1, 0.2, 0.3], 0)).rejects.toThrow(HyperliquidError);
            await expect(vectorStore.search([0.1, 0.2, 0.3], -1)).rejects.toThrow(HyperliquidError);
            await expect(vectorStore.search([0.1, 0.2, 0.3], 1001)).rejects.toThrow(HyperliquidError);
        });

        it('should return empty results when no chunks exist', async () => {
            vectorStore.clear();
            const results = await vectorStore.search([0.1, 0.2, 0.3], 5);
            expect(results).toHaveLength(0);
        });
    });

    describe('cosine similarity calculation', () => {
        it('should calculate correct similarity for identical vectors', async () => {
            const chunk: ChunkWithEmbedding = {
                id: 'test',
                documentUrl: 'https://example.com/test',
                content: 'Test content',
                title: 'Test',
                startOffset: 0,
                endOffset: 12,
                tokenCount: 3,
                embedding: [1.0, 0.0, 0.0]
            };

            await vectorStore.upsert([chunk]);
            const results = await vectorStore.search([1.0, 0.0, 0.0], 1);

            expect(results[0].score).toBeCloseTo(1.0, 5); // Should be exactly 1.0
        });

        it('should calculate correct similarity for orthogonal vectors', async () => {
            const chunk: ChunkWithEmbedding = {
                id: 'test',
                documentUrl: 'https://example.com/test',
                content: 'Test content',
                title: 'Test',
                startOffset: 0,
                endOffset: 12,
                tokenCount: 3,
                embedding: [1.0, 0.0, 0.0]
            };

            await vectorStore.upsert([chunk]);
            const results = await vectorStore.search([0.0, 1.0, 0.0], 1);

            expect(results[0].score).toBeCloseTo(0.0, 5); // Should be exactly 0.0
        });

        it('should calculate correct similarity for opposite vectors', async () => {
            const chunk: ChunkWithEmbedding = {
                id: 'test',
                documentUrl: 'https://example.com/test',
                content: 'Test content',
                title: 'Test',
                startOffset: 0,
                endOffset: 12,
                tokenCount: 3,
                embedding: [1.0, 0.0, 0.0]
            };

            await vectorStore.upsert([chunk]);
            const results = await vectorStore.search([-1.0, 0.0, 0.0], 1);

            expect(results[0].score).toBeCloseTo(-1.0, 5); // Should be exactly -1.0
        });
    });

    describe('utility methods', () => {
        it('should return correct stats', async () => {
            const initialStats = vectorStore.getStats();
            expect(initialStats.chunkCount).toBe(0);
            expect(initialStats.dimensions).toBe(3);

            const chunks: ChunkWithEmbedding[] = [
                {
                    id: 'chunk1',
                    documentUrl: 'https://example.com/doc1',
                    content: 'Test content 1',
                    title: 'Test 1',
                    startOffset: 0,
                    endOffset: 14,
                    tokenCount: 3,
                    embedding: [0.1, 0.2, 0.3]
                },
                {
                    id: 'chunk2',
                    documentUrl: 'https://example.com/doc2',
                    content: 'Test content 2',
                    title: 'Test 2',
                    startOffset: 0,
                    endOffset: 14,
                    tokenCount: 3,
                    embedding: [0.4, 0.5, 0.6]
                }
            ];

            await vectorStore.upsert(chunks);

            const updatedStats = vectorStore.getStats();
            expect(updatedStats.chunkCount).toBe(2);
            expect(updatedStats.dimensions).toBe(3);
        });

        it('should clear all data', async () => {
            const chunks: ChunkWithEmbedding[] = [
                {
                    id: 'chunk1',
                    documentUrl: 'https://example.com/doc1',
                    content: 'Test content',
                    title: 'Test',
                    startOffset: 0,
                    endOffset: 12,
                    tokenCount: 3,
                    embedding: [0.1, 0.2, 0.3]
                }
            ];

            await vectorStore.upsert(chunks);
            expect(vectorStore.getStats().chunkCount).toBe(1);

            vectorStore.clear();
            expect(vectorStore.getStats().chunkCount).toBe(0);
        });
    });

    describe('data persistence', () => {
        it('should persist data across database connections', async () => {
            const chunks: ChunkWithEmbedding[] = [
                {
                    id: 'persistent-chunk',
                    documentUrl: 'https://example.com/persistent',
                    content: 'This data should persist',
                    title: 'Persistent Data',
                    startOffset: 0,
                    endOffset: 24,
                    tokenCount: 5,
                    embedding: [0.7, 0.8, 0.9]
                }
            ];

            await vectorStore.upsert(chunks);
            vectorStore.close();

            // Create new instance with same database file
            const newVectorStore = new SQLiteVectorStore(tempDbPath, 3);

            const stats = newVectorStore.getStats();
            expect(stats.chunkCount).toBe(1);

            const results = await newVectorStore.search([0.7, 0.8, 0.9], 1);
            expect(results[0].title).toBe('Persistent Data');
            expect(results[0].url).toBe('https://example.com/persistent');

            newVectorStore.close();
        });
    });

    describe('error handling', () => {
        it('should handle database errors gracefully', () => {
            // Close the database to simulate error conditions
            vectorStore.close();

            expect(() => vectorStore.getStats()).toThrow(HyperliquidError);
        });

        it('should validate error codes', async () => {
            try {
                await vectorStore.search([0.1, 0.2], 5); // Wrong dimensions
            } catch (error) {
                expect(error).toBeInstanceOf(HyperliquidError);
                expect((error as HyperliquidError).code).toBe(ErrorCode.INVALID_PARAMETER);
            }
        });
    });
});