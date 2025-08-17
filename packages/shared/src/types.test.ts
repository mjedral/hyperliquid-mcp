import { describe, it, expect } from 'vitest';
import { ErrorCode, HyperliquidError } from './errors';
import {
  createSymbol,
  isValidSymbol,
  createIntRange,
  isValidIntRange,
  validateSymbols,
  validateChannels,
  validateDepth,
  validateUrl,
  validateConfig,
  sanitizeString,
  validateTokenCount,
} from './validation';
import { Symbol, IntRange } from './types';

describe('HyperliquidError', () => {
  it('should create error with code and message', () => {
    const error = new HyperliquidError(
      ErrorCode.INVALID_SYMBOL,
      'Invalid symbol provided'
    );

    expect(error.code).toBe(ErrorCode.INVALID_SYMBOL);
    expect(error.message).toBe('Invalid symbol provided');
    expect(error.name).toBe('HyperliquidError');
    expect(error instanceof HyperliquidError).toBe(true);
    expect(error instanceof Error).toBe(true);
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

  it('should create validation error using static method', () => {
    const error = HyperliquidError.validation('Test validation error');
    expect(error.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(error.message).toBe('Test validation error');
  });

  it('should create network error using static method', () => {
    const error = HyperliquidError.network('Connection failed');
    expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
    expect(error.message).toBe('Connection failed');
  });

  it('should create rate limited error with retry after', () => {
    const error = HyperliquidError.rateLimited('Too many requests', 30);
    expect(error.code).toBe(ErrorCode.RATE_LIMITED);
    expect(error.details?.retryAfter).toBe(30);
  });

  it('should create invalid symbol error', () => {
    const error = HyperliquidError.invalidSymbol('INVALID');
    expect(error.code).toBe(ErrorCode.INVALID_SYMBOL);
    expect(error.details?.symbol).toBe('INVALID');
  });

  it('should identify retryable errors', () => {
    const retryableError = new HyperliquidError(
      ErrorCode.NETWORK_ERROR,
      'Network error'
    );
    const nonRetryableError = new HyperliquidError(
      ErrorCode.INVALID_SYMBOL,
      'Invalid symbol'
    );

    expect(retryableError.isRetryable()).toBe(true);
    expect(nonRetryableError.isRetryable()).toBe(false);
  });

  it('should get retry delay', () => {
    const rateLimitedError = HyperliquidError.rateLimited('Rate limited', 10);
    const networkError = new HyperliquidError(
      ErrorCode.NETWORK_ERROR,
      'Network error'
    );

    expect(rateLimitedError.getRetryDelay()).toBe(10000); // 10 seconds in ms
    expect(networkError.getRetryDelay()).toBe(1000); // 1 second default
  });
});

describe('Symbol validation', () => {
  it('should validate correct symbols', () => {
    expect(isValidSymbol('BTC')).toBe(true);
    expect(isValidSymbol('ETH')).toBe(true);
    expect(isValidSymbol('BTC-USD')).toBe(true);
    expect(isValidSymbol('ETH_USDC')).toBe(true);
    expect(isValidSymbol('MATIC')).toBe(true);
  });

  it('should reject invalid symbols', () => {
    expect(isValidSymbol('')).toBe(false);
    expect(isValidSymbol('A')).toBe(false); // too short
    expect(isValidSymbol('a')).toBe(false); // lowercase
    expect(isValidSymbol('BTC@USD')).toBe(false); // invalid character
    expect(isValidSymbol('BTC USD')).toBe(false); // space
    expect(isValidSymbol('VERYLONGSYMBOLNAME123')).toBe(false); // too long
  });

  it('should create valid Symbol type', () => {
    const symbol = createSymbol('BTC');
    expect(symbol).toBe('BTC');
    // Type assertion to verify branded type
    const _typeCheck: Symbol = symbol;
    expect(_typeCheck).toBeDefined();
  });

  it('should throw error for invalid symbol creation', () => {
    expect(() => createSymbol('invalid')).toThrow(HyperliquidError);
    expect(() => createSymbol('invalid')).toThrow('Invalid symbol: invalid');
  });
});

describe('IntRange validation', () => {
  it('should validate correct integer ranges', () => {
    expect(isValidIntRange(5, 1, 10)).toBe(true);
    expect(isValidIntRange(1, 1, 10)).toBe(true);
    expect(isValidIntRange(10, 1, 10)).toBe(true);
  });

  it('should reject invalid integer ranges', () => {
    expect(isValidIntRange(0, 1, 10)).toBe(false); // below min
    expect(isValidIntRange(11, 1, 10)).toBe(false); // above max
    expect(isValidIntRange(5.5, 1, 10)).toBe(false); // not integer
  });

  it('should create valid IntRange type', () => {
    const range = createIntRange(5, 1, 10);
    expect(range).toBe(5);
    // Type assertion to verify branded type
    const _typeCheck: IntRange<1, 10> = range;
    expect(_typeCheck).toBeDefined();
  });

  it('should throw error for invalid range creation', () => {
    expect(() => createIntRange(0, 1, 10)).toThrow(HyperliquidError);
    expect(() => createIntRange(11, 1, 10)).toThrow(
      'Value 11 is not within range [1, 10]'
    );
  });
});

describe('validateSymbols', () => {
  it('should validate array of valid symbols', () => {
    const result = validateSymbols(['BTC', 'ETH', 'MATIC']);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(['BTC', 'ETH', 'MATIC']);
    expect(result.errors).toBeUndefined();
  });

  it('should handle mixed valid and invalid symbols', () => {
    const result = validateSymbols(['BTC', 'invalid', 'ETH']);
    expect(result.success).toBe(false);
    expect(result.data).toEqual(['BTC', 'ETH']);
    expect(result.errors).toContain('Invalid symbol: invalid');
  });
});

describe('validateChannels', () => {
  it('should validate correct channels', () => {
    const result = validateChannels(['ticker', 'orderbook', 'trades']);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(['ticker', 'orderbook', 'trades']);
  });

  it('should reject empty array', () => {
    const result = validateChannels([]);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Channels must be a non-empty array');
  });

  it('should reject too many channels', () => {
    const channels = Array(51).fill('ticker');
    const result = validateChannels(channels);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Too many channels (max 50)');
  });

  it('should reject invalid channels', () => {
    const result = validateChannels(['ticker', 'invalid_channel']);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Unsupported channel: invalid_channel');
  });

  it('should normalize channel names', () => {
    const result = validateChannels(['TICKER', ' OrderBook ', 'Trades']);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(['ticker', 'orderbook', 'trades']);
  });
});

describe('validateDepth', () => {
  it('should validate correct depth values', () => {
    const result1 = validateDepth(10);
    expect(result1.success).toBe(true);
    expect(result1.data).toBe(10);

    const result2 = validateDepth(undefined);
    expect(result2.success).toBe(true);
    expect(result2.data).toBeUndefined();
  });

  it('should reject invalid depth values', () => {
    const result1 = validateDepth(0);
    expect(result1.success).toBe(false);

    const result2 = validateDepth(101);
    expect(result2.success).toBe(false);

    const result3 = validateDepth(5.5);
    expect(result3.success).toBe(false);
  });
});

describe('validateUrl', () => {
  it('should validate correct URLs', () => {
    const result = validateUrl('https://example.com');
    expect(result.success).toBe(true);
    expect(result.data).toBe('https://example.com');
  });

  it('should reject invalid URLs', () => {
    const result = validateUrl('not-a-url');
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Invalid URL format: not-a-url');
  });
});

describe('validateConfig', () => {
  it('should validate complete configuration', () => {
    const config = { apiKey: 'test', baseUrl: 'https://api.example.com' };
    const result = validateConfig(config, ['apiKey', 'baseUrl']);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(config);
  });

  it('should reject incomplete configuration', () => {
    const config = { apiKey: 'test' };
    const result = validateConfig(config, ['apiKey', 'baseUrl']);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Missing required configuration: baseUrl');
  });
});

describe('sanitizeString', () => {
  it('should sanitize valid strings', () => {
    expect(sanitizeString('  hello world  ')).toBe('hello world');
    expect(sanitizeString('normal text')).toBe('normal text');
  });

  it('should remove control characters', () => {
    expect(sanitizeString('hello\x00world')).toBe('helloworld');
    expect(sanitizeString('test\x1fstring')).toBe('teststring');
  });

  it('should preserve newlines and tabs', () => {
    expect(sanitizeString('line1\nline2\tindented')).toBe(
      'line1\nline2\tindented'
    );
  });

  it('should reject non-string input', () => {
    expect(() => sanitizeString(123 as unknown as string)).toThrow(
      HyperliquidError
    );
  });

  it('should reject strings that are too long', () => {
    const longString = 'a'.repeat(1001);
    expect(() => sanitizeString(longString)).toThrow('Input too long');
  });
});

describe('validateTokenCount', () => {
  it('should validate correct token counts', () => {
    const result = validateTokenCount(500);
    expect(result.success).toBe(true);
    expect(result.data).toBe(500);
  });

  it('should reject invalid token counts', () => {
    expect(validateTokenCount(0).success).toBe(false);
    expect(validateTokenCount(-1).success).toBe(false);
    expect(validateTokenCount(10001).success).toBe(false);
    expect(validateTokenCount(5.5).success).toBe(false);
  });
});
