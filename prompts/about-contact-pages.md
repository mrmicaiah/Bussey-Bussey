# About + Contact pages — build spec

Build the About and Contact pages on the LOCKED homepage design system (same fonts,
crimson/ink tokens, .wrap 1140px column, .ey eyebrows, .section/.h1/.h2/.h3, .band,
the .chat card). They must look like the homepage and services page. Both end with the
embedded chat contact section (the chat IS the contact method — no forms).

**Commit but DO NOT push.** Pull latest first.

## ABOUT — site/src/about.md (convert to .njk if cleaner, like services)

Voice: harsh-but-professional, problem-first, same as the rest. This is the FULL version
of the homepage's "who we are" teaser — go deeper, don't just repeat it. Copy is verbatim.

### Hero (compact, no image)
- Eyebrow: WHO WE ARE
- h1: "Built by operators, not advisors."
- Lead: "Consultants are everywhere. Almost none of them can build the thing they recommend. We can — because we've run the business, not just advised one."

### Section: The short version (text, .wrap narrow)
- Eyebrow: WHERE WE CAME FROM
- h2: "We built a company before we built software for them."
- p: "Before Bussey and Bussey, we built White Shovel — a landscape design firm — and the software that ran it. We wrote the back-end systems and the design tools ourselves, and they did something most software never does: they turned an ordinary salesperson into a capable designer. The efficiency was real enough that we could hand a homeowner a finished design for free and still win the work. Then we sold it."
- p: "That's the whole idea behind Bussey and Bussey, proven before the company existed: the right tools don't just save time — they change what an ordinary person is capable of. We've spent the years since building that kind of leverage for service companies across industries."

### Section (washed bg): How we think (text)
- Eyebrow: HOW WE WORK
- h2: "Research is the foundation."
- p: "In a world where ChatGPT hands everyone an answer and a plain website means a little less every day, the rare thing isn't information. It's knowing what's actually possible for your business — and having someone do the work to find out. That's R&D, and most owners can't spare the time for it. We can."
- h3: "We solve problems. We don't sell software."
- p: "We don't start with what we'd like to build. We start with what's costing you — in an Assessment, at no charge, long before money enters. We dig until we find the real problem, design the fix so you can see it, and only talk about building once you've seen what you'd be paying for. You can't buy what you can't shop."
- h3: "Who we're for."
- p: "We work with owners who want to improve — not ones looking for a pat on the back. If you're willing to invest your time and look honestly at what's broken, we'll meet you there. If you want reassurance that everything's fine, we're not the firm for you."

### Band (provocative image — the market thesis, same as homepage climax image)
Full-bleed band, `...provocative_moasyf.jpg`, scrim rgba(8,8,8,.62), white text, centered:
- Eyebrow (#f0626c): THE MOMENT
- h2: "The market just opened. We exist to make sure you're ready."
- p: "The large companies are using AI to cut their workforce — and handing the open market back to small business. The tools that used to belong only to the big players are within reach for the first time. Reach isn't the same as ready. That's the gap we close."

### Contact section (the chat card — same as services)
- Heading: "Tell us what's broken."
- Line: "No forms. Talk to our Automated Intelligence — it'll get the details and put you in front of a person."
- The homepage .chat card with ONE #bb-chat-inline mount. Same bounded styling.

## CONTACT — site/src/contact.md (convert to .njk if cleaner)

Short page. The chat IS the contact method and is the centerpiece here (more prominent
than on other pages). Minimal copy.

### Hero + chat (the whole page, basically)
- Eyebrow: GET IN TOUCH
- h1: "There's no contact form. There's a conversation."
- Lead: "Tell our Automated Intelligence what's going on in your business. It'll ask the right questions, get the details, and make sure the right person follows up. It's faster than a form and it actually listens."
- Then the .chat card (ONE #bb-chat-inline mount), prominent and centered — this is the
  focal point of the page. Same bounded card styling.
- Below the card, small/muted: "Prefer email? Reach us at hello@busseyandbussey.com."

### Optional small reassurance line under the email
- muted small: "Encrypted and confidential. We reply to every serious inquiry within one business day."

## Constraints (both pages)
- Locked design system; must match homepage/services. One h1 each. Problem/section heads h2/h3.
- Exactly ONE #bb-chat-inline element per page (widget grabs one by id).
- The preventScroll fix is already in the widget, so the bottom-placed chat card won't
  jump the page on load — good. Contact page card is higher up, also fine.
- Mobile: everything stacks, chat card full-width, legible.
- Don't change widget JS, the worker, or Cloudinary IDs.
- Build locally, confirm both pass with one h1 each. Report files changed + what a push deploys.
  Commit, do not push.
