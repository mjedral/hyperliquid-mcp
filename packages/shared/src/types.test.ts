import { describe, it, expect } from 'vitest';
import { ErrorCode, HyperliquidError } from './errors';

describe('HyperliquidError', () => {
    it('should create error with code and message', () => {
        const error = new HyperliquidError(
            ErrorCode.INVALID_SYMBOL,
            'Invalid symbol provided'
        );

        expect(error.code).toBe(ErrorCode.INVALID_SYMBOL);
        expect(error.message).toBe('Invalid symbol provided');
        expect(error.name).toBe('HyperliquidError');
    });

    it('should create error with details', () => {
        const details = { symbol: 'INVALID' };
        const error = new HyperliquidError(
            ErrorCode.INVALID_SYMBOL,
            'Invalid symbol provided',
            details
        );

        expect(error.details).toEqual(details);
    });
});