# 03 — Workflow: Lead Capture

The one Claude-powered workflow in v1. Visitor talks to chat, structured lead info is extracted, lead record is created, you get notified.

## Actors
- Anonymous website visitor
- Claude (via Anthropic API)
- Worker (orchestration + persistence)
- Admin (recipient of notification)

## Flow

```
Visitor lands on busseyandbussey.com
        │
        ▼
Chat widget visible in corner (passive — opens on click)
        │
        ▼
Visitor clicks chat, sends first message
        │
        ▼
Worker creates chat_session, stores message, calls Claude with system prompt + context
        │
        ▼
Claude responds. Worker stores response. Sends to client.
        │
        ▼
Conversation continues. Claude asks structured questions naturally:
  • What industry are you in?
  • What's the main thing slowing you down right now?
  • Roughly how big is your team / operation?
  • What's your timeline?
  • Can I get your name and best way to reach you?
        │
        ▼
When Claude has enough info, it calls the save_lead tool with extracted fields.
        │
        ▼
Worker writes to lead table. Marks chat_session as captured_as_lead. Fires notification.
        │
        ▼
Admin email arrives: "New lead: [Name] from [Company] — [Industry] — [Pain summary]"
Link directs to the lead record in admin.
        │
        ▼
Claude tells visitor: "Got it. Someone from Bussey will reach out within [timeframe]."
```

## Chat Widget Behavior

- **Visibility:** Always-present chat bubble bottom-right on every page
- **Open state:** Click to expand. Modal-style overlay, mobile-responsive.
- **Initial greeting:** Pre-canned, sent automatically when opened the first time in a session. Example: "Hey — I'm here to help. Are you exploring what Bussey could do for your business, or looking for something specific?"
- **Session persistence:** Survives page navigation within the same site visit (KV-backed). Reset on browser close.
- **Mobile:** Full-screen takeover on small viewports.

## System Prompt (Claude)

The system prompt should establish:
1. **Identity:** You're the Bussey and Bussey assistant. You help service business owners understand whether Bussey can help with their operational pain.
2. **Tone:** Warm, professional, direct. Not salesy. Not chatbot-cheerful. Like a competent person at a firm.
3. **Knowledge:** What Bussey does (operations + AI for B2B service businesses), the verticals served (home health primary, landscape, expanding), the typical engagement (custom platform build + ongoing monthly).
4. **Behavior:**
   - Ask one question at a time
   - Always trying to understand: who they are, what they do, what's broken, what they need
   - Capture name/email/phone naturally when offered or when they're ready to talk to a human
   - Don't pitch hard. Don't quote prices.
   - When you have enough structured info, call the `save_lead` tool
   - After saving, tell them someone will reach out
5. **Tool:** A single `save_lead` tool with fields: name, email, phone, company, industry, pain_summary, urgency, additional_notes

## save_lead Tool

**Purpose:** Persist extracted lead info during the conversation.

**Inputs:**
- `name` (string, nullable)
- `email` (string, nullable)
- `phone` (string, nullable)
- `company` (string, nullable)
- `industry` (string, nullable)
- `pain_summary` (string, nullable)
- `urgency` (string: "immediate" / "weeks" / "months" / "exploring", nullable)
- `additional_notes` (string, nullable)

**Behavior:**
- If no lead exists yet for this chat_session, creates one
- If a lead exists, updates with new info (merge, don't overwrite non-null fields)
- After write, if the lead has at least one contact method (email OR phone), fires the notification
- Returns success to Claude so it can confirm to the visitor

## Notification

**Trigger:** A lead record reaches a notifiable state — has contact info plus some context.

**Channel:** Email to internal admin address (configurable list of recipients).

**Content:**
- Subject: `New Lead: [Name] from [Company]`
- Body: name, company, industry, contact info, pain summary, urgency, chat transcript link, direct link to lead record in admin
- Plain text + HTML versions

**Future:** SMS option, Slack channel, etc. Not in v1.

## Admin Inbox (Leads View)

- Default sort: most recent first
- Filters: status, source, industry, date range
- Each row: name, company, industry, source, status, last_contacted_at, [view]
- Click row → opens lead detail view
  - Full contact info, fields editable
  - Chat transcript (if from chat) — readable, copyable
  - Notes field (admin notes, not from Claude)
  - Status dropdown (new / reviewed / contacted / qualified / disqualified)
  - "Convert to Client" button (only enabled when status is qualified or contacted)
  - Activity log: when status changed, when contacted, etc.

## Error Handling

- Claude API failure: chat shows graceful fallback "I'm having trouble responding right now. Can I take your email and we'll get back to you?" — captures contact info in a basic form, persists as a manual lead
- save_lead tool failure: Claude is told the save failed; it asks again or moves on. Backend retries are queued.
- Email send failure: lead is still persisted; notification is queued for retry; admin can also see new leads in the admin UI without depending on email.

## Out of Scope (v1)

- Multi-language chat
- Voice/audio chat
- File uploads in chat
- Chat history visible to returning visitors
- Lead scoring
- Automatic SMS or email reply to visitor after capture
- Claude actually booking calls (just collects info, you book the call)
