# Execution Hub — Final Developer Review Build

This package is the clean functional prototype prepared for developer review before production deployment.

## What is included

- Individual account and first-run administrator setup
- People & Departments organisational structure
- Department membership, designation and reporting relationships
- Project creation, project lead and project-specific team access
- Project categories/workstreams with category ownership
- Tasks, subtasks, priorities, deadlines, dependencies and comments
- Project lifecycle: planning, active, on hold, launched, terminated, archived and revival
- Project overview, pulse, task board, timeline, calendar, team/access and activity views
- Planner with task deadlines, work blocks, project meetings, RSVP and conflict checks
- Cross-team approval requests, review cycles, reminders and approval history
- Audit/activity records for key actions and changes
- Admin-only Performance & Growth views for company, individual, department, project lead and project evidence

## Clean first run

The final review build contains no seeded employees, email addresses, passwords, projects, departments, tasks, approvals or meetings.

There is no in-app registration or first-user Admin flow. The single System Admin is created manually in Firebase Authentication using `ashish@arpitatravels.com`. Only that exact authenticated email receives Admin access. The Admin creates employee Auth accounts from **People & Departments**.

## Firebase setup

The browser app is connected to the Firebase project configured in `firebase-bootstrap.js`:

- Firebase Authentication (Email/Password) signs in the one Admin and pre-created employee accounts.
- Firebase Realtime Database stores workspace data at `executionHub/workspaces/default/state` and employee authorization profiles at `executionHub/users/{uid}`.
- Passwords are managed only by Firebase Authentication. Temporary passwords exist only in the Admin's form memory during account creation; they are never added to a profile or app state.
- Employee profile `role` is fixed to `employee`; employee status must be `active` at sign-in. `inactive`, `resigned`, and `suspended` accounts are signed out.
- Employee accounts are created through a secondary Firebase Auth app to preserve the Admin's current session.
- The prior browser cache is scrubbed and removed on startup. If Firebase has no workspace data, the Admin's first successful sign-in can migrate existing local project/task/business data after stripping legacy password fields.

### Firebase Console / deployment steps

1. In **Authentication → Sign-in method**, enable Email/Password.
2. Manually create the sole Admin Auth account `ashish@arpitatravels.com`; do not register it from the app.
3. Install the Firebase CLI and run `firebase deploy --only database,functions` from this folder. The callable functions require the Blaze billing plan and deploy to `asia-southeast1`.
4. Serve `index.html` over HTTP (Five Server is fine); ES module imports do not work from `file://`.
5. Sign in as the Admin and create employees from People & Departments. Do not create test/production users during validation.

### Authorization boundaries

`database.rules.json` denies unauthenticated access, permits direct shared-state reads/writes only to the fixed Admin email, permits employees to read only their own profile, and permits only Admin profile writes. Employee app data is loaded/saved through `functions/index.js`: the callable functions verify the Firebase UID, employee profile, active status, project membership, ownership, and selected mutable fields before returning or merging workspace data. Employee saves cannot modify profile/role records or delete historical records.

This is stronger than UI-only gating, but privileged app logic still resides in Cloud Functions. Keep the Admin Auth account secured with MFA, monitor function/audit logs, and review the callable permission allowlists as workflows evolve. The callable state merge deliberately favors denying unsupported employee mutations; new workflow features must be added to the server validator, not just the browser UI. RTDB rules cannot provide strong per-record authorization for the existing shared JSON state by themselves.

For a clean reset, remove the workspace records and employee profiles in Realtime Database and remove test Auth users from Firebase Authentication. Clearing browser data does not clear cloud data.

## Important production requirement

Firebase Authentication manages passwords and sessions, and Realtime Database rules plus callable functions enforce the current access boundary. Review these functions before extending the workflow; do not rely solely on client-side roles.

Before live deployment, the developer should move the following to a trusted backend/database layer:

- Server-side authorisation / role and project-scope enforcement (implemented for the current callable workflow; expand the validators with any new mutations)
- Project membership and category-owner permissions (validated for current project/task operations)
- Immutable audit records and version history
- Approval records and approval versioning
- Department/employee history
- File storage and file versioning
- Calendar reminders and notification delivery
- Performance evidence calculations
- Backups and recovery

Recommended production pattern: private responsive web application + PostgreSQL database + managed authentication + object storage + server-side row/project access rules + background notification jobs.

## Source layout

- `index.html` — application shell
- `styles.css` — UI system and responsive styling
- `app.js` — core state, dashboard, projects, tasks and base interactions
- `firebase-bootstrap.js` — Firebase initialization, authentication adapter, Realtime Database sync, and classic-script startup loader
- `database.rules.json` — Admin-only shared-state writes and UID-scoped employee profile rules
- `functions/index.js` — Admin-only employee profile creation plus UID/status-validated, project-scoped workspace load/save callables
- `firebase.json` / `.firebaserc` — Firebase CLI deployment configuration
- `phase13.js` — account/project administration and access workflows
- `phase15.js` — Planner, meetings, work blocks and reminders
- `phase16.js` — cross-team approval workflows
- `phase17.js` — Admin-only Performance & Growth
- `phase18.js` — People & Departments organisational layer

The phase files reflect the prototype's iterative build history. For production maintainability, the developer should consolidate them into domain modules rather than preserving the phase naming convention.

## Core data model

### Organisation

Company → Department → Employee → Designation / Reporting relationship

### Execution

Project → Project Lead → Selected Project Members → Category/Workstream → Category Owner → Task → Subtask

### Collaboration

Task/Deliverable → Comments / Files / Approvals / Planner Events / Activity History

### Performance

Employee evidence + Department membership + Project lead evidence + Project delivery evidence → Admin-only Performance & Growth views

Department performance must be calculated from the work of employees who belong to that department for the relevant historical period. Project categories are not departments.

## Permission model

### Director/Admin

- Company-wide administration
- Create/manage/archive departments
- Create/deactivate/reactivate employee accounts
- Create projects and assign project leads
- Access all projects and project histories
- Access all approval records
- Access Performance & Growth
- Override project administration where required, with audit history

### Project Lead

Within projects they lead:

- Manage selected project members
- Create/manage categories and assign category owners
- Create/assign project tasks
- Manage project calendar/meetings
- Manage project lifecycle actions allowed by policy
- Review project activity and delivery state

The same employee may be Project Lead on one project and only a Project Member on another.

### Category Owner

Within categories they own:

- Create and manage tasks within that category
- Assign work to authorised project members
- Coordinate comments, dependencies and delivery

### Project Member

For projects to which they are explicitly added:

- View permitted project information
- Work on assigned tasks
- Create tasks under allowed workflow rules
- Add comments and updates
- Create personal work blocks
- Send and receive cross-team approval requests

Department membership alone does not grant project access.

## Audit/accountability rules for production

- Preserve original due date and every subsequent approved revision
- Preserve task/project ownership changes
- Preserve status and priority changes
- No normal user hard deletion
- Comments and files must retain version/history where edited or replaced
- Completed/approved versions must remain identifiable
- Approval of one version must not silently approve a later replacement version
- Deactivating an employee must never remove their historical activity
- Department/designation changes must be effective-dated rather than rewriting history

## Calendar/reminder behaviour

The prototype can display reminders while it is open. Production should use backend jobs/queues for reliable delivery when the browser is closed. At minimum support in-app reminders; email/push can be added according to deployment requirements.

## Final review focus

The developer should review the supplied build for workflow intent and UX, then replace the prototype persistence/security layer with production backend implementation while preserving the agreed workflow, permissions and audit semantics.
