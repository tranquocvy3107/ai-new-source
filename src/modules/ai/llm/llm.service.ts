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

    const normalized = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    return JSON.parse(normalized) as T;
  }
}
