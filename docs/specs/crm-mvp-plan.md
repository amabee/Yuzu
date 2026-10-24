# CRM MVP — planning and pipeline specification

Status: review draft, 2026-10-24. This records confirmed product decisions,
proposed pipeline decisions, and verified implementation gaps. Pipeline proposals
require review before implementation. No CRM code is included in this change.
The revised roadmap places CRM in Phase 2; deployment is deferred and Builder is
later. This branch is based on the documentation in PR #37.

## Confirmed product decisions

- Support business and individual customers. A Company is optional.
- Lead is a separate system record: an unqualified potential customer/opportunity.
  Conversion is a validated domain operation, not a record-type switch. Associate
  existing Contacts/Companies or create missing ones; optionally create a Deal.
  Preserve history and enforce atomicity, authorization and retry idempotency.
  Suggest duplicate matches; never merge on name/email/domain alone.
- A Contact may relate to multiple Companies. Each relationship stores role/title,
  current/former status, and optional primary designation. At most one current
  relationship is primary; no primary is required. Company selection on a Deal
  is explicit, with suggestions rather than silent inheritance.

## Proposed delivery slices

1. Companies/Contacts and validated relationships; related-record panels.
2. Pipelines/Deals and the approval extensions defined below. Specify migration
   of existing generic Deal boards before changing behavior.
3. Lead qualification/conversion with matching, association and retry protection.
4. Activities/follow-ups and shared timelines. Notification email already exists;
   mailbox integration is separate scope, not implied by an email activity.
5. Retry-safe won-Deal → linked onboarding project from a scoped template;
   CRM starter configuration and a sales dashboard. Full Blueprint is deferred.

Preserve board views, approvals, revisions, private scopes, Trash, CSV, API,
automation, search and realtime. Extend the record compatibility suite per type.
Activity storage and detailed fields for each type still need their own specs.

## Pipeline decisions — proposed MVP contract

### Ownership, stages and concurrency

Each Deal board owns one pipeline. Each stage has category Open, Won or Lost;
multiple stages per category are allowed. Create pipelines with one of each.
At least one stage per category must remain after creation, deletion and category
changes. Check and mutate in one serializable transaction with bounded retries;
use a common pipeline row lock for stage-configuration writers. Two concurrent
administrators must not remove the last valid category.

Stages referenced by live, archived or trashed Deals, or Pending stage requests,
cannot be deleted or change category. Names/order may change without rewriting
closure history. Terminal requests keep immutable stage labels/categories for
history, rather than permanently preventing stage removal.

The blocker response is paginated and visibility-scoped. Show authorized records
with links to active, archived or Trash views and permitted pending requests.
Archived Deals must be restored before moving. Trashed Deals must be restored
and moved, or permanently erased by an administrator. Bulk reassignment is a
follow-up. Explain these recovery paths in the blocked-deletion UI.

Board management never grants access to another private board/project. If a
restricted dependency exists, say only: "Additional restricted dependencies
block this change. Ask an installation administrator to coordinate cleanup."
Do not reveal hidden names, IDs, counts or manager identities. Administrators
coordinate with authorized managers or use existing audited private-project
recovery; the blocker response does not grant recovery or access itself.
A permitted manager can cancel a blocking request without seeing private
request details, receiving only a generic confirmation and an audit entry.

### Pending requests and relevant changes

Keep the card in its last confirmed stage, with an indicator visible only to
people entitled to see that request. Reports use confirmed data. Enforce one
Pending stage request per Deal across UI, API and automation, with a database
constraint (not just a preflight query). Another drag opens the request for
participants; others see only "A stage change is already pending."

Store the intended patch separately from an approval dependency snapshot.
Dependencies include source stage/category, target stage/category, amount and
currency, owner, expected close date, explicit customer identity, and fields
read by the applicable policy. Store a policy version/snapshot and a schema
version for the dependency set. Compare canonical field values, not the whole
record revision. Ordinary title/note/contact edits do not stale a request unless
that field is explicitly a dependency. Renewal fields become dependencies if
used by the applicable policy.

Any accepted write changing a dependency marks matching Pending requests Stale
in the same transaction, including API/import/automation/approval writes. Draft
edits and rejected proposals have no effect. Changes to policy or access that
invalidate the request must also be handled. Mark before notifying; publish
scoped invalidations after commit. A worker reconciles expiry and missed access
changes in bounded batches. Opening/dragging/deciding performs a final validation
as a safeguard and offers "Review and resubmit" if stale. Resubmission creates a
new idempotency key and fresh snapshot; it never revives a terminal request.

### Request state machine and clearing blocked requests

Only Pending can transition; terminal records are immutable history.

| State       | Meaning                                                                        |
| ----------- | ------------------------------------------------------------------------------ |
| Pending     | Awaiting an eligible independent reviewer                                      |
| Applied     | Approved and patch committed atomically; use existing APPROVED storage mapping |
| Rejected    | Reviewer declined; reason recorded                                             |
| Stale       | Relevant values, policy or eligibility changed; review/resubmit required       |
| Withdrawn   | Requester cancelled before resolution                                          |
| Cancelled   | Authorized board manager cancelled, with a required reason                     |
| Invalidated | Deal/board/project deleted or requester deactivated; reason recorded           |
| Expired     | Pending for 30 days; create a fresh request if still needed                    |

Expiry is a fixed proposed MVP duration, not a new installation setting.
Deactivation invalidates requests eagerly in the account operation; large fan-out
requires a bounded reconciliation path. Every decision blocks a deactivated
requester immediately even before reconciliation. Deletion invalidates dependent
requests atomically; large-container reconciliation must never permit applying
against a deleted parent. Restore/reactivation does not revive terminal requests.

Requesters may withdraw; scoped board managers may cancel others' requests but
cannot approve their own or silently apply them. Stage cleanup must detect and
resolve already-invalid/expired requests before presenting pending blockers.

Applied, Rejected, Stale, Cancelled, Invalidated and Expired notify the requester
if still active and authorized. Withdrawal immediately confirms to its author
and notifies its reviewer. Other terminal transitions remove/update the reviewer
queue; a resolved detail page explains the reason. Deactivated/inaccessible
recipients get no content-bearing message. Invalidation is audited even when no
notification can be delivered. Email uses the same current visibility checks.

### Atomic approval and permissions

Approval rechecks both identities: requester is active, can access/edit the Deal,
and may perform the domain transition; reviewer is active, authorized by current
routing and independent of the requester. Recheck current policy, dependencies,
target validity, pipeline rules and expiration.

Within one transaction, claim Pending, validate dependencies, apply only the
requested patch to the latest record using a guarded current-revision write,
record closure/activity/outbox events, and resolve the request. Roll everything
back on conflict and retry within existing limits. Do not disable concurrency
checks to allow unrelated edits. A losing concurrent decision returns a stable
"Already resolved" result after re-reading; never apply twice or emit duplicates.

### Closing, reopening and reporting

Policies can explicitly match source AND target categories, including leaving
Won/Lost; this capability needs implementation. Allow Won ↔ Lost directly,
requiring an explicit confirmation and reason, plus applicable approval. Reopen
to any valid Open stage under the same policy path. Nothing changes until an
approval-required transition is confirmed.

Use distinct domain fields: `expected_close_date` (forecast date), `closed_at`
(actual closure timestamp), and immutable closure-event amount/currency snapshots.
Physical Prisma naming can follow repository camelCase conventions. Reopening
clears closed_at, preserves forecast/value, and records a reopen event. Entering
Won/Lost from another category sets closed_at; moving within the same closed
category preserves it and does not create another win/loss transition.

Current-state revenue reports include only currently Won Deals, using their
latest closed_at and current amount/currency. Historical transition reports use
immutable event times and amount/currency snapshots, include reopen events, and
label wins as transitions rather than unique sales. Do not sum different
currencies without an explicit conversion policy (separate currency totals in
MVP). Example: Won in September → reopened → Won in October yields one current
win attributed to October, plus two historical Won transitions (September and
October). These are different reports, not additive recognized revenue.

### Renewal lineage and customer changes

A renewal is a new Deal, never a cross-board move of the original. Use a single
explicit customer identity (Company or individual Contact); primary sales
contacts are separate. Renewal of is optional, permits multiple successors, and
requires the same customer on both Deals. Creating/changing a link requires
access to both records and edit permission on the changed record.

Validate self-links/cycles over the full lineage on the server, including hidden
records, in the transaction. Use bounded recursive traversal with cycle detection;
reject chains deeper than 100 renewal edges rather than assuming they are
valid. Errors never reveal hidden names or IDs. Serialize relevant lineage and
customer changes so simultaneous edge/customer updates cannot bypass validation.

Block customer changes that would invalidate incoming or outgoing renewal links.
Visible error: "Remove or update the affected Renewal of links first, then change
the customer." List only authorized affected Deals. Restricted blockers use the
generic escalation above; managers cannot edit hidden successor Deals indirectly.

Authorized source: normal link. Hidden source: "Private deal", no name/link.
Authorized source in Trash: "Deleted deal" with a Trash link only if the viewer
can access its Trash entry; otherwise a noninteractive generic placeholder.
After permanent purge, retain only a non-identifying "Deleted deal" tombstone,
without source ID/name/link. This requires domain lineage metadata: existing
RecordLink cascades alone cannot preserve it. Hide lineage placeholders too if
the containing Deal itself is unavailable.

## Existing approval engine — verified against source

| Assumption                | Current implementation                                                                                                         | CRM work needed                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Patch plus baseline       | BoardProposal stores changes, baseline, policySnapshot and sourceRevision; submitProposal persists them                        | Add explicit versioned approval dependency set beyond the changed fields                               |
| Unrelated edits survive   | approvalConflicts checks proposed fields; decideApproval applies the patch against the current record                          | Preserve this behavior while also checking policy/domain dependencies                                  |
| Relevant policy fields    | affectedFieldIds maps changed values; protectedFieldIds selects protected columns                                              | No persisted complete policy read-set or category predicates today; add both                           |
| Atomic decision           | serial uses Serializable with two conflict retries; finish conditionally updates Pending and returns PROPOSAL_CLOSED on repeat | No explicit proposal row lock today; retain safety and add scoped locks/constraint for CRM concurrency |
| Permission rechecks       | Current reviewer routing and requester board/edit access are checked at decision                                               | Add CRM domain-transition checks and dependency/expiry handling                                        |
| Lifecycle                 | PENDING, APPROVED, REJECTED, WITHDRAWN, STALE already exist; requester-only withdrawal                                         | Add Cancelled/Invalidated/Expired, manager cancellation, and consistent notifications/UI mappings      |
| Eager staleness           | Policy changes can mark requests Stale; ordinary field conflicts are checked at decision                                       | Central accepted-write invalidation and reconciliation/access hooks required                           |
| One pending stage request | Unique constraint is authorId + requestKey, not one per Deal                                                                   | Add database-enforced partial uniqueness for Pending stage operations                                  |
| Revision handling         | Comparison is field-based; apply uses the latest task in the serializable transaction                                          | Preserve guarded writes; never implement an unchecked revision bypass                                  |

Source anchors: server/approval-service.ts (decideApproval/configureApprovals),
server/approval-policy.ts (submitProposal), lib/approval-rules.ts
(approvalConflicts/affectedFieldIds), server/board-service.ts (serial/applyTaskRecord),
and packages/database/prisma/schema.prisma (BoardProposal/ProposalStatus).
These are verified source observations, not claims that proposed CRM behavior ships.

## Before coding and acceptance gate

Review the pipeline proposals, default stages and 30-day expiry with the owner.
Specify Deal board migration, Activity storage, typed customer relations,
conversion matching and template scope in their respective slice specs.

Tests must cover concurrent stage edits/approvers, unrelated versus relevant
edits, all terminal states, inactive requesters, hidden and archived/trashed
blockers, purge tombstones, private cyclic lineage, customer edits on either end,
policy-required reopen/Won↔Lost, September/October reporting, and replay safety.
Extend the full record compatibility suite for every new system type. Demonstrate
lead → customer/contact → Deal → follow-up → win → delivery project, without
leaking data or duplicating domain effects. Production readiness is a separate gate.
