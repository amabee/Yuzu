# CRM MVP — planning draft

Status: planning only, 2026-10-24. Revised roadmap Phase 2 follows the shipped
record foundation (#32–#35). Deployment is deferred; Blueprint/App Builder comes
later. This document proposes scope for agreement, not implementation approval.

## Outcome

Connect a customer, their contacts, sales opportunities and follow-up activities
to delivery work without duplicating the existing record/permission engine.

## Proposed slices

1. **Companies and Contacts:** system record types on existing boards, validated
   company/contact relationships, customer details and related-record panels.
   Preserve revisions, approvals, private-project scopes, Trash, CSV, API,
   automation, saved views and search. Extend the compatibility matrix per type.
2. **Pipelines and Deals:** relational pipeline/stage definitions, valid stage
   membership, one deal owner, monetary values/currency and expected close date.
   Pipeline Kanban shows stage totals scoped to visible records. Specify how
   existing Deal boards migrate before changing their behavior.
3. **Lead workflow:** choose independent Lead records with explicit conversion,
   or Contact lifecycle stages. Define duplicate matching, association versus
   creation, authorization, approval handling, rollback and idempotency first.
4. **Activities and follow-ups:** calls, meetings, notes and email activity with
   permitted related records and shared timeline. Existing notification/digest
   email is not an inbound/outbound mailbox integration. Specify mailbox scope
   separately before implementing it.
5. **Sales-to-delivery handoff:** won Deal creates an onboarding project from a
   template, linked to the Company/Deal, with retry-safe automation. This is a
   scoped template feature; it does not introduce the full Blueprint engine.

Each slice should have its own reviewed spec, branch/PR and meaningful browser
coverage. Keep list queries bounded and publish scoped realtime invalidations.
Use existing Radix/shadcn components, theme tokens and the Yuzu design system.

## Decisions to settle before coding

- Lead model: independent convertible record or Contact lifecycle. Recommend a
  Contact lifecycle for a smaller first release unless separate lead permissions
  or qualification history require a dedicated type; the user has not chosen.
- Company–Contact cardinality, required fields, unique identifiers and treatment
  of shared addresses/domains. Avoid assuming email/domain is universally unique.
- Pipeline ownership by workspace/board, stage transitions, won/lost semantics,
  currency aggregation and compatibility for existing generic Deal boards.
- Whether activities are first-class board records or dedicated relational
  metadata linked to shared records; select based on permissions and integrity.
- Template scope and the minimum customer journey that defines the MVP exit.

## Acceptance gate

Demonstrate customer → contact → deal → follow-up → won deal → delivery project.
Include permission denial and hidden-reference cases, revision conflicts,
approval-required changes, retry/replay, Trash/restore and every new type in the
record compatibility suite. Make no production-readiness claim before the
separate release gate is complete.
