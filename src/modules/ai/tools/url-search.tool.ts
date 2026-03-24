import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
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

@Injectable()
export class UrlSearchTool implements AgentTool {
  readonly name = 'url_search';
  readonly description = 'Simple Bing RSS search tool (top 5 results).';

  async execute(input: string, domain: string): Promise<ToolExecutionResult> {
    const query = this.resolveQuery(input, domain);
    if (!query) {
      return {
        ok: false,
        output: JSON.stringify(
          {
            tool: 'url_search',
            provider: 'bing_rss',
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

    const endpoint = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;

    try {
      const response = await axios.get<string>(endpoint, {
        timeout: 30000,
        headers: {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36', // UA mới hơn
  'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
  'Referer': 'https://www.bing.com/',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Dest': 'document',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache'
}
      });

      const results = this.parseRssItems(response.data);
      return {
        ok: true,
        output: JSON.stringify(
          {
            tool: 'url_search',
            provider: 'bing_rss',
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
            provider: 'bing_rss',
            query,
            total: 0,
            results: [],
            error: `Bing RSS request failed: ${message}`,
          },
          null,
          2,
        ),
      };
    }
  }

  private parseRssItems(xml: string): SimpleSearchResult[] {
    const $ = cheerio.load(xml, { xmlMode: true });
    const results: SimpleSearchResult[] = [];
    const seen = new Set<string>();

    $('item').each((_, item) => {
      if (results.length >= 5) {
        return;
      }

      const title = this.clean($(item).find('title').text());
      const link = this.clean($(item).find('link').text());
      const description = this.clean($(item).find('description').text());

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
}
