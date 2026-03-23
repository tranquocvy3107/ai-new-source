import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { AgentTool } from './tool.types';
import { ToolExecutionResult } from '../agent';

type ResultType = 'affiliate' | 'pricing' | 'official' | 'login';

interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  type: ResultType;
}

@Injectable()
export class UrlSearchTool implements AgentTool {
  readonly name = 'url_search';
  readonly description = 'Simple URL search for domain research';

  async execute(input: string, domain: string): Promise<ToolExecutionResult> {
    const targetDomain = this.detectDomain(input) || this.normalizeDomain(domain);

    const query = `${targetDomain} affiliate program`;
    const results = await this.search(query);

    // filter đúng domain + loại rác
    const filtered = results.filter((r) =>
      this.isValidResult(r.link, targetDomain),
    );

    const mapped: SearchResult[] = filtered.map((r) => ({
      ...r,
      type: this.classify(r.link),
    }));

    return {
      ok: true,
      output: JSON.stringify({
        affiliateCandidates: mapped.filter((r) => r.type === 'affiliate'),
        officialPages: mapped.filter((r) => r.type === 'official'),
        other: mapped.filter((r) => r.type === 'pricing'),
      }, null, 2),
    };
  }

  // ================= SEARCH =================

  private async search(query: string) {
    const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;

    const res = await axios.get(url);
    const $ = cheerio.load(res.data, { xmlMode: true });

    const results: any[] = [];

    $('item').each((_, el) => {
      const title = $(el).find('title').text().trim();
      const link = $(el).find('link').text().trim();
      const snippet = $(el).find('description').text().trim();

      if (title && link) {
        results.push({ title, link, snippet });
      }
    });

    return results;
  }

  // ================= LOGIC =================

  private classify(link: string): ResultType {
    const l = link.toLowerCase();

    if (l.includes('affiliate') || l.includes('partner')) return 'affiliate';
    if (l.includes('pricing') || l.includes('plan')) return 'pricing';
    if (l.includes('login') || l.includes('dashboard')) return 'login';

    return 'official';
  }

  private isValidResult(link: string, domain: string): boolean {
    if (!link.includes(domain)) return false;

    const bad = ['zhihu', 'reddit', 'facebook', 'twitter'];
    if (bad.some((d) => link.includes(d))) return false;

    return true;
  }

  private detectDomain(input: string): string {
    const match = input.match(/([a-z0-9.-]+\.[a-z]{2,})/i);
    return this.normalizeDomain(match?.[1] ?? '');
  }

  private normalizeDomain(domain: string): string {
    return domain.replace(/^www\./, '').toLowerCase();
  }
}