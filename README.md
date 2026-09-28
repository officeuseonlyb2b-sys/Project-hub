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

On first launch the application asks for the initial Director/Admin account and first department. After setup, additional departments and employee logins can be created from **People & Departments**.

## Run locally

Open `index.html` in a modern browser. The prototype stores data in browser local storage.

For a clean reset during developer testing, clear the site's browser storage and reload the page.

## Important production requirement

This package is a functional workflow prototype and review build. It must **not** be treated as production security merely because permissions are represented in the UI.

Before live deployment, the developer should move the following to a trusted backend/database layer:

- Authentication and password hashing
- Authorisation / role and project-scope enforcement
- Project membership and category-owner permissions
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
