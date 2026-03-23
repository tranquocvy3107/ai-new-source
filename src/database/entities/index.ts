import { AgentEventEntity } from './agent-event.entity';
import { AgentRunEntity } from './agent-run.entity';
import { DomainMemoryEntity } from './domain-memory.entity';
import { MemoryChunkEntity } from './memory-chunk.entity';

export * from './agent-event.entity';
export * from './agent-run.entity';
export * from './domain-memory.entity';
export * from './memory-chunk.entity';

export const DatabaseEntities = [
  AgentRunEntity,
  AgentEventEntity,
  DomainMemoryEntity,
  MemoryChunkEntity,
];
