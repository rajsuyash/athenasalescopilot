import argon2 from 'argon2';
import { prisma } from '@athena/db';
import type { Prisma } from '@athena/db';
import type { Role } from '@athena/shared-types';
import { isDisposableEmail } from '../../lib/email-domains.js';
import { Errors } from '../../lib/errors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 12;

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
