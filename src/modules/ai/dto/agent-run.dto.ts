import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class AgentRunDto {
  @IsString()
  @MaxLength(12000)
  input!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  domain?: string;

  @IsOptional()
  @IsBoolean()
  saveMemory?: boolean;
}

export class ModelTestDto {
  @IsString()
  @MaxLength(4000)
  prompt!: string;
}
