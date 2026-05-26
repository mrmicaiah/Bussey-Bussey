# Admin app mapping — READ ONLY investigation

We're about to redesign the admin app's WORKFLOW and visual design (rebrand it "Studio44",
apply the black/crimson/white system, and turn it from a database-style UI into a guided
workflow). Before any of that, I need a complete, accurate map of what exists today.

**This is READ-ONLY. Change nothing, build nothing, commit nothing. Just investigate and
report in detail.**

The admin app is the SvelteKit SPA at `/admin` (in the `admin/` directory). Report the
following, in plain prose + lists. Be thorough — this map is the foundation for the redesign.

## 1. Routes / pages
List every page/route in the admin app. For each: its path, its purpose, and what a user
does on it. (Walk the SvelteKit routes directory.) Note especially: dashboard/home, leads
list, lead detail, client views, assessment screens, presentation screens, anything in the
sales funnel, settings, auth/login.

## 2. The pipeline / funnel — the data model
This is the most important part. Map the lead→client→build funnel as it exists in the data:
- What are the actual pipeline STAGES a lead/opportunity moves through? List them in order,
  with their exact names/values as stored in the DB.
- What entities exist and how do they relate? (lead, client, opportunity, assessment,
  presentation, proposal/calculator, disposition, activation, build/change-order, billing —
  whatever's real.) Give the actual table/entity names and how one becomes the next.
- What fields does a lead/opportunity carry that matter for working it (status, owner,
  next-step, contact attempts, scheduled follow-ups, dates, etc.)?
- How does a lead get "worked"? What actions/state-changes are possible on a lead today
  (log a call, log contact, schedule follow-up, change stage, convert to client, etc.)?
  List what EXISTS as an action vs. what doesn't.

## 3. What actions/workflows exist vs. don't
- Can you currently: log/initiate a call, text, or email from a lead? Schedule a follow-up?
  Schedule or launch a presentation? Record a disposition? Convert lead→client? Move through
  assessment→presentation→build? For each, say whether the UI/action EXISTS, partially exists,
  or doesn't exist.
- Is there any "batch" concept (e.g. a calling list, a queue of leads to work)? Describe it
  if so.
- Is there any "next best action" or guidance anywhere, or is it all manual record-editing?

## 4. The lead detail page specifically
(The known pain point.) Describe exactly how it works today: does it open in edit mode or
view mode? What's on it? What can you do from it? Why does it feel like a database record
rather than a workspace?

## 5. Visual / tech structure
- What styling system does the admin use now (CSS framework, design tokens, component
  library)? Where are its colors/theme defined? (We'll be reskinning to black/crimson/white.)
- Component structure: is there a shared layout, nav/sidebar, reusable components? List the
  key shared components.
- How does admin auth work (briefly — login flow, where credentials/sessions live)?

## 6. Anything notable
Dead ends, half-built features, things that exist in the data model but have no UI, or UI
that has no backend. Anything that would surprise someone redesigning this.

Report all of this clearly. Change NOTHING. No commits.
