// Module declarations for non-TS files imported as text by the Worker bundler.
//
// Bundling is configured in worker/wrangler.toml under `[[rules]]` with
// `type = "Text"` for *.md, which makes esbuild emit the file's contents as
// the default export. The matching declaration here lets the TypeScript
// compiler accept those imports.
//
// This is how we bring `/templates/contract/master.md` into the activation
// service while keeping the template itself drop-in replaceable from outside
// the worker package — see notes/deferred-cleanup.md and
// templates/contract/README.md.

declare module '*.md' {
  const content: string;
  export default content;
}
