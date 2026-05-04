/**
 * Clerk webhook handler (Block T).
 *
 *   POST /v1/auth/clerk-webhook
 *
 * Receives Svix-signed events from Clerk. We care about:
 *   - user.created  → create matching Athena User + default Workspace + owner membership
 *   - user.updated  → sync email + name
 *   - user.deleted  → soft-delete (mark globalStatus='deleted')
 *
 * Idempotent: lookups by clerkUserId, creates only when missing.
 *
 * Set the webhook URL in Clerk dashboard → Webhooks:
 *   https://athena-api-production-aa5b.up.railway.app/v1/auth/clerk-webhook
 *
 * The signing secret goes into CLERK_WEBHOOK_SECRET env var.
 */
import type { FastifyInstance } from 'fastify';
import { Webhook } from 'svix';
import { prisma } from '@athena/db';

interface ClerkUserEvent {
  type: 'user.created' | 'user.updated' | 'user.deleted';
  data: {
    id: string;
    email_addresses?: Array<{ id: string; email_address: string }>;
    primary_email_address_id?: string;
    first_name?: string | null;
    last_name?: string | null;
  };
}

interface WebhookDeps {
  webhookSecret: string;
}

export function clerkWebhookRoutes(deps: WebhookDeps) {
  return async function plugin(app: FastifyInstance): Promise<void> {
    // Raw body required to verify the Svix signature.
    app.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (_req, body, done) => done(null, body),
    );

    app.post('/auth/clerk-webhook', async (req, reply) => {
      if (!deps.webhookSecret) {
        return reply.code(503).send({ error: 'WEBHOOK_NOT_CONFIGURED' });
      }
      const svixId = req.headers['svix-id'];
      const svixTimestamp = req.headers['svix-timestamp'];
      const svixSignature = req.headers['svix-signature'];
      if (!svixId || !svixTimestamp || !svixSignature) {
        return reply.code(400).send({ error: 'MISSING_SVIX_HEADERS' });
      }
      const wh = new Webhook(deps.webhookSecret);
      let evt: ClerkUserEvent;
      try {
        evt = wh.verify(req.body as string, {
          'svix-id': String(svixId),
          'svix-timestamp': String(svixTimestamp),
          'svix-signature': String(svixSignature),
        }) as ClerkUserEvent;
      } catch (err) {
        req.log.warn({ err }, 'clerk webhook signature verification failed');
        return reply.code(400).send({ error: 'BAD_SIGNATURE' });
      }

      try {
        if (evt.type === 'user.created') await handleCreated(evt);
        else if (evt.type === 'user.updated') await handleUpdated(evt);
        else if (evt.type === 'user.deleted') await handleDeleted(evt);
      } catch (err) {
        req.log.error({ err, evtType: evt.type }, 'clerk webhook handler failed');
        return reply.code(500).send({ error: 'HANDLER_FAILED' });
      }

      return reply.code(204).send();
    });
  };
}

function primaryEmail(e: ClerkUserEvent['data']): string | null {
  if (!e.email_addresses?.length) return null;
  const primary = e.email_addresses.find((x) => x.id === e.primary_email_address_id);
  return primary?.email_address ?? e.email_addresses[0]?.email_address ?? null;
}

function fullName(e: ClerkUserEvent['data']): string {
  return [e.first_name, e.last_name].filter(Boolean).join(' ').trim() || 'Athena user';
}

async function handleCreated(evt: ClerkUserEvent): Promise<void> {
  const email = primaryEmail(evt.data);
  if (!email) throw new Error('user.created without primary email');
  const existing = await prisma.user.findUnique({ where: { clerkUserId: evt.data.id } });
  if (existing) return;

  // Two paths:
  //   A) An Athena user with this email already exists (signed up via the
  //      legacy email/password flow before Clerk migration). Pair it.
  //   B) Brand-new — create User + default Workspace + owner membership.
  const byEmail = await prisma.user.findUnique({ where: { email } });
  if (byEmail) {
    await prisma.user.update({
      where: { id: byEmail.id },
      data: { clerkUserId: evt.data.id, name: fullName(evt.data) || byEmail.name },
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, name: fullName(evt.data), clerkUserId: evt.data.id },
    });
    const slug = `ws-${user.id.slice(0, 8)}`;
    const workspace = await tx.workspace.create({
      data: { name: `${fullName(evt.data)}'s workspace`, slug },
    });
    await tx.userWorkspaceMembership.create({
      data: { userId: user.id, workspaceId: workspace.id, role: 'owner' },
    });
  });
}

async function handleUpdated(evt: ClerkUserEvent): Promise<void> {
  const email = primaryEmail(evt.data);
  await prisma.user.updateMany({
    where: { clerkUserId: evt.data.id },
    data: {
      ...(email ? { email } : {}),
      name: fullName(evt.data),
    },
  });
}

async function handleDeleted(evt: ClerkUserEvent): Promise<void> {
  await prisma.user.updateMany({
    where: { clerkUserId: evt.data.id },
    data: { globalStatus: 'deleted' },
  });
}
