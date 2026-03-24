export const domainsDData = [
  {
    domain: 'firecrawl.dev',
    homepageUrl: 'https://www.firecrawl.dev',
    pageType: 'landing',
    productType: 'digital',
    products: [
      {
        name: 'Firecrawl Pro Plan',
        price: '99.00',
        currency: 'USD',
        url: 'https://www.firecrawl.dev/pricing',
        trustScore: 95,
        trustReason: 'Official pricing page',
      },
    ],
    affiliateProgram: {
      found: true,
      signupUrl: 'https://www.firecrawl.dev/affiliate',
      commissionRate: '25%',
      commissionType: 'recurring',
      cookieDuration: '60 days',
      payoutMethod: 'Stripe, PayPal',
      trustScore: 88,
    },
    overallTrustScore: 92,
    exitReason: null,
  },
  {
    domain: 'webscraper.io',
    homepageUrl: 'https://webscraper.io',
    pageType: 'store',
    productType: 'digital',
    products: [
      {
        name: 'Cloud Scraper Browser Extension',
        price: '50.00',
        currency: 'USD',
        url: 'https://webscraper.io/pricing',
        trustScore: 98,
        trustReason: 'Long-standing industry tool',
      },
    ],
    affiliateProgram: {
      found: true,
      signupUrl: 'https://webscraper.io/affiliate-program',
      commissionRate: '20%',
      commissionType: 'one-time',
      cookieDuration: '30 days',
      payoutMethod: 'PayPal',
      trustScore: 90,
    },
    overallTrustScore: 95,
    exitReason: null,
  },
  {
    domain: 'browse.ai',
    homepageUrl: 'https://www.browse.ai',
    pageType: 'landing',
    productType: 'digital',
    products: [
      {
        name: 'Starter Plan',
        price: '19.00',
        currency: 'USD',
        url: 'https://www.browse.ai/pricing',
        trustScore: 92,
        trustReason: 'Modern UI and clear subscription paths',
      },
    ],
    affiliateProgram: {
      found: true,
      signupUrl: 'https://www.browse.ai/affiliates',
      commissionRate: '20%',
      commissionType: 'recurring',
      cookieDuration: '60 days',
      payoutMethod: 'Stripe',
      trustScore: 85,
    },
    overallTrustScore: 89,
    exitReason: null,
  },
];

export const semrushData = {
  traffic: {
    totalTraffic: 27348,
    organicTraffic: 24333,
    organicTrafficBranded: 17414,
    organicTrafficNonBranded: 6919,
    organicTrafficCost: 105185,
    adwordsTraffic: 3015,
    adwordsTrafficCost: 13192,
  },
  authority: {
    authorityScore: 42,
    domainHealth: 44,
    backlinks: 71276,
    referringDomains: 4612,
  },
  aiSources: {
    sources: [
      { domain: 'medium.com', mentions_count: 165 },
      { domain: 'reddit.com', mentions_count: 128 },
      { domain: 'youtube.com', mentions_count: 149 },
    ],
  },
  marketContext: {
    competitionLvl: 1,
    topCompetitor: 'webscraper.io',
    competitorTrafficCost: 768163,
  },
};
