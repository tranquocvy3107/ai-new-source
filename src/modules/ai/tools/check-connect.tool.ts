import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AgentTool } from './tool.types';
import { ToolExecutionResult } from '../agent';

@Injectable()
export class CheckConnectTool implements AgentTool {
  readonly name = 'check_connect';
  readonly description =
    'Check if a URL is reachable and return HTTP status/connectivity details before scraping.';

  constructor(private readonly configService: ConfigService) {}

  async execute(input: string, _domain: string): Promise<ToolExecutionResult> {
    const url = input.trim();
    if (!/^https?:\/\/.+/i.test(url)) {
      return {
        ok: false,
        output: 'Invalid URL. Please provide a full URL (http/https).',
      };
    }

    const timeout = this.configService.get<number>('REQUEST_TIMEOUT_MS', 30000);
    const headers = {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    };

    const response = await axios.get(url, {
      timeout,
      maxRedirects: 5,
      validateStatus: () => true,
      headers,
    });

    const status = response.status;
    const reachable = status >= 200 && status < 400;
    const contentType = String(response.headers['content-type'] ?? '');
    const finalUrl = String((response.request as { res?: { responseUrl?: string } })?.res?.responseUrl ?? url);

    return {
      ok: reachable,
      output: `URL: ${finalUrl}\nStatus: ${status}\nReachable: ${reachable}\nContent-Type: ${contentType}`,
      metadata: {
        url: finalUrl,
        status,
        reachable,
        contentType,
      },
    };
  }
}
