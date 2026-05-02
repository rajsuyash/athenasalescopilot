import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@athena/db';
import {
  ensureBillingAccount,
  PLAN_DEFAULTS,
  persistUsage,
  seatCheck,
  snapshotUsage,
  type PlanTier,
} from './service.js';
import {
  createCheckout,
  createPortalSession,
  verifyWebhook,
  type StripeBundle,
} from '../../lib/stripe.js';

interface RouteDeps {
  stripe: StripeBundle;
  successUrl: string;
  cancelUrl: string;
  portalReturnUrl: string;
}

const CheckoutBody = z.object({
  planTier: z.enum(['pro', 'enterprise']),
  seats: z.number().int().min(1).max(1000).default(1),
});

export function billingRoutes(deps: RouteDeps) {
  return async function (app: FastifyInstance): Promise<void> {
    /** GET /v1/billing/subscription — current account state. */
    app.get('/billing/subscription', async (req) => {
      const claims = await req.requireAuth();
      return ensureBillingAccount(claims.workspaceId);
    });

    /** GET /v1/billing/usage — period counters + seat check. */
    app.get('/billing/usage', async (req) => {
      const claims = await req.requireAuth();
      const [usage, seats] = await Promise.all([
        snapshotUsage(claims.workspaceId),
        seatCheck(claims.workspaceId),
      ]);
      // Best-effort persist for analytics. Don't block the response on it.
      void persistUsage(claims.workspaceId).catch(() => {});
      return { usage, seats };
    });

    /** POST /v1/billing/checkout — create a Stripe Checkout session. */
    app.post('/billing/checkout', async (req) => {
      const claims = await req.requirePermission('billing:update');
      const body = CheckoutBody.parse(req.body);
      const account = await ensureBillingAccount(claims.workspaceId);
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: claims.sub },
        select: { email: true },
      });
      const r = await createCheckout(deps.stripe, {
        workspaceId: claims.workspaceId,
        email: user.email,
        customerId: account.stripeCustomerId,
        planTier: body.planTier,
        seats: body.seats,
        successUrl: deps.successUrl,
        cancelUrl: deps.cancelUrl,
      });
      await prisma.auditLog.create({
        data: {
          workspaceId: claims.workspaceId,
          actorUserId: claims.sub,
          action: 'billing.checkout_started',
          resourceType: 'billing_account',
          resourceId: claims.workspaceId,
          metadataJson: { planTier: body.planTier, seats: body.seats, mock: r.mock },
        },
      });
      return r;
    });

    /** POST /v1/billing/portal — Stripe customer-portal session. */
    app.post('/billing/portal', async (req) => {
      const claims = await req.requirePermission('billing:update');
      const account = await ensureBillingAccount(claims.workspaceId);
      return createPortalSession(deps.stripe, account.stripeCustomerId, deps.portalReturnUrl);
    });

    /**
     * POST /v1/billing/webhook — Stripe webhook receiver.
     * Must read the raw body to verify the HMAC signature.
     */
    app.post(
      '/billing/webhook',
      { config: { rawBody: true } },
      async (req, reply) => {
        const sig = req.headers['stripe-signature'];
        const raw = (req as unknown as { rawBody?: string | Buffer }).rawBody;
        if (!raw) {
          reply.status(400);
          return { error: 'NO_BODY' };
        }
        const event = verifyWebhook(deps.stripe, raw, Array.isArray(sig) ? sig[0] : sig);
        if (!event) {
          reply.status(400);
          return { error: 'INVALID_SIGNATURE' };
        }
        await handleWebhookEvent(event as unknown as StripeEventLite);
        return { received: true };
      },
    );

    /**
     * POST /v1/billing/mock/upgrade — dev-only, applied when Stripe is in mock mode.
     * Lets you test the full plan-tier UX without a Stripe account.
     */
    app.post('/billing/mock/upgrade', async (req) => {
      if (deps.stripe.enabled) {
        return { error: 'STRIPE_LIVE', message: 'Mock upgrade disabled while Stripe is configured.' };
      }
      const claims = await req.requirePermission('billing:update');
      const body = CheckoutBody.parse(req.body);
      const planTier = body.planTier as PlanTier;
      const seats = body.seats;
      const account = await ensureBillingAccount(claims.workspaceId);
      const updated = await prisma.billingAccount.update({
        where: { workspaceId: claims.workspaceId },
        data: {
          planTier,
          seats,
          meetingHourLimit: PLAN_DEFAULTS.hours[planTier],
          status: 'active',
        },
      });
      await prisma.auditLog.create({
        data: {
          workspaceId: claims.workspaceId,
          actorUserId: claims.sub,
          action: 'billing.mock_upgraded',
          resourceType: 'billing_account',
          resourceId: account.stripeCustomerId ?? claims.workspaceId,
          metadataJson: { planTier, seats },
        },
      });
      return {
        planTier: updated.planTier,
        seats: updated.seats,
        meetingHourLimit: updated.meetingHourLimit,
      };
    });
  };
}

interface StripeEventLite {
  id?: string;
  type: string;
  livemode?: boolean;
  created?: number;
  data: { object: Record<string, unknown> };
}

/**
 * Compact metadata snapshot for the audit_logs row. Strips Stripe object
 * payloads down to the fields we care about so the audit table stays small
 * and PII-light.
 */
function summarizeForAudit(event: StripeEventLite): Record<string, unknown> {
  const obj = event.data.object;
  return {
    eventId: event.id ?? null,
    eventType: event.type,
    livemode: event.livemode ?? false,
    createdAt: event.created ?? null,
    object: {
      id: obj.id ?? null,
      customer: obj.customer ?? null,
      status: obj.status ?? null,
      quantity: obj.quantity ?? null,
      currentPeriodEnd: obj.current_period_end ?? null,
      planTier: (obj.metadata as Record<string, string> | undefined)?.planTier ?? null,
    },
  };
}

async function handleWebhookEvent(event: StripeEventLite): Promise<void> {
  const obj = event.data.object;
  const workspaceId =
    (obj.metadata as Record<string, string> | undefined)?.workspaceId ??
    (obj.client_reference_id as string | undefined);
  if (!workspaceId) return;
  const account = await prisma.billingAccount.findUnique({ where: { workspaceId } });
  if (!account) return;

  switch (event.type) {
    case 'checkout.session.completed':
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const planTier =
        ((obj.metadata as Record<string, string> | undefined)?.planTier as PlanTier | undefined) ??
        (account.planTier as PlanTier);
      const seats = Number((obj.quantity as number | undefined) ?? account.seats);
      const periodEnd =
        typeof obj.current_period_end === 'number'
          ? new Date((obj.current_period_end as number) * 1000)
          : account.currentPeriodEnd;
      await prisma.billingAccount.update({
        where: { workspaceId },
        data: {
          stripeSubscriptionId: (obj.id as string | undefined) ?? account.stripeSubscriptionId,
          stripeCustomerId:
            (obj.customer as string | undefined) ?? account.stripeCustomerId,
          planTier,
          seats,
          meetingHourLimit: PLAN_DEFAULTS.hours[planTier] ?? account.meetingHourLimit,
          status: (obj.status as string | undefined) ?? 'active',
          currentPeriodEnd: periodEnd,
        },
      });
      break;
    }
    case 'customer.subscription.deleted': {
      await prisma.billingAccount.update({
        where: { workspaceId },
        data: { status: 'canceled', planTier: 'free' },
      });
      break;
    }
    case 'invoice.payment_failed': {
      await prisma.billingAccount.update({
        where: { workspaceId },
        data: { status: 'past_due' },
      });
      break;
    }
  }

  await prisma.auditLog.create({
    data: {
      workspaceId,
      actorUserId: null,
      action: 'billing.webhook',
      resourceType: 'billing_account',
      resourceId: account.id,
      metadataJson: summarizeForAudit(event) as object,
    },
  });
}
