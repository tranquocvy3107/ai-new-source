import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { Configuration, PlaywrightCrawler } from 'crawlee';
import { AgentTool } from './tool.types';
import { ToolExecutionResult } from '../agent';

type LoadedDocument = ReturnType<typeof cheerio.load>;

@Injectable()
export class WebScrapeTool implements AgentTool {
  readonly name = 'web_scrape';
  readonly description = 'Fetch a URL with Crawlee Playwright crawler and extract useful text content.';

  constructor(private readonly configService: ConfigService) {}

  async execute(input: string, _domain: string): Promise<ToolExecutionResult> {
    const timeout = this.configService.get<number>('REQUEST_TIMEOUT_MS', 60000);
    const maxContentLength = this.configService.get<number>('WEB_SCRAPE_MAX_CONTENT_CHARS', 8000);

    try {
      const crawled = await this.scrapeWithCrawlee(input, timeout);
      const formatted = this.formatOutput(crawled.title, crawled.url, crawled.text, maxContentLength);
      return {
        ok: true,
        output: formatted.output,
        metadata: {
          extractedFrom: crawled.contentRoot,
          length: crawled.text.length,
          truncated: formatted.truncated,
          method: 'crawlee_playwright',
          pricingHighlights: crawled.pricingHighlights.length,
        },
      };
    } catch (crawleeError) {
      const fallback = await this.scrapeWithStaticHttp(input, timeout);
      const formatted = this.formatOutput(fallback.title, fallback.url, fallback.text, maxContentLength);
      return {
        ok: true,
        output: formatted.output,
        metadata: {
          extractedFrom: fallback.contentRoot,
          length: fallback.text.length,
          truncated: formatted.truncated,
          method: 'axios_cheerio_fallback',
          fallbackReason:
            crawleeError instanceof Error ? crawleeError.message.slice(0, 240) : 'Crawlee scrape failed',
          pricingHighlights: fallback.pricingHighlights.length,
        },
      };
    }
  }

  private async scrapeWithCrawlee(input: string, timeout: number): Promise<{
    title: string;
    url: string;
    text: string;
    contentRoot: string;
    pricingHighlights: string[];
  }> {
    let finalUrl = input;
    let title = '';
    let html = '';
    let visibleText = '';
    const crawlerConfig = new Configuration({
      persistStorage: false,
      purgeOnStart: false,
    });

    const crawler = new PlaywrightCrawler({
      maxRequestsPerCrawl: 1,
      maxConcurrency: 1,
      navigationTimeoutSecs: Math.max(15, Math.ceil(timeout / 1000)),
      requestHandlerTimeoutSecs: Math.max(20, Math.ceil(timeout / 1000) + 10),
      headless: true,
      async requestHandler({ page, request }) {
        await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => undefined);
        await page.waitForLoadState('networkidle', { timeout: Math.min(timeout, 15000) }).catch(() => undefined);
        await page.waitForTimeout(1200);

        title = (await page.title()).trim();
        finalUrl = page.url() || request.url;
        html = await page.content();
        visibleText = await page.evaluate(() => (document.body?.innerText ?? '').trim());
      },
    }, crawlerConfig);

    await crawler.run([input]);

    if (!html) {
      throw new Error('Crawlee returned empty HTML');
    }

    const parsed = this.extractFromHtml(html, visibleText);
    return {
      title: title || parsed.title,
      url: finalUrl,
      text: parsed.text,
      contentRoot: parsed.contentRoot,
      pricingHighlights: parsed.pricingHighlights,
    };
  }

  private async scrapeWithStaticHttp(input: string, timeout: number): Promise<{
    title: string;
    url: string;
    text: string;
    contentRoot: string;
    pricingHighlights: string[];
  }> {
    const response = await axios.get<string>(input, {
      timeout,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    const parsed = this.extractFromHtml(response.data);
    return {
      title: parsed.title,
      url: input,
      text: parsed.text,
      contentRoot: parsed.contentRoot,
      pricingHighlights: parsed.pricingHighlights,
    };
  }

  private extractFromHtml(html: string, visibleText = ''): {
    title: string;
    contentRoot: string;
    text: string;
    pricingHighlights: string[];
  } {
    const $ = cheerio.load(html);
    this.removeNoise($);

    const title = $('title').first().text().trim();
    const contentRoot = this.pickContentRoot($);
    const mainText = this.extractReadableText($, contentRoot);
    const pricingHighlights = this.extractPricingHighlights($, visibleText);
    const mergedText = this.mergeTextWithPricing(mainText, pricingHighlights);

    return {
      title,
      contentRoot,
      text: mergedText,
      pricingHighlights,
    };
  }

  private formatOutput(title: string, url: string, text: string, maxLength: number): {
    output: string;
    truncated: boolean;
  } {
    const excerpt = text.slice(0, maxLength);
    const truncated = text.length > excerpt.length;
    return {
      output: `Title: ${title}\nURL: ${url}\nContent: ${excerpt}`,
      truncated,
    };
  }

  private extractPricingHighlights($: LoadedDocument, visibleText = ''): string[] {
    const selectors = [
      '[class*="price"]',
      '[id*="price"]',
      '[class*="plan"]',
      '[id*="plan"]',
      'table tr',
      'table td',
      'main p',
      'main li',
      'section span',
      'section div',
      'main span',
      'main div',
    ];
    const pricePattern =
      /([$€£¥]\s?\d[\d,]*(?:\.\d+)?(?:\s*\/\s*(?:mo|month|yr|year))?)|(\d[\d,]*(?:\.\d+)?\s?(?:usd|eur|gbp|vnd|\/mo|\/month|\/yr|\/year))/i;
    const hits: string[] = [];
    const seen = new Set<string>();

    for (const selector of selectors) {
      $(selector).each((_, element) => {
        const text = this.normalizeText($(element).text());
        if (!text || text.length < 4 || text.length > 260) {
          return;
        }
        if (!pricePattern.test(text)) {
          return;
        }
        if (seen.has(text)) {
          return;
        }
        seen.add(text);
        hits.push(text);
      });
    }

    for (const line of this.extractPricingLinesFromVisibleText(visibleText)) {
      if (seen.has(line)) {
        continue;
      }
      seen.add(line);
      hits.push(line);
    }

    return hits.slice(0, 40);
  }

  private extractPricingLinesFromVisibleText(visibleText: string): string[] {
    if (!visibleText) {
      return [];
    }

    const pricePattern =
      /([$€£¥]\s?\d[\d,]*(?:\.\d+)?(?:\s*\/\s*(?:mo|month|yr|year))?)|(\d[\d,]*(?:\.\d+)?\s?(?:usd|eur|gbp|vnd|\/mo|\/month|\/yr|\/year))/i;
    const lines = visibleText
      .split(/\r?\n/)
      .map((line) => this.normalizeText(line))
      .filter((line) => line.length >= 4 && line.length <= 180 && pricePattern.test(line));

    return Array.from(new Set(lines)).slice(0, 40);
  }

  private mergeTextWithPricing(text: string, pricingHighlights: string[]): string {
    if (pricingHighlights.length === 0) {
      return text;
    }

    return `${text}\nPricing highlights:\n${pricingHighlights.join('\n')}`;
  }

  private removeNoise($: LoadedDocument): void {
    $(
      [
        'script',
        'style',
        'noscript',
        'template',
        'iframe',
        'svg',
        'canvas',
        'form',
        'nav',
        'footer',
        '.cookie-banner',
        '.cookie-consent',
        '[role="dialog"]',
      ].join(','),
    ).remove();
  }

  private pickContentRoot($: LoadedDocument): string {
    const preferred = ['main', 'article', '[role="main"]', '#content', '.content', '.main-content'];

    for (const selector of preferred) {
      const candidate = $(selector).first();
      const text = this.normalizeText(candidate.text());
      if (candidate.length > 0 && text.length >= 180) {
        return selector;
      }
    }

    return 'body';
  }

  private extractReadableText($: LoadedDocument, rootSelector: string): string {
    const root = $(rootSelector).first();
    const blocks: string[] = [];
    const seen = new Set<string>();

    root.find('h1,h2,h3,p,li,dt,dd,blockquote').each((_, el) => {
      const text = this.normalizeText($(el).text());
      if (text.length < 12) {
        return;
      }
      if (seen.has(text)) {
        return;
      }
      seen.add(text);
      blocks.push(text);
    });

    if (blocks.length === 0) {
      return this.normalizeText(root.text());
    }

    return blocks.join('\n');
  }

  private normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }
}
