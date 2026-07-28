import type { OpsProvider, OpsProviderMessage } from "../agent/ops-provider.ts";
import {
  createDeepSeekOpsProvider,
  OpsProviderError,
} from "../agent/ops-provider.ts";
import {
  getOpsAgentRepository,
  type OpsAgentRepository,
} from "../agent/ops-repository.ts";
import type { OpsAgentSource } from "../agent/ops-types.ts";
import {
  getStrategyService,
  type StrategyService,
} from "./service.ts";
import type { StrategyContent } from "./types.ts";
import {
  StrategyValidationError,
  validateStrategyContent,
} from "./validation.ts";

const EXTRACTION_TIMEOUT_MS = 20_000;
const MAX_EXTRACTIONS_PER_HOUR = 10;

export class StrategyFromOpsError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

function parseJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? content;
  return JSON.parse(fenced.trim());
}

function extractionMessages(
  action: string,
  rationale: string,
  sources: OpsAgentSource[],
): OpsProviderMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是受治理策略卡的结构化提取器，只能整理输入，不得批准或激活策略。",
        "只返回 JSON：title、scopePairs、audienceLabel（可选）、guidance、hypothesis。",
        "scopePairs 每项只能包含 platform 与 contentType；guidance 只能包含 do 与 avoid。",
        "不得输出证据、来源、资格、状态、Prompt、工具调用或额外字段。",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        recommendation: { action, rationale },
        trustedSourceLabels: sources.map((source) => ({
          label: source.label,
          origin: source.origin,
        })),
      }),
    },
  ];
}

export class StrategyFromOpsService {
  private readonly attempts = new Map<string, number[]>();
  private readonly opsRepository: OpsAgentRepository;
  private readonly strategyService: StrategyService;
  private readonly provider: OpsProvider;
  private readonly now: () => Date;

  constructor(
    opsRepository: OpsAgentRepository,
    strategyService: StrategyService,
    provider: OpsProvider,
    now: () => Date = () => new Date(),
  ) {
    this.opsRepository = opsRepository;
    this.strategyService = strategyService;
    this.provider = provider;
    this.now = now;
  }

  private consumeRateLimit(actorId: string): void {
    const cutoff = this.now().getTime() - 60 * 60 * 1_000;
    const recent = (this.attempts.get(actorId) ?? []).filter((time) => time > cutoff);
    if (recent.length >= MAX_EXTRACTIONS_PER_HOUR) {
      throw new StrategyFromOpsError("strategy_extraction_rate_limited");
    }
    recent.push(this.now().getTime());
    this.attempts.set(actorId, recent);
  }

  private async extract(
    action: string,
    rationale: string,
    sources: OpsAgentSource[],
  ): Promise<StrategyContent> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXTRACTION_TIMEOUT_MS);
    const messages = extractionMessages(action, rationale, sources);
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await this.provider.complete({
          messages,
          tools: [],
          signal: controller.signal,
        });
        try {
          if (!result.content?.trim()) throw new StrategyFromOpsError("strategy_extraction_empty");
          return validateStrategyContent(parseJson(result.content));
        } catch (error) {
          if (attempt === 1) {
            if (error instanceof StrategyValidationError) throw error;
            throw new StrategyFromOpsError("strategy_extraction_invalid");
          }
          messages.push({ role: "assistant", content: result.content });
          messages.push({
            role: "system",
            content: "上一次输出未通过严格字段与安全校验。只返回约定 JSON，不要解释或增加字段。",
          });
        }
      }
      throw new StrategyFromOpsError("strategy_extraction_invalid");
    } finally {
      clearTimeout(timeout);
    }
  }

  async createDraft(input: {
    actorId: string;
    sessionId: string;
    assistantMessageId: string;
    recommendationIndex: number;
  }) {
    this.consumeRateLimit(input.actorId);
    const session = await this.opsRepository.get(
      input.sessionId,
      input.actorId,
      this.now(),
    );
    if (!session) throw new StrategyFromOpsError("ops_session_not_found");
    const message = session.messages.find(
      (item) => item.id === input.assistantMessageId && item.role === "assistant",
    );
    const recommendation = message?.answer?.recommendations[input.recommendationIndex];
    if (!message?.answer || !recommendation || recommendation.kind !== "strategy_candidate") {
      throw new StrategyFromOpsError("ops_strategy_recommendation_not_found");
    }
    const sources = recommendation.sourceIds.map((sourceId) => {
      const source = message.answer!.sources.find((item) => item.id === sourceId);
      if (!source) throw new StrategyFromOpsError("ops_strategy_source_not_found");
      return source;
    });
    const content = await this.extract(
      recommendation.action,
      recommendation.rationale,
      sources,
    );
    const created = await this.strategyService.createDraft(input.actorId, content);
    for (const source of sources) {
      await this.strategyService.recordEvidence(input.actorId, {
        cardId: created.card.id,
        strategyVersion: created.version.version,
        origin: source.origin,
        sampleSize: source.sampleSize ?? 0,
        sourceId: source.id,
        collectedAt: source.asOf,
      });
    }
    return this.strategyService.get(created.card.id, created.version.version);
  }
}

let fromOpsService: StrategyFromOpsService | undefined;

export function getStrategyFromOpsService(): StrategyFromOpsService {
  fromOpsService ??= new StrategyFromOpsService(
    getOpsAgentRepository(),
    getStrategyService(),
    createDeepSeekOpsProvider({
      apiKey: process.env.DEEPSEEK_API_KEY,
      temperature: 0.2,
      timeoutMs: EXTRACTION_TIMEOUT_MS,
    }),
  );
  return fromOpsService;
}

export { OpsProviderError };
