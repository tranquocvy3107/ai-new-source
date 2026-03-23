import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { existsSync, readFileSync } from 'fs';
import { AgentTool } from './tool.types';
import { ToolExecutionResult } from '../agent';

interface SemrushCredentials {
  userId: number;
  apiKey: string;
}

@Injectable()
export class SemrushTrafficTool implements AgentTool {
  readonly name = 'semrush_traffic';
  readonly description =
    'Get domain traffic/authority signals from Semrush overview (requires Semrush authenticated cookie).';

  constructor(private readonly configService: ConfigService) {}

  async execute(input: string, domain: string): Promise<ToolExecutionResult> {
    const targetDomain = this.normalizeDomain(input || domain);
    if (!targetDomain) {
      return {
        ok: false,
        output: 'Invalid domain for semrush_traffic.',
      };
    }

    const cookie = this.loadSemrushCookie();
    if (!cookie) {
      return {
        ok: false,
        output:
          'Semrush cookie is missing. Set `SEMRUSH_COOKIE` or provide file path in `SEMRUSH_COOKIE_FILE`.',
      };
    }

    const timeout = this.configService.get<number>('REQUEST_TIMEOUT_MS', 30000);
    const overviewUrl = `https://www.semrush.com/analytics/overview/?q=${encodeURIComponent(targetDomain)}&searchType=domain`;
    const headers = this.buildBrowserHeaders(cookie, 'https://www.semrush.com/');

    const pageResponse = await axios.get(overviewUrl, {
      timeout,
      headers,
      maxRedirects: 5,
      validateStatus: () => true,
    });

    if (pageResponse.status >= 400) {
      return {
        ok: false,
        output: `Semrush page request failed: HTTP ${pageResponse.status}`,
        metadata: {
          domain: targetDomain,
          status: pageResponse.status,
        },
      };
    }

    const html = String(pageResponse.data ?? '');
    const credentials = this.extractInternalCredentials(html);

    const rpcData = credentials
      ? await this.fetchSemrushRpcData(targetDomain, overviewUrl, cookie, credentials, timeout)
      : null;
    const htmlFallback = this.extractFromOverviewHtml(html);

    const result = {
      domain: targetDomain,
      source: credentials ? 'semrush_rpc' : 'semrush_html',
      overviewUrl,
      traffic: rpcData?.traffic ?? htmlFallback.traffic,
      authority: rpcData?.authority ?? htmlFallback.authority,
      trend: rpcData?.trend ?? [],
      notes: [
        ...(rpcData?.notes ?? []),
        ...(htmlFallback.notes ?? []),
      ].filter(Boolean),
    };

    return {
      ok: true,
      output: JSON.stringify(result, null, 2),
      metadata: {
        domain: targetDomain,
        source: result.source,
        hasTraffic: Boolean(result.traffic),
        hasAuthority: Boolean(result.authority),
      },
    };
  }

  private buildBrowserHeaders(cookie: string, referer?: string): Record<string, string> {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Cookie: cookie,
      Referer: referer ?? 'https://www.semrush.com/analytics/overview/',
      'X-Requested-With': 'XMLHttpRequest',
    };
  }

  private loadSemrushCookie(): string {
    const envCookie = this.configService.get<string>('SEMRUSH_COOKIE', '').trim();
    if (envCookie) {
      return envCookie;
    }

    const cookiePath = this.configService.get<string>(
      'SEMRUSH_COOKIE_FILE',
      'src/config/cookie-semrush.txt',
    );
    if (!existsSync(cookiePath)) {
      return '';
    }
    return readFileSync(cookiePath, 'utf8').trim();
  }

  private extractInternalCredentials(html: string): SemrushCredentials | null {
    const match = html.match(/window\.sm2\.user\s*=\s*(\{[\s\S]+?\});/);
    if (!match) {
      return null;
    }

    try {
      const parsed = JSON.parse(match[1]) as { id?: number; api_key?: string };
      if (!parsed.id || !parsed.api_key) {
        return null;
      }
      return {
        userId: parsed.id,
        apiKey: parsed.api_key,
      };
    } catch {
      return null;
    }
  }

  private async fetchSemrushRpcData(
    domain: string,
    overviewUrl: string,
    cookie: string,
    credentials: SemrushCredentials,
    timeout: number,
  ): Promise<{
    traffic?: Record<string, number>;
    authority?: Record<string, number>;
    trend?: Array<{ date: string; organic?: number; paid?: number }>;
    notes?: string[];
  } | null> {
    const payload = [
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'organic.Summary',
        params: {
          report: 'domain.overview',
          args: {
            searchItem: domain,
            searchType: 'domain',
            database: 'us',
            dateType: 'daily',
          },
          userId: credentials.userId,
          apiKey: credentials.apiKey,
        },
      },
      {
        id: 2,
        jsonrpc: '2.0',
        method: 'backlinks.Summary',
        params: {
          report: 'domain.overview',
          args: {
            searchItem: domain,
            searchType: 'domain',
          },
          userId: credentials.userId,
          apiKey: credentials.apiKey,
        },
      },
      {
        id: 3,
        jsonrpc: '2.0',
        method: 'organic.OverviewTrend',
        params: {
          report: 'domain.overview',
          args: {
            dateType: 'monthly',
            searchItem: domain,
            searchType: 'domain',
            database: 'us',
          },
          userId: credentials.userId,
          apiKey: credentials.apiKey,
        },
      },
    ];

    const rpcResponse = await axios.post('https://www.semrush.com/dpa/rpc', payload, {
      timeout,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Content-Type': 'application/json',
        Cookie: cookie,
        Referer: overviewUrl,
        'X-Requested-With': 'XMLHttpRequest',
      },
      validateStatus: () => true,
    });

    if (rpcResponse.status >= 400 || !Array.isArray(rpcResponse.data)) {
      return null;
    }

    const output: {
      traffic?: Record<string, number>;
      authority?: Record<string, number>;
      trend?: Array<{ date: string; organic?: number; paid?: number }>;
      notes?: string[];
    } = {};

    for (const item of rpcResponse.data as Array<Record<string, unknown>>) {
      const id = item.id as number | undefined;
      const result = item.result as Record<string, unknown> | undefined;
      const error = item.error as { message?: string } | undefined;

      if (error?.message) {
        output.notes = [...(output.notes ?? []), error.message];
      }

      if (id === 1 && Array.isArray(result)) {
        const best = (result[0] ?? {}) as Record<string, number>;
        output.traffic = {
          organicTraffic: Number(best.organicTraffic ?? 0),
          paidTraffic: Number(best.adwordsTraffic ?? 0),
          trafficCost: Number(best.organicTrafficCost ?? 0),
          rank: Number(best.rank ?? 0),
        };
      }

      if (id === 2 && result) {
        output.authority = {
          authorityScore: Number(result.authorityScore ?? 0),
          backlinks: Number(result.backlinks ?? 0),
          referringDomains: Number(result.referringDomains ?? 0),
        };
      }

      if (id === 3 && result && Array.isArray(result.history)) {
        output.trend = result.history.map((point) => {
          const data = point as Record<string, unknown>;
          return {
            date: String(data.date ?? ''),
            organic: Number(data.organicTraffic ?? 0),
            paid: Number(data.adwordsTraffic ?? 0),
          };
        });
      }
    }

    return output;
  }

  private extractFromOverviewHtml(html: string): {
    traffic?: Record<string, number>;
    authority?: Record<string, number>;
    notes: string[];
  } {
    const $ = cheerio.load(html);
    const text = $('body').text().replace(/\s+/g, ' ');

    const notes: string[] = [];
    const authorityScore = this.pickFirstNumber(
      text.match(/Authority\s*Score[^0-9]{0,20}([0-9.,]+)/i)?.[1],
    );
    const organicTraffic = this.pickFirstNumber(
      text.match(/Organic\s*Traffic[^0-9]{0,20}([0-9.,KMkmb]+)/i)?.[1],
    );

    if (!authorityScore) {
      notes.push('Authority score not confidently parsed from HTML.');
    }
    if (!organicTraffic) {
      notes.push('Organic traffic not confidently parsed from HTML.');
    }

    return {
      authority: authorityScore ? { authorityScore } : undefined,
      traffic: organicTraffic ? { organicTraffic } : undefined,
      notes,
    };
  }

  private pickFirstNumber(raw?: string): number {
    if (!raw) {
      return 0;
    }
    const value = raw.trim().toUpperCase().replace(/,/g, '');
    if (!value) {
      return 0;
    }
    const base = Number(value.replace(/[KMB]/g, ''));
    if (Number.isNaN(base)) {
      return 0;
    }
    if (value.endsWith('K')) {
      return base * 1_000;
    }
    if (value.endsWith('M')) {
      return base * 1_000_000;
    }
    if (value.endsWith('B')) {
      return base * 1_000_000_000;
    }
    return base;
  }

  private normalizeDomain(input: string): string {
    const value = input.trim();
    if (!value) {
      return '';
    }
    return value.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  }
}
