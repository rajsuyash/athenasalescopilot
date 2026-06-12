/// <reference types="@fastify/jwt" />
// ^ Types-only reference that brings in the `app.jwt` augmentation for token
//   *issuance* below. The plugin is registered by @athena/auth (the single
//   owner of the JWT library); this is not a runtime import, so the
//   no-rogue-auth tripwire stays satisfied.
import crypto from 'node:crypto';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@athena/db';
import type { Role } from '@athena/shared-types';
import { Errors } from '../../lib/errors.js';
import { seedWorkspaceKnowledge } from '../../lib/seed-workspace.js';
import type { AccessTokenClaims, RefreshTokenClaims } from '../../lib/types.js';
import {
  claimExtensionPairing,
  isValidPairingCode,
  login,
  signup,
  startExtensionPairing,
} from './service.js';

const SignupBody = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  name: z.string().min(1).max(120),
  workspaceName: z.string().min(1).max(120),
  workspaceSlug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'lowercase letters, digits, and dashes only'),
});

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  workspaceSlug: z.string().optional(),
});

const RefreshBody = z.object({
  refreshToken: z.string().min(1),
});

const PairClaimBody = z.object({
  code: z.string().min(8).max(32).refine(isValidPairingCode, 'invalid pairing code'),
});

const REFRESH_TTL_DAYS = 30;

interface AuthDeps {
  refreshSecret: string;
  knowledgeUrl: string;
}

export function authRoutes(deps: AuthDeps) {
  return async function (app: FastifyInstance): Promise<void> {
    async function issueTokens(input: {
      userId: string;
      workspaceId: string;
      membershipId: string;
      role: Role;
    }) {
      const claims: AccessTokenClaims = {
        sub: input.userId,
        workspaceId: input.workspaceId,
        role: input.role,
        membershipId: input.membershipId,
      };
      const accessToken = app.jwt.sign(claims);

      // Refresh token: random opaque string, hashed at rest, persisted for revocation.
      const refreshRaw = crypto.randomBytes(48).toString('base64url');
      const tokenHash = await argon2.hash(refreshRaw, { type: argon2.argon2id });
      const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
      await prisma.refreshToken.create({
        data: {
          userId: input.userId,
          workspaceId: input.workspaceId,
          tokenHash,
          expiresAt,
        },
      });
      // We return a packed string `<id>.<raw>` so we can find the row on refresh.
      // The id is non-secret; the raw remains server-secret-only after hashing.
      const lastRow = await prisma.refreshToken.findFirstOrThrow({
        where: { tokenHash },
        select: { id: true },
      });
      return { accessToken, refreshToken: `${lastRow.id}.${refreshRaw}`, expiresAt };
    }

    app.post(
      '/auth/signup',
      {
        config: {
          rateLimit: { max: 5, timeWindow: '1 hour' },
        },
      },
      async (req, reply) => {
        const body = SignupBody.parse(req.body);
        const created = await signup(body);
        const tokens = await issueTokens(created);
        // Fire-and-forget: don't block signup on knowledge-service availability.
        void seedWorkspaceKnowledge({
          knowledgeUrl: deps.knowledgeUrl,
          accessToken: tokens.accessToken,
        });
        reply.status(201);
        return { ...tokens, user: { id: created.userId }, workspace: { id: created.workspaceId } };
      },
    );

    app.post(
      '/auth/login',
      {
        config: {
          rateLimit: { max: 20, timeWindow: '15 minutes' },
        },
      },
      async (req) => {
        const body = LoginBody.parse(req.body);
        const r = await login(body);
        const tokens = await issueTokens(r);
        return { ...tokens, user: { id: r.userId }, workspace: { id: r.workspaceId } };
      },
    );

    app.post('/auth/refresh', async (req) => {
      const { refreshToken } = RefreshBody.parse(req.body);
      const [id, raw] = refreshToken.split('.');
      if (!id || !raw) throw Errors.tokenInvalid();
      const row = await prisma.refreshToken.findUnique({ where: { id } });
      if (!row) throw Errors.tokenInvalid();
      if (row.revokedAt) throw Errors.tokenInvalid();
      if (row.expiresAt < new Date()) throw Errors.tokenExpired();
      const ok = await argon2.verify(row.tokenHash, raw);
      if (!ok) throw Errors.tokenInvalid();

      const membership = await prisma.userWorkspaceMembership.findFirstOrThrow({
        where: { userId: row.userId, workspaceId: row.workspaceId, status: 'active' },
      });

      // Rotate: revoke old, mint new.
      await prisma.refreshToken.update({
        where: { id: row.id },
        data: { revokedAt: new Date() },
      });

      const tokens = await issueTokens({
        userId: row.userId,
        workspaceId: row.workspaceId,
        membershipId: membership.id,
        role: membership.role as Role,
      });
      return tokens;
    });

    app.post('/auth/logout', async (req, reply) => {
      const { refreshToken } = RefreshBody.parse(req.body);
      const [id] = refreshToken.split('.');
      if (id) {
        await prisma.refreshToken.updateMany({
          where: { id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      reply.status(204).send();
    });

    /**
     * POST /v1/auth/extension/pair-start
     * Authed user mints a short-lived single-use pairing code for the
     * Chrome extension. Returns the raw code ONCE.
     */
    app.post(
      '/auth/extension/pair-start',
      {
        config: {
          rateLimit: { max: 10, timeWindow: '1 hour' },
        },
      },
      async (req, reply) => {
        const claims = await req.requireAuth();
        const r = await startExtensionPairing({
          userId: claims.sub,
          workspaceId: claims.workspaceId,
        });
        reply.status(201);
        return { code: r.code, expiresAt: r.expiresAt.toISOString() };
      },
    );

    /**
     * POST /v1/auth/extension/pair-claim
     * Chrome extension exchanges a pairing code for an access+refresh token
     * pair. Issued tokens have identical shape and TTL to a password login.
     */
    app.post(
      '/auth/extension/pair-claim',
      {
        config: {
          rateLimit: { max: 5, timeWindow: '1 minute' },
        },
      },
      async (req) => {
        const body = PairClaimBody.parse(req.body);
        const r = await claimExtensionPairing({ code: body.code });
        const tokens = await issueTokens(r);
        return { ...tokens, user: { id: r.userId }, workspace: { id: r.workspaceId } };
      },
    );

    /**
     * POST /v1/auth/token
     * Exchange any identity requireAuth accepts (Clerk session JWT via
     * preVerify, or an existing HMAC token) for a short-lived HMAC access
     * token. Every backend service verifies HMAC only — Clerk stays exclusive
     * to the api — so admin-web calls this and uses the result against
     * knowledge/analytics/billing/etc. No refresh token is minted: callers
     * re-exchange their Clerk session when this expires.
     */
    app.post(
      '/auth/token',
      {
        config: {
          // Keyed per-IP; admin-web is one server IP serving many users, so
          // this must comfortably exceed one-exchange-per-user-per-TTL.
          rateLimit: { max: 300, timeWindow: '1 minute' },
        },
      },
      async (req) => {
        const claims = await req.requireAuth();
        const accessToken = app.jwt.sign({
          sub: claims.sub,
          workspaceId: claims.workspaceId,
          role: claims.role,
          membershipId: claims.membershipId,
        });
        return { accessToken };
      },
    );

    app.get('/auth/me', async (req) => {
      const claims = await req.requireAuth();
      const me = await prisma.user.findUniqueOrThrow({
        where: { id: claims.sub },
        select: { id: true, email: true, name: true },
      });
      const ws = await prisma.workspace.findUniqueOrThrow({
        where: { id: claims.workspaceId },
        select: { id: true, name: true, slug: true, planTier: true },
      });
      return { user: me, workspace: ws, role: claims.role };
    });
  };
  // Note: deps.refreshSecret reserved for signed-refresh future; opaque random for now.
  void deps;
}

export type { RefreshTokenClaims };
