# demos

Hand-built static demos embedded into sales presentations.

## Quick start

```sh
# Copy the template into a new folder named after the opportunity's presentation_token
cp -R demos/_template demos/<presentation_token>
# Edit demos/<presentation_token>/index.html
```

Set `proposal.demo_enabled = true` in admin so the presentation includes the demo slide.

## Folder convention

One folder per opportunity, keyed by the opportunity's presentation token:

```
demos/
  [opportunity_token]/
    index.html
    assets/
    pages/
      dashboard.html
      settings.html
      ...
  _shared/
    css/
    js/
    partials/
```

The opportunity token is the same one that protects the presentation URL (`busseyandbussey.com/p/[opportunity_token]/`). Eleventy passthrough (or direct Pages serving) exposes each demo at `/p/[opportunity_token]/demo/`.

## Authoring

Demos are static HTML/CSS/JS, built by hand with Claude in IDE assistance. Pull common patterns from `_shared/` rather than re-implementing them.

## Lifecycle

- A demo belongs to an **opportunity**, not a proposal. Cloning a proposal *within the same opportunity* keeps the existing demo. Cloning an accepted proposal creates a new opportunity, which can have its own demo (or share via copy).
- Demos are not authenticated — the unguessable opportunity token is the only protection. Adequate for sales demos; do not put real client PII in a demo.

See `specs/06-workflow-presentation-and-disposition.md` § "Demo Folder Convention" for full guidance.
