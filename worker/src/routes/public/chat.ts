import type { HandlerContext } from '../../types/route';
import { json } from '../../lib/responses';
import { randomBase64Url } from '../../lib/random';
import { runChatTurn, type ConversationTurn, type AssistantContentBlock } from '../../services/claude';
import { saveLeadFromChat, markLeadNotified, type SaveLeadInput } from '../../services/save-lead';
import { sendEmail, adminNotifyRecipients } from '../../services/email';

const INITIAL_GREETING =
  "Hey — I'm here to help. Are you exploring what Bussey could do for your business, or looking for something specific?";

const CHAT_SESSION_KV_TTL_SECONDS = 24 * 60 * 60;

type ChatSessionRow = {
  id: string;
  session_token: string;
  status: string;
};

/**
 * CORS: chat endpoints are anonymous and need to be reachable from the
 * Eleventy dev server (different origin from the Worker). Allow any origin;
 * the only thing the visitor presents is the session token they were just
 * issued. No cookies on this path.
 */
function corsHeaders(): HeadersInit {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  };
}

function corsJson(body: unknown, init: ResponseInit = {}): Response {
  return json(body, { ...init, headers: { ...corsHeaders(), ...(init.headers ?? {}) } });
}

export async function chatPreflight(): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function chatSessionCreate(ctx: HandlerContext): Promise<Response> {
  const body = await readJsonObject(ctx.request);
  const source_page = body && typeof body['source_page'] === 'string' ? body['source_page'] : null;
  const visitor_fingerprint =
    body && typeof body['visitor_fingerprint'] === 'string' ? body['visitor_fingerprint'] : null;

  const id = crypto.randomUUID();
  const session_token = randomBase64Url(24);

  await ctx.env.DB.prepare(
    `INSERT INTO chat_session (id, session_token, source_page, visitor_fingerprint)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(id, session_token, source_page, visitor_fingerprint)
    .run();

  // Pre-canned greeting from the assistant (spec 03).
  await ctx.env.DB.prepare(
    `INSERT INTO chat_message (id, session_id, role, content) VALUES (?, ?, 'assistant', ?)`,
  )
    .bind(crypto.randomUUID(), id, INITIAL_GREETING)
    .run();

  await ctx.env.SESSIONS.put(
    kvKey(session_token),
    JSON.stringify({ id, session_token, started_at: Date.now() }),
    { expirationTtl: CHAT_SESSION_KV_TTL_SECONDS },
  );

  return corsJson(
    {
      session_token,
      messages: [{ role: 'assistant', content: INITIAL_GREETING }],
    },
    { status: 201 },
  );
}

export async function chatSessionFetch(ctx: HandlerContext): Promise<Response> {
  const token = ctx.params['token'];
  if (!token) return corsJson({ error: 'invalid_token' }, { status: 400 });

  const session = await loadSession(ctx, token);
  if (!session) return corsJson({ error: 'session_not_found' }, { status: 404 });

  const msgs = await ctx.env.DB.prepare(
    `SELECT role, content, created_at FROM chat_message WHERE session_id = ? ORDER BY created_at ASC`,
  )
    .bind(session.id)
    .all<{ role: 'user' | 'assistant'; content: string; created_at: string }>();

  return corsJson({ session_token: token, status: session.status, messages: msgs.results ?? [] });
}

export async function chatMessage(ctx: HandlerContext): Promise<Response> {
  const body = await readJsonObject(ctx.request);
  if (!body) return corsJson({ error: 'invalid_request' }, { status: 400 });
  const token = typeof body['session_token'] === 'string' ? body['session_token'] : '';
  const userText = typeof body['content'] === 'string' ? body['content'].trim() : '';
  if (!token || !userText) return corsJson({ error: 'invalid_request' }, { status: 400 });
  if (userText.length > 4000) return corsJson({ error: 'message_too_long' }, { status: 400 });

  const session = await loadSession(ctx, token);
  if (!session) return corsJson({ error: 'session_not_found' }, { status: 404 });

  // Persist the user's message before calling Claude.
  await ctx.env.DB.prepare(
    `INSERT INTO chat_message (id, session_id, role, content) VALUES (?, ?, 'user', ?)`,
  )
    .bind(crypto.randomUUID(), session.id, userText)
    .run();

  // Update the session's last_active_at.
  await ctx.env.DB.prepare(`UPDATE chat_session SET last_active_at = ? WHERE id = ?`)
    .bind(new Date().toISOString(), session.id)
    .run();

  // Fetch the last 20 messages for context (excluding the assistant greeting if
  // it makes the window noisy — we keep it; spec says limit is 20).
  const history = await ctx.env.DB.prepare(
    `SELECT role, content FROM chat_message WHERE session_id = ? ORDER BY created_at ASC LIMIT 20`,
  )
    .bind(session.id)
    .all<{ role: 'user' | 'assistant'; content: string }>();

  const conversation: ConversationTurn[] = (history.results ?? []).map((m) =>
    m.role === 'assistant'
      ? { role: 'assistant', content: [{ type: 'text', text: m.content }] as AssistantContentBlock[] }
      : { role: 'user', content: m.content },
  );

  // Bail gracefully if the Anthropic key is the dev placeholder. Lets the
  // smoke test exercise the rest of the pipeline (session, persistence,
  // CORS, transcript fetch) without a real key configured.
  if (!ctx.env.ANTHROPIC_API_KEY || ctx.env.ANTHROPIC_API_KEY === 'sk-ant-replace-me') {
    const stub = "(Bussey assistant isn't connected to Claude in this environment — set ANTHROPIC_API_KEY in .dev.vars to enable.)";
    await ctx.env.DB.prepare(
      `INSERT INTO chat_message (id, session_id, role, content) VALUES (?, ?, 'assistant', ?)`,
    )
      .bind(crypto.randomUUID(), session.id, stub)
      .run();
    return corsJson({ assistant: { role: 'assistant', content: stub }, lead_captured: false, stub: true });
  }

  let leadCaptured = false;

  try {
    const result = await runChatTurn(ctx.env, conversation, {
      save_lead: async (input) => {
        const saved = await saveLeadFromChat(ctx.env, session.id, input as SaveLeadInput);
        if (saved.should_notify) {
          await fireNewLeadNotification(ctx, saved.lead_id);
        }
        leadCaptured = true;
        return { ok: true, lead_id: saved.lead_id, created: saved.created };
      },
    });

    // Persist the assistant's tool_calls + text. We store the text in `content`
    // and any tool_use blocks in the `tool_calls` JSON column for the audit
    // trail.
    const toolUseBlocks = result.assistantBlocks.filter((b) => b.type === 'tool_use');
    await ctx.env.DB.prepare(
      `INSERT INTO chat_message (id, session_id, role, content, tool_calls) VALUES (?, ?, 'assistant', ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        session.id,
        result.assistantText || '(no text response)',
        toolUseBlocks.length > 0 ? JSON.stringify(toolUseBlocks) : null,
      )
      .run();

    // If the assistant called save_lead and we just captured a lead, optionally
    // flip session status now so the admin inbox shows the right state.
    if (leadCaptured) {
      await ctx.env.DB.prepare(`UPDATE chat_session SET status = 'captured_as_lead' WHERE id = ?`)
        .bind(session.id)
        .run();
    }

    return corsJson({
      assistant: { role: 'assistant', content: result.assistantText },
      lead_captured: leadCaptured,
    });
  } catch (e) {
    console.error('chat:claude_error', e);
    return corsJson({ error: 'assistant_failed', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

/** Fire the new-lead admin notification and stamp the lead so we never re-send. */
async function fireNewLeadNotification(ctx: HandlerContext, leadId: string): Promise<void> {
  const lead = await ctx.env.DB.prepare(
    `SELECT id, name, email, phone, company, industry, pain_summary, urgency
       FROM lead WHERE id = ?`,
  )
    .bind(leadId)
    .first<{
      id: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      company: string | null;
      industry: string | null;
      pain_summary: string | null;
      urgency: string | null;
    }>();
  if (!lead) return;

  const recipients = adminNotifyRecipients(ctx.env);
  if (recipients.length === 0) return;

  const subject = `New Lead: ${lead.name ?? '(no name yet)'}${lead.company ? ` from ${lead.company}` : ''}`;
  const lines = [
    `New lead captured by the website chat.`,
    ``,
    `Name:    ${lead.name ?? '—'}`,
    `Email:   ${lead.email ?? '—'}`,
    `Phone:   ${lead.phone ?? '—'}`,
    `Company: ${lead.company ?? '—'}`,
    `Industry: ${lead.industry ?? '—'}`,
    `Urgency: ${lead.urgency ?? '—'}`,
    ``,
    `Pain summary:`,
    `  ${lead.pain_summary ?? '—'}`,
    ``,
    `Open in admin: ${ctx.env.ADMIN_URL_BASE}/leads/${lead.id}`,
  ];

  await sendEmail(ctx.env, {
    kind: 'new_lead',
    to: recipients,
    subject,
    text: lines.join('\n'),
    relatedEntity: { type: 'lead', id: lead.id },
  });

  await markLeadNotified(ctx.env, lead.id);
}

async function loadSession(ctx: HandlerContext, token: string): Promise<ChatSessionRow | null> {
  // Hot path: KV.
  const raw = await ctx.env.SESSIONS.get(kvKey(token));
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { id: string };
      if (parsed.id) {
        // Touch TTL.
        await ctx.env.SESSIONS.put(kvKey(token), raw, { expirationTtl: CHAT_SESSION_KV_TTL_SECONDS });
        const status = await ctx.env.DB.prepare(`SELECT id, session_token, status FROM chat_session WHERE id = ?`)
          .bind(parsed.id)
          .first<ChatSessionRow>();
        if (status) return status;
      }
    } catch {
      // fall through to D1 lookup
    }
  }
  // Fallback: D1 by token.
  return ctx.env.DB.prepare(`SELECT id, session_token, status FROM chat_session WHERE session_token = ?`)
    .bind(token)
    .first<ChatSessionRow>();
}

function kvKey(token: string): string {
  return `chat:session:${token}`;
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = (await request.json()) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
