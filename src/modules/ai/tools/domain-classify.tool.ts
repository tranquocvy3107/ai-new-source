import { Injectable } from '@nestjs/common';
import { DomainService } from '../domain/domain.service';
import { ClassifiledDomain, InvestmentSignal } from '../domain/dto/domain.dto';
import { AgentTool } from './tool.types';
import { ToolExecutionResult } from '../agent';

@Injectable()
export class DomainClassifyTool implements AgentTool {
  readonly name = 'domain_classify';
  readonly description =
    'Classify a list of affiliate domains and return investment signals, opportunity scores, traffic metrics, and actionable insights for AI reasoning.';

  constructor(private readonly domainService: DomainService) {}

  async execute(_input: string, _domain: string): Promise<ToolExecutionResult> {
    try {
      const domains = await this.domainService.classifyDomain();
      return {
        ok: true,
        output: this.formatForAgent(domains),
      };
    } catch (err: any) {
      return { ok: false, output: err.message };
    }
  }

  private formatForAgent(domains: ClassifiledDomain[]): string {
    const lines: string[] = ['=== DOMAIN CLASSIFICATION REPORT ===\n'];

    for (const d of domains) {
      const emoji = this.signalEmoji(d.investmentSignal);
      lines.push(`${emoji} [${d.investmentSignal}] ${d.domain}`);
      lines.push(`  URL: ${d.homepageUrl}`);
      lines.push(`  Signal Reason: ${d.recommendationReason}`);
      lines.push(`  Authority: ${d.authorityScore} | Competition: ${d.competitionLevel.toFixed(2)} | Saturated: ${d.isMarketSaturated}`);
      lines.push(`  Traffic: ${d.trafficHealth.total.toLocaleString()} total | Organic: ${d.trafficHealth.organicRatio.toFixed(1)}% | Non-branded gap: ${d.trafficHealth.nonBrandedRatio.toFixed(1)}%`);
      lines.push(`  Traffic Value: $${d.trafficHealth.trafficValue.toLocaleString()}/mo | Est. Revenue: $${d.estimatedMonthlyRevenue.toFixed(0)}/mo`);
      lines.push(`  Commission: ${d.commissionPotential.rate ?? 'N/A'} (${d.commissionPotential.type ?? 'N/A'}) | Avg Order: $${d.commissionPotential.avgOrderValue.toFixed(0)}`);
      lines.push(`  Top Promo Platform: ${d.socialMentions.topPlatform} (${d.socialMentions.totalMentions} mentions)`);
      lines.push('');
    }

    const allIn = domains.filter((d) => d.investmentSignal === InvestmentSignal.ALL_IN).map((d) => d.domain);
    const scaling = domains.filter((d) => d.investmentSignal === InvestmentSignal.SCALING).map((d) => d.domain);

    lines.push('--- SUMMARY ---');
    lines.push(`Total analyzed: ${domains.length}`);
    lines.push(`ALL_IN: ${allIn.length > 0 ? allIn.join(', ') : 'none'}`);
    lines.push(`SCALING: ${scaling.length > 0 ? scaling.join(', ') : 'none'}`);

    return lines.join('\n');
  }

  private signalEmoji(signal: InvestmentSignal): string {
    const map: Record<InvestmentSignal, string> = {
      [InvestmentSignal.ALL_IN]: '🔥',
      [InvestmentSignal.SCALING]: '📈',
      [InvestmentSignal.WATCHLIST]: '👀',
      [InvestmentSignal.HIGH_BARRIER]: '🚧',
      [InvestmentSignal.AVOID]: '❌',
    };
    return map[signal] ?? '•';
  }
}
