import { describe, it, expect } from 'vitest';
import { search, buildIndex } from './api';

describe('RAG API', () => {
    it('should return empty results for search', async () => {
        const results = await search('test query');
        expect(results).toEqual([]);
    });

    it('should complete buildIndex without error', async () => {
        await expect(buildIndex()).resolves.toBeUndefined();
    });
});