import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { AgentTool } from './tool.types';
import { ToolExecutionResult } from '../agent';

type LoadedDocument = ReturnType<typeof cheerio.load>;

@Injectable()
export class WebScrapeTool implements AgentTool {
  readonly name = 'web_scrape';
  readonly description = 'Fetch a URL and extract useful text content.';

  constructor(private readonly configService: ConfigService) {}

  async execute(input: string, _domain: string): Promise<ToolExecutionResult> {
    const timeout = this.configService.get<number>('REQUEST_TIMEOUT_MS', 30000);
    const response = await axios.get<string>(input, {
      timeout,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    const $ = cheerio.load(response.data);
    this.removeNoise($);

    const title = $('title').first().text().trim();
    const contentRoot = this.pickContentRoot($);
    const text = this.extractReadableText($, contentRoot);
    const excerpt = text.slice(0, 4200);
    const isTruncated = text.length > excerpt.length;

    return {
      ok: true,
      output: `Title: ${title}\nURL: ${input}\nContent: ${excerpt}`,
      metadata: {
        extractedFrom: contentRoot,
        length: text.length,
        truncated: isTruncated,
      },
    };
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
      if (text.length < 25) {
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
