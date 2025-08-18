import * as cheerio from 'cheerio';
import { createHash } from 'crypto';
import * as fs from 'fs-extra';
import * as path from 'path';
import { Document, HyperliquidError, ErrorCode } from '@hl/shared';

export interface CrawlerOptions {
  baseUrl: string;
  cacheDir?: string;
  rateLimitMs?: number;
  maxRetries?: number;
  userAgent?: string;
  maxPages?: number;
}

export interface CrawlResult {
  documents: Document[];
  errors: Array<{ url: string; error: string }>;
}

/**
 * GitBook crawler with rate limiting, caching, and retry logic
 */
export class GitBookCrawler {
  private readonly baseUrl: string;
  private readonly cacheDir: string;
  private readonly rateLimitMs: number;
  private readonly maxRetries: number;
  private readonly userAgent: string;
  private readonly maxPages: number;
  private lastRequestTime = 0;

  constructor(options: CrawlerOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.cacheDir =
      options.cacheDir || path.join(process.cwd(), '.cache', 'rag');
    this.rateLimitMs = options.rateLimitMs || 1000; // 1 request per second
    this.maxRetries = options.maxRetries || 3;
    this.userAgent =
      options.userAgent ||
      'HyperliquidRAG/1.0 (+https://github.com/hyperliquid/rag)';
    this.maxPages = options.maxPages || 1000;
  }

  /**
   * Crawl the entire GitBook site
   */
  async crawlSite(): Promise<CrawlResult> {
    try {
      await fs.ensureDir(this.cacheDir);

      const urls = await this.discoverPages();
      const documents: Document[] = [];
      const errors: Array<{ url: string; error: string }> = [];

      console.log(`Discovered ${urls.length} pages to crawl`);

      for (const url of urls.slice(0, this.maxPages)) {
        try {
          const document = await this.crawlPage(url);
          if (document) {
            documents.push(document);
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          errors.push({ url, error: errorMessage });
          console.warn(`Failed to crawl ${url}: ${errorMessage}`);
        }
      }

      return { documents, errors };
    } catch (error) {
      throw new HyperliquidError(
        ErrorCode.CRAWL_FAILED,
        `Failed to crawl site: ${error instanceof Error ? error.message : String(error)
        }`,
        { baseUrl: this.baseUrl }
      );
    }
  }

  /**
   * Discover all pages from sitemap or table of contents
   */
  private async discoverPages(): Promise<string[]> {
    const urls = new Set<string>();

    // Try to get sitemap.xml first
    try {
      const sitemapUrls = await this.parseSitemap();
      sitemapUrls.forEach(url => urls.add(url));
    } catch (error) {
      console.log(
        'Sitemap not found or invalid, falling back to TOC discovery'
      );
    }

    // If no sitemap or few URLs, try to discover from main page
    if (urls.size === 0) {
      try {
        const tocUrls = await this.discoverFromTOC();
        tocUrls.forEach(url => urls.add(url));
      } catch (error) {
        console.warn('TOC discovery failed, using base URL only');
        urls.add(this.baseUrl);
      }
    }

    return Array.from(urls);
  }

  /**
   * Parse sitemap.xml to get all URLs
   */
  private async parseSitemap(): Promise<string[]> {
    const sitemapUrl = `${this.baseUrl}/sitemap.xml`;
    const content = await this.fetchWithRetry(sitemapUrl);

    const $ = cheerio.load(content, { xmlMode: true });
    const urls: string[] = [];

    // Check if this is a sitemap index
    const sitemapElements = $('sitemapindex > sitemap > loc');
    if (sitemapElements.length > 0) {
      // This is a sitemap index, fetch individual sitemaps
      for (let i = 0; i < sitemapElements.length; i++) {
        const sitemapUrl = $(sitemapElements[i]).text().trim();
        if (sitemapUrl) {
          try {
            const sitemapContent = await this.fetchWithRetry(sitemapUrl);
            const sitemapUrls = this.parseSitemapContent(sitemapContent);
            urls.push(...sitemapUrls);
          } catch (error) {
            console.warn(`Failed to fetch sitemap ${sitemapUrl}: ${error}`);
          }
        }
      }
    } else {
      // This is a regular sitemap
      const sitemapUrls = this.parseSitemapContent(content);
      urls.push(...sitemapUrls);
    }

    return urls;
  }

  /**
   * Parse sitemap content to extract URLs
   */
  private parseSitemapContent(content: string): string[] {
    const $ = cheerio.load(content, { xmlMode: true });
    const urls: string[] = [];

    $('url > loc').each((_, element) => {
      const url = $(element).text().trim();
      if (url && this.isValidDocumentUrl(url)) {
        urls.push(url);
      }
    });

    return urls;
  }

  /**
   * Discover pages from table of contents on main page
   */
  private async discoverFromTOC(): Promise<string[]> {
    const mainContent = await this.fetchWithRetry(this.baseUrl);
    const $ = cheerio.load(mainContent);
    const urls = new Set<string>();

    // Look for common GitBook navigation patterns
    const selectors = [
      'nav a[href]',
      '.navigation a[href]',
      '.sidebar a[href]',
      '.toc a[href]',
      'a[href*="/docs/"]',
      'a[href*="/guide/"]',
    ];

    for (const selector of selectors) {
      $(selector).each((_, element) => {
        const href = $(element).attr('href');
        if (href) {
          const fullUrl = this.resolveUrl(href);
          if (this.isValidDocumentUrl(fullUrl)) {
            urls.add(fullUrl);
          }
        }
      });
    }

    return Array.from(urls);
  }

  /**
   * Crawl a single page and return Document
   */
  private async crawlPage(url: string): Promise<Document | null> {
    const cacheKey = this.getCacheKey(url);
    const cachePath = path.join(this.cacheDir, `${cacheKey}.json`);

    // Check cache first
    try {
      if (await fs.pathExists(cachePath)) {
        const cached = await fs.readJson(cachePath);
        // Validate cache is not too old (24 hours)
        const cacheAge = Date.now() - new Date(cached.lastModified).getTime();
        if (cacheAge < 24 * 60 * 60 * 1000) {
          return cached;
        }
      }
    } catch (error) {
      // Cache read failed, continue with fresh fetch
    }

    const content = await this.fetchWithRetry(url);
    const $ = cheerio.load(content);

    // Extract title
    const title = this.extractTitle($);

    // Extract main content
    const mainContent = this.extractContent($);

    if (!mainContent.trim()) {
      return null; // Skip empty pages
    }

    const contentHash = this.hashContent(mainContent);
    const document: Document = {
      url,
      title,
      content: mainContent,
      lastModified: new Date(),
      contentHash,
    };

    // Cache the document
    try {
      await fs.writeJson(cachePath, document, { spaces: 2 });
    } catch (error) {
      console.warn(`Failed to cache document for ${url}: ${error}`);
    }

    return document;
  }

  /**
   * Fetch URL with retry logic and rate limiting
   */
  private async fetchWithRetry(url: string): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // Rate limiting
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.rateLimitMs) {
          await this.sleep(this.rateLimitMs - timeSinceLastRequest);
        }
        this.lastRequestTime = Date.now();

        const response = await fetch(url, {
          headers: {
            'User-Agent': this.userAgent,
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            Connection: 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
          },
          signal: AbortSignal.timeout(30000), // 30 second timeout
        });

        if (!response.ok) {
          if (response.status === 429) {
            // Rate limited - exponential backoff
            const retryAfter = response.headers.get('Retry-After');
            const delay = retryAfter
              ? parseInt(retryAfter) * 1000
              : Math.pow(2, attempt) * 1000;
            await this.sleep(delay);
            continue;
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.text();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === this.maxRetries) {
          break;
        }

        // Exponential backoff with jitter
        const baseDelay = Math.pow(2, attempt) * 1000;
        const jitter = Math.random() * 1000;
        await this.sleep(baseDelay + jitter);
      }
    }

    throw new HyperliquidError(
      ErrorCode.NETWORK_ERROR,
      `Failed to fetch ${url} after ${this.maxRetries} attempts: ${lastError?.message}`,
      { url, attempts: this.maxRetries }
    );
  }

  /**
   * Extract title from page
   */
  private extractTitle($: cheerio.CheerioAPI): string {
    // Try multiple selectors for title
    const titleSelectors = [
      'h1',
      '.page-title',
      '.article-title',
      'title',
      '[data-testid="page-title"]',
    ];

    for (const selector of titleSelectors) {
      const title = $(selector).first().text().trim();
      if (title) {
        return title;
      }
    }

    return 'Untitled';
  }

  /**
   * Extract main content from page
   */
  private extractContent($: cheerio.CheerioAPI): string {
    // Remove unwanted elements
    $('script, style, nav, header, footer, .sidebar, .navigation').remove();

    // Try to find main content area
    const contentSelectors = [
      'main',
      '.content',
      '.article-content',
      '.page-content',
      '[role="main"]',
      'body',
    ];

    for (const selector of contentSelectors) {
      const element = $(selector).first();
      if (element.length > 0) {
        return element.text().trim().replace(/\s+/g, ' ');
      }
    }

    return '';
  }

  /**
   * Generate cache key for URL
   */
  private getCacheKey(url: string): string {
    return createHash('md5').update(url).digest('hex');
  }

  /**
   * Generate content hash for deduplication
   */
  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Resolve relative URL to absolute
   */
  private resolveUrl(href: string): string {
    if (href.startsWith('http')) {
      return href;
    }
    if (href.startsWith('/')) {
      const baseUrlObj = new URL(this.baseUrl);
      return `${baseUrlObj.protocol}//${baseUrlObj.host}${href}`;
    }
    return new URL(href, this.baseUrl).toString();
  }

  /**
   * Check if URL is a valid document URL to crawl
   */
  private isValidDocumentUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);

      // Must be same domain as base URL
      const baseUrlObj = new URL(this.baseUrl);
      if (urlObj.hostname !== baseUrlObj.hostname) {
        return false;
      }

      // Skip certain file types
      const skipExtensions = [
        '.pdf',
        '.jpg',
        '.jpeg',
        '.png',
        '.gif',
        '.svg',
        '.css',
        '.js',
        '.json',
        '.xml',
      ];
      const pathname = urlObj.pathname.toLowerCase();
      if (skipExtensions.some(ext => pathname.endsWith(ext))) {
        return false;
      }

      // Skip anchor links - we don't want to crawl the same page multiple times
      if (urlObj.hash) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
