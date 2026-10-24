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
2. Pipelines/Deals: first spike the policy dependency read-set and prove its
   fallback, then implement the migration and approval extensions below.
3. Lead qualification/conversion with matching, association and retry protection.
4. Activities/follow-ups and shared timelines. Notification email already exists;
   mailbox integration is separate scope, not implied by an email activity.
5. Retry-safe won-Deal → linked onboarding project from a scoped template;
   CRM starter configuration and a sales dashboard. Full Blueprint is deferred.

Preserve board views, approvals, revisions, private scopes, Trash, CSV, API,
automation, search and realtime. Extend the record compatibility suite per type.
Activity storage and detailed fields for each type still need their own specs.
Companies/Contacts is NOT ready to code: required/optional fields, normalization,
relationship constraints, validation, permissions and migration must first be
written and reviewed in its field-level specification.

## Pipeline decisions — proposed MVP contract

### Ownership, stages and concurrency

Each Deal board owns one pipeline. Each stage has category Open, Won or Lost;
multiple stages per category are allowed. New pipelines use these defaults:

| Order | Name        | Category | New Deal default |
| ----- | ----------- | -------- | ---------------- |
| 1     | New         | Open     | Yes              |
| 2     | Qualified   | Open     | No               |
| 3     | Proposal    | Open     | No               |
| 4     | Negotiation | Open     | No               |
| 5     | Won         | Won      | No               |
| 6     | Lost        | Lost     | No               |

Stage records use UUIDv7 IDs and stable board-local keys; labels can be renamed.
The name New avoids confusing an opportunity stage with the separate Lead type.
Every pipeline stores one default stage, which must be Open. A caller omitting
the stage gets that default. Changing/removing the default requires designating
another Open stage in the same transaction.

At least one stage per category must remain after creation, deletion and category
changes. Check and mutate in one serializable transaction with bounded retries;
use a common pipeline row lock for stage-configuration writers. Two concurrent
administrators must not remove the last valid category.

Stage-request creation, direct moves and approval application must take the same
pipeline lock as stage configuration and validate source/target existence in
that serializable transaction. Store Deal.stageId as a real foreign key with
RESTRICT on deletion; JSON proposal patches alone cannot enforce references.
Store requestKind (including DEAL_STAGE_CHANGE) on proposals. A raw SQL migration
adds a partial unique index on taskId WHERE status = PENDING AND requestKind =
DEAL_STAGE_CHANGE, plus checks requiring taskId for stage requests. Prisma schema
declarations alone do not express this partial index; document and test the SQL
constraint and map uniqueness failures to the existing-pending-request response.

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

### Existing Deal board migration — core contract

Activation is explicit per Deal board, with a manager-reviewed preview. Ordinary
Task/custom boards and their status columns are unaffected. Migration maps the
STATUS column's option IDs (the current Kanban lanes), not BoardGroup IDs or
labels, to new pipeline stage IDs. Groups remain independent organization.

- Preserve existing option names/order and stable legacy-ID aliases so saved
  views, filters, policies, automations and API/CSV references can be rewritten
  or resolved deterministically. Never guess categories from translated names.
- For known built-in option IDs, lead/qualified/proposal/negotiation map to Open,
  won maps to Won and lost maps to Lost. Preserve an existing Lead label for
  compatibility; renaming it is a separate manager choice. Other options require
  an explicit category in the preview. Add missing category stages from the
  defaults; existing custom configurations do not get silently replaced.
- The manager selects an Open default. The built-in lead stage is preselected
  where available; otherwise require selection or create the New default.
- Preview all live, archived and trashed Deals, null/unknown status references,
  pending drafts and affected saved configurations using bounded pages and full
  counts. A missing/orphan status requires an explicit assignment, or manager
  acceptance of a generated Unmapped/Open stage. No Deal is dropped; activation
  is blocked until mapping and configuration-reference validation are complete.
- Stage all backfill in bounded resumable batches under a versioned migration
  checkpoint. Serialize activation against board mutations, request submission,
  decisions and the worker. Freeze that board's writes during its final backfill
  and cutover, with a clear retryable migration response; reads use the old model
  until activation. Recheck the preview revision and mapping before cutover.
  Partial backfill is not an active pipeline. Retry uses the same mappings/IDs.
- At activation, atomically mark all still-Pending legacy proposals on that Deal
  board that lack the versioned dependency snapshot Stale, including create,
  update and archive requests. Notify permitted requesters once, invalidate
  reviewer queues and show Review and resubmit. Do not grandfather weaker checks
  or silently manufacture approval baselines. Preserve terminal request history.
- Preserve records, links, revisions/history, customer data and forecast dates.
  Do not infer actual closure from dueDate, updatedAt or the migration time.
  Existing Won/Lost Deals with no proven closure event have closed_at = null
  and closure-time-unknown metadata. Show them in an Undated legacy bucket for
  current-state reports; exclude them from dated transition totals. Record an
  explicit migration baseline, never a fabricated sale/closure transition.

Detailed schema/backfill/rollback scripts and compatibility tests are required
before shipping activation. Before activation, failed migration can discard
staged data and resume legacy reads/writes; after activation, rollback requires a
validated reverse migration, never a casual version downgrade.

### Pending requests and relevant changes

Keep the card in its last committed stage, with an indicator visible only to
people entitled to see that request. Reports use committed data. Enforce one
Pending stage request per Deal across UI, API and automation, with a database
constraint (not just a preflight query). Another drag opens the request for
participants; others see only "A stage change is already pending."

Store the intended patch separately from an approval dependency snapshot.
Dependencies include source stage/category, target stage/category, amount and
currency, owner, expected close date, explicit customer identity, and fields
read by the applicable policy. Store a policy version/snapshot and a schema
version for the dependency set. Compare canonical field values, not the whole
record revision. Ordinary title/note/contact edits do not stale a request only
when proven outside the exact or conservative dependency set described below. Renewal fields become dependencies if
used by the applicable policy.

Any accepted write changing a dependency marks matching Pending requests Stale
in the same transaction, including API/import/automation/approval writes. Draft
edits and rejected proposals have no effect. Changes to policy or access that
invalidate the request must also be handled. Mark before notifying; publish
scoped invalidations after commit. A worker reconciles expiry and missed access
changes in bounded batches. Opening/dragging/deciding performs a final validation
as a safeguard and offers "Review and resubmit" if stale. Resubmission creates a
new idempotency key and fresh snapshot; it never revives a terminal request.

### First pipeline spike: policy read-set

Before implementing the pipeline approval UX, build a small design/test spike
that enumerates every field a policy can read, including conditional branches,
source/target stage metadata and related-record values. Persist canonical
field/reference identifiers and dependency schema/policy versions per request.
Do not infer the read-set from the requested patch or only an executed branch.

If exact enumeration cannot be proved, persist the conservative superset of all
fields that that policy could read, together with mandatory domain dependencies.
Any accepted change in that set eagerly makes the request Stale. Under this
fallback, a title/note/contact edit may stale a request if the policy could read
it; make that explicit in request details. If even a complete superset cannot be
established, block activation of that policy for pipeline approvals. Never ship
an incomplete set or compensate with an unchecked approve-anyway action.

The spike must prove unrelated-edit preservation, relevant-edit invalidation,
conditional branches, related-record/access changes, atomic apply and policy
schema changes. Its reviewed result determines the slice's schema and ordering.

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

Expiry is a fixed proposed MVP duration, not a new installation setting. Owner
review of 30 days may run in parallel with the read-set spike; keep the duration
a named constant so changing it does not require redesigning request states.
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
and notifies the currently designated eligible reviewer, resolved inside the
transaction using current routing: primary if eligible and independent, otherwise
backup, otherwise no notification recipient. This is not a broadcast to every
manager or everyone who can open the queue. Invalidate all authorized cached
queue copies so former reviewers do not retain a pending item.
A manager's cancellation reason is visible to an active requester who still has
request access, in the resolved detail page. Use a public-safe reason code/text;
restricted dependency details belong only in a separately authorized audit entry,
never in requester-visible text or notification payloads.
Other terminal transitions remove/update the reviewer queue; a resolved detail page explains the reason. Deactivated/inaccessible
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
requiring an explicit user confirmation dialog and reason, plus applicable approval. Reopen
to any valid Open stage under the same policy path. A confirmation dialog only
submits the command; it does not grant approval. Committed state changes only
when a direct command is authorized or its approval is Applied.

Use distinct domain fields: `expected_close_date` (forecast date), `closed_at`
(actual closure timestamp), and immutable closure-event amount/currency snapshots.
Physical Prisma naming can follow repository camelCase conventions. Reopening
clears closed_at, preserves forecast/value, and records a reopen event. Entering
Won/Lost from another category sets closed_at; moving within the same closed
category preserves it and does not create another win/loss transition.
Explicitly: Won → Lost sets closed_at to the new commit time and records a Lost
transition; Lost → Won does the inverse. The earlier closure event is immutable.

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
valid. Self-link, cycle and depth-limit failures use the SAME restricted-
dependencies error code and generic message as hidden blockers, whether or not
the lineage is visible. Do not distinguish these cases in client/API payloads;
this prevents traversal errors from becoming an oracle for hidden lineage.
Keep diagnostic distinctions only in authorized internal logs. Serialize relevant lineage and
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

Review the pipeline proposals, listed default stages and 30-day expiry with the owner.
Complete the policy read-set spike first in the pipeline slice, then its detailed
Deal-board migration/backfill/rollback spec. Specify Activity storage, typed customer relations,
conversion matching and template scope in their respective slice specs.

Tests must cover default-stage assignment, legacy/custom/null/orphan mappings,
legacy Pending invalidation and resumable activation; raw SQL pending-stage
uniqueness; target deletion racing with request submission/direct moves/approval;
concurrent stage edits/approvers, unrelated versus relevant
edits, all terminal states, inactive requesters, hidden and archived/trashed
blockers, purge tombstones, private cyclic lineage, customer edits on either end,
policy-required reopen/Won↔Lost, September/October reporting, and replay safety.
Extend the full record compatibility suite for every new system type. Demonstrate
lead → customer/contact → Deal → follow-up → win → delivery project, without
leaking data or duplicating domain effects. Production readiness is a separate gate.
