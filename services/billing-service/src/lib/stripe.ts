/**
 * Stripe wrapper. When STRIPE_SECRET_KEY is unset (dev / personal-use), all
 * methods return stubbed payloads so the rest of the system is exercisable
 * without an account. When set, calls go to the real API.
 */
import Stripe from 'stripe';

export interface StripeBundle {
  enabled: boolean;
  client: Stripe | null;
  webhookSecret: string | null;
  prices: { pro?: string | undefined; enterprise?: string | undefined };
}

export function buildStripe(opts: {
  secretKey?: string | undefined;
  webhookSecret?: string | undefined;
  prices: { pro?: string | undefined; enterprise?: string | undefined };
}): StripeBundle {
  if (!opts.secretKey) {
    return { enabled: false, client: null, webhookSecret: null, prices: opts.prices };
  }
  const client = new Stripe(opts.secretKey);
  return {
    enabled: true,
    client,
    webhookSecret: opts.webhookSecret ?? null,
    prices: opts.prices,
  };
}

export interface CheckoutInput {
  workspaceId: string;
  email: string;
  customerId: string | null;
  planTier: 'pro' | 'enterprise';
  seats: number;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  url: string;
  /** True when the URL is a stub for mock mode. */
  mock: boolean;
}

export async function createCheckout(
  bundle: StripeBundle,
  input: CheckoutInput,
): Promise<CheckoutResult> {
  if (!bundle.enabled || !bundle.client) {
    // Mock mode: return a deterministic local URL the UI can render.
    const url =
      `${input.successUrl}&mock=1&plan=${input.planTier}&seats=${input.seats}` +
      `&workspace=${encodeURIComponent(input.workspaceId)}`;
    return { url, mock: true };
  }
  const price =
    input.planTier === 'pro' ? bundle.prices.pro : bundle.prices.enterprise;
  if (!price) {
    throw Object.assign(new Error('STRIPE_PRICE_MISSING'), {
      statusCode: 500,
      code: 'STRIPE_PRICE_MISSING',
    });
  }
  const session = await bundle.client.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: input.seats }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer: input.customerId ?? undefined,
    customer_email: input.customerId ? undefined : input.email,
    client_reference_id: input.workspaceId,
    metadata: { workspaceId: input.workspaceId, planTier: input.planTier },
  });
  return { url: session.url ?? '', mock: false };
}

export async function createPortalSession(
  bundle: StripeBundle,
  customerId: string | null,
  returnUrl: string,
): Promise<{ url: string; mock: boolean }> {
  if (!bundle.enabled || !bundle.client || !customerId) {
    return { url: `${returnUrl}?mock=portal`, mock: true };
  }
  const session = await bundle.client.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return { url: session.url, mock: false };
}

/** Verify and parse a webhook event. Returns null if signature is invalid. */
export function verifyWebhook(
  bundle: StripeBundle,
  rawBody: string | Buffer,
  signature: string | undefined,
): Stripe.Event | null {
  if (!bundle.enabled || !bundle.client || !bundle.webhookSecret || !signature) return null;
  try {
    return bundle.client.webhooks.constructEvent(rawBody, signature, bundle.webhookSecret);
  } catch {
    return null;
  }
}
