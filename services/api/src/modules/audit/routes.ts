import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@athena/db';

const ListQuery = z.object({
  action: z.string().min(1).max(80).optional(),
  actorUserId: z.string().uuid().optional(),
  resourceType: z.string().min(1).max(40).optional(),
  resourceId: z.string().min(1).max(80).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const FacetsQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/audit — paginated audit log for the caller's workspace.
   * Required permission: `audit:read` (compliance_viewer + owner).
   */
  app.get('/audit', async (req) => {
    const claims = await req.requirePermission('audit:read');
    const q = ListQuery.parse(req.query);

    const where = {
      workspaceId: claims.workspaceId,
      ...(q.action ? { action: q.action } : {}),
      ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
      ...(q.resourceType ? { resourceType: q.resourceType } : {}),
      ...(q.resourceId ? { resourceId: q.resourceId } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: q.limit,
        skip: q.offset,
        include: { actor: { select: { id: true, email: true, name: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      total,
      limit: q.limit,
      offset: q.offset,
      events: rows.map((r) => ({
        id: r.id,
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        actor: r.actor
          ? { id: r.actor.id, email: r.actor.email, name: r.actor.name }
          : null,
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        metadataJson: r.metadataJson,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });

  /**
   * GET /v1/audit/export — stream a CSV or JSON dump of the filtered set.
   * Capped at 10,000 rows. PRD §7 (data export). Logged as `audit.exported`.
   */
  const ExportQuery = ListQuery.extend({
    format: z.enum(['csv', 'json']).default('csv'),
    limit: z.coerce.number().int().min(1).max(10_000).default(10_000),
  });

  app.get('/audit/export', async (req, reply) => {
    const claims = await req.requirePermission('audit:read');
    const q = ExportQuery.parse(req.query);

    const where = {
      workspaceId: claims.workspaceId,
      ...(q.action ? { action: q.action } : {}),
      ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
      ...(q.resourceType ? { resourceType: q.resourceType } : {}),
      ...(q.resourceId ? { resourceId: q.resourceId } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    };

    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      include: { actor: { select: { id: true, email: true, name: true } } },
    });

    const fname = `audit-${claims.workspaceId.slice(0, 8)}-${new Date()
      .toISOString()
      .slice(0, 10)}.${q.format}`;
    reply.header('content-disposition', `attachment; filename="${fname}"`);

    // Audit-log the export itself BEFORE streaming so the export reflects it
    // on the next pull.
    await prisma.auditLog.create({
      data: {
        workspaceId: claims.workspaceId,
        actorUserId: claims.sub,
        action: 'audit.exported',
        resourceType: 'audit_log',
        resourceId: claims.workspaceId,
        metadataJson: { count: rows.length, format: q.format, filters: { ...where } },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      },
    });

    if (q.format === 'json') {
      reply.type('application/json');
      return rows.map((r) => ({
        id: r.id,
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        actor: r.actor
          ? { id: r.actor.id, email: r.actor.email, name: r.actor.name }
          : null,
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        metadataJson: r.metadataJson,
        createdAt: r.createdAt.toISOString(),
      }));
    }

    // CSV
    reply.type('text/csv; charset=utf-8');
    const cols = [
      'id',
      'created_at',
      'action',
      'resource_type',
      'resource_id',
      'actor_id',
      'actor_email',
      'actor_name',
      'ip_address',
      'user_agent',
      'metadata_json',
    ];
    const lines = [cols.join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.id,
          r.createdAt.toISOString(),
          r.action,
          r.resourceType,
          r.resourceId,
          r.actor?.id ?? '',
          r.actor?.email ?? '',
          r.actor?.name ?? '',
          r.ipAddress ?? '',
          r.userAgent ?? '',
          JSON.stringify(r.metadataJson ?? {}),
        ]
          .map(csvCell)
          .join(','),
      );
    }
    return lines.join('\n');
  });

  /**
   * GET /v1/audit/facets — distinct actions + actors over a window.
   * Cheap read for the filter dropdowns.
   */
  app.get('/audit/facets', async (req) => {
    const claims = await req.requirePermission('audit:read');
    const q = FacetsQuery.parse(req.query);
    const since = new Date(Date.now() - q.days * 24 * 60 * 60 * 1000);

    const [actions, actors] = await Promise.all([
      prisma.auditLog.groupBy({
        by: ['action'],
        where: { workspaceId: claims.workspaceId, createdAt: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { action: 'desc' } },
        take: 30,
      }),
      prisma.auditLog
        .findMany({
          where: {
            workspaceId: claims.workspaceId,
            createdAt: { gte: since },
            actorUserId: { not: null },
          },
          select: { actor: { select: { id: true, email: true, name: true } } },
          distinct: ['actorUserId'],
          take: 50,
        })
        .then((rows) =>
          rows
            .map((r) => r.actor)
            .filter((a): a is { id: string; email: string; name: string } => a !== null),
        ),
    ]);

    return {
      windowDays: q.days,
      actions: actions.map((a) => ({ action: a.action, count: a._count._all })),
      actors,
    };
  });
}

/**
 * RFC 4180 CSV escaping. Wraps in quotes when the value contains comma, quote,
 * CR, or LF. Doubles inner quotes.
 */
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (s === '') return '';
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
