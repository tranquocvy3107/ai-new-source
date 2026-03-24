import { Injectable } from '@nestjs/common';
import { AgentTool } from './tool.types';
import { ToolExecutionResult } from '../agent';

interface UrlSearchInput {
  query?: string;
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

@Injectable()
export class UrlSearchTool implements AgentTool {
  readonly name = 'url_search';
  readonly description = 'Web search powered by open-websearch engine.';

  async execute(input: string, domain: string): Promise<ToolExecutionResult> {
    const query = this.resolveQuery(input, domain);
    if (!query) {
      return {
        ok: false,
        output: JSON.stringify(
          {
            tool: 'url_search',
            provider: 'open_websearch',
            query: '',
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
      const results = await this.searchWithOpenWebSearch(query);
      return {
        ok: true,
        output: JSON.stringify(
          {
            tool: 'url_search',
            provider: 'open_websearch',
            engine: 'duckduckgo',
            query,
            total: results.length,
            results,
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
            engine: 'duckduckgo',
            query,
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

  private async searchWithOpenWebSearch(query: string): Promise<SimpleSearchResult[]> {
    const searchDuckDuckGo = await this.loadDuckduckgoEngine();
    const rawResults = (await searchDuckDuckGo(query, 5)) as OpenWebSearchEngineResult[];
    const results: SimpleSearchResult[] = [];
    const seen = new Set<string>();

    rawResults.forEach((item) => {
      if (results.length >= 5) {
        return;
      }

      const title = this.clean(this.toText(item.title));
      const link = this.clean(this.toText(item.url));
      const description = this.clean(this.toText(item.description));

      if (!title || !link || !this.isHttpUrl(link) || seen.has(link)) {
        return;
      }

      seen.add(link);
      results.push({
        rank: results.length + 1,
        title,
        link,
        description,
      });
    });

    return results;
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

  private async loadDuckduckgoEngine(): Promise<(query: string, limit: number) => Promise<unknown>> {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<Record<string, unknown>>;
    const module = await dynamicImport('open-websearch/build/engines/duckduckgo/searchDuckDuckGo.js');
    const fn = module.searchDuckDuckGo;

    if (typeof fn !== 'function') {
      throw new Error('Cannot load searchDuckDuckGo from open-websearch');
    }

    return fn as (query: string, limit: number) => Promise<unknown>;
  }
}
