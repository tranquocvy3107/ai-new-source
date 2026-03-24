import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { existsSync, readFileSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { AgentTool } from './tool.types';
import { ToolExecutionResult } from '../agent';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36';

interface SemrushCredentials {
  userId: number;
  apiKey: string;
}

@Injectable()
export class SemrushTrafficTool implements AgentTool {
  readonly name = 'semrush_traffic';

  readonly description =
    'Get full domain traffic, authority, competitors and AI signals from Semrush via RPC';

  constructor(private readonly configService: ConfigService) {}


  async execute(input: string, domain: string): Promise<ToolExecutionResult> {
    const cleanDomain = this.normalizeDomain(input || domain);
    if (!cleanDomain) return { ok: false, output: 'Invalid domain' };

    const cookie = this.loadCookie();
    if (!cookie) return { ok: false, output: 'Missing cookie' };

    const overviewUrl = `https://www.semrush.com/analytics/overview/?q=${cleanDomain}&searchType=domain`;

    try {
      const html = await this.fetchHtml(overviewUrl, cookie);
      const creds = this.extractCreds(html);

      let parsed: any = {};

      if (creds) {
        parsed = await this.fetchRpc(cleanDomain, overviewUrl, cookie, creds);
      }

      // fallback riêng traffic
      if (!parsed.traffic?.organicTraffic) {
        const fallback = this.extractHtmlFallback(html);
        parsed.traffic = { ...fallback.traffic, ...parsed.traffic };
      }

      return {
        ok: true,
        output: {
          domain: cleanDomain,
          source: {
            name: 'semrush',
            url: overviewUrl,
            method: creds ? 'rpc' : 'html',
          },
          dbStatus: 'created',
          ...parsed,
        },
      };
    } catch (err: any) {
      return { ok: false, output: err.message };
    }
  }

  // ================= RPC =================
  private async fetchRpc(
    domain: string,
    referer: string,
    cookie: string,
    creds: SemrushCredentials,
  ) {
    const requestId = uuidv4();

    const payload = [
      this.buildRpc(1, 'organic.Summary', domain, creds, requestId),
      this.buildRpc(2, 'backlinks.Summary', domain, creds, requestId),
      this.buildRpc(3, 'organic.AiSeoSummary', domain, creds, requestId),
      this.buildRpc(4, 'organic.OverviewTrend', domain, creds, requestId),
      this.buildRpc(5, 'organic.CompetitorsOverview', domain, creds, requestId),
      this.buildRpc(6, 'organic.AiTopSources', domain, creds, requestId),
    ];

    const res = await axios.post(
      'https://www.semrush.com/dpa/rpc',
      payload,
      {
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/json',
          Cookie: cookie,
          Referer: referer,
          'X-Requested-With': 'XMLHttpRequest',
        },
      },
    );

    if (!Array.isArray(res.data)) return {};

    const out: any = {};

    for (const item of res.data) {
      // ===== TRAFFIC =====
      if (item.id === 1 && Array.isArray(item.result)) {
        const best =
          item.result.find((r: any) => r.database === 'us') ||
          item.result.find((r: any) => r.organicTraffic) ||
          item.result[0];

        if (best) {
          out.traffic = {
            organicTraffic: best.organicTraffic,
            organicPositions: best.organicPositions,
            organicTrafficBranded: best.organicTrafficBranded,
            organicTrafficNonBranded: best.organicTrafficNonBranded,
            organicTrafficCost: best.organicTrafficCost,
            adwordsTraffic: best.adwordsTraffic,
            adwordsPositions: best.adwordsPositions,
            adwordsTrafficCost: best.adwordsTrafficCost,
            totalTraffic:
              (best.organicTraffic || 0) +
              (best.adwordsTraffic || 0),
            semrushRank: best.rank,
          };
        }
      }

      // ===== AUTHORITY =====
      if (item.id === 2 && item.result) {
        out.authority = {
          authorityScore: item.result.authorityScore,
          backlinks: item.result.backlinks,
          referringDomains: item.result.referringDomains,
          domainHealth: item.result.health,
          linkPower: item.result.linkPower,
          naturalness: item.result.naturalness,
        };
      }

      // ===== AI =====
      if (item.id === 3 && item.result) {
        out.aiOverview = {
          visibility: item.result.ai_visibility,
          citedPages: item.result.cited_pages,
        };
      }

      if (item.id === 4 && item.result?.history) {
        out.trendData = item.result.history;
      }

      if (item.id === 5 && item.result) {
        out.competitors = item.result;
      }

      if (item.id === 6 && item.result) {
        out.aiSources = item.result;
      }
    }

    return out;
  }

  private buildRpc(
    id: number,
    method: string,
    domain: string,
    creds: SemrushCredentials,
    requestId: string,
  ) {
    return {
      id,
      jsonrpc: '2.0',
      method,
      params: {
        request_id: requestId,
        report: 'domain.overview',
        args: {
          searchItem: domain,
          searchType: 'domain',
          database: 'us',
          dateFormat: 'date', // 🔥 FIX QUAN TRỌNG
          dateType: 'daily',  // 🔥 FIX QUAN TRỌNG
        },
        userId: creds.userId,
        apiKey: creds.apiKey,
      },
    };
  }

  // ================= HTML =================
  private extractHtmlFallback(html: string) {
    const $ = cheerio.load(html);
    const text = $('body').text();

    const match = text.match(/Organic Traffic\s*([\d,.KMB]+)/i);

    return {
      traffic: match
        ? { organicTraffic: this.parseNumber(match[1]) }
        : {},
    };
  }

  // ================= HELPERS =================
  private async fetchHtml(url: string, cookie: string) {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': UA,
        Cookie: cookie,
      },
    });
    return res.data;
  }

  private extractCreds(html: string): SemrushCredentials | null {
    const m = html.match(/window\.sm2\.user\s*=\s*(\{[\s\S]+?\});/);
    if (!m) return null;
    const p = JSON.parse(m[1]);
    return { userId: p.id, apiKey: p.api_key };
  }

  private loadCookie() {
    const file = this.configService.get<string>(
      'SEMRUSH_COOKIE_FILE',
      'cookie.txt',
    );
    if (!existsSync(file)) return '';
    return readFileSync(file, 'utf8').trim();
  }

  private normalizeDomain(input: string) {
    return input
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .toLowerCase();
  }

  private parseNumber(raw: string): number {
    const v = raw.toUpperCase().replace(/,/g, '');
    const n = Number(v.replace(/[KMB]/g, ''));
    if (v.endsWith('K')) return n * 1e3;
    if (v.endsWith('M')) return n * 1e6;
    if (v.endsWith('B')) return n * 1e9;
    return n;
  }
}