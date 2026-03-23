export const AFFILIATE_RESEARCH_SCOPE = `
Primary goal: research affiliate potential of a domain and prepare decision-ready output.

Research checklist:
1) Identify affiliate program presence and entry points.
2) Identify products/services suitable for affiliate promotion.
3) Extract pricing and plan structure.
4) Extract commission model (rate, CPA/CPS/recurring, cookie duration).
5) Find referral/affiliate links and tracking pattern.
6) Estimate domain traffic signals and quality indicators from available sources.
7) Build domain evaluation criteria and score pass/fail.
8) Prepare data package for Google Ads execution:
   - target offers
   - audience angle
   - keywords
   - ad copy angles
   - landing page notes
   - compliance/risk notes
`;

export const AFFILIATE_RESULT_FORMAT = `
When finishing, produce strict JSON object with this shape:
{
  "domain": "string",
  "domain_snapshot": "string",
  "affiliate_program": {
    "found": true,
    "official_url": "string",
    "notes": "string"
  },
  "products_pricing": {
    "products": ["string"],
    "pricing_notes": "string"
  },
  "commission_economics": {
    "model": "string",
    "rate": "string",
    "cookie_duration": "string",
    "payout_notes": "string"
  },
  "referral_tracking": {
    "referral_link": "string",
    "tracking_notes": "string"
  },
  "traffic_quality_signals": {
    "signals": ["string"],
    "confidence": "low|medium|high"
  },
  "evaluation": {
    "score": 0,
    "verdict": "PASS|FAIL",
    "reasons": ["string"]
  },
  "google_ads_ready_data": {
    "offers": ["string"],
    "audience_angles": ["string"],
    "keywords": ["string"],
    "ad_copy_angles": ["string"],
    "landing_page_notes": ["string"],
    "compliance_risk_notes": ["string"]
  },
  "unknowns_next_steps": ["string"]
}
`;
