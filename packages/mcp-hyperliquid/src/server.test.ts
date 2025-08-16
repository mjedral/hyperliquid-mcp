import { describe, it, expect } from 'vitest';
import { HyperliquidMCPServer } from './server';

describe('HyperliquidMCPServer', () => {
    it('should create server instance', () => {
        const server = new HyperliquidMCPServer();
        expect(server).toBeInstanceOf(HyperliquidMCPServer);
    });

    it('should have start method', async () => {
        const server = new HyperliquidMCPServer();
        await expect(server.start()).resolves.toBeUndefined();
    });
});