import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { DomainMemoryEntity, MemoryChunkEntity } from '../../../database/entities';
import { RagService } from '../rag';

@Injectable()
export class MemoryService {
  constructor(
    @InjectRepository(DomainMemoryEntity)
    private readonly domainMemoryRepo: Repository<DomainMemoryEntity>,
    @InjectRepository(MemoryChunkEntity)
    private readonly memoryChunkRepo: Repository<MemoryChunkEntity>,
    private readonly ragService: RagService,
  ) {}

  async getOrCreateDomainMemory(domain: string): Promise<DomainMemoryEntity> {
    const existing = await this.domainMemoryRepo.findOne({ where: { domain } });
    if (existing) {
      return existing;
    }

    const created = this.domainMemoryRepo.create({
      domain,
      summary: '',
      keyFacts: [],
    });
    return this.domainMemoryRepo.save(created);
  }

  async getDomainSummary(domain: string): Promise<string> {
    const memory = await this.getOrCreateDomainMemory(domain);
    return memory.summary || 'No summary yet.';
  }

  async updateDomainSummary(
    domain: string,
    summary: string,
    keyFacts: string[] = [],
    metadata?: Record<string, unknown>,
  ): Promise<DomainMemoryEntity> {
    const memory = await this.getOrCreateDomainMemory(domain);
    memory.summary = summary;
    memory.keyFacts = keyFacts;
    memory.metadata = metadata ?? memory.metadata;
    return this.domainMemoryRepo.save(memory);
  }

  async saveEvidence(domain: string, source: string, content: string): Promise<number> {
    const chunks = await this.ragService.buildChunks(content);
    if (!chunks.length) {
      return 0;
    }

    const chunkEntities = chunks.map((chunk) =>
      this.memoryChunkRepo.create({
        domain,
        source,
        content: chunk,
      }),
    );
    await this.memoryChunkRepo.save(chunkEntities);
    return chunkEntities.length;
  }

  async findRelevantContext(domain: string, query: string, limit = 5): Promise<string> {
    const memory = await this.getOrCreateDomainMemory(domain);
    const fetched = await this.memoryChunkRepo.find({
      where: [
        {
          domain,
          content: ILike(`%${query}%`),
        },
        {
          domain,
          source: ILike(`%${query}%`),
        },
      ],
      order: {
        createdAt: 'DESC',
      },
      take: Math.max(10, limit * 2),
    });

    const ranked = await this.ragService.rankChunksByQuery(
      query,
      fetched.map((item) => item.content),
      limit,
    );
    const keyFacts = memory.keyFacts.length ? `Key facts:\n- ${memory.keyFacts.join('\n- ')}` : '';
    const summary = memory.summary ? `Summary:\n${memory.summary}` : 'Summary:\nNo summary yet.';
    const evidence = ranked.length ? `Relevant chunks:\n${ranked.join('\n\n')}` : 'Relevant chunks:\nNo chunk matched.';

    return `${summary}\n\n${keyFacts}\n\n${evidence}`.trim();
  }
}
