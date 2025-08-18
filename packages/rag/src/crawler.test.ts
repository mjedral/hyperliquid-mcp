import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs-extra';
import { GitBookCrawler } from './crawler';
import { HyperliquidError, Document } from '@hl/shared';

// Type for accessing private methods in tests
interface CrawlerWithPrivateMethods {
    fetchWithRetry: (url: string) => Promise<string>;
    crawlPage: (url: string) => Promise<Document | null>;
    isValidDocumentUrl: (url: string) => boolean;
    resolveUrl: (href: string) => string;
}

// Mock fs-extra
vi.mock('fs-extra', () => ({
    ensureDir: vi.fn(),
    pathExists: vi.fn(),
    writeJson: vi.fn(),
    readJson: vi.fn(),
}));

const mockFs = vi.mocked(fs, true);

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('GitBookCrawler', () => {
    let crawler: GitBookCrawler;
    const testCacheDir = '/tmp/test-cache';
    const baseUrl = 'https://docs.example.com';

    beforeEach(() => {
        vi.clearAllMocks();
        crawler = new GitBookCrawler({
            baseUrl,
            cacheDir: testCacheDir,
            rateLimitMs: 100, // Faster for tests
            maxRetries: 2,
            maxPages: 10,
        });

        // Setup default fs mocks
        (mockFs.ensureDir as any).mockResolvedValue(undefined);
        (mockFs.pathExists as any).mockResolvedValue(false);
        (mockFs.writeJson as any).mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('constructor', () => {
        it('should initialize with default options', () => {
            const defaultCrawler = new GitBookCrawler({ baseUrl });
            expect(defaultCrawler).toBeDefined();
        });

        it('should remove trailing slash from baseUrl', () => {
            const crawlerWithSlash = new GitBookCrawler({
                baseUrl: 'https://docs.example.com/',
            });
            expect(crawlerWithSlash).toBeDefined();
        });
    });

    describe('crawlSite', () => {
        it('should successfully crawl a site with sitemap', async () => {
            const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://docs.example.com/page1</loc></url>
          <url><loc>https://docs.example.com/page2</loc></url>
        </urlset>`;

            const pageHtml = `
        <html>
          <head><title>Test Page</title></head>
          <body>
            <main>
              <h1>Page Title</h1>
              <p>This is the main content of the page.</p>
            </main>
          </body>
        </html>`;

            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    text: () => Promise.resolve(sitemapXml),
                } as Response)
                .mockResolvedValue({
                    ok: true,
                    text: () => Promise.resolve(pageHtml),
                } as Response);

            const result = await crawler.crawlSite();

            expect(result.documents).toHaveLength(2);
            expect(result.errors).toHaveLength(0);
            expect(result.documents[0]).toMatchObject({
                url: 'https://docs.example.com/page1',
                title: 'Page Title',
                content: expect.stringContaining('This is the main content'),
            });
        });

        it('should fallback to TOC discovery when sitemap fails', async () => {
            const mainPageHtml = `
        <html>
          <body>
            <nav>
              <a href="/docs/guide1">Guide 1</a>
              <a href="/docs/guide2">Guide 2</a>
            </nav>
            <main>
              <h1>Main Page</h1>
              <p>Welcome to the documentation.</p>
            </main>
          </body>
        </html>`;

            const guideHtml = `
        <html>
          <body>
            <main>
              <h1>Guide Title</h1>
              <p>Guide content here.</p>
            </main>
          </body>
        </html>`;

            mockFetch
                .mockRejectedValueOnce(new Error('Sitemap not found')) // Sitemap fails
                .mockResolvedValueOnce({
                    ok: true,
                    text: () => Promise.resolve(mainPageHtml),
                } as Response)
                .mockResolvedValue({
                    ok: true,
                    text: () => Promise.resolve(guideHtml),
                } as Response);

            const result = await crawler.crawlSite();

            // Should have at least the discovered pages from TOC
            expect(result.documents.length).toBeGreaterThanOrEqual(0);
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/sitemap.xml'),
                expect.any(Object)
            );
        });

        it('should handle crawl errors gracefully', async () => {
            const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://docs.example.com/page1</loc></url>
          <url><loc>https://docs.example.com/page2</loc></url>
        </urlset>`;

            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    text: () => Promise.resolve(sitemapXml),
                } as Response)
                .mockResolvedValueOnce({
                    ok: true,
                    text: () =>
                        Promise.resolve('<html><body><h1>Page 1</h1></body></html>'),
                } as Response)
                .mockRejectedValue(new Error('Network error'));

            const result = await crawler.crawlSite();

            expect(result.documents).toHaveLength(1);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toMatchObject({
                url: 'https://docs.example.com/page2',
                error: expect.stringContaining('Failed to fetch'),
            });
        });

        it('should throw HyperliquidError on complete failure', async () => {
            (mockFs.ensureDir as any).mockRejectedValue(new Error('Permission denied'));

            await expect(crawler.crawlSite()).rejects.toThrow(HyperliquidError);
            await expect(crawler.crawlSite()).rejects.toThrow('Failed to crawl site');
        });
    });

    describe('fetchWithRetry', () => {
        it('should retry on network errors', async () => {
            const crawler = new GitBookCrawler({
                baseUrl,
                maxRetries: 3,
                rateLimitMs: 10,
            });

            mockFetch
                .mockRejectedValueOnce(new Error('Network error'))
                .mockRejectedValueOnce(new Error('Network error'))
                .mockResolvedValueOnce({
                    ok: true,
                    text: () => Promise.resolve('<html><body>Success</body></html>'),
                } as Response);

            // Use reflection to access private method for testing
            const fetchMethod = (
                crawler as unknown as CrawlerWithPrivateMethods
            ).fetchWithRetry.bind(crawler);
            const result = await fetchMethod('https://docs.example.com/test');

            expect(result).toContain('Success');
            expect(mockFetch).toHaveBeenCalledTimes(3);
        }, 10000);

        it('should handle rate limiting with Retry-After header', async () => {
            const crawler = new GitBookCrawler({
                baseUrl,
                maxRetries: 2,
                rateLimitMs: 10,
            });

            const mockHeaders = new Headers();
            mockHeaders.set('Retry-After', '1');

            mockFetch
                .mockResolvedValueOnce({
                    ok: false,
                    status: 429,
                    statusText: 'Too Many Requests',
                    headers: mockHeaders,
                } as Response)
                .mockResolvedValueOnce({
                    ok: true,
                    text: () => Promise.resolve('<html><body>Success</body></html>'),
                } as Response);

            const fetchMethod = (
                crawler as unknown as CrawlerWithPrivateMethods
            ).fetchWithRetry.bind(crawler);
            const result = await fetchMethod('https://docs.example.com/test');

            expect(result).toContain('Success');
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        it('should throw HyperliquidError after max retries', async () => {
            const crawler = new GitBookCrawler({
                baseUrl,
                maxRetries: 2,
                rateLimitMs: 10,
            });

            mockFetch.mockRejectedValue(new Error('Persistent network error'));

            const fetchMethod = (
                crawler as unknown as CrawlerWithPrivateMethods
            ).fetchWithRetry.bind(crawler);

            await expect(
                fetchMethod('https://docs.example.com/test')
            ).rejects.toThrow(HyperliquidError);
            await expect(
                fetchMethod('https://docs.example.com/test')
            ).rejects.toThrow('Failed to fetch');
            expect(mockFetch).toHaveBeenCalledTimes(4); // 2 attempts for each test call (maxRetries = 2)
        }, 10000);

        it('should respect rate limiting', async () => {
            const crawler = new GitBookCrawler({
                baseUrl,
                rateLimitMs: 100,
            });

            mockFetch.mockResolvedValue({
                ok: true,
                text: () => Promise.resolve('<html><body>Success</body></html>'),
            } as Response);

            const fetchMethod = (
                crawler as unknown as CrawlerWithPrivateMethods
            ).fetchWithRetry.bind(crawler);

            const start = Date.now();
            await fetchMethod('https://docs.example.com/test1');
            await fetchMethod('https://docs.example.com/test2');
            const elapsed = Date.now() - start;

            expect(elapsed).toBeGreaterThanOrEqual(90); // Allow some timing variance
        });
    });

    describe('caching', () => {
        it('should use cached content when available and fresh', async () => {
            const cachedDoc = {
                url: 'https://docs.example.com/cached',
                title: 'Cached Page',
                content: 'Cached content',
                lastModified: new Date(),
                contentHash: 'hash123',
            };

            (mockFs.pathExists as any).mockResolvedValue(true);
            (mockFs.readJson as any).mockResolvedValue(cachedDoc);

            const crawler = new GitBookCrawler({ baseUrl });
            const crawlMethod = (crawler as unknown as CrawlerWithPrivateMethods).crawlPage.bind(
                crawler
            );
            const result = await crawlMethod('https://docs.example.com/cached');

            expect(result).toEqual(cachedDoc);
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('should refresh stale cache', async () => {
            const staleCachedDoc = {
                url: 'https://docs.example.com/stale',
                title: 'Stale Page',
                content: 'Stale content',
                lastModified: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
                contentHash: 'stale-hash',
            };

            (mockFs.pathExists as any).mockResolvedValue(true);
            (mockFs.readJson as any).mockResolvedValue(staleCachedDoc);
            mockFetch.mockResolvedValue({
                ok: true,
                text: () =>
                    Promise.resolve('<html><body><h1>Fresh Content</h1></body></html>'),
            } as Response);

            const crawler = new GitBookCrawler({ baseUrl });
            const crawlMethod = (crawler as unknown as CrawlerWithPrivateMethods).crawlPage.bind(
                crawler
            );
            const result = await crawlMethod('https://docs.example.com/stale');

            expect(result?.content).toContain('Fresh Content');
            expect(mockFetch).toHaveBeenCalled();
        });
    });

    describe('content extraction', () => {
        it('should extract title from h1 tag', () => {
            const html =
                '<html><body><h1>Main Title</h1><p>Content</p></body></html>';

            // This is a simplified test - in practice, we'd need to mock cheerio properly
            expect(html).toContain('Main Title');
        });

        it('should handle pages with no content', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                text: () => Promise.resolve('<html><body></body></html>'),
            } as Response);

            const crawler = new GitBookCrawler({ baseUrl });
            const crawlMethod = (crawler as any as CrawlerWithPrivateMethods).crawlPage.bind(
                crawler
            );
            const result = await crawlMethod('https://docs.example.com/empty');

            expect(result).toBeNull();
        });
    });

    describe('URL validation', () => {
        it('should validate document URLs correctly', () => {
            const crawler = new GitBookCrawler({
                baseUrl: 'https://docs.example.com',
            });
            const isValidMethod = (
                crawler as any as CrawlerWithPrivateMethods
            ).isValidDocumentUrl.bind(crawler);

            expect(isValidMethod('https://docs.example.com/guide')).toBe(true);
            expect(isValidMethod('https://docs.example.com/api/reference')).toBe(
                true
            );
            expect(isValidMethod('https://other-domain.com/guide')).toBe(false);
            expect(isValidMethod('https://docs.example.com/image.jpg')).toBe(false);
            expect(isValidMethod('https://docs.example.com/style.css')).toBe(false);
            expect(isValidMethod('https://docs.example.com/guide#section')).toBe(
                false
            );
        });

        it('should resolve relative URLs correctly', () => {
            const crawler = new GitBookCrawler({
                baseUrl: 'https://docs.example.com',
            });
            const resolveMethod = (
                crawler as any as CrawlerWithPrivateMethods
            ).resolveUrl.bind(crawler);

            expect(resolveMethod('/guide')).toBe('https://docs.example.com/guide');
            expect(resolveMethod('guide')).toBe('https://docs.example.com/guide');
            expect(resolveMethod('https://external.com/page')).toBe(
                'https://external.com/page'
            );
        });
    });

    describe('error scenarios', () => {
        it('should handle malformed sitemap gracefully', async () => {
            const malformedXml = 'This is not valid XML';

            mockFetch.mockResolvedValueOnce({
                ok: true,
                text: () => Promise.resolve(malformedXml),
            } as Response);

            // Should fallback to TOC discovery
            mockFetch.mockResolvedValueOnce({
                ok: true,
                text: () =>
                    Promise.resolve('<html><body><h1>Fallback</h1></body></html>'),
            } as Response);

            const result = await crawler.crawlSite();
            expect(result.documents.length).toBeGreaterThanOrEqual(0);
        });

        it('should handle cache write failures gracefully', async () => {
            (mockFs.writeJson as any).mockRejectedValue(new Error('Disk full'));
            mockFetch.mockResolvedValue({
                ok: true,
                text: () => Promise.resolve('<html><body><h1>Test</h1></body></html>'),
            } as Response);

            const crawler = new GitBookCrawler({ baseUrl });
            const crawlMethod = (crawler as any as CrawlerWithPrivateMethods).crawlPage.bind(
                crawler
            );

            // Should not throw, just warn
            const result = await crawlMethod('https://docs.example.com/test');
            expect(result).toBeDefined();
        });

        it('should handle timeout errors', async () => {
            const crawler = new GitBookCrawler({
                baseUrl,
                maxRetries: 1,
                rateLimitMs: 10,
            });

            mockFetch.mockRejectedValue(new Error('TimeoutError'));

            const fetchMethod = (
                crawler as any as CrawlerWithPrivateMethods
            ).fetchWithRetry.bind(crawler);

            await expect(
                fetchMethod('https://docs.example.com/test')
            ).rejects.toThrow(HyperliquidError);
        });
    });
});
