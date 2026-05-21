import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';

type AdminRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: number;
};

/**
 * GET /api/admin/me — current admin user from the verified session.
 * Used by the SPA on boot to know whether the user is logged in and as whom.
 */
export async function adminMe(ctx: HandlerContext): Promise<Response> {
  if (!ctx.session) return json({ error: 'unauthenticated' }, { status: 401 });

  const user = await ctx.env.DB.prepare(
    `SELECT id, name, email, role, active FROM admin_user WHERE id = ? AND active = 1`,
  )
    .bind(ctx.session.subjectId)
    .first<AdminRow>();

  if (!user) return json({ error: 'unauthenticated' }, { status: 401 });

  return json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
}
