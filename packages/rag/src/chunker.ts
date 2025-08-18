import { Document, Chunk } from '@hl/shared';
import { createHash } from 'crypto';

export interface ChunkerConfig {
    minTokens: number;
    maxTokens: number;
    overlapTokens: number;
}

export class DocumentChunker {
    private config: ChunkerConfig;

    constructor(config: Partial<ChunkerConfig> = {}) {
        this.config = {
            minTokens: config.minTokens ?? 500,
            maxTokens: config.maxTokens ?? 1000,
            overlapTokens: config.overlapTokens ?? 75, // Default to middle of 50-100 range
        };

        // Validate configuration
        if (this.config.minTokens >= this.config.maxTokens) {
            throw new Error('minTokens must be less than maxTokens');
        }
        if (this.config.overlapTokens >= this.config.minTokens) {
            throw new Error('overlapTokens must be less than minTokens');
        }
        if (this.config.overlapTokens < 0) {
            throw new Error('overlapTokens must be non-negative');
        }
    }

    /**
     * Chunks a document into overlapping segments with structure preservation
     */
    chunkDocument(doc: Document): Chunk[] {
        const chunks: Chunk[] = [];
        const sections = this.extractSections(doc.content, doc.title);

        for (const section of sections) {
            const sectionChunks = this.chunkSection(section, doc.url);
            chunks.push(...sectionChunks);
        }

        return chunks;
    }

    /**
     * Estimates token count using a simple heuristic
     * Approximates GPT tokenization: ~4 characters per token for English text
     */
    estimateTokens(text: string): number {
        // Remove extra whitespace and normalize
        const normalized = text.trim().replace(/\s+/g, ' ');

        // Handle empty or whitespace-only text
        if (normalized.length === 0) {
            return 0;
        }

        // Basic heuristic: 4 characters per token on average
        // This is a rough approximation but sufficient for chunking purposes
        const charCount = normalized.length;
        const wordCount = normalized.split(' ').filter(word => word.length > 0).length;

        // Use a weighted average: characters/4 + words/0.75 (since words are typically 4-5 chars)
        // This gives a reasonable approximation for most English text
        return Math.ceil((charCount / 4 + wordCount / 0.75) / 2);
    }

    /**
     * Extracts sections from document content, preserving hierarchy
     */
    private extractSections(content: string, docTitle: string): DocumentSection[] {
        const lines = content.split('\n');
        const sections: DocumentSection[] = [];
        let currentSection: DocumentSection | null = null;
        let currentContent: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line === undefined) continue;

            const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);

            if (headerMatch && headerMatch[1] && headerMatch[2]) {
                // Save previous section if it exists
                if (currentSection) {
                    currentSection.content = currentContent.join('\n').trim();
                    if (currentSection.content) {
                        sections.push(currentSection);
                    }
                }

                // Start new section
                const level = headerMatch[1].length;
                const title = headerMatch[2].trim();

                currentSection = {
                    title,
                    level,
                    content: '',
                    startLine: i,
                };
                currentContent = [];
            } else {
                // Add line to current section content
                currentContent.push(line);
            }
        }

        // Don't forget the last section
        if (currentSection) {
            currentSection.content = currentContent.join('\n').trim();
            if (currentSection.content) {
                sections.push(currentSection);
            }
        }

        // If no sections found, treat entire document as one section (only if it has content)
        if (sections.length === 0) {
            const trimmedContent = content.trim();
            if (trimmedContent) {
                sections.push({
                    title: docTitle,
                    level: 1,
                    content: trimmedContent,
                    startLine: 0,
                });
            }
        }

        return sections;
    }

    /**
     * Chunks a single section into overlapping segments
     */
    private chunkSection(section: DocumentSection, documentUrl: string): Chunk[] {
        const chunks: Chunk[] = [];
        const sectionTokens = this.estimateTokens(section.content);

        // If section is small enough, return as single chunk
        if (sectionTokens <= this.config.maxTokens) {
            const chunk = this.createChunk(
                section.content,
                section.title,
                documentUrl,
                0,
                section.content.length,
                sectionTokens
            );
            chunks.push(chunk);
            return chunks;
        }

        // Split section into overlapping chunks
        const sentences = this.splitIntoSentences(section.content);
        let currentChunk = '';
        let currentTokens = 0;
        let chunkStart = 0;
        let sentenceStart = 0;

        for (let i = 0; i < sentences.length; i++) {
            const sentence = sentences[i];
            if (sentence === undefined) continue;

            const sentenceTokens = this.estimateTokens(sentence);

            // Check if adding this sentence would exceed max tokens
            if (currentTokens + sentenceTokens > this.config.maxTokens && currentChunk) {
                // Create chunk if we have enough content
                if (currentTokens >= this.config.minTokens) {
                    const chunk = this.createChunk(
                        currentChunk.trim(),
                        section.title,
                        documentUrl,
                        chunkStart,
                        chunkStart + currentChunk.length,
                        currentTokens
                    );
                    chunks.push(chunk);

                    // Start new chunk with overlap
                    const overlapContent = this.createOverlap(sentences, i, this.config.overlapTokens);
                    currentChunk = overlapContent;
                    currentTokens = this.estimateTokens(overlapContent);
                    chunkStart = sentenceStart;
                } else {
                    // Current chunk is too small, just add the sentence
                    currentChunk += (currentChunk ? ' ' : '') + sentence;
                    currentTokens += sentenceTokens;
                }
            } else {
                // Add sentence to current chunk
                currentChunk += (currentChunk ? ' ' : '') + sentence;
                currentTokens += sentenceTokens;

                if (!currentChunk.trim()) {
                    chunkStart = sentenceStart;
                }
            }

            sentenceStart += (sentence?.length ?? 0) + 1; // +1 for space/newline
        }

        // Don't forget the last chunk
        if (currentChunk.trim() && currentTokens > 0) {
            const chunk = this.createChunk(
                currentChunk.trim(),
                section.title,
                documentUrl,
                chunkStart,
                chunkStart + currentChunk.length,
                currentTokens
            );
            chunks.push(chunk);
        }

        return chunks;
    }

    /**
     * Creates overlap content by going back from current position
     */
    private createOverlap(sentences: string[], currentIndex: number, targetOverlapTokens: number): string {
        let overlapContent = '';
        let overlapTokens = 0;

        // Go backwards to build overlap
        for (let i = currentIndex - 1; i >= 0; i--) {
            const sentence = sentences[i];
            if (sentence === undefined) continue;

            const sentenceTokens = this.estimateTokens(sentence);

            if (overlapTokens + sentenceTokens > targetOverlapTokens) {
                break;
            }

            overlapContent = sentence + (overlapContent ? ' ' + overlapContent : '');
            overlapTokens += sentenceTokens;
        }

        return overlapContent;
    }

    /**
     * Splits text into sentences using simple heuristics
     */
    private splitIntoSentences(text: string): string[] {
        // Split on sentence boundaries, but be careful with abbreviations
        const sentences = text
            .split(/(?<=[.!?])\s+/)
            .filter(s => s.trim().length > 0);

        // If no sentence boundaries found, split on paragraphs
        if (sentences.length === 1) {
            return text
                .split(/\n\s*\n/)
                .filter(s => s.trim().length > 0);
        }

        return sentences;
    }

    /**
     * Creates a chunk object with proper ID generation
     */
    private createChunk(
        content: string,
        title: string,
        documentUrl: string,
        startOffset: number,
        endOffset: number,
        tokenCount: number
    ): Chunk {
        // Generate deterministic ID based on content and position
        const id = createHash('sha256')
            .update(`${documentUrl}:${startOffset}:${endOffset}:${content.substring(0, 100)}`)
            .digest('hex')
            .substring(0, 16);

        return {
            id,
            documentUrl,
            content,
            title,
            startOffset,
            endOffset,
            tokenCount,
        };
    }
}

interface DocumentSection {
    title: string;
    level: number;
    content: string;
    startLine: number;
}