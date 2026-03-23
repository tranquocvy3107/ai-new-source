import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { AgentTool } from './tool.types';
import { ToolExecutionResult } from '../agent';

@Injectable()
export class WebScrapeTool implements AgentTool {
  readonly name = 'web_scrape';
  readonly description = 'Fetch a URL and extract useful text content.';

  constructor(private readonly configService: ConfigService) {}

  async execute(input: string, _domain: string): Promise<ToolExecutionResult> {
    const timeout = this.configService.get<number>('REQUEST_TIMEOUT_MS', 30000);
    const response = await axios.get(input, {
      timeout,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    const $ = cheerio.load(response.data);
    const title = $('title').first().text().trim();
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    const excerpt = bodyText.slice(0, 3500);

    return {
      ok: true,
      output: `Title: ${title}\nURL: ${input}\nContent: ${excerpt}`,
      metadata: {
        length: bodyText.length,
      },
    };
  }
}
