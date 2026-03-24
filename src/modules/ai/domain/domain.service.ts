import { Injectable } from '@nestjs/common';
import { ClassifiledDomain, InvestmentSignal } from './dto/domain.dto';
import { domainsDData } from './data/domain.data';
import { SemrushTrafficTool } from '../tools';

@Injectable()
export class DomainService {
  constructor(private readonly semrushTool: SemrushTrafficTool) {}

  async classifyDomain(): Promise<ClassifiledDomain[]> {
    return Promise.all(domainsDData.map((domainInfo) => this.classifySingle(domainInfo)));
  }

  private async classifySingle(domainInfo: (typeof domainsDData)[number]): Promise<ClassifiledDomain> {
    const trafficInfo = await this.fetchTraffic(domainInfo.domain);

    const { organicTraffic, organicTrafficNonBranded, organicTrafficCost, totalTraffic } = trafficInfo.traffic;
    const { authorityScore } = trafficInfo.authority;
    const competitionLvl: number = trafficInfo.marketContext?.competitionLvl ?? 0;

    const nonBrandedRatio = (organicTrafficNonBranded / organicTraffic) * 100;
    const isRecurring = domainInfo.affiliateProgram.commissionType === 'recurring';

    return {
      domain: domainInfo.domain,
      homepageUrl: domainInfo.homepageUrl,
      estimatedMonthlyRevenue: organicTrafficCost * 0.02,
      commissionPotential: {
        rate: domainInfo.affiliateProgram.commissionRate,
        type: domainInfo.affiliateProgram.commissionType,
        avgOrderValue: this.calcAvgPrice(domainInfo.products),
      },
      authorityScore,
      competitionLevel: competitionLvl,
      isMarketSaturated: competitionLvl > 0.7,
      trafficHealth: {
        total: totalTraffic,
        organicRatio: (organicTraffic / totalTraffic) * 100,
        nonBrandedRatio,
        trafficValue: organicTrafficCost,
      },
      socialMentions: {
        topPlatform: trafficInfo.aiSources?.sources?.[0]?.domain ?? 'N/A',
        totalMentions: trafficInfo.aiSources?.sources?.reduce(
          (sum: number, s: any) => sum + s.mentions_count, 0,
        ) ?? 0,
      },
      ...this.resolveSignal({ authorityScore, nonBrandedRatio, isRecurring, competitionLvl, organicTraffic }),
    };
  }

  private resolveSignal({
    authorityScore,
    nonBrandedRatio,
    isRecurring,
    competitionLvl,
    organicTraffic,
  }: {
    authorityScore: number;
    nonBrandedRatio: number;
    isRecurring: boolean;
    competitionLvl: number;
    organicTraffic: number;
  }): { investmentSignal: InvestmentSignal; recommendationReason: string } {
    if (authorityScore > 35 && nonBrandedRatio > 20 && isRecurring) {
      return {
        investmentSignal: InvestmentSignal.ALL_IN,
        recommendationReason: 'Authority cao, ngách từ khóa mở (Non-branded > 20%), hoa hồng trọn đời.',
      };
    }
    if (competitionLvl > 0.8) {
      return {
        investmentSignal: InvestmentSignal.HIGH_BARRIER,
        recommendationReason: 'Thị trường quá bão hòa, đối thủ lớn chiếm lĩnh hầu hết traffic.',
      };
    }
    if (organicTraffic < 1000) {
      return {
        investmentSignal: InvestmentSignal.AVOID,
        recommendationReason: 'Traffic quá thấp, không bõ công đầu tư SEO hay Ads.',
      };
    }
    return {
      investmentSignal: InvestmentSignal.WATCHLIST,
      recommendationReason: 'Dữ liệu chưa đủ đột phá để xếp hạng cao.',
    };
  }

  private async fetchTraffic(domain: string) {
    const result = await this.semrushTool.execute(domain, domain);
    if (!result.ok) throw new Error(`Semrush error for ${domain}: ${result.output}`);
    return result.output as any;
  }

  private calcAvgPrice(products: any[]): number {
    const prices = products.map((p) => parseFloat(p.price)).filter((p) => !isNaN(p));
    return prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  }
}
