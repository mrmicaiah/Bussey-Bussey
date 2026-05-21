<!--
  STARTER CONTRACT TEMPLATE — v0.1
  NOT FOR REAL CLIENT SIGNING WITHOUT LAWYER REVIEW.

  This template is structurally complete for system testing but contains
  placeholder language that has not been reviewed by counsel. Before any
  real client signs a contract generated from this template:

  1. Lawyer review of the entire document
  2. State-specific governing law selected
  3. Jurisdiction for disputes selected
  4. Termination data export language confirmed against actual capability
  5. Limitation of liability and warranty language reviewed for
     enforceability in target states
  6. Confidentiality carve-outs reviewed against actual data handling

  Tracked in notes/deferred-cleanup.md.

  Bussey-side execution is implicit: the platform serving this contract
  via the authenticated client portal constitutes Bussey and Bussey's
  execution. There is intentionally no Bussey signature block in this
  version. When the lawyer-finalized template lands, that decision can be
  revisited.
-->

# Master Service Agreement

This Master Service Agreement (the "**Agreement**") is entered into and
made effective as of {{effective_date}} (the "**Effective Date**") by and
between:

- **Bussey and Bussey** ("**Provider**"), and
- **{{client_legal_name}}**, with principal address at
  {{client_address}}, primary contact {{client_primary_contact}}
  ("**Client**").

Provider and Client are each a "**Party**" and together the "**Parties**."

---

## 1. Scope of Services

Provider will deliver the services described in the proposal titled
"**{{opportunity_name}}**" (Proposal ID `{{proposal_id}}`, accepted by
Client on {{proposal_accepted_at}}) (the "**Proposal**"), which is
incorporated by reference and is the authoritative description of scope.

The Proposal includes, without limitation, the following narrative
solution and key capabilities:

> {{proposal_narrative_solution}}

**Key capabilities:**

{{proposal_key_capabilities}}

In the event of any conflict between this Agreement and the Proposal
regarding scope, this Agreement controls; regarding the description of
deliverables, the Proposal controls.

## 2. Fees and Payment Terms

- **Setup fee:** {{setup_fee_total}}, due upon execution of this
  Agreement.
- **Monthly subscription:** {{monthly_fee_total}}, billed monthly in
  advance beginning on the activation date.
- **Payment method:** credit card via Stripe. Client authorizes Provider
  to charge the payment method on file according to the schedule above.
- **First monthly invoice:** issued on the activation date.
- **Taxes:** fees are exclusive of applicable taxes, which are Client's
  responsibility except for taxes imposed on Provider's net income.

Initial here: {{initial:section_3}}

## 3. Term and Termination

- **Initial term:** month-to-month, beginning on the activation date.
- **Termination for convenience:** either Party may terminate this
  Agreement upon thirty (30) days' prior written notice to the other
  Party.
- **Effect of termination:**
  - All outstanding fees accrued through the effective date of
    termination are due and payable.
  - Client data export will be available through the portal for sixty
    (60) days following the effective date of termination, after which
    Provider may delete Client data in accordance with its standard data
    retention practices.
  - Sections that by their nature should survive termination
    (Confidentiality, Intellectual Property, Limitation of Liability,
    Governing Law) shall survive.

Initial here: {{initial:section_4}}

## 4. Change Orders

The scope and pricing established by this Agreement and the Proposal may
be modified only by a written change order signed by both Parties. Change
orders signed electronically through the authenticated client portal
become part of this Agreement upon signature and supersede any
inconsistent prior terms with respect to the items they modify.

See the system's change-order mechanism (spec 09) for the operational
process by which change orders are proposed, reviewed, and executed.

Initial here: {{initial:section_5}}

## 5. Intellectual Property

- **Provider IP.** Provider retains all right, title, and interest in
  and to its platform, frameworks, reusable components, methodologies,
  templates, and any pre-existing or independently developed
  intellectual property used to deliver the services.
- **Client data.** As between the Parties, Client owns all data Client
  submits to the platform and any client-specific configurations
  created on Client's behalf.
- **License to Client.** Provider grants Client a non-exclusive,
  non-transferable, non-sublicensable license to access and use the
  platform solely for Client's internal business purposes during the
  term of this Agreement.

## 6. Confidentiality

Each Party may receive non-public business information from the other
Party in connection with this Agreement ("**Confidential Information**").
The receiving Party will (a) use Confidential Information solely to
perform under this Agreement and (b) protect it with the same degree of
care it uses for its own confidential information of similar nature, and
in no event less than reasonable care.

**Carve-outs.** Confidential Information does not include information
that: (i) is or becomes publicly available without breach of this
Agreement; (ii) was rightfully known to the receiving Party prior to
disclosure; (iii) is rightfully received from a third party without
confidentiality obligations; (iv) is independently developed without use
of or reference to the disclosing Party's Confidential Information; or
(v) is required to be disclosed by law, provided the receiving Party
gives the disclosing Party prompt notice where legally permitted.

## 7. Warranties and Limitations

THE SERVICES AND PLATFORM ARE PROVIDED "AS IS" AND PROVIDER MAKES NO
WARRANTIES, EXPRESS OR IMPLIED, INCLUDING ANY IMPLIED WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT.
Provider will use commercially reasonable efforts to deliver the
services described in the Proposal.

**Limitation of liability.** EXCEPT FOR EITHER PARTY'S BREACH OF
CONFIDENTIALITY OR INFRINGEMENT OF THE OTHER PARTY'S INTELLECTUAL
PROPERTY, EACH PARTY'S AGGREGATE LIABILITY ARISING OUT OF OR RELATED TO
THIS AGREEMENT WILL NOT EXCEED THE TOTAL FEES PAID BY CLIENT TO PROVIDER
IN THE TWELVE (12) MONTHS IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO
THE CLAIM. NEITHER PARTY WILL BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES.

**Force majeure.** Neither Party will be liable for any failure or delay
in performance to the extent caused by events beyond its reasonable
control, including acts of God, natural disasters, war, terrorism,
labor disputes, governmental action, and failures of public utilities
or networks not under that Party's control.

Initial here: {{initial:section_8}}

## 8. Governing Law and Disputes

- **Governing law.** This Agreement is governed by the laws of
  [STATE TO BE DETERMINED — TODO], without regard to its conflict of
  laws principles.
- **Disputes.** The Parties will first attempt in good faith to resolve
  any dispute arising out of or related to this Agreement through
  direct negotiation between authorized representatives. If unresolved
  within thirty (30) days, the Parties will proceed to non-binding
  mediation. If mediation does not resolve the dispute within sixty
  (60) days of its commencement, the dispute will be finally resolved by
  binding arbitration administered in [JURISDICTION TO BE DETERMINED —
  TODO] in accordance with the rules of a mutually agreed arbitral body.

## 9. Signatures

By signing below, Client agrees to be bound by the terms of this
Agreement as of the Effective Date.

**Client**

- Sign here: {{sig:client_name}}
- Print name: {{print:client_name}}
- Title: {{print:client_title}}
- Date: {{date:signed_at}}
