import { Module } from '@nestjs/common';
import { DomainService } from './domain.service';
import { DomainController } from './domain.controller';
import { SemrushTrafficTool } from '../tools';

@Module({
  controllers: [DomainController],
  providers: [DomainService, SemrushTrafficTool],
  exports: [DomainService],
})
export class DomainModule {}
