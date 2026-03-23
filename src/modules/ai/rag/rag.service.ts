import { Injectable } from '@nestjs/common';
import { ChunkService } from './chunk.service';
import { VectorService } from './vector.service';

interface RankedChunk {
  score: number;
  text: string;
}

@Injectable()
export class RagService {
  constructor(
    private readonly chunkService: ChunkService,
    private readonly vectorService: VectorService,
  ) {}

  async buildChunks(content: string): Promise<string[]> {
    return this.chunkService.splitText(content);
  }

  async rankChunksByQuery(query: string, chunks: string[], topK = 5): Promise<string[]> {
    const queryVector = this.vectorService.embedText(query);
    const ranked: RankedChunk[] = chunks.map((text) => {
      const score = this.vectorService.cosineSimilarity(queryVector, this.vectorService.embedText(text));
      return { score, text };
    });

    return ranked
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((item) => item.text);
  }
}
