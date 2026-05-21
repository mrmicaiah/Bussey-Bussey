<script lang="ts">
  import Button from '../Button.svelte';
  let {
    clientCompanyName,
    opportunityName,
    onContinue,
  }: { clientCompanyName: string; opportunityName: string; onContinue: () => void } = $props();
</script>

<div class="surface welcome">
  <h1>Welcome, {clientCompanyName}.</h1>
  <p class="lede">
    Let's get <strong>{opportunityName}</strong> activated. This takes about
    5 minutes.
  </p>
  <ol class="preview">
    <li><strong>Secure your account.</strong> Set a permanent password.</li>
    <li><strong>Review &amp; sign the contract.</strong> Initial each section, sign at the end.</li>
    <li><strong>Set up payment.</strong> Add a card to cover setup and your monthly subscription.</li>
    <li><strong>Done.</strong> You'll get a receipt and we'll be in touch within 24 hours.</li>
  </ol>
  <div class="cta">
    <Button onclick={onContinue}>Get started</Button>
  </div>
</div>

<style>
  .welcome { display: flex; flex-direction: column; gap: var(--space-4); }
  .lede { font-size: 1.05rem; margin: 0; }
  .preview {
    margin: 0;
    padding-left: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    line-height: 1.5;
  }
  .preview li { padding-left: 0.25rem; }
  .cta { margin-top: var(--space-3); }
</style>
