# Batch 4: Achievement submission and verification

## Status and review behavior

Achievements start as `Pending`. The existing history implementation already
uses `Verified` for approved achievements, so approval retains that value.
Review decisions set `Rejected` or `Returned` for rejection or correction.
Only `Pending` achievements can be reviewed; decisions are final in this batch.
Returned submissions do not have an edit/resubmit workflow yet.

Review notes are stored in the existing `AuditLog.Action` field with the
decision. No spreadsheet columns or tabs are added. The browser cannot set
submitter or verifier IDs; the server resolves the active Google account to
exactly one active `Users` row and uses its `UserID`.

The app recognizes `Mentor` as the submission role, and `Verifier`, `Reviewer`,
`Admin` or `Administrator` as review roles (case-insensitive). Use those role
values in the existing `Users.Role` column. A submitter cannot approve their
own submission. A `Users.Active` value of `TRUE`, `Active`, `Yes`, `Y` or `1`
is treated as active.

Identity lookup trims leading/trailing whitespace and compares email addresses
case-insensitively. It selects active records only: zero matches, a blank
Google email, and multiple active matches are separate errors. If the current
signed-in account is the intended one, its normalized email must appear in
exactly one active `Users` row with a nonblank `UserID` and `Role`. Inactive
duplicate rows do not count as active matches; duplicate active rows must be
resolved in the existing sheet without changing its structure.

## Authentication and deployment

The project manifest currently specifies a domain-restricted web app that
executes as the accessing user. This is a secure default for a Google Workspace
deployment, not proof that an existing deployed version uses those settings:
the Apps Script deployment listing available to this project exposes versions
but not execute-as or audience configuration. `Session.getActiveUser().getEmail()`
can be used when Google exposes the accessing Workspace user's identity; it may
be blank in contexts where Google withholds it. The deployed app must be tested
as the intended account. This project cannot reliably determine the effective
settings or actual email returned by a live deployment from the local manifest
alone.

Before enabling real submissions or reviews:

1. In Apps Script, open **Deploy > Manage deployments** and edit the deployment
   used by SAMS. Select a new version, set **Execute as** to **User accessing
   the web app**, and restrict **Who has access** to signed-in members of the
   intended Workspace domain. Do not select anonymous access or execute as the
   deploying owner.
2. If the application is not intended for a Workspace domain, change the
   manifest `webapp.access` to the narrowest supported audience for the
   organization and verify that `Session.getActiveUser().getEmail()` returns
   the accessing user's email. The server denies all privileged operations when
   Google does not provide an identity.
3. Give each mentor/verifier access to the spreadsheet and authorize the Apps
   Script scopes requested by Google. Populate `Users` with each person's
   actual email, unique `UserID`, exact role and active status. Do not use a
   shared or hard-coded administrator account.
4. Open the deployed web app separately as a mentor, verifier, administrator,
and unauthorized signed-in account. Confirm the mentor can submit, a
different verifier can review, non-administrator submitters cannot approve
or reject their own item, an administrator can decide their own item, and unauthorized
   accounts are denied. Keep the deployment disabled for real records if these
   checks fail.

Do not infer that existing deployment URLs use the manifest settings. Edit and
verify the intended deployment before using it with real submissions.

## Achievement evidence and publication proof

Every new achievement requires at least one PDF, JPEG, or PNG evidence file and
allows up to 3. A certificate, a photo of the student receiving or participating
in the achievement, or both are acceptable; neither evidence category is
individually mandatory, and additional files are optional. Evidence categories
are not inferred from filenames. Each file is limited to 1 MiB, with 3 MiB
combined decoded data and a 4,200,000-character combined Base64 payload limit.
Create the `AchievementEvidence` spreadsheet tab
with headers `EvidenceID`, `AchievementID`, `DriveFileID`, `FileType`,
`DisplayFileName`, `UploadedBy`, and `UploadedAt`. Configure the administrator-
approved restricted folder as Script Property `SAMS_PROOF_FOLDER_ID`. The
server validates uploads and writes a separate evidence-link row per file; the
first Drive ID is also written to the legacy `Achievements.EvidenceFileID`
field. Existing values are not changed.

Drive ACLs must be reviewed manually. Files and sheet writes are not atomic;
the app attempts row rollback and trashes newly uploaded files on failure.
If rollback cannot be confirmed, uploaded files are retained for manual
reconciliation. Local tests mock Drive and do not verify deployed permissions.

The Social media page does not display or inspect `ScreenshotFileID`.
Publication-proof review and task completion remain blocked by the server-side
fail-closed guard; achievement evidence cannot be used to enable them.

## Write safety

Submission and review mutations use `LockService.getScriptLock()` to serialize
SAMS writes. IDs are generated server-side and checked for collision while the
lock is held. Rows are mapped to the actual header names, not fixed column
numbers. Achievements, participants, and audit entries are written as separate
sheet operations; Apps Script does not provide a multi-tab transaction here.
If a write fails, the server attempts to blank only rows it can identify by the
new record ID, and restores the previous review fields. It reports any rollback
failure instead of returning success. Inspect the affected tabs and execution
logs if a partial-write recovery error is reported. Blank recovery rows are
retained rather than deleting or shifting existing records.

## Push and test

From PowerShell:

```powershell
Set-Location C:\Users\ADMIN\Desktop\SAMS
clasp.cmd status
node --test tests\*.test.js
clasp.cmd push
```

Review the `clasp.cmd status` output and confirm the linked script is the
intended SAMS project before pushing. After the push, open Apps Script **Deploy
> Manage deployments**, edit the intended web-app deployment, select the new
version, confirm its execute-as/audience settings above, and deploy. Use only
the updated deployment URL for browser testing. For an un-deployed project,
create a web-app deployment with the same restricted settings instead of
updating an existing deployment.

The local automated suite uses mocked Sheets, identity, locks, and UUID
generation. It cannot verify Google authentication behavior, deployed
permissions, actual spreadsheet writes, or Drive configuration; perform the
signed-in deployment checks above before production use.

## Batch 5: Social media task management

Social media task operations use the existing `SocialMediaTasks` headers and
append audit events to the existing `AuditLog`. Tasks are created manually;
only `Verified` achievements are eligible, and a duplicate achievement/platform
pair is rejected. The task board joins approved achievement details at read
time and does not modify achievement rows. The supported task statuses are
`Incoming`, `In Design`, `Awaiting Approval`, `Ready to Publish`, `Awaiting
Publication Proof`, `Completed`, `Needs Correction`, `On Hold`, and `Cancelled`.

Task management mutations require an active Google identity mapped to a unique
active `Users` record whose role is `SocialMedia`, `Social Media`,
`Communications`, `Admin`, or `Administrator`. These checks are performed on
every server mutation. Other active SAMS users can
view the task board without edit actions. When identity cannot be verified,
the UI shows clearly labelled sample data and disables all task mutations;
sample data is never sent to or saved in Sheets.

Manual publication changes `Ready to Publish` to `Awaiting Publication Proof`.
Publication-proof review and task completion remain disabled and are rejected
by the server. There is no Drive preflight or dependency on a configured proof
folder. Existing `ScreenshotFileID` values are left untouched; they do not
enable review or completion.

Task status transitions are enforced server-side. Tasks put On Hold can only
resume as `Incoming`, because the existing schema has no column to retain a
previous status. Publication actions are manual; no social platform API is
called. As with other multi-sheet writes, task mutation and audit writes are
not a spreadsheet transaction: the server attempts to roll back identifiable
changes and reports recovery failures. Review execution logs and affected rows
if a partial-write recovery error is reported.

Run the full local test suite and push from PowerShell:

```powershell
Set-Location C:\Users\ADMIN\Desktop\SAMS
node --test tests\*.test.js
clasp.cmd status
clasp.cmd push
```

Confirm the clasp target before pushing. After push, deploy a new web-app
version with the verified Workspace access settings described above.
