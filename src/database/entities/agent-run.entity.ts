import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'agent_runs' })
export class AgentRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  domain!: string;

  @Column({ type: 'text' })
  userInput!: string;

  @Column({ type: 'text', nullable: true })
  finalAnswer!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'running' })
  status!: 'running' | 'completed' | 'failed';

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
