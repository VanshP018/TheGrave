import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

export type HintErrorCode = 'busy' | 'unconfigured' | 'unavailable';

/** A hint couldn't be produced; `code` maps to the HTTP status in the route. */
export class HintError extends Error {
  constructor(
    readonly code: HintErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/** The hint bot's LLM, behind a seam so tests and E2E never reach the network (decision.md D-075). */
export interface HintModel {
  reply(input: {
    system: Anthropic.Beta.BetaTextBlockParam[];
    messages: Anthropic.Beta.BetaMessageParam[];
  }): Promise<string>;
}

const REFUSAL = "I can't help with that one, but I'm happy to give a hint about the challenge.";
const EMPTY = "I couldn't come up with a hint for that. Try rephrasing your question.";

export class AnthropicHintModel implements HintModel {
  private readonly client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  private readonly model = config.HINT_MODEL;

  async reply(input: {
    system: Anthropic.Beta.BetaTextBlockParam[];
    messages: Anthropic.Beta.BetaMessageParam[];
  }): Promise<string> {
    try {
      const res = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 4000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default', // server-side refusal fallback
        output_config: { effort: 'low' }, // short chat answers
        system: input.system,
        messages: input.messages,
      });
      if (res.stop_reason === 'refusal') return REFUSAL;
      let text = '';
      for (const block of res.content) if (block.type === 'text') text += block.text;
      return text.trim() || EMPTY;
    } catch (err) {
      // Most specific first; subclasses of APIError must be checked before it.
      if (err instanceof Anthropic.RateLimitError) throw new HintError('busy', 'rate limited');
      if (err instanceof Anthropic.AuthenticationError) throw new HintError('unconfigured');
      if (err instanceof Anthropic.APIError) throw new HintError('unavailable');
      throw err;
    }
  }
}

/** Anthropic-shaped content (a string or text blocks) as plain text, for providers that take strings. */
function plainText(content: string | readonly { type: string; text?: string }[]): string {
  if (typeof content === 'string') return content;
  return content.map((b) => (b.type === 'text' ? (b.text ?? '') : '')).join('\n\n');
}

/**
 * Any OpenAI-compatible chat API (DeepSeek, Groq), through plain fetch with no extra dependency. The prompt is
 * built once in Anthropic's shape (prompt.ts); here the system blocks are joined and the content flattened.
 */
export class OpenAICompatHintModel implements HintModel {
  private readonly url: string;

  constructor(
    private readonly provider: string,
    baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {
    this.url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  }

  async reply(input: {
    system: Anthropic.Beta.BetaTextBlockParam[];
    messages: Anthropic.Beta.BetaMessageParam[];
  }): Promise<string> {
    const body = {
      model: this.model,
      max_tokens: 1000, // replies are capped at ~80 words by the prompt
      stream: false,
      messages: [
        { role: 'system', content: input.system.map((b) => b.text).join('\n\n') },
        ...input.messages.map((m) => ({
          role: m.role,
          content: plainText(m.content as Parameters<typeof plainText>[0]),
        })),
      ],
    };
    let res: Response;
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new HintError('unavailable', `${this.provider} unreachable`);
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      console.warn(`hint model: ${this.provider} answered ${res.status}: ${detail}`);
    }
    if (res.status === 429) throw new HintError('busy', 'rate limited');
    if (res.status === 401) throw new HintError('unconfigured');
    if (!res.ok) throw new HintError('unavailable', `${this.provider} ${res.status}`);
    const data = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string | null }; finish_reason?: string }[];
    } | null;
    const choice = data?.choices?.[0];
    if (choice?.finish_reason === 'content_filter') return REFUSAL;
    return choice?.message?.content?.trim() || EMPTY;
  }
}

/** Deterministic stand-in (HINT_MODEL=fake). Echoes nothing from the input; keeps the last input for tests. */
export class FakeHintModel implements HintModel {
  lastInput: Parameters<HintModel['reply']>[0] | null = null;

  async reply(input: Parameters<HintModel['reply']>[0]): Promise<string> {
    this.lastInput = input;
    return 'Hint: reproduce the first ticket before changing code — run the demo or the visible tests and compare with the docs.';
  }
}

const deepseek = () =>
  config.DEEPSEEK_API_KEY
    ? new OpenAICompatHintModel(
        'deepseek',
        config.DEEPSEEK_BASE_URL,
        config.DEEPSEEK_API_KEY,
        config.DEEPSEEK_MODEL,
      )
    : null;
const groq = () =>
  config.GROQ_API_KEY
    ? new OpenAICompatHintModel('groq', config.GROQ_BASE_URL, config.GROQ_API_KEY, config.GROQ_MODEL)
    : null;
const anthropic = () => (config.ANTHROPIC_API_KEY ? new AnthropicHintModel() : null);

/** HINT_PROVIDER picks one explicitly; otherwise the first key that is set wins: Anthropic, DeepSeek, Groq. */
export function createHintModel(): HintModel | null {
  if (config.HINT_MODEL === 'fake') return new FakeHintModel();
  const byName = { anthropic, deepseek, groq };
  if (config.HINT_PROVIDER) return byName[config.HINT_PROVIDER]();
  return anthropic() ?? deepseek() ?? groq();
}
