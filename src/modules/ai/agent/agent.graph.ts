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
import { AFFILIATE_RESEARCH_SCOPE, AFFILIATE_RESULT_FORMAT } from './research-context';

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
  searchSignatures: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  visitedScrapeUrls: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  checkedConnectUrls: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
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
          decision = await this.llmService.generateJson<AgentDecision>(AGENT_SYSTEM_PROMPT, prompt);
        } catch {
          decision = {
            thought: 'I cannot parse JSON planning output, I will finish with best available answer.',
            action: 'final',
            finalAnswer: 'Agent planning parser failed. Please rerun with the same input.',
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
        const toolInput = decision.toolInput ?? '';

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
        const result = await tool.execute(toolInput, state.domain);
        await params.onToolResult(tool.name, result, state.step);

        const extractedSearchUrls =
          tool.name === 'url_search' ? this.extractUrlsFromSearchResult(result.output) : state.lastSearchUrls;
        const extractedUrl =
          tool.name === 'url_search'
            ? extractedSearchUrls[0] || state.lastSearchTopUrl
            : state.lastSearchTopUrl;
        const searchSignature =
          tool.name === 'url_search' ? this.buildSearchSignature(extractedSearchUrls) : '';
        const scrapedUrl =
          tool.name === 'web_scrape' && this.isLikelyUrl(toolInput) ? [toolInput.trim()] : [];
        const checkedUrl =
          tool.name === 'check_connect' && this.isLikelyUrl(toolInput) ? [toolInput.trim()] : [];

        return {
          lastToolResult: result,
          recentContext: result.output.slice(0, 2000),
          lastSearchTopUrl: extractedUrl,
          lastSearchUrls: extractedSearchUrls,
          searchSignatures: searchSignature ? [searchSignature] : [],
          visitedScrapeUrls: scrapedUrl,
          checkedConnectUrls: checkedUrl,
          toolHistory: [`${tool.name}|${toolInput}`],
          scratchpad: [
            `Tool ${tool.name}(${toolInput}) => ${result.output.slice(0, 1200)}`,
          ],
        };
      })
      .addNode('respond', async (state: AgentStateType) => {
        if (state.decision?.action === 'final' && state.decision.finalAnswer) {
          return {
            finalAnswer: state.decision.finalAnswer,
          };
        }

        const finalAnswer = await this.llmService.generateText(
          'You are an AI agent summarizing execution in clear Vietnamese. Keep useful details and actionability.',
          this.renderFinalResponsePrompt({
            input: state.input,
            domain: state.domain,
            scratchpad: state.scratchpad.join('\n'),
          }),
        );

        return { finalAnswer };
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
    if (decision.action !== 'tool') {
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
          toolInput: `${state.domain} affiliate program pricing commission`,
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

      if (input && !state.checkedConnectUrls.some((item) => item === input)) {
        return {
          thought:
            'Before scraping, I should verify connectivity/status for this URL to avoid 403/500 issues.',
          action: 'tool',
          toolName: 'check_connect',
          toolInput: input,
        };
      }
    }

    if (decision.toolName === 'check_connect') {
      const input = (decision.toolInput ?? '').trim();
      if (!this.isLikelyUrl(input) && nextUrlToScrape) {
        return {
          thought:
            'Connectivity check needs a valid URL. I will check the next candidate URL from search results.',
          action: 'tool',
          toolName: 'check_connect',
          toolInput: nextUrlToScrape,
        };
      }
    }

    return decision;
  }

  private extractUrlsFromSearchResult(content: string): string[] {
    const matches = Array.from(content.matchAll(/https?:\/\/[^\s)]+/gi)).map((match) => match[0]);
    const unique = Array.from(new Set(matches.map((value) => value.trim())));
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
    const candidate = searchUrls.find((url) => !visited.has(url.trim().toLowerCase()));
    return candidate ?? '';
  }

  private isLikelyUrl(value: string): boolean {
    return /^https?:\/\/.+/i.test(value);
  }

  private renderFinalResponsePrompt(input: {
    input: string;
    domain: string;
    scratchpad: string;
  }): string {
    return FINAL_RESPONSE_PROMPT_TEMPLATE.replace('{input}', input.input)
      .replace('{domain}', input.domain)
      .replace('{scratchpad}', input.scratchpad || 'No scratchpad yet.')
      .replace('{resultFormat}', AFFILIATE_RESULT_FORMAT.trim());
  }
}
