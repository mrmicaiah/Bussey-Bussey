/**
 * Contract template renderer.
 *
 * CONSTRAINT — DO NOT VIOLATE WITHOUT A SCOPE DISCUSSION
 * ======================================================
 * This renderer treats the contract template as PURE CONTENT + MARKERS.
 * The only things it is allowed to understand are:
 *
 *   - The variable-substitution syntax:  {{variable_name}}
 *   - The marker syntax:                 {{sig:label}}, {{print:label}},
 *                                        {{initial:label}}, {{date:label}}
 *   - HTML comment blocks (stripped as whole `<!-- ... -->` units).
 *
 * It does NOT — and must never — look at section names, section counts,
 * paragraph order, heading text, or any other content-structural feature
 * of the template. No "find section 8 to validate the term clause."
 * No "the renderer expects a 'Fees' heading." None of that.
 *
 * Why: the v0.1 template at /templates/contract/master.md is a starter
 * that will be replaced wholesale by a lawyer-finalized version. Any
 * content-aware coupling here forces a code change every time legal
 * rewords something, which defeats the drop-in property documented in
 * the template README and tracked in notes/deferred-cleanup.md.
 *
 * If you are tempted to introspect template content, route the need
 * through a new variable or marker instead.
 */

const HTML_COMMENT_BLOCK = /<!--[\s\S]*?-->/g;

// Variable form: {{name}} with no colon. Letters, digits, underscores,
// must start with a letter or underscore. Anything with a colon is a
// signature marker and is intentionally NOT matched.
const VARIABLE_PLACEHOLDER = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

export class ContractRenderError extends Error {
  constructor(
    message: string,
    public readonly code: 'missing_variable',
    public readonly variable?: string,
  ) {
    super(message);
    this.name = 'ContractRenderError';
  }
}

/**
 * Render a contract template by substituting `{{variable_name}}` placeholders
 * with values from `variables` and stripping HTML comment blocks. Signature
 * markers (`{{sig:...}}`, `{{print:...}}`, `{{initial:...}}`, `{{date:...}}`)
 * are intentionally left in place so the portal walkthrough renderer can
 * replace them with interactive components at signing time.
 *
 * Throws ContractRenderError if a `{{variable_name}}` appears in the template
 * but is missing from the variables map. Extra keys in the map are ignored.
 */
export function renderContract(
  template: string,
  variables: Readonly<Record<string, string>>,
): string {
  const withoutComments = template.replace(HTML_COMMENT_BLOCK, '');

  const rendered = withoutComments.replace(VARIABLE_PLACEHOLDER, (_match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(variables, name)) {
      throw new ContractRenderError(
        `Contract template references {{${name}}} but no value was supplied.`,
        'missing_variable',
        name,
      );
    }
    return variables[name] ?? '';
  });

  return rendered;
}
