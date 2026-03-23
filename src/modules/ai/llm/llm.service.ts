import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

@Injectable()
export class LlmService {
  private readonly chatModel: ChatOpenAI;

  constructor(private readonly configService: ConfigService) {
    this.chatModel = new ChatOpenAI({
      model: this.configService.get<string>('LLM_MODEL', 'Qwen3.5-4B'),
      apiKey: this.configService.get<string>('LLM_API_KEY', 'local-llama'),
      configuration: {
        baseURL: this.configService.get<string>('LLM_BASE_URL', 'http://127.0.0.1:8080/v1'),
      },
      temperature: 0.2,
    });
  }

  async generateText(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await this.chatModel.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ]);
    return String(response.content ?? '').trim();
  }

  async generateJson<T>(systemPrompt: string, userPrompt: string): Promise<T> {
    const raw = await this.generateText(
      `${systemPrompt}\nReturn JSON only.`,
      `${userPrompt}\nOutput must be valid JSON.`,
    );

    const normalized = this.stripCodeFence(raw);
    const direct = this.tryParseJson<T>(normalized);
    if (direct !== null) {
      return direct;
    }

    const extracted = this.extractFirstJsonObject(normalized);
    const parsedExtracted = this.tryParseJson<T>(extracted);
    if (parsedExtracted !== null) {
      return parsedExtracted;
    }

    throw new Error(`Failed to parse JSON response: ${normalized.slice(0, 500)}`);
  }

  private stripCodeFence(value: string): string {
    return value
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }

  private tryParseJson<T>(value: string): T | null {
    const text = value.trim();
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  private extractFirstJsonObject(value: string): string {
    const start = value.indexOf('{');
    if (start < 0) {
      return '';
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let i = start; i < value.length; i += 1) {
      const ch = value[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (end < 0) {
      return value.slice(start).trim();
    }

    return value.slice(start, end + 1).trim();
  }
}
