import { codeSubmissionSchema } from '@thegrave/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { BattleError, type BattleService } from '../../battle/service.js';

const idParams = z.object({ id: z.uuid() });

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

  app.post('/matches/:id/submit', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const input = codeSubmissionSchema.parse(req.body);
    try {
      return reply.code(202).send(await battle.submit(id, req.auth!.userId, input));
    } catch (err) {
      return sendBattleError(reply, err);
    }
  });
}
