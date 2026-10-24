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

/** Deterministic stand-in (HINT_MODEL=fake). Echoes nothing from the input; keeps the last input for tests. */
export class FakeHintModel implements HintModel {
  lastInput: Parameters<HintModel['reply']>[0] | null = null;

  async reply(input: Parameters<HintModel['reply']>[0]): Promise<string> {
    this.lastInput = input;
    return 'Hint: reproduce the first ticket before changing code — run the demo or the visible tests and compare with the docs.';
  }
}

export function createHintModel(): HintModel | null {
  if (config.HINT_MODEL === 'fake') return new FakeHintModel();
  return config.ANTHROPIC_API_KEY ? new AnthropicHintModel() : null;
}
