import { Injectable } from '@nestjs/common';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';

@Injectable()
export class ChunkService {
  private readonly splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 800,
    chunkOverlap: 120,
  });

  async splitText(content: string): Promise<string[]> {
    if (!content.trim()) {
      return [];
    }
    return this.splitter.splitText(content);
  }
}
