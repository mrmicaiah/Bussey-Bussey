import type { Env } from '../types/env';
import { CHAT_SYSTEM_PROMPT } from '../config/chat-system-prompt';

/**
 * Anthropic Messages API wrapper for the public chat.
 *
 * We call the API over plain fetch (no SDK) to keep the Worker bundle small.
 * The Messages API accepts the system prompt + a list of conversation turns
 * + tool definitions. Tool calls round-trip: we receive `tool_use` blocks,
 * execute the tool (in our case, `save_lead`), and call back with a
 * `tool_result` content block. Loop until the assistant returns a stop_reason
 * other than 'tool_use', capped at MAX_LOOPS.
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;
const MAX_LOOPS = 4; // Defensive: prevent runaway tool loops.

export type ConversationTurn =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: AssistantContentBlock[] };

export type AssistantContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

export type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;

export type ClaudeResponse = {
  assistantText: string;
  assistantBlocks: AssistantContentBlock[];
  toolCallsExecuted: { name: string; input: Record<string, unknown>; result: unknown }[];
  stop_reason: string | null;
};

const SAVE_LEAD_TOOL = {
  name: 'save_lead',
  description:
    "Persist what you've learned about the visitor so far. Always call this when you have a contact method (email or phone) plus at least one substantive field (industry, company, or pain). Safe to call multiple times in one conversation — the backend merges and never overwrites non-null fields.",
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Visitor full name.' },
      email: { type: 'string', description: 'Visitor email.' },
      phone: { type: 'string', description: 'Visitor phone (any format).' },
      company: { type: 'string', description: 'Their business name.' },
      industry: {
        type: 'string',
        description: 'Industry / vertical — home_health, landscape, or other free-text.',
      },
      pain_summary: {
        type: 'string',
        description: 'One- or two-sentence summary of what they want to fix, in their own words where possible.',
      },
      urgency: {
        type: 'string',
        enum: ['immediate', 'weeks', 'months', 'exploring'],
        description: 'Rough timeline they hinted at.',
      },
      additional_notes: {
        type: 'string',
        description: 'Anything else relevant for the human follow-up: scale of operation, decision makers, blockers.',
      },
    },
    additionalProperties: false,
  },
};

/**
 * Run a single round-trip with Claude, executing tools as they come up,
 * until the assistant returns plain text. Returns the full assistant
 * response plus a record of any tool calls executed during the loop.
 */
export async function runChatTurn(
  env: Env,
  conversation: ConversationTurn[],
  toolHandlers: Record<string, ToolHandler>,
): Promise<ClaudeResponse> {
  const turns: ConversationTurn[] = [...conversation];
  const toolCallsExecuted: ClaudeResponse['toolCallsExecuted'] = [];
  let stop_reason: string | null = null;
  let assistantBlocks: AssistantContentBlock[] = [];

  for (let i = 0; i < MAX_LOOPS; i++) {
    const res = await callClaude(env, turns);
    stop_reason = res.stop_reason;
    assistantBlocks = res.content;

    // Append assistant message to the conversation.
    turns.push({ role: 'assistant', content: assistantBlocks });

    const toolUses = assistantBlocks.filter((b): b is Extract<AssistantContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    if (toolUses.length === 0) break;

    // Execute each tool and feed results back as a user-role tool_result block.
    const toolResultsContent: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
    for (const use of toolUses) {
      const handler = toolHandlers[use.name];
      let result: unknown;
      try {
        result = handler ? await handler(use.input) : { error: 'unknown_tool', name: use.name };
      } catch (e) {
        result = { error: 'tool_threw', message: e instanceof Error ? e.message : String(e) };
      }
      toolCallsExecuted.push({ name: use.name, input: use.input, result });
      toolResultsContent.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: typeof result === 'string' ? result : JSON.stringify(result),
      });
    }

    // The Anthropic Messages API expects tool_results as a user message with an array of tool_result blocks.
    turns.push({
      role: 'user',
      // Internally we keep `content` as string for user turns, but the API also accepts arrays.
      // Cast it through unknown so the type stays clean upstream.
      content: toolResultsContent as unknown as string,
    });
  }

  const assistantText = assistantBlocks
    .filter((b): b is Extract<AssistantContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  return { assistantText, assistantBlocks, toolCallsExecuted, stop_reason };
}

async function callClaude(env: Env, turns: ConversationTurn[]): Promise<{
  content: AssistantContentBlock[];
  stop_reason: string;
}> {
  // The user-role tool_result is already an array; the wire format wants
  // the array passed through as content. Other user turns are strings and
  // we wrap them in a single text block for clarity.
  const messages = turns.map((t) => {
    if (t.role === 'user') {
      const c = t.content as unknown;
      if (typeof c === 'string') {
        return { role: 'user' as const, content: [{ type: 'text' as const, text: c }] };
      }
      return { role: 'user' as const, content: c };
    }
    return { role: 'assistant' as const, content: t.content };
  });

  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: CHAT_SYSTEM_PROMPT,
      tools: [SAVE_LEAD_TOOL],
      messages,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`anthropic_${res.status}: ${errorText.slice(0, 400)}`);
  }

  const body = (await res.json()) as {
    content: AssistantContentBlock[];
    stop_reason: string;
  };
  return { content: body.content, stop_reason: body.stop_reason };
}
