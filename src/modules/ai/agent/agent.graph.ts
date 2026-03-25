import { Injectable } from '@nestjs/common';
import { END, START, Annotation, StateGraph } from '@langchain/langgraph';
import { LlmService } from '../llm';
import { MemoryService } from '../memory';
import { AgentTool } from '../tools';
import {
  AGENT_SYSTEM_PROMPT,
  DECISION_PROMPT_TEMPLATE,
  FINAL_RESPONSE_PROMPT_TEMPLATE,
  SUMMARY_PROMPT_TEMPLATE,
} from './prompts';
import { AgentDecision, ToolExecutionResult } from './agent.types';
import { AFFILIATE_RESEARCH_SCOPE } from './research-context';
import {
  GOOGLE_ADS_EXPORT_SCHEMA_TEXT,
  normalizeGoogleAdsExportPayload,
} from './google-ads-export.schema';

const AgentState = Annotation.Root({
  input: Annotation<string>(),
  domain: Annotation<string>(),
  maxSteps: Annotation<number>(),
  step: Annotation<number>(),
  memorySummary: Annotation<string>(),
  recentContext: Annotation<string>(),
  scratchpad: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  thoughts: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  decision: Annotation<AgentDecision | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),
  lastToolResult: Annotation<ToolExecutionResult | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),
  finalAnswer: Annotation<string>({
    reducer: (_, update) => update,
    default: () => '',
  }),
  lastSearchTopUrl: Annotation<string>({
    reducer: (_, update) => update,
    default: () => '',
  }),
  lastSearchUrls: Annotation<string[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),
  affiliateUrlCandidate: Annotation<string>({
    reducer: (_, update) => update,
    default: () => '',
  }),
  pricingUrlCandidate: Annotation<string>({
    reducer: (_, update) => update,
    default: () => '',
  }),
  semrushSnapshot: Annotation<Record<string, unknown> | null>({
    reducer: (_, update) => update,
    default: () => null,
  }),
  searchSignatures: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  visitedScrapeUrls: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  // checkedConnectUrls: Annotation<string[]>({
  //   reducer: (current, update) => [...current, ...update],
  //   default: () => [],
  // }),
  toolHistory: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
});

type AgentStateType = typeof AgentState.State;

@Injectable()
export class AgentGraphService {
  constructor(
    private readonly llmService: LlmService,
    private readonly memoryService: MemoryService,
  ) {}

  async run(params: {
    input: string;
    domain: string;
    maxSteps: number;
    tools: AgentTool[];
    onThinking: (thought: string, step: number) => Promise<void>;
    onToolCall: (name: string, toolInput: string, step: number) => Promise<void>;
    onToolResult: (name: string, result: ToolExecutionResult, step: number) => Promise<void>;
  }): Promise<{ finalAnswer: string; thoughts: string[]; scratchpad: string[]; summarySuggestion: string }> {
    const toolMap = new Map<string, AgentTool>(params.tools.map((tool) => [tool.name, tool]));

    const graph = new StateGraph(AgentState)
      .addNode('bootstrap', async (state: AgentStateType) => {
        const memorySummary = await this.memoryService.getDomainSummary(state.domain);
        return {
          memorySummary,
          recentContext: 'No recent context yet.',
        };
      })
      .addNode('plan', async (state: AgentStateType) => {
        const prompt = this.renderDecisionPrompt({
          domain: state.domain,
          input: state.input,
          researchObjective: AFFILIATE_RESEARCH_SCOPE.trim(),
          memorySummary: state.memorySummary,
          recentContext: state.recentContext,
          scratchpad: state.scratchpad.join('\n'),
        });

        let decision: AgentDecision;
        try {
          const rawDecision = await this.llmService.generateJson<unknown>(AGENT_SYSTEM_PROMPT, prompt);
          decision = this.normalizeDecision(rawDecision);
        } catch {
          decision = {
            thought: 'I cannot parse JSON planning output, I will finish with best available answer.',
            action: 'final',
          };
        }

        decision = this.applyExecutionPolicy(decision, state);
        await params.onThinking(decision.thought, state.step);
        return {
          decision,
          thoughts: [decision.thought],
          step: state.step + 1,
        };
      })
      .addNode('tool', async (state: AgentStateType) => {
        const decision = state.decision;
        if (!decision || decision.action !== 'tool') {
          return {
            lastToolResult: {
              ok: false,
              output: 'No tool action was selected.',
            },
          };
        }

        const tool = decision.toolName ? toolMap.get(decision.toolName) : undefined;
        let toolInput = decision.toolInput ?? '';
        if (decision.toolName === 'web_scrape') {
          toolInput = this.normalizeUrlCandidate(toolInput);
        }

        if (!tool) {
          const missingResult: ToolExecutionResult = {
            ok: false,
            output: `Tool "${decision.toolName ?? 'unknown'}" is not available.`,
          };
          await params.onToolResult(decision.toolName ?? 'unknown', missingResult, state.step);
          return {
            lastToolResult: missingResult,
            scratchpad: [`Tool missing: ${missingResult.output}`],
          };
        }

        await params.onToolCall(tool.name, toolInput, state.step);
        let result: ToolExecutionResult;
        try {
          result = await tool.execute(toolInput, state.domain);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown tool error';
          result = {
            ok: false,
            output: `Tool "${tool.name}" failed: ${message}`,
          };
        }
        await params.onToolResult(tool.name, result, state.step);
        const outputText = this.toOutputText(result.output);

        const extractedSearchUrls =
          tool.name === 'url_search' ? this.extractUrlsFromSearchResult(outputText) : state.lastSearchUrls;
        const extractedUrl =
          tool.name === 'url_search'
            ? extractedSearchUrls[0] || state.lastSearchTopUrl
            : state.lastSearchTopUrl;
        const searchSignature =
          tool.name === 'url_search' ? this.buildSearchSignature(extractedSearchUrls) : '';
        const scrapedUrl =
          tool.name === 'web_scrape' && this.isLikelyUrl(toolInput) ? [toolInput.trim()] : [];
        const normalizedDomain = this.normalizeDomain(state.domain);
        const affiliateCandidateFromSearch =
          tool.name === 'url_search'
            ? this.pickBestSearchUrl(extractedSearchUrls, normalizedDomain, 'affiliate', [])
            : '';
        const pricingCandidateFromSearch =
          tool.name === 'url_search'
            ? this.pickBestSearchUrl(extractedSearchUrls, normalizedDomain, 'pricing', [])
            : '';
        const scrapedAffiliateUrl =
          tool.name === 'web_scrape' && this.isAffiliateEvidence(toolInput, outputText, normalizedDomain)
            ? this.normalizeUrlCandidate(toolInput)
            : '';
        const scrapedPricingUrl =
          tool.name === 'web_scrape' && this.isPricingEvidence(toolInput, outputText, normalizedDomain)
            ? this.normalizeUrlCandidate(toolInput)
            : '';
        const semrushSnapshot =
          tool.name === 'semrush_traffic' ? this.asObject(result.output) : state.semrushSnapshot;
        // const checkedUrl =
        //   tool.name === 'check_connect' && this.isLikelyUrl(toolInput) ? [toolInput.trim()] : [];

        return {
          lastToolResult: result,
          recentContext: outputText.slice(0, 2000),
          lastSearchTopUrl: extractedUrl,
          lastSearchUrls: extractedSearchUrls,
          affiliateUrlCandidate:
            scrapedAffiliateUrl || affiliateCandidateFromSearch || state.affiliateUrlCandidate,
          pricingUrlCandidate:
            scrapedPricingUrl || pricingCandidateFromSearch || state.pricingUrlCandidate,
          semrushSnapshot,
          searchSignatures: searchSignature ? [searchSignature] : [],
          visitedScrapeUrls: scrapedUrl,
          // checkedConnectUrls: checkedUrl,
          toolHistory: [`${tool.name}|${toolInput}`],
          scratchpad: [
            `Tool ${tool.name}(${toolInput}) => ${outputText.slice(0, 1200)}`,
          ],
        };
      })
      .addNode('respond', async (state: AgentStateType) => {
        const existingFinalAnswer =
          state.decision?.action === 'final' ? state.decision.finalAnswer : undefined;
        const parsedExistingFinalAnswer = existingFinalAnswer
          ? this.tryParseJsonText(existingFinalAnswer)
          : null;

        if (parsedExistingFinalAnswer !== null) {
          return {
            finalAnswer: this.formatFinalAnswer(parsedExistingFinalAnswer, state),
          };
        }

        try {
          const finalPayload = await this.llmService.generateJson<Record<string, unknown>>(
            'You are an AI agent summarizing execution into structured JSON for downstream Google Ads automation.',
            `${this.renderFinalResponsePrompt({
              input: state.input,
              domain: state.domain,
              memorySummary: state.memorySummary,
              scratchpad: state.scratchpad.join('\n'),
            })}\nOutput strict JSON only. Do not use markdown.`,
          );

          return { finalAnswer: this.formatFinalAnswer(finalPayload, state) };
        } catch {
          const fallback = await this.llmService.generateText(
            'You are an AI agent summarizing execution into strict JSON only for downstream Google Ads automation.',
            this.renderFinalResponsePrompt({
              input: state.input,
              domain: state.domain,
              memorySummary: state.memorySummary,
              scratchpad: state.scratchpad.join('\n'),
            }),
          );
          return { finalAnswer: this.formatFinalAnswer(fallback, state) };
        }
      })
      .addEdge(START, 'bootstrap')
      .addEdge('bootstrap', 'plan')
      .addConditionalEdges(
        'plan',
        (state: AgentStateType) => {
          if (!state.decision) {
            return 'respond';
          }
          if (state.step >= state.maxSteps) {
            return 'respond';
          }
          return state.decision.action === 'tool' ? 'tool' : 'respond';
        },
        ['tool', 'respond'],
      )
      .addEdge('tool', 'plan')
      .addEdge('respond', END)
      .compile();

    const result = await graph.invoke({
      input: params.input,
      domain: params.domain,
      maxSteps: params.maxSteps,
      step: 0,
    });

    const summarySuggestion = await this.llmService.generateText(
      'You compress research memory in concise markdown with bullets.',
      SUMMARY_PROMPT_TEMPLATE.replace('{domain}', params.domain)
        .replace('{currentSummary}', result.memorySummary ?? '')
        .replace('{newEvidence}', result.scratchpad?.join('\n') ?? ''),
    );

    return {
      finalAnswer: result.finalAnswer ?? '',
      thoughts: result.thoughts ?? [],
      scratchpad: result.scratchpad ?? [],
      summarySuggestion,
    };
  }

  private renderDecisionPrompt(input: {
    input: string;
    domain: string;
    researchObjective: string;
    memorySummary: string;
    recentContext: string;
    scratchpad: string;
  }): string {
    return DECISION_PROMPT_TEMPLATE.replace('{domain}', input.domain)
      .replace('{input}', input.input)
      .replace('{researchObjective}', input.researchObjective)
      .replace('{memorySummary}', input.memorySummary)
      .replace('{recentContext}', input.recentContext)
      .replace('{scratchpad}', input.scratchpad || 'No scratchpad yet.');
  }

  private applyExecutionPolicy(decision: AgentDecision, state: AgentStateType): AgentDecision {
    const flowDecision = this.enforceMandatoryResearchFlow(state, decision);
    if (flowDecision) {
      return flowDecision;
    }

    const hasSemrushCall = this.hasToolCall(state.toolHistory, 'semrush_traffic');
    const hasMemoryLookupCall = this.hasToolCall(state.toolHistory, 'memory_lookup');
    const semrushInput = this.normalizeDomain(state.domain || state.input);

    if (decision.action === 'final') {
      const hasDomainMemory = Boolean(state.memorySummary && state.memorySummary !== 'No summary yet.');
      if (state.step < state.maxSteps && hasDomainMemory && !state.scratchpad.length && !hasMemoryLookupCall) {
        return {
          thought:
            'I should load persisted memory chunks for this domain before finalizing to improve output completeness.',
          action: 'tool',
          toolName: 'memory_lookup',
          toolInput: `${semrushInput || state.domain} affiliate google ads`,
        };
      }
      return decision;
    }

    const normalizedInput = (decision.toolInput ?? '').trim().toLowerCase();
    const historyKey = `${decision.toolName ?? ''}|${normalizedInput}`;
    const isRepeatedCall = state.toolHistory.some((item) => item.toLowerCase() === historyKey);
    const nextUrlToScrape = this.pickNextUrlToScrape(state.lastSearchUrls, state.visitedScrapeUrls);
    const repeatedSearchResults = this.hasRepeatedSearchResults(state.searchSignatures);

    if (decision.toolName === 'url_search') {
      if (repeatedSearchResults) {
        if (nextUrlToScrape) {
          return {
            thought:
              'Search results are repeating. I will scrape a new URL from the existing result set instead of searching again.',
            action: 'tool',
            toolName: 'web_scrape',
            toolInput: nextUrlToScrape,
          };
        }
        return {
          thought:
            'Search results are repeating and no new URL is available. I will continue with analysis/finalization.',
          action: 'final',
        };
      }

      if (isRepeatedCall) {
        if (nextUrlToScrape) {
          return {
            thought:
              'Repeated search query detected. I will scrape another URL from prior search results to collect missing details.',
            action: 'tool',
            toolName: 'web_scrape',
            toolInput: nextUrlToScrape,
          };
        }
      }

      if (!normalizedInput) {
        return {
          thought:
            'Search query was empty. I will use a targeted affiliate query to continue data collection.',
          action: 'tool',
          toolName: 'url_search',
          toolInput: this.buildSearchToolInput(`${semrushInput || state.domain} affiliate program`),
        };
      }
    }

    if (decision.toolName === 'semrush_traffic') {
      if (hasSemrushCall) {
        return {
          thought:
            'Semrush traffic was already queried in this run. I will avoid duplicate Semrush calls and continue analysis.',
          action: 'final',
        };
      }

      if (!normalizedInput && semrushInput) {
        return {
          thought:
            'Semrush tool input was empty. I will use the current research domain as Semrush query input.',
          action: 'tool',
          toolName: 'semrush_traffic',
          toolInput: semrushInput,
        };
      }
    }

    if (decision.toolName === 'web_scrape') {
      const input = (decision.toolInput ?? '').trim();
      if (!this.isLikelyUrl(input) && nextUrlToScrape) {
        return {
          thought:
            'Scrape input is not a valid URL. I will scrape a candidate URL from recent search results.',
          action: 'tool',
          toolName: 'web_scrape',
          toolInput: nextUrlToScrape,
        };
      }

      if (input && state.visitedScrapeUrls.some((item) => item === input) && nextUrlToScrape) {
        return {
          thought:
            'This URL was already scraped. I will scrape another URL to avoid duplicate evidence.',
          action: 'tool',
          toolName: 'web_scrape',
          toolInput: nextUrlToScrape,
        };
      }

      // if (input && !state.checkedConnectUrls.some((item) => item === input)) {
      //   return {
      //     thought:
      //       'Before scraping, I should verify connectivity/status for this URL to avoid 403/500 issues.',
      //     action: 'tool',
      //     toolName: 'check_connect',
      //     toolInput: input,
      //   };
      // }
    }

    // if (decision.toolName === 'check_connect') {
    //   const input = (decision.toolInput ?? '').trim();
    //   if (!this.isLikelyUrl(input) && nextUrlToScrape) {
    //     return {
    //       thought:
    //         'Connectivity check needs a valid URL. I will check the next candidate URL from search results.',
    //       action: 'tool',
    //       toolName: 'check_connect',
    //       toolInput: nextUrlToScrape,
    //     };
    //   }
    // }

    return decision;
  }

  private hasToolCall(toolHistory: string[], toolName: string): boolean {
    return toolHistory.some((item) => item.toLowerCase().startsWith(`${toolName.toLowerCase()}|`));
  }

  private enforceMandatoryResearchFlow(
    state: AgentStateType,
    decision: AgentDecision,
  ): AgentDecision | null {
    if (state.step >= state.maxSteps) {
      return null;
    }

    const domain = this.normalizeDomain(state.domain || state.input);
    if (!domain) {
      return null;
    }

    const toolCalls = this.parseToolHistory(state.toolHistory);
    const scrapedEvidence = state.scratchpad.filter((item) =>
      item.toLowerCase().startsWith('tool web_scrape('),
    );
    const hasAffiliateSearch = toolCalls.some(
      (call) => call.name === 'url_search' && this.isAffiliateSearchQuery(call.input),
    );
    const hasAffiliateScrape =
      toolCalls.some((call) => call.name === 'web_scrape' && this.isAffiliateEvidence(call.input, '', domain)) ||
      scrapedEvidence.some((item) => this.isAffiliateEvidence('', item, domain));
    const hasPricingSearch = toolCalls.some(
      (call) => call.name === 'url_search' && this.isPricingSearchQuery(call.input),
    );
    const hasPricingScrape =
      toolCalls.some((call) => call.name === 'web_scrape' && this.isPricingEvidence(call.input, '', domain)) ||
      scrapedEvidence.some((item) => this.isPricingEvidence('', item, domain));
    const hasSemrushCall = toolCalls.some((call) => call.name === 'semrush_traffic');

    const affiliateQuery = `${domain} affiliate program`;
    const pricingQuery = `${domain} pricing plans`;

    if (!hasAffiliateSearch) {
      if (decision.action === 'tool' && decision.toolName === 'url_search' && this.isAffiliateSearchQuery(decision.toolInput ?? '')) {
        return {
          ...decision,
          toolInput: this.buildSearchToolInput(this.extractQueryFromToolInput(decision.toolInput ?? '') || affiliateQuery),
        };
      }
      return {
        thought:
          'I must start by searching affiliate program sources first. I will run url_search and gather the top 5 links.',
        action: 'tool',
        toolName: 'url_search',
        toolInput: this.buildSearchToolInput(affiliateQuery),
      };
    }

    if (!hasAffiliateScrape) {
      const affiliateCandidate =
        state.affiliateUrlCandidate ||
        this.pickBestSearchUrl(state.lastSearchUrls, domain, 'affiliate', state.visitedScrapeUrls);

      if (
        decision.action === 'tool' &&
        decision.toolName === 'web_scrape' &&
        this.isAffiliateEvidence(decision.toolInput ?? '', '', domain)
      ) {
        return decision;
      }

      if (affiliateCandidate) {
        return {
          thought:
            'I have affiliate search results and need evidence from the closest official affiliate URL before moving on.',
          action: 'tool',
          toolName: 'web_scrape',
          toolInput: affiliateCandidate,
        };
      }

      return {
        thought:
          'Affiliate scrape target is still unclear, so I will refresh affiliate-focused search results before continuing.',
        action: 'tool',
        toolName: 'url_search',
        toolInput: this.buildSearchToolInput(affiliateQuery),
      };
    }

    if (!hasPricingSearch) {
      if (decision.action === 'tool' && decision.toolName === 'url_search' && this.isPricingSearchQuery(decision.toolInput ?? '')) {
        return {
          ...decision,
          toolInput: this.buildSearchToolInput(this.extractQueryFromToolInput(decision.toolInput ?? '') || pricingQuery),
        };
      }
      return {
        thought:
          'Affiliate details are collected. Next I need pricing model data, so I will search pricing pages.',
        action: 'tool',
        toolName: 'url_search',
        toolInput: this.buildSearchToolInput(pricingQuery),
      };
    }

    if (!hasPricingScrape) {
      const pricingCandidate =
        state.pricingUrlCandidate ||
        this.pickBestSearchUrl(state.lastSearchUrls, domain, 'pricing', state.visitedScrapeUrls);

      if (
        decision.action === 'tool' &&
        decision.toolName === 'web_scrape' &&
        this.isPricingEvidence(decision.toolInput ?? '', '', domain)
      ) {
        return decision;
      }

      if (pricingCandidate) {
        return {
          thought:
            'I have pricing search results and should scrape the most relevant official pricing URL before Semrush.',
          action: 'tool',
          toolName: 'web_scrape',
          toolInput: pricingCandidate,
        };
      }

      return {
        thought:
          'Pricing scrape target is unclear, so I will run one more pricing-focused search to find an official pricing page.',
        action: 'tool',
        toolName: 'url_search',
        toolInput: this.buildSearchToolInput(pricingQuery),
      };
    }

    if (!hasSemrushCall) {
      if (decision.action === 'tool' && decision.toolName === 'semrush_traffic') {
        return {
          ...decision,
          toolInput: decision.toolInput?.trim() || domain,
        };
      }
      return {
        thought:
          'I now have affiliate and pricing evidence. Next I need Semrush traffic/authority signals before final JSON.',
        action: 'tool',
        toolName: 'semrush_traffic',
        toolInput: domain,
      };
    }

    return null;
  }

  private parseToolHistory(toolHistory: string[]): Array<{ name: string; input: string }> {
    return toolHistory
      .map((item) => {
        const index = item.indexOf('|');
        if (index < 0) {
          return { name: item.trim(), input: '' };
        }
        return {
          name: item.slice(0, index).trim(),
          input: item.slice(index + 1).trim(),
        };
      })
      .filter((item) => item.name.length > 0);
  }

  private extractQueryFromToolInput(input: string): string {
    const raw = input.trim();
    if (!raw) {
      return '';
    }

    if (!raw.startsWith('{')) {
      return raw;
    }

    try {
      const parsed = JSON.parse(raw) as { query?: unknown };
      return typeof parsed.query === 'string' ? parsed.query.trim() : '';
    } catch {
      return '';
    }
  }

  private isAffiliateSearchQuery(input: string): boolean {
    const query = this.extractQueryFromToolInput(input).toLowerCase();
    return /affiliate|affiliates|partner program|referral|ambassador/.test(query);
  }

  private isPricingSearchQuery(input: string): boolean {
    const query = this.extractQueryFromToolInput(input).toLowerCase();
    return /pricing|price|plans|plan|subscription|billing/.test(query);
  }

  private buildSearchToolInput(query: string): string {
    return JSON.stringify({ query: query.trim(), limit: 5 });
  }

  private pickBestSearchUrl(
    searchUrls: string[],
    domain: string,
    intent: 'affiliate' | 'pricing',
    visitedUrls: string[],
  ): string {
    const visited = new Set(visitedUrls.map((item) => this.normalizeUrlCandidate(item).toLowerCase()));
    const candidates = searchUrls
      .map((item) => this.normalizeUrlCandidate(item))
      .filter((item) => this.isLikelyUrl(item) && !visited.has(item.toLowerCase()));

    if (candidates.length === 0) {
      return '';
    }

    const keywords =
      intent === 'affiliate'
        ? ['affiliate', 'affiliates', 'partner', 'referral', 'ambassador']
        : ['pricing', 'price', 'plans', 'plan', 'subscription', 'billing'];

    let bestUrl = candidates[0];
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
      const score = this.scoreUrlCandidate(candidate, domain, keywords);
      if (score > bestScore) {
        bestScore = score;
        bestUrl = candidate;
      }
    }

    return bestUrl;
  }

  private scoreUrlCandidate(url: string, domain: string, keywords: string[]): number {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
      const normalizedDomain = domain.toLowerCase();
      const combinedPath = `${parsed.pathname}${parsed.search}`.toLowerCase();
      let score = 0;

      if (hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`)) {
        score += 100;
      } else if (normalizedDomain && hostname.includes(normalizedDomain.split('.')[0])) {
        score += 25;
      }

      for (const keyword of keywords) {
        if (combinedPath.includes(keyword)) {
          score += 20;
        }
      }

      if (combinedPath === '/' || combinedPath.length <= 2) {
        score -= 10;
      }

      return score;
    } catch {
      return Number.NEGATIVE_INFINITY;
    }
  }

  private isAffiliateEvidence(url: string, content: string, domain: string): boolean {
    const text = `${url}\n${content}`.toLowerCase();
    const hasKeyword = /affiliate|affiliates|commission|referral|partner portal|partner program/.test(text);
    if (!url.trim()) {
      return hasKeyword;
    }
    const sameDomain = this.isSameDomainUrl(url, domain);
    return hasKeyword && (sameDomain || /partners\./.test(text));
  }

  private isPricingEvidence(url: string, content: string, domain: string): boolean {
    const text = `${url}\n${content}`.toLowerCase();
    const hasKeyword = /pricing|price|plans|subscription|billing|monthly|yearly/.test(text);
    if (!url.trim()) {
      return hasKeyword;
    }
    const sameDomain = this.isSameDomainUrl(url, domain);
    return hasKeyword && sameDomain;
  }

  private isSameDomainUrl(url: string, domain: string): boolean {
    if (!url || !this.isLikelyUrl(url) || !domain) {
      return false;
    }
    try {
      const hostname = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
      const normalizedDomain = domain.replace(/^www\./i, '').toLowerCase();
      return hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`);
    } catch {
      return false;
    }
  }

  private extractUrlsFromSearchResult(content: string): string[] {
    const matches = Array.from(content.matchAll(/https?:\/\/[^\s)]+/gi)).map((match) => match[0]);
    const unique = Array.from(
      new Set(
        matches
          .map((value) => this.normalizeUrlCandidate(value))
          .filter((value) => this.isLikelyUrl(value)),
      ),
    );
    return unique.slice(0, 10);
  }

  private buildSearchSignature(urls: string[]): string {
    return urls
      .slice(0, 5)
      .map((url) => url.toLowerCase())
      .join('|');
  }

  private hasRepeatedSearchResults(searchSignatures: string[]): boolean {
    if (searchSignatures.length < 2) {
      return false;
    }
    const latest = searchSignatures[searchSignatures.length - 1];
    const previous = searchSignatures[searchSignatures.length - 2];
    return Boolean(latest) && latest === previous;
  }

  private pickNextUrlToScrape(searchUrls: string[], visitedScrapeUrls: string[]): string {
    const visited = new Set(visitedScrapeUrls.map((item) => item.trim().toLowerCase()));
    const candidate = searchUrls.find((url) => !visited.has(this.normalizeUrlCandidate(url).toLowerCase()));
    return candidate ?? '';
  }

  private isLikelyUrl(value: string): boolean {
    try {
      const url = new URL(value.trim());
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private normalizeUrlCandidate(value: string): string {
    return value
      .trim()
      .replace(/^[\s"'(<\[{]+/, '')
      .replace(/[>"')\],.;:!?]+$/g, '')
      .replace(/[\\]+$/g, '');
  }

  private renderFinalResponsePrompt(input: {
    input: string;
    domain: string;
    memorySummary: string;
    scratchpad: string;
  }): string {
    return FINAL_RESPONSE_PROMPT_TEMPLATE.replace('{input}', input.input)
      .replace('{domain}', input.domain)
      .replace('{memorySummary}', input.memorySummary || 'No summary yet.')
      .replace('{scratchpad}', input.scratchpad || 'No scratchpad yet.')
      .replace('{resultFormat}', GOOGLE_ADS_EXPORT_SCHEMA_TEXT);
  }

  private normalizeDecision(rawDecision: unknown): AgentDecision {
    const parsed =
      rawDecision && typeof rawDecision === 'object'
        ? (rawDecision as Record<string, unknown>)
        : {};
    const thought = this.asText(parsed.thought, 'I will continue with best available strategy.');
    const action = parsed.action === 'tool' || parsed.action === 'final' ? parsed.action : 'final';
    const toolName = this.asText(parsed.toolName);
    const toolInput = this.asText(parsed.toolInput);
    const finalAnswer = this.asText(parsed.finalAnswer);

    if (action === 'tool') {
      if (!toolName) {
        return {
          thought: `${thought} Tool name was missing, so I will finalize with current context.`,
          action: 'final',
        };
      }

      return {
        thought,
        action: 'tool',
        toolName,
        toolInput,
      };
    }

    return {
      thought,
      action: 'final',
      ...(finalAnswer ? { finalAnswer } : {}),
    };
  }

  private asText(value: unknown, fallback = ''): string {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed || fallback;
    }
    if (value && typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return fallback;
      }
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return fallback;
  }

  private formatFinalAnswer(value: unknown, state: AgentStateType): string {
    const parsed =
      typeof value === 'string'
        ? this.tryParseJsonText(value.trim())
        : value && typeof value === 'object'
          ? value
          : null;

    const normalized = normalizeGoogleAdsExportPayload(parsed ?? {}) as Record<string, unknown>;
    const hydrated = this.hydrateFinalPayload(normalized, state);
    return JSON.stringify(hydrated, null, 2);
  }

  private hydrateFinalPayload(
    normalized: Record<string, unknown>,
    state: AgentStateType,
  ): Record<string, unknown> {
    const payload = JSON.parse(JSON.stringify(normalized)) as Record<string, unknown>;
    const domain = this.normalizeDomain(state.domain || state.input);
    const semrushSnapshot = state.semrushSnapshot ?? null;

    if (domain) {
      const site = this.ensureObject(payload, 'site');
      if (!this.hasValue(site.domain)) {
        site.domain = domain;
      }
    }

    const semrushData = this.ensureObject(payload, 'semrushData');
    const semrushSource = this.ensureObject(semrushData, 'source');
    const hasSemrushCall = this.hasToolCall(state.toolHistory, 'semrush_traffic');
    if (hasSemrushCall && domain) {
      if (!this.hasValue(semrushSource.name)) {
        semrushSource.name = 'semrush';
      }
      if (!this.hasValue(semrushSource.url)) {
        semrushSource.url = `https://www.semrush.com/analytics/overview/?q=${domain}&searchType=domain`;
      }
      if (!this.hasValue(semrushSource.method)) {
        semrushSource.method = 'rpc';
      }
    }

    if (semrushSnapshot) {
      const source = this.asObject(semrushSnapshot['source']);
      const traffic = this.asObject(semrushSnapshot['traffic']);
      const authority = this.asObject(semrushSnapshot['authority']);
      const aiOverview = this.asObject(semrushSnapshot['aiOverview']);
      const aiSources = this.asObject(semrushSnapshot['aiSources']);
      const competitors = semrushSnapshot['competitors'];

      if (source) {
        this.fillMissingFields(semrushSource, source);
      }

      if (traffic) {
        this.fillMissingFields(this.ensureObject(semrushData, 'traffic'), traffic);
      }

      if (authority) {
        this.fillMissingFields(this.ensureObject(semrushData, 'authority'), authority);
      }

      if (aiOverview) {
        this.fillMissingFields(this.ensureObject(semrushData, 'aiOverview'), aiOverview);
      }

      if (aiSources) {
        this.fillMissingFields(this.ensureObject(semrushData, 'aiSources'), aiSources);
      }

      if (Array.isArray(competitors) && !Array.isArray(semrushData.competitors)) {
        semrushData.competitors = competitors;
      }
    }

    const affiliateUrl =
      state.affiliateUrlCandidate ||
      this.pickBestSearchUrl(
        [...state.visitedScrapeUrls, ...state.lastSearchUrls],
        domain,
        'affiliate',
        [],
      );
    const pricingUrl =
      state.pricingUrlCandidate ||
      this.pickBestSearchUrl(
        [...state.visitedScrapeUrls, ...state.lastSearchUrls],
        domain,
        'pricing',
        [],
      );

    const siteAffiliateInfo = this.ensureObject(payload, 'siteAffiliateInfo');
    if (!this.hasValue(siteAffiliateInfo.programInfoLink) && affiliateUrl) {
      siteAffiliateInfo.programInfoLink = affiliateUrl;
    }

    const pricingModels = payload.pricingModels;
    if (Array.isArray(pricingModels) && pricingModels.length > 0) {
      const firstModel = this.asObject(pricingModels[0]) ?? {};
      if (!this.hasValue(firstModel.sourceDomain) && domain) {
        firstModel.sourceDomain = domain;
      }
      if (!this.hasValue(firstModel.productUrl) && pricingUrl) {
        firstModel.productUrl = pricingUrl;
      }
      if (!this.hasValue(firstModel.sourceType) && pricingUrl) {
        firstModel.sourceType = 'official_pricing_page';
      }
      pricingModels[0] = firstModel;
    } else if (pricingUrl || domain) {
      payload.pricingModels = [
        {
          value: null,
          modelName: null,
          rawPrice: null,
          currency: null,
          billingCycle: null,
          description: null,
          productUrl: pricingUrl || null,
          brand: null,
          sourceDomain: domain || null,
          sourceType: pricingUrl ? 'official_pricing_page' : null,
          notes: null,
        },
      ];
    }

    return payload;
  }

  private fillMissingFields(target: Record<string, unknown>, source: Record<string, unknown>): void {
    for (const key of Object.keys(source)) {
      const sourceValue = source[key];
      const targetValue = target[key];

      if (!this.hasValue(targetValue) && this.hasValue(sourceValue)) {
        target[key] = sourceValue;
        continue;
      }

      if (
        targetValue &&
        sourceValue &&
        typeof targetValue === 'object' &&
        typeof sourceValue === 'object' &&
        !Array.isArray(targetValue) &&
        !Array.isArray(sourceValue)
      ) {
        this.fillMissingFields(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>,
        );
      }
    }
  }

  private ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
    const value = parent[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      parent[key] = {};
    }
    return parent[key] as Record<string, unknown>;
  }

  private hasValue(value: unknown): boolean {
    if (value === null || value === undefined) {
      return false;
    }

    if (typeof value === 'string') {
      return value.trim().length > 0;
    }

    if (Array.isArray(value)) {
      return value.length > 0;
    }

    return true;
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    if (typeof value === 'string') {
      const parsed = this.tryParseJsonText(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    }

    return null;
  }

  private normalizeDomain(value: string): string {
    if (!value) {
      return '';
    }

    return value
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/[/?#].*$/g, '')
      .toLowerCase();
  }

  private tryParseJsonText(value: string): unknown | null {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private toOutputText(value: ToolExecutionResult['output']): string {
    if (typeof value === 'string') {
      return value;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value ?? '');
    }
  }
}
