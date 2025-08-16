// RAG API placeholder
export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
  score: number;
}

export async function buildIndex(): Promise<void> {
  // Implementation placeholder
}

export async function search(_query: string, k = 5): Promise<SearchResult[]> {
  // Implementation placeholder
  console.log(`Searching with k=${k}`);
  return [];
}
