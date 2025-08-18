import { describe, it, expect, beforeEach } from 'vitest';
import { DocumentChunker } from './chunker';
import { Document } from '@hl/shared';

describe('DocumentChunker', () => {
    let chunker: DocumentChunker;

    beforeEach(() => {
        chunker = new DocumentChunker({
            minTokens: 50,
            maxTokens: 100,
            overlapTokens: 20,
        });
    });

    describe('constructor', () => {
        it('should use default configuration when no config provided', () => {
            const defaultChunker = new DocumentChunker();
            expect(defaultChunker).toBeDefined();
        });

        it('should throw error when minTokens >= maxTokens', () => {
            expect(() => new DocumentChunker({
                minTokens: 100,
                maxTokens: 50,
            })).toThrow('minTokens must be less than maxTokens');
        });

        it('should throw error when overlapTokens >= minTokens', () => {
            expect(() => new DocumentChunker({
                minTokens: 50,
                maxTokens: 100,
                overlapTokens: 60,
            })).toThrow('overlapTokens must be less than minTokens');
        });

        it('should throw error when overlapTokens is negative', () => {
            expect(() => new DocumentChunker({
                minTokens: 50,
                maxTokens: 100,
                overlapTokens: -10,
            })).toThrow('overlapTokens must be non-negative');
        });
    });

    describe('estimateTokens', () => {
        it('should estimate tokens for simple text', () => {
            const text = 'This is a simple test sentence.';
            const tokens = chunker.estimateTokens(text);
            expect(tokens).toBeGreaterThan(0);
            expect(tokens).toBeLessThan(20); // Should be reasonable for short text
        });

        it('should handle empty text', () => {
            const tokens = chunker.estimateTokens('');
            expect(tokens).toBe(0);
        });

        it('should handle whitespace-only text', () => {
            const tokens = chunker.estimateTokens('   \n\t  ');
            expect(tokens).toBe(0);
        });

        it('should normalize whitespace before counting', () => {
            const text1 = 'This is a test.';
            const text2 = 'This    is\n\na\t\ttest.';
            expect(chunker.estimateTokens(text1)).toBe(chunker.estimateTokens(text2));
        });

        it('should provide consistent estimates for similar length texts', () => {
            const text1 = 'The quick brown fox jumps over the lazy dog.';
            const text2 = 'A simple sentence with approximately same length.';
            const tokens1 = chunker.estimateTokens(text1);
            const tokens2 = chunker.estimateTokens(text2);

            // Should be within reasonable range of each other
            expect(Math.abs(tokens1 - tokens2)).toBeLessThan(5);
        });
    });

    describe('chunkDocument', () => {
        it('should chunk a simple document without sections', () => {
            const doc: Document = {
                url: 'https://example.com/doc',
                title: 'Test Document',
                content: 'This is a simple document with just plain text content that should be chunked appropriately.',
                lastModified: new Date(),
                contentHash: 'hash123',
            };

            const chunks = chunker.chunkDocument(doc);
            expect(chunks).toHaveLength(1);
            expect(chunks[0].title).toBe('Test Document');
            expect(chunks[0].documentUrl).toBe('https://example.com/doc');
            expect(chunks[0].content).toBe(doc.content);
            expect(chunks[0].id).toBeDefined();
            expect(chunks[0].tokenCount).toBeGreaterThan(0);
        });

        it('should preserve section hierarchy', () => {
            const doc: Document = {
                url: 'https://example.com/doc',
                title: 'Test Document',
                content: `# Main Section
This is the main section content.

## Subsection
This is subsection content with more details.

### Sub-subsection
Even more detailed content here.`,
                lastModified: new Date(),
                contentHash: 'hash123',
            };

            const chunks = chunker.chunkDocument(doc);
            expect(chunks.length).toBeGreaterThan(0);

            // Check that section titles are preserved
            const titles = chunks.map(c => c.title);
            expect(titles).toContain('Main Section');
            expect(titles).toContain('Subsection');
            expect(titles).toContain('Sub-subsection');
        });

        it('should handle documents with no markdown headers', () => {
            const doc: Document = {
                url: 'https://example.com/doc',
                title: 'Plain Document',
                content: 'Just plain text without any headers or structure.',
                lastModified: new Date(),
                contentHash: 'hash123',
            };

            const chunks = chunker.chunkDocument(doc);
            expect(chunks).toHaveLength(1);
            expect(chunks[0].title).toBe('Plain Document');
        });

        it('should create overlapping chunks for long sections', () => {
            // Create a long section that will need multiple chunks
            const longContent = Array(50).fill('This is a sentence that will make the content long enough to require chunking.').join(' ');

            const doc: Document = {
                url: 'https://example.com/doc',
                title: 'Long Document',
                content: `# Long Section\n${longContent}`,
                lastModified: new Date(),
                contentHash: 'hash123',
            };

            const chunks = chunker.chunkDocument(doc);
            expect(chunks.length).toBeGreaterThan(1);

            // Check that chunks have proper token counts
            chunks.forEach(chunk => {
                expect(chunk.tokenCount).toBeGreaterThan(0);
                expect(chunk.tokenCount).toBeLessThanOrEqual(100); // maxTokens
            });
        });

        it('should generate unique IDs for different chunks', () => {
            const doc: Document = {
                url: 'https://example.com/doc',
                title: 'Test Document',
                content: `# Section 1
Content for section 1.

# Section 2  
Content for section 2.`,
                lastModified: new Date(),
                contentHash: 'hash123',
            };

            const chunks = chunker.chunkDocument(doc);
            const ids = chunks.map(c => c.id);
            const uniqueIds = new Set(ids);

            expect(uniqueIds.size).toBe(ids.length);
        });

        it('should handle empty sections gracefully', () => {
            const doc: Document = {
                url: 'https://example.com/doc',
                title: 'Test Document',
                content: `# Section 1

# Section 2
Some content here.

# Section 3

`,
                lastModified: new Date(),
                contentHash: 'hash123',
            };

            const chunks = chunker.chunkDocument(doc);
            // Should only create chunks for sections with content
            expect(chunks.length).toBe(1);
            expect(chunks[0].title).toBe('Section 2');
        });
    });

    describe('edge cases and token limits', () => {
        it('should handle very short documents', () => {
            const doc: Document = {
                url: 'https://example.com/doc',
                title: 'Short',
                content: 'Hi.',
                lastModified: new Date(),
                contentHash: 'hash123',
            };

            const chunks = chunker.chunkDocument(doc);
            expect(chunks).toHaveLength(1);
            expect(chunks[0].content).toBe('Hi.');
        });

        it('should handle documents with only whitespace', () => {
            const doc: Document = {
                url: 'https://example.com/doc',
                title: 'Empty',
                content: '   \n\n\t  ',
                lastModified: new Date(),
                contentHash: 'hash123',
            };

            const chunks = chunker.chunkDocument(doc);
            expect(chunks).toHaveLength(0);
        });

        it('should respect minimum token limits', () => {
            const chunkerWithHighMin = new DocumentChunker({
                minTokens: 200,
                maxTokens: 300,
                overlapTokens: 50,
            });

            const doc: Document = {
                url: 'https://example.com/doc',
                title: 'Test',
                content: 'Short content that is below minimum token threshold.',
                lastModified: new Date(),
                contentHash: 'hash123',
            };

            const chunks = chunkerWithHighMin.chunkDocument(doc);
            // Should still create chunk even if below minimum (for single section)
            expect(chunks).toHaveLength(1);
        });

        it('should handle documents with special characters', () => {
            const doc: Document = {
                url: 'https://example.com/doc',
                title: 'Special Chars',
                content: 'Content with émojis 🚀, unicode ñ, and symbols @#$%^&*().',
                lastModified: new Date(),
                contentHash: 'hash123',
            };

            const chunks = chunker.chunkDocument(doc);
            expect(chunks).toHaveLength(1);
            expect(chunks[0].content).toContain('🚀');
            expect(chunks[0].content).toContain('ñ');
        });

        it('should maintain proper start and end offsets', () => {
            const doc: Document = {
                url: 'https://example.com/doc',
                title: 'Test',
                content: 'First sentence. Second sentence. Third sentence.',
                lastModified: new Date(),
                contentHash: 'hash123',
            };

            const chunks = chunker.chunkDocument(doc);
            expect(chunks).toHaveLength(1);
            expect(chunks[0].startOffset).toBe(0);
            expect(chunks[0].endOffset).toBeGreaterThan(0);
            expect(chunks[0].endOffset).toBeLessThanOrEqual(doc.content.length);
        });

        it('should handle code blocks and preserve formatting', () => {
            const doc: Document = {
                url: 'https://example.com/doc',
                title: 'Code Example',
                content: `# Code Section
Here's some code:

\`\`\`typescript
function example() {
  return "hello world";
}
\`\`\`

And some explanation after.`,
                lastModified: new Date(),
                contentHash: 'hash123',
            };

            const chunks = chunker.chunkDocument(doc);
            expect(chunks).toHaveLength(1);
            expect(chunks[0].content).toContain('```typescript');
            expect(chunks[0].content).toContain('function example()');
        });
    });

    describe('overlap functionality', () => {
        it('should create overlapping content between chunks', () => {
            // Create content that will definitely need multiple chunks
            const sentences = Array(20).fill(0).map((_, i) =>
                `This is sentence number ${i + 1} with enough content to make chunking necessary.`
            );
            const longContent = sentences.join(' ');

            const doc: Document = {
                url: 'https://example.com/doc',
                title: 'Long Document',
                content: `# Long Section\n${longContent}`,
                lastModified: new Date(),
                contentHash: 'hash123',
            };

            const chunks = chunker.chunkDocument(doc);

            if (chunks.length > 1) {
                // Check that there's some overlap between consecutive chunks
                for (let i = 1; i < chunks.length; i++) {
                    const prevChunk = chunks[i - 1];
                    const currentChunk = chunks[i];

                    // There should be some common words between chunks (indicating overlap)
                    const prevWords = new Set(prevChunk.content.toLowerCase().split(/\s+/));
                    const currentWords = new Set(currentChunk.content.toLowerCase().split(/\s+/));

                    const intersection = new Set([...prevWords].filter(x => currentWords.has(x)));
                    expect(intersection.size).toBeGreaterThan(0);
                }
            }
        });
    });
});