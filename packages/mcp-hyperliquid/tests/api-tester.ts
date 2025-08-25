#!/usr/bin/env tsx

/**
 * Comprehensive API Tester for Hyperliquid HTTP Client
 * 
 * This script provides both interactive testing and automated test suites
 * for all HTTP client endpoints.
 */

import { HyperliquidHttpClient } from '../src/http-client';
import { Symbol } from '@hl/shared';
import * as readline from 'readline';

class HyperliquidApiTester {
    private client: HyperliquidHttpClient | null = null;
    private rl: readline.Interface;

    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
    }

    private async question(prompt: string): Promise<string> {
        return new Promise((resolve) => {
            this.rl.question(prompt, resolve);
        });
    }

    private async selectNetwork(): Promise<'testnet' | 'mainnet'> {
        console.log('\nSelect network:');
        console.log('1. Testnet (recommended for testing)');
        console.log('2. Mainnet (live data)');

        const choice = await this.question('\nEnter choice (1 or 2): ');
        return choice === '2' ? 'mainnet' : 'testnet';
    }

    private async initializeClient(): Promise<void> {
        const network = await this.selectNetwork();

        this.client = new HyperliquidHttpClient({
            network,
            timeout: 15000,
            maxRetries: 3,
        });

        console.log(`Client initialized for ${network}`);
    }

    // Interactive test methods
    private async testMarkets(): Promise<void> {
        if (!this.client) {
            console.log('Client not initialized');
            return;
        }

        console.log('\nFetching markets...');
        try {
            const markets = await this.client.getMarkets();
            console.log(`\nFound ${markets.length} markets:`);

            markets.slice(0, 10).forEach((market, i) => {
                console.log(`${i + 1}. ${market.symbol} (${market.baseAsset}/${market.quoteAsset})`);
                console.log(`   Status: ${market.status}, Tick: ${market.tickSize}, Min: ${market.minSize}`);
            });

            if (markets.length > 10) {
                console.log(`... and ${markets.length - 10} more`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.log(`Error: ${errorMessage}`);
        }
    }

    private async testTicker(): Promise<void> {
        if (!this.client) {
            console.log('Client not initialized');
            return;
        }

        const symbol = await this.question('\nEnter symbol for ticker (e.g., BTC, SOL, ETH): ');

        console.log(`Fetching ticker for ${symbol}...`);
        try {
            const ticker = await this.client.getTicker(symbol as Symbol);
            console.log('\nTicker data:');
            console.log(`   Symbol: ${ticker.symbol}`);
            console.log(`   Price: $${ticker.price}`);
            console.log(`   24h Change: ${ticker.change24h}%`);
            console.log(`   24h Volume: ${ticker.volume24h}`);
            console.log(`   24h High: $${ticker.high24h}`);
            console.log(`   24h Low: $${ticker.low24h}`);
            console.log(`   Timestamp: ${new Date(ticker.timestamp).toISOString()}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.log(`Error: ${errorMessage}`);
        }
    }

    private async testOrderbook(): Promise<void> {
        if (!this.client) {
            console.log('Client not initialized');
            return;
        }

        const symbol = await this.question('\nEnter symbol for orderbook (e.g., BTC, SOL, ETH): ');
        const depthStr = await this.question('Enter depth (1-100, default 5): ');
        const depth = depthStr ? parseInt(depthStr) : 5;

        console.log(`Fetching orderbook for ${symbol} with depth ${depth}...`);
        try {
            const orderbook = await this.client.getOrderbook(symbol as Symbol, depth as any);
            console.log('\nOrderbook data:');
            console.log(`   Symbol: ${orderbook.symbol}`);
            console.log(`   Timestamp: ${new Date(orderbook.timestamp).toISOString()}`);

            console.log(`\n   Bids (${orderbook.bids.length}):`);
            orderbook.bids.slice(0, 5).forEach(([price, size], i) => {
                console.log(`     ${i + 1}. $${price} x ${size}`);
            });

            console.log(`\n   Asks (${orderbook.asks.length}):`);
            orderbook.asks.slice(0, 5).forEach(([price, size], i) => {
                console.log(`     ${i + 1}. $${price} x ${size}`);
            });

            if (orderbook.bids.length > 0 && orderbook.asks.length > 0) {
                const spread = orderbook.asks[0][0] - orderbook.bids[0][0];
                const spreadPercent = (spread / orderbook.bids[0][0]) * 100;
                console.log(`\n   Spread: $${spread.toFixed(6)} (${spreadPercent.toFixed(4)}%)`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.log(`Error: ${errorMessage}`);
        }
    }

    // Automated test suite
    async runAutomatedTests(network: 'testnet' | 'mainnet' = 'testnet'): Promise<void> {
        console.log(`\nRunning automated tests on ${network}...`);

        this.client = new HyperliquidHttpClient({
            network,
            timeout: 15000,
            maxRetries: 3,
        });

        console.log(`Initialized client for ${network}`);
        console.log('Starting comprehensive endpoint tests...\n');

        const results: { [key: string]: boolean } = {};

        // Test getMarkets()
        console.log('Testing getMarkets()...');
        try {
            const markets = await this.client.getMarkets();
            console.log(`Success: Found ${markets.length} markets`);
            console.log('Sample markets:');
            markets.slice(0, 5).forEach((market, i) => {
                console.log(`  ${i + 1}. ${market.symbol} - ${market.status}`);
            });
            results.getMarkets = true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.log(`Failed: ${errorMessage}`);
            results.getMarkets = false;
        }

        console.log('');

        // Test getTicker()
        console.log('Testing getTicker() for SOL...');
        try {
            const ticker = await this.client.getTicker('SOL' as Symbol);
            console.log(`Success: Price = $${ticker.price}`);
            console.log(`   24h Change: ${ticker.change24h}%`);
            console.log(`   Volume: ${ticker.volume24h}`);
            results.getTicker = true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.log(`Failed: ${errorMessage}`);
            results.getTicker = false;
        }

        console.log('');

        // Test getOrderbook()
        console.log('Testing getOrderbook() for SOL (depth: 5)...');
        try {
            const orderbook = await this.client.getOrderbook('SOL' as Symbol, 5 as any);
            console.log(`Success: ${orderbook.bids.length} bids, ${orderbook.asks.length} asks`);
            if (orderbook.bids.length > 0 && orderbook.asks.length > 0) {
                console.log(`   Best bid: $${orderbook.bids[0][0]} x ${orderbook.bids[0][1]}`);
                console.log(`   Best ask: $${orderbook.asks[0][0]} x ${orderbook.asks[0][1]}`);
            }
            results.getOrderbook = true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.log(`Failed: ${errorMessage}`);
            results.getOrderbook = false;
        }

        console.log('');

        // Test error handling
        console.log('Testing error handling...');
        try {
            await this.client.getTicker('INVALID_SYMBOL' as Symbol);
            console.log('Failed: Should have thrown error for invalid symbol');
            results.errorHandling_invalidSymbol = false;
        } catch (error) {
            console.log('Correctly caught invalid symbol error:', error instanceof Error ? error.message : String(error));
            results.errorHandling_invalidSymbol = true;
        }

        try {
            await this.client.getOrderbook('SOL' as Symbol, 999 as any);
            console.log('Failed: Should have thrown error for invalid depth');
            results.errorHandling_invalidDepth = false;
        } catch (error) {
            console.log('Correctly caught invalid depth error:', error instanceof Error ? error.message : String(error));
            results.errorHandling_invalidDepth = true;
        }

        // Print summary
        console.log('\nTest Summary:');
        console.log('================');
        const passed = Object.entries(results).filter(([_, success]) => success);
        const failed = Object.entries(results).filter(([_, success]) => !success);

        passed.forEach(([test, _]) => console.log(`PASS ${test}`));
        failed.forEach(([test, _]) => console.log(`FAIL ${test}`));

        console.log(`\nResults: ${passed.length}/${Object.keys(results).length} tests passed`);

        if (failed.length === 0) {
            console.log('All tests passed!');
        } else {
            console.log('Some tests failed. Check the logs above.');
        }
    }

    // Interactive menu
    private async showMenu(): Promise<string> {
        console.log('\nHyperliquid API Tester Menu:');
        console.log('1. Test getMarkets()');
        console.log('2. Test getTicker()');
        console.log('3. Test getOrderbook()');
        console.log('4. Run automated test suite');
        console.log('5. Change network');
        console.log('6. Exit');

        return await this.question('\nSelect option (1-6): ');
    }

    async runInteractive(): Promise<void> {
        console.log('Hyperliquid API Tester');
        console.log('======================');

        await this.initializeClient();

        while (true) {
            const choice = await this.showMenu();

            switch (choice) {
                case '1':
                    await this.testMarkets();
                    break;
                case '2':
                    await this.testTicker();
                    break;
                case '3':
                    await this.testOrderbook();
                    break;
                case '4':
                    if (this.client) {
                        const network = this.client['baseUrl'].includes('testnet') ? 'testnet' : 'mainnet';
                        await this.runAutomatedTests(network as 'testnet' | 'mainnet');
                    }
                    break;
                case '5':
                    await this.initializeClient();
                    break;
                case '6':
                    console.log('\nGoodbye!');
                    this.rl.close();
                    return;
                default:
                    console.log('\nInvalid choice. Please select 1-6.');
            }

            await this.question('\nPress Enter to continue...');
        }
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    const tester = new HyperliquidApiTester();

    if (args.includes('--auto') || args.includes('-a')) {
        // Run automated tests
        const network = args.includes('--mainnet') ? 'mainnet' : 'testnet';
        await tester.runAutomatedTests(network);
    } else {
        // Run interactive mode
        await tester.runInteractive();
    }
}

if (require.main === module) {
    main().catch(console.error);
}