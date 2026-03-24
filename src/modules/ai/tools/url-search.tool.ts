import { Injectable } from '@nestjs/common';
import { AgentTool } from './tool.types';
import { ToolExecutionResult } from '../agent';

interface UrlSearchInput {
  query?: string;
  engines?: string[];
  limit?: number;
}

interface SimpleSearchResult {
  rank: number;
  title: string;
  link: string;
  description: string;
}

interface OpenWebSearchEngineResult {
  title?: unknown;
  url?: unknown;
  description?: unknown;
}

type SearchEngine = 'duckduckgo' | 'bing' | 'brave' | 'exa';
type SearchFn = (query: string, limit: number) => Promise<unknown>;

@Injectable()
export class UrlSearchTool implements AgentTool {
  readonly name = 'url_search';
  readonly description = 'Web search powered by open-websearch with multi-engine fallback.';

  async execute(input: string, domain: string): Promise<ToolExecutionResult> {
    const parsedInput = this.parseJsonInput(input);
    const query = this.resolveQuery(input, domain);
    const desiredLimit = this.resolveLimit(parsedInput.limit);
    const requestedEngines = this.resolveEngines(parsedInput.engines);

    if (!query) {
      return {
        ok: false,
        output: JSON.stringify(
          {
            tool: 'url_search',
            provider: 'open_websearch',
            query: '',
            engines: requestedEngines,
            total: 0,
            results: [],
            error: 'Empty query',
          },
          null,
          2,
        ),
      };
    }

    try {
      const searchResult = await this.searchWithOpenWebSearch(query, requestedEngines, desiredLimit);
      return {
        ok: searchResult.results.length > 0,
        output: JSON.stringify(
          {
            tool: 'url_search',
            provider: 'open_websearch',
            engine: searchResult.usedEngine ?? requestedEngines[0],
            query,
            engines: requestedEngines,
            attemptedEngines: searchResult.attemptedEngines,
            total: searchResult.results.length,
            results: searchResult.results,
            ...(searchResult.results.length === 0
              ? { error: 'No results from configured engines (possibly rate-limited/blocked).' }
              : {}),
          },
          null,
          2,
        ),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        ok: false,
        output: JSON.stringify(
          {
            tool: 'url_search',
            provider: 'open_websearch',
            engine: requestedEngines[0],
            query,
            engines: requestedEngines,
            total: 0,
            results: [],
            error: `open-websearch request failed: ${message}`,
          },
          null,
          2,
        ),
      };
    }
  }

  private async searchWithOpenWebSearch(
    query: string,
    engines: SearchEngine[],
    limit: number,
  ): Promise<{ results: SimpleSearchResult[]; attemptedEngines: SearchEngine[]; usedEngine: SearchEngine | null }> {
    const attemptedEngines: SearchEngine[] = [];

    for (const engine of engines) {
      attemptedEngines.push(engine);
      const searchFn = await this.loadEngine(engine);
      const raw = await searchFn(query, limit);
      const normalized = this.normalizeResults(raw, limit);
      if (normalized.length > 0) {
        return {
          results: normalized,
          attemptedEngines,
          usedEngine: engine,
        };
      }
    }

    return {
      results: [],
      attemptedEngines,
      usedEngine: null,
    };
  }

  private resolveQuery(input: string, domain: string): string {
    const parsed = this.parseJsonInput(input);
    const raw = this.clean(parsed.query ?? input);
    if (raw) {
      return raw;
    }

    const cleanDomain = this.clean(domain)
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('/')[0];

    if (!cleanDomain) {
      return '';
    }

    return `${cleanDomain} affiliate program`;
  }

  private parseJsonInput(input: string): UrlSearchInput {
    const text = input.trim();
    if (!text.startsWith('{')) {
      return {};
    }

    try {
      const parsed = JSON.parse(text) as UrlSearchInput;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private clean(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  private isHttpUrl(value: string): boolean {
    return /^https?:\/\/.+/i.test(value);
  }

  private toText(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private async loadEngine(engine: SearchEngine): Promise<SearchFn> {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<Record<string, unknown>>;
    const entrypoints: Record<SearchEngine, { path: string; fn: string }> = {
      duckduckgo: {
        path: 'open-websearch/build/engines/duckduckgo/searchDuckDuckGo.js',
        fn: 'searchDuckDuckGo',
      },
      bing: {
        path: 'open-websearch/build/engines/bing/bing.js',
        fn: 'searchBing',
      },
      brave: {
        path: 'open-websearch/build/engines/brave/brave.js',
        fn: 'searchBrave',
      },
      exa: {
        path: 'open-websearch/build/engines/exa/exa.js',
        fn: 'searchExa',
      },
    };
    const target = entrypoints[engine];
    const module = await dynamicImport(target.path);
    const fn = module[target.fn];

    if (typeof fn !== 'function') {
      throw new Error(`Cannot load ${target.fn} from open-websearch`);
    }

    return fn as SearchFn;
  }

  private normalizeResults(raw: unknown, limit: number): SimpleSearchResult[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    const results: SimpleSearchResult[] = [];
    const seen = new Set<string>();

    for (const item of raw as OpenWebSearchEngineResult[]) {
      if (results.length >= limit) {
        break;
      }

      const title = this.clean(this.toText(item.title));
      const link = this.clean(this.toText(item.url));
      const description = this.clean(this.toText(item.description));

      if (!title || !link || !this.isHttpUrl(link) || seen.has(link)) {
        continue;
      }

      seen.add(link);
      results.push({
        rank: results.length + 1,
        title,
        link,
        description,
      });
    }

    return results;
  }

  private resolveEngines(engines?: string[]): SearchEngine[] {
    const fallback: SearchEngine[] = ['duckduckgo', 'bing', 'brave', 'exa'];
    if (!Array.isArray(engines) || engines.length === 0) {
      return fallback;
    }

    const parsed = engines
      .map((item) => this.clean(String(item)).toLowerCase())
      .filter((item): item is SearchEngine =>
        item === 'duckduckgo' || item === 'bing' || item === 'brave' || item === 'exa',
      );

    return parsed.length > 0 ? Array.from(new Set(parsed)) : fallback;
  }

  private resolveLimit(limit?: number): number {
    if (typeof limit !== 'number' || !Number.isFinite(limit)) {
      return 5;
    }
    const normalized = Math.floor(limit);
    if (normalized < 1) {
      return 1;
    }
    return normalized > 10 ? 10 : normalized;
  }
}
