import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import { AgentEvent } from '../agent';

@Injectable()
export class AgentStreamService {
  private readonly runStreams = new Map<string, Subject<AgentEvent>>();

  getRunStream(runId: string): Subject<AgentEvent> {
    if (!this.runStreams.has(runId)) {
      this.runStreams.set(runId, new Subject<AgentEvent>());
    }
    return this.runStreams.get(runId)!;
  }

  emit(runId: string, event: AgentEvent): void {
    this.getRunStream(runId).next(event);
  }

  complete(runId: string): void {
    const stream = this.runStreams.get(runId);
    if (!stream) {
      return;
    }
    stream.complete();
    this.runStreams.delete(runId);
  }
}
