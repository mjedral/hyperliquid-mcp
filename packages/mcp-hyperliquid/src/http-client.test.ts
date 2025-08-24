import { describe, it, expect } from 'vitest';
import { HyperliquidHttpClient } from './http-client';

describe('HyperliquidHttpClient', () => {
    it('should create client with testnet configuration', () => {
        const client = new HyperliquidHttpClient({ network: 'testnet' });
        expect(client).toBeDefined();
    });

    it('should create client with mainnet configuration', () => {
        const client = new HyperliquidHttpClient({ network: 'mainnet' });
        expect(client).toBeDefined();
    });

    it('should create client with custom URL', () => {
        const client = new HyperliquidHttpClient({
            network: 'testnet',
            httpUrl: 'https://custom.api.url',
        });
        expect(client).toBeDefined();
    });

    it('should validate invalid symbols', async () => {
        const client = new HyperliquidHttpClient({ network: 'testnet' });
        const { HyperliquidError } = await import('@hl/shared');

        await expect(
            client.getTicker('invalid' as any)
        ).rejects.toThrow(HyperliquidError);
    });
});