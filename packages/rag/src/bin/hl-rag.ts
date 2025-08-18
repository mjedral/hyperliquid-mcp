import { GitBookCrawler } from '../crawler.js';

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (command === 'test-crawl') {
        const url = args[1] || 'https://hyperliquid.gitbook.io/hyperliquid-docs';
        console.log(`Testing crawler with URL: ${url}`);

        try {
            const crawler = new GitBookCrawler({
                baseUrl: url,
                maxPages: 20, // Limit for testing
                rateLimitMs: 1000, // Be respectful - 1 second between requests
                maxRetries: 3,
            });

            console.log('Starting crawl...');
            const result = await crawler.crawlSite();

            console.log(`\n✅ Crawl completed!`);
            console.log(`📄 Documents found: ${result.documents.length}`);
            console.log(`❌ Errors: ${result.errors.length}`);
            console.log(`⏱️  Total pages discovered: ${result.documents.length + result.errors.length}`);

            if (result.errors.length > 0) {
                console.log('\nErrors:');
                result.errors.slice(0, 5).forEach(error => {
                    console.log(`  - ${error.url}: ${error.error}`);
                });
                if (result.errors.length > 5) {
                    console.log(`  ... and ${result.errors.length - 5} more errors`);
                }
            }

            if (result.documents.length > 0) {
                console.log('\nDocuments found:');
                result.documents.forEach((doc, index) => {
                    if (doc) {
                        console.log(`\n${index + 1}. ${doc.title}`);
                        console.log(`   URL: ${doc.url}`);
                        console.log(`   Content: ${doc.content.length} chars`);
                        console.log(`   Preview: ${doc.content.substring(0, 200)}...`);
                    }
                });

                console.log('\n📊 Content Statistics:');
                const totalChars = result.documents.reduce((sum, doc) => sum + doc.content.length, 0);
                const avgChars = Math.round(totalChars / result.documents.length);
                console.log(`   Total content: ${totalChars.toLocaleString()} characters`);
                console.log(`   Average per document: ${avgChars.toLocaleString()} characters`);

                // Show some interesting topics found
                const topics = new Set<string>();
                result.documents.forEach(doc => {
                    const words = doc.content.toLowerCase().split(/\s+/);
                    ['trading', 'api', 'blockchain', 'defi', 'liquidity', 'perpetual', 'spot', 'vault', 'bridge'].forEach(topic => {
                        if (words.includes(topic)) topics.add(topic);
                    });
                });
                if (topics.size > 0) {
                    console.log(`   Topics found: ${Array.from(topics).join(', ')}`);
                }
            }

        } catch (error) {
            console.error('❌ Crawl failed:', error);
            process.exit(1);
        }
    } else {
        console.log('hl-rag CLI');
        console.log('');
        console.log('Commands:');
        console.log('  test-crawl [url]  - Test crawler with Hyperliquid docs (default: https://hyperliquid.gitbook.io/hyperliquid-docs)');
        console.log('');
        console.log('Examples:');
        console.log('  hl-rag test-crawl');
        console.log('  hl-rag test-crawl https://hyperliquid.gitbook.io/hyperliquid-docs');
    }
}

main().catch(console.error);
