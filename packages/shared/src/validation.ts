import { Symbol, IntRange, ValidationResult } from './types';
import { ErrorCode, HyperliquidError } from './errors';

/**
 * Create a branded Symbol type with validation
 */
export function createSymbol(value: string): Symbol {
  if (!isValidSymbol(value)) {
    throw HyperliquidError.invalidSymbol(value);
  }
  return value as Symbol;
}

/**
 * Validate symbol format
 */
export function isValidSymbol(symbol: string): boolean {
  if (!symbol || typeof symbol !== 'string') {
    return false;
  }

  // Basic symbol validation - must be uppercase alphanumeric with optional dash/underscore
  // Examples: BTC, ETH, BTC-USD, ETH_USDC
  // Reject lowercase symbols like "invalid"
  const symbolRegex = /^[A-Z0-9]+([_-][A-Z0-9]+)*$/;
  return symbolRegex.test(symbol) && symbol.length >= 2 && symbol.length <= 20;
}

/**
 * Create a branded IntRange type with validation
 */
export function createIntRange<Min extends number, Max extends number>(
  value: number,
  min: Min,
  max: Max
): IntRange<Min, Max> {
  if (!isValidIntRange(value, min, max)) {
    throw new HyperliquidError(
      ErrorCode.INVALID_PARAMETER,
      `Value ${value} is not within range [${min}, ${max}]`,
      { value, min, max }
    );
  }
  return value as IntRange<Min, Max>;
}

/**
 * Validate integer range
 */
export function isValidIntRange(
  value: number,
  min: number,
  max: number
): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Validate array of symbols
 */
export function validateSymbols(symbols: string[]): ValidationResult<Symbol[]> {
  const errors: string[] = [];
  const validSymbols: Symbol[] = [];

  for (const symbol of symbols) {
    if (isValidSymbol(symbol)) {
      validSymbols.push(symbol as Symbol);
    } else {
      errors.push(`Invalid symbol: ${symbol}`);
    }
  }

  return {
    success: errors.length === 0,
    data: validSymbols,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Validate WebSocket channels
 */
export function validateChannels(
  channels: string[]
): ValidationResult<string[]> {
  const errors: string[] = [];
  const validChannels: string[] = [];

  if (!Array.isArray(channels) || channels.length === 0) {
    return {
      success: false,
      errors: ['Channels must be a non-empty array'],
    };
  }

  // Limit number of channels to prevent abuse
  if (channels.length > 50) {
    return {
      success: false,
      errors: ['Too many channels (max 50)'],
    };
  }

  const allowedChannels = [
    'ticker',
    'orderbook',
    'trades',
    'candles',
    'funding',
    'liquidations',
  ];

  for (const channel of channels) {
    if (typeof channel !== 'string' || channel.trim().length === 0) {
      errors.push(`Invalid channel: ${channel}`);
      continue;
    }

    const normalizedChannel = channel.toLowerCase().trim();
    if (allowedChannels.includes(normalizedChannel)) {
      validChannels.push(normalizedChannel);
    } else {
      errors.push(`Unsupported channel: ${channel}`);
    }
  }

  return {
    success: errors.length === 0,
    data: validChannels,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Validate orderbook depth parameter
 */
export function validateDepth(
  depth?: number
): ValidationResult<IntRange<1, 100> | undefined> {
  if (depth === undefined) {
    return { success: true, data: undefined };
  }

  if (!isValidIntRange(depth, 1, 100)) {
    return {
      success: false,
      errors: [`Depth must be an integer between 1 and 100, got: ${depth}`],
    };
  }

  return {
    success: true,
    data: depth as IntRange<1, 100>,
  };
}

/**
 * Validate URL format
 */
export function validateUrl(url: string): ValidationResult<string> {
  try {
    new URL(url);
    return { success: true, data: url };
  } catch {
    return {
      success: false,
      errors: [`Invalid URL format: ${url}`],
    };
  }
}

/**
 * Validate environment configuration
 */
export function validateConfig<T extends Record<string, unknown>>(
  config: T,
  requiredFields: (keyof T)[]
): ValidationResult<T> {
  const errors: string[] = [];

  for (const field of requiredFields) {
    if (
      config[field] === undefined ||
      config[field] === null ||
      config[field] === ''
    ) {
      errors.push(`Missing required configuration: ${String(field)}`);
    }
  }

  return {
    success: errors.length === 0,
    data: config,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Sanitize string input to prevent injection attacks
 */
export function sanitizeString(input: string, maxLength = 1000): string {
  if (typeof input !== 'string') {
    throw new HyperliquidError(
      ErrorCode.VALIDATION_FAILED,
      'Input must be a string'
    );
  }

  // Remove null bytes and control characters except newlines and tabs
  const sanitized = input
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();

  if (sanitized.length > maxLength) {
    throw new HyperliquidError(
      ErrorCode.VALIDATION_FAILED,
      `Input too long (max ${maxLength} characters)`,
      { length: sanitized.length, maxLength }
    );
  }

  return sanitized;
}

/**
 * Validate token count for chunking
 */
export function validateTokenCount(count: number): ValidationResult<number> {
  if (!Number.isInteger(count) || count < 1) {
    return {
      success: false,
      errors: ['Token count must be a positive integer'],
    };
  }

  if (count > 10000) {
    return {
      success: false,
      errors: ['Token count too large (max 10000)'],
    };
  }

  return { success: true, data: count };
}
