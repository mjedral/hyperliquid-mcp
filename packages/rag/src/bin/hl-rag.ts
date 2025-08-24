import { buildIndex, search } from '../api.js';
import { HyperliquidError } from '@hl/shared';

interface CLIOptions {
    help?: boolean;
    version?: boolean;
    verbose?: boolean;
    config?: string;
    topK?: number;
    baseUrl?: string;
    provider?: string;
    model?: string;
}

function parseArgs(args: string[]): { command: string; options: CLIOptions; positional: string[] } {
    const options: CLIOptions = {};
    const positional: string[] = [];
    let command = '';

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg) continue;

        if (arg.startsWith('--')) {
            const [key, value] = arg.slice(2).split('=');
            switch (key) {
                case 'help':
                    options.help = true;
                    break;
                case 'version':
                    options.version = true;
                    break;
                case 'verbose':
                    options.verbose = true;
                    break;
                case 'config':
                    const configValue = value || args[++i];
                    if (!configValue) {
                        console.error('--config requires a value');
                        process.exit(1);
                    }
                    options.config = configValue;
                    break;
                case 'top-k':
                    const topKValue = value || args[++i];
                    if (!topKValue) {
                        console.error('--top-k requires a value');
                        process.exit(1);
                    }
                    options.topK = parseInt(topKValue);
                    break;
                case 'base-url':
                    const baseUrlValue = value || args[++i];
                    if (!baseUrlValue) {
                        console.error('--base-url requires a value');
                        process.exit(1);
                    }
                    options.baseUrl = baseUrlValue;
                    break;
                case 'provider':
                    const providerValue = value || args[++i];
                    if (!providerValue) {
                        console.error('--provider requires a value');
                        process.exit(1);
                    }
                    options.provider = providerValue;
                    break;
                case 'model':
                    const modelValue = value || args[++i];
                    if (!modelValue) {
                        console.error('--model requires a value');
                        process.exit(1);
                    }
                    options.model = modelValue;
                    break;
                default:
                    console.error(`Unknown option: --${key}`);
                    process.exit(1);
            }
        } else if (arg.startsWith('-')) {
            const flags = arg.slice(1);
            for (const flag of flags) {
                switch (flag) {
                    case 'h':
                        options.help = true;
                        break;
                    case 'v':
                        options.verbose = true;
                        break;
                    case 'V':
                        options.version = true;
                        break;
                    default:
                        console.error(`Unknown flag: -${flag}`);
                        process.exit(1);
                }
            }
        } else if (!command) {
            command = arg;
        } else {
            positional.push(arg);
        }
    }

    return { command, options, positional };
}

function showHelp(): void {
    console.log(`
hl-rag - Hyperliquid RAG Documentation Search

USAGE:
  hl-rag <command> [options]

COMMANDS:
  build                 Build the RAG index from GitBook documentation
  search <query>        Search the RAG index for relevant documentation

OPTIONS:
  -h, --help           Show this help message
  -V, --version        Show version information
  -v, --verbose        Enable verbose output
  --base-url <url>     GitBook base URL (default: from RAG_BASE_URL env)
  --provider <name>    Embedding provider: openai|local (default: openai)
  --model <name>       Embedding model name (default: text-embedding-3-small)
  --top-k <number>     Number of search results to return (default: 5)

ENVIRONMENT VARIABLES:
  RAG_BASE_URL         GitBook base URL to crawl
  EMBEDDING_PROVIDER   Embedding provider (openai|local)
  EMBEDDING_MODEL      Embedding model name
  OPENAI_API_KEY       OpenAI API key (required for openai provider)
  RAG_CACHE_DIR        Cache directory for crawled content
  RAG_DB_PATH          SQLite database path for vector storage
  RAG_MAX_PAGES        Maximum pages to crawl (default: 1000)
  RAG_RATE_LIMIT_MS    Rate limit between requests in ms (default: 1000)

EXAMPLES:
  # Build index with default settings
  hl-rag build

  # Build index with custom base URL
  hl-rag build --base-url https://docs.hyperliquid.xyz

  # Search for trading information
  hl-rag search "how to place orders"

  # Search with more results
  hl-rag search "API endpoints" --top-k 10

  # Use verbose output
  hl-rag build --verbose
`);
}

function showVersion(): void {
    // In a real implementation, this would read from package.json
    console.log('hl-rag version 0.1.0');
}

async function handleBuild(options: CLIOptions): Promise<void> {
    try {
        const config = {
            ...(options.baseUrl && { baseUrl: options.baseUrl }),
            ...(options.provider && { embeddingProvider: options.provider as 'openai' | 'local' }),
            ...(options.model && { embeddingModel: options.model }),
        };

        if (options.verbose) {
            const onProgress = (stage: string, progress: number, total: number) => {
                const percentage = Math.round((progress / total) * 100);
                console.log(`[${percentage}%] ${stage}`);
            };
            await buildIndex({ config, onProgress });
        } else {
            await buildIndex({ config });
        }

    } catch (error) {
        if (error instanceof HyperliquidError) {
            console.error(`Build failed: ${error.message}`);
            if (options.verbose && error.details) {
                console.error('Details:', JSON.stringify(error.details, null, 2));
            }
        } else {
            console.error('Unexpected error:', error);
        }
        process.exit(1);
    }
}

async function handleSearch(query: string, options: CLIOptions): Promise<void> {
    if (!query.trim()) {
        console.error('Search query is required');
        console.error('Usage: hl-rag search "<query>"');
        process.exit(1);
    }

    try {
        const config = {
            ...(options.baseUrl && { baseUrl: options.baseUrl }),
            ...(options.provider && { embeddingProvider: options.provider as 'openai' | 'local' }),
            ...(options.model && { embeddingModel: options.model }),
        };

        const searchOptions = {
            config,
            topK: options.topK || 5,
        };

        console.log(`Searching for: "${query}"`);
        const results = await search(query, searchOptions);

        if (results.length === 0) {
            console.log('No results found.');
            return;
        }

        console.log(`\nFound ${results.length} results:\n`);

        results.forEach((result, index) => {
            console.log(`${index + 1}. ${result.title}`);
            console.log(`   Score: ${result.score.toFixed(3)}`);
            console.log(`   URL: ${result.url}`);
            console.log(`   Snippet: ${result.snippet}`);
            console.log('');
        });

    } catch (error) {
        if (error instanceof HyperliquidError) {
            console.error(`Search failed: ${error.message}`);
            if (options.verbose && error.details) {
                console.error('Details:', JSON.stringify(error.details, null, 2));
            }
        } else {
            console.error('Unexpected error:', error);
        }
        process.exit(1);
    }
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const { command, options, positional } = parseArgs(args);

    if (options.version) {
        showVersion();
        return;
    }

    if (options.help || !command) {
        showHelp();
        return;
    }

    switch (command) {
        case 'build':
            await handleBuild(options);
            break;

        case 'search':
            const query = positional.join(' ');
            await handleSearch(query, options);
            break;

        default:
            console.error(`Unknown command: ${command}`);
            console.error('Run "hl-rag --help" for usage information.');
            process.exit(1);
    }
}

main().catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
});
