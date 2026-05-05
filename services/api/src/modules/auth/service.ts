import crypto from 'node:crypto';
import argon2 from 'argon2';
import { prisma } from '@athena/db';
import type { Prisma } from '@athena/db';
import type { Role } from '@athena/shared-types';
import { isDisposableEmail } from '../../lib/email-domains.js';
import { Errors } from '../../lib/errors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 12;

// Crockford-ish alphabet — no 0/1/O/I to keep codes phone-readable.
const PAIRING_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const PAIRING_SEGMENT_LEN = 4;
const PAIRING_TTL_MS = 10 * 60 * 1000;
const PAIRING_CODE_RE = /^ATH-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;

export interface SignupInput {
  email: string;
  password: string;
  name: string;
  workspaceName: string;
  workspaceSlug: string;
}

export interface SignupResult {
  userId: string;
  workspaceId: string;
  membershipId: string;
  role: Role;
}

/**
 * Create a user + their first workspace + owner membership in one transaction.
 * The first user of a workspace is the owner per PRD F8 (workspace must always
 * have ≥1 owner).
 */
export async function signup(input: SignupInput): Promise<SignupResult> {
  if (!EMAIL_RE.test(input.email)) throw Errors.invalidEmail();
  if (isDisposableEmail(input.email)) throw Errors.emailDomainBlocked();
  if (input.password.length < MIN_PASSWORD_LEN) throw Errors.weakPassword();

  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

  try {
    return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const user = await tx.user.create({
        data: {
          email: input.email.toLowerCase(),
          name: input.name,
          passwordHash,
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: input.workspaceName,
          slug: input.workspaceSlug.toLowerCase(),
        },
      });

      const membership = await tx.userWorkspaceMembership.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: 'owner',
          status: 'active',
        },
      });

      await tx.retentionPolicy.create({
        data: { workspaceId: workspace.id },
      });

      await tx.auditLog.create({
        data: {
          workspaceId: workspace.id,
          actorUserId: user.id,
          action: 'workspace.created',
          resourceType: 'workspace',
          resourceId: workspace.id,
          metadataJson: { name: workspace.name, slug: workspace.slug },
        },
      });

      return {
        userId: user.id,
        workspaceId: workspace.id,
        membershipId: membership.id,
        role: 'owner' as Role,
      };
    });
  } catch (err) {
    // Prisma P2002 = unique violation
    if ((err as { code?: string }).code === 'P2002') {
      const target = (err as { meta?: { target?: string[] } }).meta?.target ?? [];
      if (target.includes('email')) throw Errors.emailTaken();
    }
    throw err;
  }
}

export interface LoginInput {
  email: string;
  password: string;
  /** Optional — if user belongs to multiple workspaces. */
  workspaceSlug?: string | undefined;
}

export interface LoginResult {
  userId: string;
  workspaceId: string;
  membershipId: string;
  role: Role;
}

// ─── Extension pairing ────────────────────────────────────────────────────
//
// Lets a user authenticated on admin-web mint a short-lived single-use code
// that the Chrome extension exchanges for tokens. Closes the OAuth gap:
// Clerk/Google-signup users have no email+password to type into the popup.

/** Generate a `ATH-XXXX-XXXX` pairing code from a CSPRNG. Pure helper, no I/O. */
export function generatePairingCode(): string {
  const seg = (): string => {
    const out: string[] = [];
    const buf = crypto.randomBytes(PAIRING_SEGMENT_LEN);
    for (let i = 0; i < PAIRING_SEGMENT_LEN; i++) {
      // Reject-on-overflow would be ideal; modulo bias on 256→32 is zero
      // because 256 is divisible by 32. Safe.
      const idx = buf[i]! & 0x1f;
      out.push(PAIRING_ALPHABET.charAt(idx));
    }
    return out.join('');
  };
  return `ATH-${seg()}-${seg()}`;
}

export function isValidPairingCode(code: string): boolean {
  return PAIRING_CODE_RE.test(code);
}

function hashPairingCode(code: string): string {
  // Cheap deterministic hash — pairing codes are short-lived (10 min) and the
  // table has UNIQUE on code_hash so we don't need argon2's collision
  // resistance. SHA-256 keeps insert latency in the µs range.
  return crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

export interface StartPairingInput {
  userId: string;
  workspaceId: string;
}

export interface StartPairingResult {
  code: string;
  expiresAt: Date;
}

/**
 * Mint a pairing code for the (user, workspace) tuple. The membership must
 * exist + be active. Returns the raw code ONCE — caller must show it to the
 * user immediately; we never log it server-side.
 */
export async function startExtensionPairing(
  input: StartPairingInput,
): Promise<StartPairingResult> {
  const membership = await prisma.userWorkspaceMembership.findFirst({
    where: { userId: input.userId, workspaceId: input.workspaceId, status: 'active' },
    select: { id: true },
  });
  if (!membership) throw Errors.invalidCredentials();

  // Try a few times in the astronomically-unlikely event of a code collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generatePairingCode();
    const codeHash = hashPairingCode(code);
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
    try {
      await prisma.extensionPairing.create({
        data: {
          userId: input.userId,
          workspaceId: input.workspaceId,
          membershipId: membership.id,
          codeHash,
          expiresAt,
        },
      });
      return { code, expiresAt };
    } catch (err) {
      // P2002 unique violation on code_hash → retry with a new code.
      if ((err as { code?: string }).code === 'P2002') continue;
      throw err;
    }
  }
  throw new Error('failed to mint pairing code after retries');
}

export interface ClaimPairingInput {
  code: string;
}

export interface ClaimPairingResult {
  userId: string;
  workspaceId: string;
  membershipId: string;
  role: Role;
}

/**
 * Exchange a pairing code for the membership tuple needed to issue tokens.
 * Single-use: marks the row claimed in the same query that reads it so
 * concurrent claims race-safely (only one wins).
 */
export async function claimExtensionPairing(
  input: ClaimPairingInput,
): Promise<ClaimPairingResult> {
  const code = input.code.trim().toUpperCase();
  if (!isValidPairingCode(code)) throw Errors.tokenInvalid();
  const codeHash = hashPairingCode(code);

  // updateMany returns count; with UNIQUE(code_hash) at most one row matches.
  // The WHERE clause rejects already-claimed and expired rows so we don't
  // even need a separate read. Race-safe.
  const updated = await prisma.extensionPairing.updateMany({
    where: {
      codeHash,
      claimedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { claimedAt: new Date() },
  });
  if (updated.count === 0) throw Errors.tokenInvalid();

  // Now load the membership/role to issue tokens.
  const row = await prisma.extensionPairing.findUnique({
    where: { codeHash },
    select: { userId: true, workspaceId: true, membershipId: true },
  });
  if (!row) throw Errors.tokenInvalid();

  const membership = await prisma.userWorkspaceMembership.findFirst({
    where: { id: row.membershipId, status: 'active' },
    select: { id: true, role: true },
  });
  if (!membership) throw Errors.tokenInvalid();

  return {
    userId: row.userId,
    workspaceId: row.workspaceId,
    membershipId: membership.id,
    role: membership.role as Role,
  };
}

export async function login(input: LoginInput): Promise<LoginResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
    include: {
      memberships: { include: { workspace: true }, where: { status: 'active' } },
    },
  });
  if (!user || !user.passwordHash) throw Errors.invalidCredentials();
  const ok = await argon2.verify(user.passwordHash, input.password);
  if (!ok) throw Errors.invalidCredentials();
  if (user.memberships.length === 0) throw Errors.invalidCredentials();

  const wsSlug = input.workspaceSlug?.toLowerCase();
  const membership = wsSlug
    ? user.memberships.find((m: { workspace: { slug: string } }) => m.workspace.slug === wsSlug)
    : user.memberships[0];
  if (!membership) throw Errors.invalidCredentials();

  return {
    userId: user.id,
    workspaceId: membership.workspaceId,
    membershipId: membership.id,
    role: membership.role as Role,
  };
}
