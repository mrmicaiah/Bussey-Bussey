# Article H1 De-duplication — Worker Task

**PREREQUISITE.** This task assumes `prompts/article-layout-restructure.md` has already been executed and pushed to staging, and that staging is rendering correctly. Do not run this task until that one is verified live.

## Context

The article layout (`site/src/_includes/layouts/article.njk`) now renders the article title in the hero (`<h1 class="h1">{{ title }}</h1>`). However, the six article markdown bodies each still contain their own `# Title` heading at the top of the body content. The result is that every article currently renders its title twice — once in the styled hero, once in the body.

This task removes the duplicate H1 from each article body, leaving the styled hero as the single title surface.

## Files to edit

All under `site/src/articles/`:

1. `the-work-that-shouldnt-be-manual.md`
2. `automate-customer-service.md`
3. `business-process-automation-tools.md`
4. `business-process-automation.md`
5. `business-process-automation-software.md`
6. `workflow-automation-tools.md`

## The edit

For EACH file, locate the first `# ` heading in the markdown body (NOT in the frontmatter — the frontmatter `title:` field stays). It will be the first line of body content immediately after the frontmatter closes, possibly with a blank line above it.

**Remove that single H1 line and any blank line immediately following it.**

Leave everything else in the body — every H2 (`##`), every paragraph, every link, every blockquote, every list — exactly as it is. Do not edit, reorder, reword, or "clean up" anything else.

## Verification rules

For each file, after the edit:

- The frontmatter still has `title: "..."` matching the original.
- The first line of body content is **no longer** a `# Heading` — it's the first paragraph of the article.
- Every `##` (H2) section heading is still present.
- The total word count is approximately the original minus the H1 text only (5–15 words removed).

Spot-check at least two files by eye before committing. If a file does not match this pattern (e.g. it doesn't have a body H1, or it has multiple H1s), STOP and report — do not guess.

## Build and verify

Run the site build. Confirm:

- No build errors.
- Loading any article page (e.g. `/articles/automate-customer-service/`) shows the title ONCE — in the styled hero — followed directly by the article body opening paragraph.
- The `/articles/` index page still lists all six articles correctly.

## Commit, do not push

Commit all six file changes in a single commit with message:

```
Remove duplicate H1 from article bodies — title now rendered by layout hero only
```

Report back: the commit hash, list of files changed with the H1 text removed from each, and confirmation that the rendered pages show the title only once.

**DO NOT push to main.** Micaiah pushes manually after reviewing what the deploy would change.
