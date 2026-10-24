import { codeSubmissionSchema, projectSubmissionSchema } from '@thegrave/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { BattleError, type BattleService, type DrawAction } from '../../battle/service.js';

const idParams = z.object({ id: z.uuid() });
const drawBody = z.object({ action: z.enum(['offer', 'accept', 'decline', 'withdraw']) });

function sendBattleError(reply: FastifyReply, err: unknown) {
  if (!(err instanceof BattleError)) throw err;
  if (err.retryAfterMs !== undefined)
    reply.header('Retry-After', Math.ceil(err.retryAfterMs / 1000));
  const error = { 404: 'Not Found', 409: 'Conflict', 429: 'Too Many Requests' }[err.statusCode];
  return reply
    .code(err.statusCode)
    .send({ error, message: err.message, retryAfterMs: err.retryAfterMs });
}

export async function matchRoutes(app: FastifyInstance, { battle }: { battle: BattleService }) {
  app.addHook('onRequest', app.authenticate);

  // Full resync for a (re)loading battle page. Participants only; 404 for everyone else.
  app.get('/matches/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    try {
      return await battle.view(id, req.auth!.userId);
    } catch (err) {
      return sendBattleError(reply, err);
    }
  });

  // Quit: the opponent wins (decision.md D-068).
  app.post('/matches/:id/resign', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    try {
      await battle.resign(id, req.auth!.userId);
      return { ok: true };
    } catch (err) {
      return sendBattleError(reply, err);
    }
  });

  app.post('/matches/:id/draw', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const { action } = drawBody.parse(req.body);
    try {
      await battle.draw(id, req.auth!.userId, action as DrawAction);
      return { ok: true };
    } catch (err) {
      return sendBattleError(reply, err);
    }
  });

  app.post('/matches/:id/submit', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    // DSA battles send { language, code }; programming battles send { files } (decision.md D-067).
    const body = req.body as Record<string, unknown> | null;
    const input =
      body && 'files' in body
        ? projectSubmissionSchema.parse(body)
        : codeSubmissionSchema.parse(body);
    try {
      return reply.code(202).send(await battle.submit(id, req.auth!.userId, input));
    } catch (err) {
      return sendBattleError(reply, err);
    }
  });
}
