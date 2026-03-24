type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const GOOGLE_ADS_EXPORT_TEMPLATE: { [key: string]: JsonValue } = {
  site: {
    domain: null,
    name: null,
    description: null,
    globalRanking: null,
    status: null,
    priority: null,
    visibilityStatus: null,
  },
  semrushData: {
    source: {
      url: null,
      name: null,
      method: null,
      fetchDate: null,
    },
    traffic: {
      semrushRank: null,
      totalTraffic: null,
      adwordsTraffic: null,
      organicTraffic: null,
      adwordsPositions: null,
      organicPositions: null,
      adwordsTrafficCost: null,
      organicTrafficCost: null,
      organicTrafficBranded: null,
      organicTrafficNonBranded: null,
    },
    authority: {
      backlinks: null,
      linkPower: null,
      naturalness: null,
      domainHealth: null,
      authorityScore: null,
      referringDomains: null,
    },
    aiOverview: {
      citedPages: null,
      visibility: null,
    },
    aiSources: {
      sources: [
        {
          domain: null,
          mentions_count: null,
          category: null,
          relevance: null,
        },
      ],
    },
    competitors: [
      {
        domain: null,
        traffic: null,
        organicTraffic: null,
        positions: null,
        organicPositions: null,
        trafficCost: null,
        organicTrafficCost: null,
        commonKeywords: null,
        competitionLvl: null,
        adwordsPositions: null,
        serpFeaturesTraffic: null,
        strength: null,
        opportunity: null,
        recommendedAction: null,
      },
    ],
  },
  googleAdsInsights: {
    recommendedKeywords: [
      {
        keyword: null,
        searchVolume: null,
        cpc: null,
        competition: null,
        intent: null,
        priority: null,
      },
    ],
    targetingStrategy: {
      primaryGeo: [null],
      deviceSplit: {
        desktop: null,
        mobile: null,
      },
      biddingStrategy: null,
      dailyBudget: null,
      campaignGoal: null,
    },
    estimatedPerformance: {
      expectedImpressions: null,
      expectedClicks: null,
      expectedCTR: null,
      expectedCPC: null,
      expectedCost: null,
      expectedConversions: null,
      expectedConversionRate: null,
    },
  },
  siteAffiliateInfo: {
    programInfoLink: null,
    loginLink: null,
    description: null,
    percentCommission: null,
    isBanBrandedKeyword: null,
    isDisplayAdsExisted: null,
    commissionType: null,
    cookieDuration: null,
    minPayout: null,
  },
  siteAffiliateProfiles: [
    {
      name: null,
      referralLink: null,
      loginUser: null,
      loginPassword: null,
      description: null,
      percentCommission: null,
      linkedProjectProfileId: null,
      isPublished: null,
      specialTerms: null,
    },
  ],
  pricingModels: [
    {
      value: null,
      modelName: null,
      rawPrice: null,
      currency: null,
      billingCycle: null,
      description: null,
      productUrl: null,
      brand: null,
      sourceDomain: null,
      sourceType: null,
      notes: null,
    },
  ],
  recommendedCampaigns: [
    {
      campaignName: null,
      campaignType: null,
      keywords: [null],
      dailyBudget: null,
      cpcBid: null,
      priority: null,
      rationale: null,
    },
  ],
  researchMetadata: {
    batchResearch: {
      name: null,
      description: null,
      tags: null,
      status: null,
      totalDomains: null,
      completedDomains: null,
      failedDomains: null,
      assigneeId: null,
    },
    batchResearchSite: {
      status: null,
      researchDate: null,
      errorMessage: null,
      retryCount: null,
      dataSource: null,
    },
    researchQueue: {
      priority: null,
      status: null,
      scheduledAt: null,
      processedAt: null,
    },
  },
  tags: [
    {
      name: null,
      category: null,
    },
  ],
  actionPlan: {
    immediateActions: [null],
    shortTermGoals: [null],
    longTermStrategy: [null],
  },
};

export const GOOGLE_ADS_EXPORT_SCHEMA_TEXT = JSON.stringify(
  GOOGLE_ADS_EXPORT_TEMPLATE,
  null,
  2,
);

export function normalizeGoogleAdsExportPayload(input: unknown): Record<string, JsonValue> {
  return coerceByTemplate(GOOGLE_ADS_EXPORT_TEMPLATE, input) as Record<string, JsonValue>;
}

function coerceByTemplate(template: JsonValue, input: unknown): JsonValue {
  if (Array.isArray(template)) {
    const itemTemplate = template[0];
    if (itemTemplate === undefined || !Array.isArray(input)) {
      return null;
    }
    return input.map((item) => coerceByTemplate(itemTemplate, item));
  }

  if (isJsonObject(template)) {
    const inputObj = isJsonObject(input) ? input : {};
    const result: { [key: string]: JsonValue } = {};

    for (const key of Object.keys(template)) {
      result[key] = coerceByTemplate(template[key], inputObj[key]);
    }

    return result;
  }

  return toPrimitiveOrNull(input);
}

function isJsonObject(value: unknown): value is { [key: string]: JsonValue } {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toPrimitiveOrNull(value: unknown): JsonPrimitive {
  if (value === null) {
    return null;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return null;
}
