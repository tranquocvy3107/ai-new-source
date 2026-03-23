import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { AgentTool } from './tool.types';
import { ToolExecutionResult } from '../agent';

interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  query: string;
  score: number;
}

interface SearchAttempt {
  engine: string;
  query: string;
  status: number;
  count: number;
}

@Injectable()
export class UrlSearchTool implements AgentTool {
  readonly name = 'url_search';
  readonly description = 'Search URLs with affiliate-aware ranking for domain research.';

  constructor(private readonly configService: ConfigService) {}

  async execute(input: string, domain: string): Promise<ToolExecutionResult> {
    const timeout = this.configService.get<number>('REQUEST_TIMEOUT_MS', 30000);
    const headers = {
      Accept: 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      Referer: 'https://www.bing.com/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    };

    const targetDomain = this.detectDomain(input) || this.normalizeDomain(domain);
    const queries = this.buildQueryVariants(input, targetDomain);
    const attempts: SearchAttempt[] = [];
    const aggregated: SearchResult[] = [];

    for (const query of queries) {
      const rssItems = await this.searchWithBingRss(query, headers, timeout, attempts);
      aggregated.push(
        ...rssItems.map((item) => ({
          ...item,
          query,
          score: this.scoreResult(item, targetDomain),
        })),
      );
    }

    const deduped = this.dedupeByLinkKeepBest(aggregated);
    const seeded = this.injectHeuristicDomainUrls(deduped, targetDomain);
    const ranked = seeded.sort((a, b) => b.score - a.score);
    const top = ranked.slice(0, 10);
    const affiliateLikelyCount = ranked.filter((item) => item.score >= 30).length;

    const formatted = top
      .map((item, idx) => {
        const flag = item.score >= 30 ? '[affiliate-signal]' : '[general]';
        return `${idx + 1}. ${flag} ${item.title}\n${item.link}\n${item.snippet}`;
      })
      .join('\n\n');

    const output =
      formatted ||
      'No results. Try broader query like "<domain> affiliate OR partner OR referral OR commission".';

    return {
      ok: true,
      output,
      metadata: {
        count: top.length,
        totalCollected: aggregated.length,
        dedupedCount: ranked.length,
        source: 'bing_rss_multi_query',
        queriesUsed: queries,
        targetDomain,
        affiliateLikelyCount,
        attempts,
      },
    };
  }

  private async searchWithBingRss(
    query: string,
    headers: Record<string, string>,
    timeout: number,
    attempts: SearchAttempt[],
  ): Promise<Array<Pick<SearchResult, 'title' | 'link' | 'snippet'>>> {
    const endpoint = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}&count=10`;
    const response = await axios.get(endpoint, {
      timeout,
      maxRedirects: 5,
      headers,
      validateStatus: () => true,
    });

    const xml = String(response.data ?? '');
    const $ = cheerio.load(xml, { xmlMode: true });
    const output: Array<Pick<SearchResult, 'title' | 'link' | 'snippet'>> = [];

    $('item').each((_, item) => {
      const title = $(item).find('title').first().text().trim();
      const link = $(item).find('link').first().text().trim();
      const snippet = $(item).find('description').first().text().trim();
      if (!title || !link) {
        return;
      }
      output.push({ title, link, snippet });
    });

    if (!output.length) {
      const links = Array.from(xml.matchAll(/<link>(https?:\/\/[^<]+)<\/link>/gi)).map((m) => m[1]);
      links
        .filter((link) => !/bing\.com\/search/i.test(link))
        .slice(0, 10)
        .forEach((link, index) => {
          output.push({
            title: `Search result ${index + 1}`,
            link,
            snippet: '',
          });
        });
    }

    attempts.push({
      engine: 'bing_rss',
      query,
      status: response.status,
      count: output.length,
    });

    return output;
  }

  private buildQueryVariants(input: string, domain: string): string[] {
    const base = input.trim();
    const safeDomain = domain || this.detectDomain(base) || '';
    const site = safeDomain ? `site:${safeDomain}` : '';
    const variants = [
      base,
      safeDomain ? `${safeDomain} affiliate program` : '',
      safeDomain ? `${safeDomain} partner program referral commission` : '',
      safeDomain ? `${site} (affiliate OR partner OR referral OR commission)` : '',
      safeDomain ? `${site} (pricing OR plans OR cost)` : '',
      safeDomain ? `${safeDomain} impact radius OR partnerstack OR rewardful OR firstpromoter` : '',
    ].filter(Boolean);

    return Array.from(new Set(variants)).slice(0, 6);
  }

  private dedupeByLinkKeepBest(items: SearchResult[]): SearchResult[] {
    const byLink = new Map<string, SearchResult>();
    for (const item of items) {
      const key = item.link.trim().toLowerCase();
      const existing = byLink.get(key);
      if (!existing || existing.score < item.score) {
        byLink.set(key, item);
      }
    }
    return Array.from(byLink.values());
  }

  private injectHeuristicDomainUrls(items: SearchResult[], domain: string): SearchResult[] {
    if (!domain) {
      return items;
    }

    const existing = new Set(items.map((item) => item.link.toLowerCase()));
    const heuristicPaths = ['/affiliate', '/partners', '/partner', '/referral', '/pricing', '/terms'];
    const appended: SearchResult[] = [...items];

    for (const path of heuristicPaths) {
      const link = `https://${domain}${path}`;
      if (existing.has(link.toLowerCase())) {
        continue;
      }
      appended.push({
        title: `${domain}${path} (heuristic candidate)`,
        link,
        snippet: 'Potential affiliate/partner related endpoint to verify by scrape.',
        query: 'heuristic',
        score: path.includes('affiliate') || path.includes('partner') ? 32 : 20,
      });
    }

    return appended;
  }

  private scoreResult(
    item: Pick<SearchResult, 'title' | 'link' | 'snippet'>,
    targetDomain: string,
  ): number {
    const title = item.title.toLowerCase();
    const link = item.link.toLowerCase();
    const snippet = item.snippet.toLowerCase();
    const text = `${title} ${link} ${snippet}`;
    let score = 0;

    if (targetDomain && link.includes(targetDomain.toLowerCase())) {
      score += 22;
    }

    const strongKeywords = ['affiliate', 'partner program', 'referral', 'commission', 'revshare', 'reseller'];
    const mediumKeywords = ['partnership', 'program', 'tracking', 'cookie duration', 'cpa', 'cps', 'recurring'];
    const pricingKeywords = ['pricing', 'plans', 'cost', 'price'];

    for (const keyword of strongKeywords) {
      if (text.includes(keyword)) {
        score += 14;
      }
    }
    for (const keyword of mediumKeywords) {
      if (text.includes(keyword)) {
        score += 7;
      }
    }
    for (const keyword of pricingKeywords) {
      if (text.includes(keyword)) {
        score += 4;
      }
    }

    if (/\/affiliate|\/partner|\/partners|\/referral/.test(link)) {
      score += 18;
    }

    if (/github\.com|deepwiki|apidog|wikipedia|reddit/.test(link)) {
      score -= 5;
    }

    if (/facebook\.com|x\.com|twitter\.com|linkedin\.com/.test(link)) {
      score -= 10;
    }

    return score;
  }

  private detectDomain(input: string): string {
    const domainRegex = /(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})(?:\/|$|\s)/i;
    const match = input.match(domainRegex);
    return this.normalizeDomain(match?.[1] ?? '');
  }

  private normalizeDomain(value: string): string {
    if (!value) {
      return '';
    }
    return value.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase();
  }
}
