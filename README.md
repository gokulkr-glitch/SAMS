# Student Achievement Management System (SAMS)

SAMS is a Google Apps Script web app backed by an existing Google Spreadsheet.
It provides a dashboard, a student directory, achievement submission and
verification, and a social-media task workflow for approved achievements.
The app uses the existing sheet tabs and headers; it does not create or
restructure sheets.

## Status update

Completed as of the current release:

- Dashboard overview with spreadsheet connection checks and aggregate counts.
- Student search and achievement history by name, StudentID, or roll number.
- Achievement submission workflow with evidence uploads and review states.
- Approval, rejection, and return-for-correction review flows.
- Automatic creation of one linked `Incoming` Social Media task after an achievement and its participants, evidence references, and audit record are saved.
- Safe, idempotent task retry when automatic task creation fails; the saved achievement is preserved and the failure is reported and audited when possible.
- Read-only achievement details on Social Media tasks, joined from the original achievement, participant, and student records.
- Administrator-only, read-only Activity Log with filters, newest-first bounded pagination, authenticated actor details, and explicit outcomes.
- Administrator deletion of any achievement and Mentor deletion of their own achievement, with linked-record handling, audit history retention, recovery attempts, and Drive evidence files retained.
- Local test coverage for the implemented student, achievement, and task flows.

Not included in the current release:

- External social-platform publishing integration.
- Email/notification automation.
- Batch 6 enhancements beyond the implemented workflow and safety checks.

## Current scope

The current project contains Batches 1–5.8.4 and the Students-page regression
repair. Batch 6 and external social-platform publishing are not implemented.

| Area | Implemented |
| --- | --- |
| Dashboard | Spreadsheet connection/schema diagnostic and aggregate counts for students, achievements, Pending reviews, social-media tasks, and Story assets. The browser receives counts and schema metadata, not complete spreadsheet records. |
| Students | Search active students by name, StudentID, or roll number; view achievement history. Administrators can delete any listed achievement; Mentors can delete only achievements they submitted. The server rechecks permissions. The Students page is available at `#students`. |
| Achievements | Submit Individual or Team achievements with participating students and 1–3 evidence files (at least one required). A certificate, a student achievement photo, or both are accepted; neither category is individually required. New submissions start as `Pending`; IDs and timestamps are generated on the server. |
| Reviews | Review Pending achievements with required notes: approve (`Verified`), reject (`Rejected`), or return for correction (`Returned`). A submitter cannot approve or reject their own submission unless they have an active Administrator role. |
| Social media | Receive an automatic `Incoming` task for each new achievement; task creation failures can be retried from the submission page. Managers can also create tasks manually for `Verified` achievements, search and filter the task list, inspect read-only joined achievement and participant details, and manage task-specific fields and workflow. Publication is manual. |
| Activity Log | Active Administrators can view human-readable audit events, filter and page through the log, and review achievement deletion outcomes. Historical entries are read-only. |
| Audit | Important achievement and social-media mutations are recorded in the existing `AuditLog` tab. |
| Notifications | Email and other notifications are not implemented. `Notifications.js` is a placeholder. |

The interface includes navigation for **Overview**, **Students**,
**Achievements**, **Reviews**, **Social media**, and the Administrator-only
**Activity Log**. Routes are `#overview`, `#students`, `#achievements`,
`#reviews`, `#social-media`, and `#activity-log`. Navigation visibility does
not grant permissions: server-side identity and role checks apply to protected
reads and every mutation.

## Project layout

| File | Responsibility |
| --- | --- |
| `Index.html` | App shell, sidebar navigation, page containers, forms, and task-board markup. |
| `Styles.html` | Shared visual design and page-specific styles. |
| `JavaScript.html` | Browser routing, rendering, validation feedback, and asynchronous Apps Script calls. |
| `Code.js` | HTML entry point, health check, and aggregate dashboard summary. |
| `Config.js` | Server-only spreadsheet ID, sheet names, and required headers. |
| `Sheets.js` | Spreadsheet access, header-based record mapping, schema diagnostics, and shared sheet helpers. |
| `Students.js` | Protected student search and achievement-history functions. |
| `Achievements.js` | Trusted-user lookup, role checks, achievement submission, review queue, and review decisions. |
| `Workflow.js` | Shared audit and append/rollback helpers used by workflow operations. |
| `ActivityLog.js` | Administrator-only audit queries, safe display formatting, pagination, and achievement deletion/recovery. |
| `SocialMedia.js` | Social-media task reads, eligibility checks, workflow transitions, authorization, and audit logging. |
| `Notifications.js` | Reserved placeholder; notifications are not active. |
| `appsscript.json` | Apps Script runtime, time zone, and web-app access/execute-as defaults. |
| `tests/` | Node.js tests using mocked Apps Script services. |
| `BATCH4_SETUP.md` | Additional deployment, identity, evidence-storage, and write-recovery notes for Batches 4–5. |

`Index.html` includes the `Styles.html` and `JavaScript.html` templates. All
spreadsheet access and privileged operations run in Apps Script, not in the
browser. The Apps Script project should be pushed with clasp from the project
root.

Activity Log timestamps are formatted in the Apps Script project time zone
(`Asia/Kolkata` in the current manifest). A deletion request is recorded before
the operation begins and has outcome `Recorded`; a separate final event reports
whether deletion succeeded or failed. Deletion removes the achievement,
participant/evidence/media references, and linked Social Media tasks without
publication history. It preserves any linked task with `PostURL`,
`PublishedAt`, `CompletedAt`, or `ScreenshotFileID`, and never deletes Drive
evidence files or AuditLog entries. Automatic task retry checks that the
achievement still exists before reusing or creating a task, preventing a
deleted achievement from being recreated. Entries are read-only in the
interface, returned newest first, and retrieved in bounded pages.

## Existing spreadsheet schema

The configured tabs and required headers are defined in `Config.js`. Keep
these headers and existing records intact; do not rename, reorder, or clear
tabs as part of deploying this application.

| Tab | Required headers |
| --- | --- |
| `Students` | `StudentID`, `Name`, `RollNumber`, `Grade`, `Section`, `Status` |
| `Achievements` | `AchievementID`, `Title`, `Category`, `CompetitionEvent`, `Result`, `Date`, `AcademicYear`, `Type`, `Status`, `Description`, `SubmittedBy`, `VerifiedBy`, `VerifiedAt`, `EvidenceFileID`, `CreatedAt`, `UpdatedAt` |
| `AchievementEvidence` (new required tab) | `EvidenceID`, `AchievementID`, `DriveFileID`, `FileType`, `DisplayFileName`, `UploadedBy`, `UploadedAt` |
| `AchievementParticipants` | `AchievementID`, `StudentID`, `RoleContribution` |
| `MediaAssets` | `AssetID`, `AchievementID`, `FileID`, `AssetType`, `PublicationApproved` |
| `SocialMediaTasks` | `TaskID`, `AchievementID`, `Platform`, `AssignedTo`, `Priority`, `Status`, `DueDate`, `CreatedAt`, `DesignFileID`, `Caption`, `PostURL`, `ScreenshotFileID`, `PublishedAt`, `CompletedAt`, `ReviewedBy`, `ReviewNotes` |
| `Users` | `UserID`, `Name`, `Email`, `Role`, `Active` |
| `AuditLog` | `LogID`, `UserID`, `ActorName`, `ActorEmail`, `ActionType`, `Action`, `Outcome`, `Details`, `EntityType`, `RecordID`, `CorrelationID`, `Timestamp` |

Rows are read and written by matching header names; code does not assume a
specific column order. The spreadsheet diagnostic reports missing tabs,
headers, or duplicate headers. Empty data tabs are supported when their
header rows exist.

**Manual Activity Log setup is required before pushing this version.** In the
existing `AuditLog` tab, preserve every existing row and header. The original
headers, in order, are:

```text
LogID, UserID, Action, RecordID, Timestamp
```

Append only missing columns, in this order:

```text
ActorName, ActorEmail, ActionType, Outcome, Details, EntityType, CorrelationID
```

The complete configured order is:

```text
LogID, UserID, ActorName, ActorEmail, ActionType, Action, Outcome, Details, EntityType, RecordID, CorrelationID, Timestamp
```

| Added header | Stored value |
| --- | --- |
| `ActorName` | Authenticated SAMS actor's display name. |
| `ActorEmail` | Authenticated SAMS actor's normalized email. |
| `ActionType` | Human-readable action category. |
| `Outcome` | `Successful`, `Failed`, `Denied`, or `Recorded`. |
| `Details` | Concise explanation or context for the event. |
| `EntityType` | Related record kind, such as Achievement or Social Media task. |
| `CorrelationID` | Related event/reference ID; defaults to the record reference when none is supplied. |

Existing data is mapped by header name; existing columns do not need
renaming or reordering, and historical rows do not need transformation.
Blank legacy values in added fields remain blank except that blank or unknown
outcomes display and filter as `Recorded`. Activity Log requests and audit
writes require all configured headers; partial migration is not supported.
Blank and duplicate header cells are rejected.

Safe manual migration plan (not executed by the application or in this task):

1. Make a backup copy of the existing `AuditLog` tab.
2. Record the current header row and historical data-row count.
3. Append only missing columns from the exact additional list above. Do not
   overwrite existing columns or historical records.
4. Verify all 12 required header names are present exactly once and compare
   the historical data-row count with the recorded count.
5. In development, verify legacy blank-outcome entries display/filter as
   `Recorded`, and verify a newly written audit event populates the new fields.

No live spreadsheet migration has been performed.

## Identity, roles, and deployment security

Protected functions obtain the current Google identity on the server with
`Session.getActiveUser().getEmail()`. They normalize email by trimming
whitespace and comparing case-insensitively, then require exactly one matching
active row in `Users`. Zero matches, multiple active matches, a missing Google
email, or a matching row without a `UserID` or `Role` are errors. `Active`
values accepted as active are `TRUE`, `Active`, `Yes`, `Y`, and `1` (case
insensitive, with whitespace trimmed).

The role names recognized by the current code are:

| Permission | Roles |
| --- | --- |
| Submit achievements and access the student directory/history | `Mentor` |
| Review achievements | `Verifier`, `Reviewer`, `Admin`, `Administrator` |
| Manage social-media tasks | `SocialMedia`, `Social Media`, `Communications`, `Admin`, `Administrator` |
| Potential proof-review roles | Social-media manager roles above, plus `Verifier` and `Reviewer`; proof review is currently disabled by the server guard |
| View the social-media task board | Any identity that resolves to one active SAMS user |

The `Users.Role` cell may contain one role or multiple comma-separated roles,
for example `Mentor, Administrator`. Each role is trimmed and compared
case-insensitively; unknown role names grant no permissions. Do not put user
identity or role in browser-submitted data as a source of authority. Server
functions recheck the current identity and roles for protected operations.

The checked-in Apps Script manifest specifies `DOMAIN` access and execution as
`USER_ACCESSING`. This manifest does **not** prove that a previously deployed
web app has those effective settings. Apps Script may withhold the accessing
user's email in some deployment contexts. Therefore, a successful spreadsheet
connection diagnostic does not prove that authentication is working.

Before using real submissions, reviews, or task mutations:

1. In Apps Script, open **Deploy → Manage deployments** and select the
   deployment used by SAMS. Confirm that it runs as **User accessing the web
   app** and is restricted to signed-in members of the intended Workspace
   domain. Do not enable anonymous access or run the app as the deploying
   owner for these workflows.
2. Confirm that Google provides the signed-in user's email in the deployed
   environment. The app must fail closed if it does not.
3. Give appropriate staff access to the existing spreadsheet and populate
   `Users` with each person's actual Google account email, a unique `UserID`,
   an authorized role, and an active value. Ensure the normalized email
   matches exactly one active Users row; resolve duplicate active matches in
   the sheet without changing its schema.
4. Test with separate mentor, verifier, social-media manager, and unauthorized
   accounts. Confirm the authorized operations work and unauthorized
   operations fail. Confirm the submitter cannot approve their own record.
5. Keep write workflows unavailable until these checks pass. A visible page or
   navigation link is not evidence that a user is authorized.

When identity cannot be verified, achievement submission/review and student
search are unavailable. Social-media mutations remain disabled; the interface
may display clearly labelled demonstration data, which is not written to the
spreadsheet. Do not work around this behavior by trusting a browser-provided
email or role or by installing a hard-coded administrator.

## Achievement workflow

### Submission

The submission form captures title, category, competition/event, result,
date, academic year, type, description, and participants. The server checks
required fields, valid calendar dates, consecutive `YYYY-YYYY` academic years,
type values, participant IDs, and duplicate participant IDs. `Individual`
requires exactly one active student; `Team` accepts multiple active students.
Student existence and active status are checked server-side.

The server generates a unique `AchievementID`, sets status to `Pending`, and
sets `SubmittedBy`, `CreatedAt`, and `UpdatedAt` using server-side values. It
writes an achievement row and participant-link rows using existing headers.
`LockService` serializes the sensitive write sequence and ID generation.

### Verification

Only `Pending` achievements can be reviewed. A verifier can approve, reject,
or return an item for correction; review notes are required and recorded in
the existing audit log. Approval sets status to `Verified`, `VerifiedBy`,
`VerifiedAt`, and `UpdatedAt` on the server. Rejection sets `Rejected`;
returning sets `Returned`. These decisions are final in the current app;
there is no correction/resubmission flow yet.

### Achievement evidence

Every new achievement submission requires at least one valid evidence file;
submissions may include up to 3. A certificate, a photo of the student
receiving or participating in the achievement, or both are acceptable, and
neither category is individually mandatory. Additional files are optional.
The application does not infer evidence categories from filenames. Supported
file types are PDF, JPEG, and PNG; each file is limited to 1 MiB and combined
decoded data to 3 MiB. Combined Base64 payload is capped at 4,200,000 characters. The
server validates each file's Base64 encoding, declared MIME type, size, and
signature before creating any Drive files. Invalid files reject the entire
submission. The browser's file checks are only for usability; server checks
are authoritative.

Before enabling submissions, create the `AchievementEvidence` tab in the
existing spreadsheet with exactly these headers in row 1:

`EvidenceID`, `AchievementID`, `DriveFileID`, `FileType`, `DisplayFileName`,
`UploadedBy`, `UploadedAt`

No tab or schema is created automatically. The sheet diagnostic reports this
new required tab; submissions fail safely until it exists and has the expected
headers. Do not rename or reorder existing tabs or alter existing records.

Configure `SAMS_PROOF_FOLDER_ID` in Apps Script **Project Settings → Script
Properties** with the administrator-approved restricted Drive folder ID.
Administrators must independently verify that the folder is restricted and
grant the Apps Script executing identity permission to add files. The server
reads the property only server-side, creates files only inside that folder,
does not change Drive sharing, and never returns Drive IDs to the browser.
It stores each file as a separate `AchievementEvidence` row. The first
uploaded file ID is also written to the legacy `Achievements.EvidenceFileID`
field for compatibility with existing single-file consumers; existing values
are not modified.

Uploads and Sheets writes cannot be one atomic transaction. SAMS holds the
script lock, creates files, then writes the achievement, participant,
evidence-link, and audit rows. On sheet-write failure it attempts to blank
identifiable new rows and trash all uploaded files. If rollback fails, files
are retained to avoid breaking a possibly saved reference. If Drive creates a
file but does not return a usable handle, cleanup may be impossible; inspect
the configured folder and execution history before retrying. A lost browser
response can also make retry status ambiguous; check the achievement queue
before resubmitting. There is no schema-backed idempotency key.

This evidence belongs only to achievement submissions. The Social media page
does not inspect or display publication-proof references and no Drive
preflight is present. Publication-proof review and social-media task completion
remain blocked by the server-side guard. No Drive setup enables those actions.

## Social-media task workflow

Tasks are created only on request and only for achievements whose status is
`Verified` when created manually. New achievement submissions also create an
`Incoming` task automatically after the achievement package is persisted.
Automatic task rows begin with no platform, assignee, priority, or due date;
Social Media managers can set those task-specific fields later. Retrying
automatic task creation checks for an existing task linked to that exact
achievement and will not create another task. The task board joins task data
to the original achievement, participant, and student records at read time;
achievement source fields are not copied or editable through task updates.
The UI includes task counts, text search, and status, platform, assignee, and
priority filters.

Supported statuses are:

`Incoming` → `In Design` → `Awaiting Approval` → `Ready to Publish` →
`Awaiting Publication Proof` → `Completed`

Other supported workflow statuses are `Needs Correction`, `On Hold`, and
`Cancelled`. The server enforces permitted transitions. Task managers can
assign tasks, set priority and due date, enter captions and design references,
submit work for approval, and record the manual post URL and publication time.
Design approval requires an authorized reviewer. Important mutations use a
script lock and are audited.

Task cards show the task ID, linked achievement ID and original title,
category, event, result, date, description, and participant details, as well
as task-specific assignment, caption, design-reference availability, post URL,
publication/completion times, and review details where present. Drive file
IDs are not sent to the browser.

Task creation is a separate step after the achievement, participants,
evidence references, and submission audit row have been successfully saved.
If task creation fails, the achievement remains saved, the submission response
explicitly reports that its task needs retry, and the app attempts to record
the failure in `AuditLog`. Use **Retry Social Media task creation** beside the
submission result to safely retry; the retry function reuses an existing
linked task rather than duplicating it. The Social Media task read/write
workflow uses the existing schema; no new sheet or headers are required.

Publication is manual: SAMS does not call Instagram or other external
publishing APIs. Publication-proof review and task completion are disabled in
the interface and rejected by the server; these actions cannot be enabled by
adding a file reference. The app does not require or inspect
`SAMS_PROOF_FOLDER_ID`. The existing schema has no field to remember a task's
pre-hold status, so a task resumed from `On Hold` resumes as `Incoming`.

## Write safety and data handling

Achievement, review, and task writes use `LockService` for relevant concurrent
operations. IDs are generated and checked server-side. Audit and workflow
records are mapped by header name. The Sheets service does not provide an
atomic transaction spanning multiple tabs; on a failed multi-tab write, the
server attempts to roll back the rows or fields it can identify and reports
rollback failures. If Apps Script reports a partial-write recovery error,
inspect the affected existing tabs and execution logs before retrying. The app
does not intentionally delete or shift existing records; rollback may leave
blank rows.

The browser receives only the fields required for the relevant page. Dashboard
summary values are aggregate counts. Spreadsheet IDs, private Drive IDs, and
full spreadsheet records are not sent as dashboard data. Treat Apps Script
execution logs and the spreadsheet as sensitive operational resources.

The Activity Log is accessible only to active users with an Administrator
role; the server checks this on every request. It returns up to 50 entries per
page and filters entries server-side. Actor identity is captured from the
authenticated SAMS user record. Historical log entries cannot be edited in
the UI. Achievement deletion is available to Administrators for any
achievement and to Mentors only for their own submissions; both cases are
enforced server-side. It removes linked participant, evidence-reference, and
media-asset rows, plus Social Media task rows without publication history.
Tasks with any populated `PostURL`, `PublishedAt`, `CompletedAt`, or
`ScreenshotFileID` field are preserved. AuditLog history and Drive evidence
files are never deleted. On multi-tab failure the server attempts to restore
removed rows and records the outcome. If recovery is incomplete, an
administrator must reconcile the named tabs using the deletion events and
execution logs before retrying. There is no separate reconciliation API;
automatic retry refuses to create a task after its achievement record has
been deleted.

## Local tests

Tests use Node.js built-in test tooling and mocked Apps Script services. From
PowerShell in the project directory:

```powershell
node --test tests\*.test.js
```

The suite covers spreadsheet header diagnostics, dashboard aggregates,
achievement submission without Drive configuration, submission validation,
identity matching, authorization and review transitions, task creation and
retry after task-write failure, participant/evidence persistence, task-board
achievement joins, source-field read-only enforcement, permitted task
updates, student search/history, task filtering, task transitions,
proof-review safeguards, Activity Log filtering and authorization, deletion
permissions, preservation of publication-history tasks, and partial deletion
recovery.

These tests mock Apps Script and Drive services. They do not verify live Google
authentication, the effective deployment's access settings, real spreadsheet
permissions/writes, Drive folder ACLs, or deployed uploads. Test the configured
restricted destination and a harmless sample manually in `/dev`.

## Push and retest

From PowerShell:

```powershell
Set-Location C:\Users\ADMIN\Desktop\SAMS
node --test tests\*.test.js
clasp.cmd status
clasp.cmd push
```

Review `clasp.cmd status` and confirm the linked Apps Script project is the
intended SAMS project before pushing. A push updates the Apps Script project
files but does not by itself update an existing deployed web-app version. In
**Deploy → Manage deployments**, edit the intended deployment, select the
new version, confirm its access and execute-as settings, and deploy it.

Retest using the existing `/dev` URL with the route fragment, for example:

* `.../dev#overview` — dashboard diagnostic and aggregate cards.
* `.../dev#students` — Students page, search, and history.
* `.../dev#achievements` — submit a harmless test achievement with one or more
  sample PDF/JPEG/PNG files (up to 3, each at most 1 MiB, 3 MiB total); verify
  it remains `Pending`, evidence rows link to it, and the files are in the
  restricted folder. Then try no files and an invalid file to confirm rejection.
* `.../dev#reviews` — review access state and queue.
* `.../dev#social-media` — task board, filters, and current write-access
  state.
* `.../dev#activity-log` — Administrator-only history, filters, pagination,
  and legacy outcomes.

Development-only manual checklist (do not use real achievement records for
destructive tests):

1. Verify the dashboard loads and reports the development spreadsheet schema.
2. Sign in as an authorized Mentor and submit a development achievement.
3. Test valid evidence: certificate-only, student-photo-only, and both kinds
   where applicable; verify the configured count and size limits.
4. Verify exactly one linked `Incoming` task is created; retry and confirm no
   duplicate task appears.
5. Verify the Mentor can delete their own achievement, cannot delete another
   user's, and an Administrator can delete either.
6. Verify tasks with each publication-history indicator (`PostURL`,
   `PublishedAt`, `CompletedAt`, `ScreenshotFileID`) remain after deletion;
   confirm unpublished linked tasks are handled and audited.
7. Confirm Drive evidence files and existing task AuditLog entries remain
   intact after deletion.
8. Verify an Administrator can open the Activity Log and a Mentor is denied,
   including a direct server call.
9. Verify a legacy blank outcome displays and filters as `Recorded`, not
   `Successful`.
10. Cause a safe development-only failure and verify failed, denied, and
    partial-recovery outcomes are accurate and logged.
11. Verify publication-proof upload and preview are unavailable, while proof
    review and proof-based completion remain rejected server-side.

Use test accounts and non-production records while verifying permissions.
Do not enable real writes until trusted identity and each role's access have
been verified in the deployed environment.
