// Core type definitions placeholder
export type Brand<K, T> = K & { __brand: T };
export type Symbol = Brand<string, 'SYMBOL'>;
export type IntRange<Min extends number, Max extends number> = number & {
  __min: Min;
  __max: Max;
};

export interface ErrorResponse {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
