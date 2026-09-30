# OnboardX - AI + Automation upgrade

This version adds:

- Gemini-powered AI Assistant through the backend only.
- Role-aware AI context (the model receives only data already permitted by the logged-in user).
- Optional Resend email delivery for invitations, email OTPs, reminders and escalations.
- Background automation worker for due/overdue tasks, dependency unlock notifications and identity-review tasks.
- Development fallback when AI/email API keys are not configured.

## Backend environment

Copy `.env.example` to `.env` inside `backend/` and configure:

```env
MONGODB_URI=...
MONGODB_DATABASE=onboardx
PORT=4000
WEB_ORIGIN=http://localhost:5173
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-flash-latest
RESEND_API_KEY=...
RESEND_FROM=OnboardX <onboarding@resend.dev>
AUTOMATION_INTERVAL_MS=60000
```

Keep API keys server-side. Do not put them in `frontend/.env` or any `VITE_` variable.

## Current AI behavior

When `GEMINI_API_KEY` is present, `/api/ai/chat` uses the Gemini Responses API. Without it, the app remains usable with a small local fallback and clearly labels the assistant as demo mode.

## Current email behavior

When `RESEND_API_KEY` is present, OnboardX sends real transactional emails through Resend. Without it, email actions are printed in the backend console and onboarding still works in development mode.

## Automation behavior

The worker runs periodically and can:

- Remind employees and task owners about tasks due today.
- Flag overdue tasks and send escalation notifications.
- Notify the owner when a task dependency becomes verified.
- Create an HR identity-review task when Aadhaar consistency verification needs review.
- Auto-close the identity-review task when identity verification later passes.


## AI task verification

Standard onboarding tasks can now be verified through `POST /api/tasks/:id/verify-ai`.
The verifier sends the task requirements, limited employee context, and submitted evidence to Gemini and expects structured `VERIFIED`, `FAILED`, or `BLOCKED` output. The result is stored on the task as `verification`.

This is intentionally evidence-first: Gemini does not get to invent source-system evidence. In production, the evidence field should be populated by real connectors (GitHub, Slack, Google Workspace, Jira, LMS, etc.) rather than free text.

## Prototype Aadhaar skip

The employee identity step now has **Skip Aadhaar for now**. Skipping records `SKIPPED`, sets the identity task to non-mandatory, and allows account creation without falsely marking the identity as verified. This is for the prototype/demo only.

## Autonomous AI Fix + Verification Reports

Tasks can now be diagnosed and remediated without changing the existing verification flow:

1. **AI Verify** collects source-system evidence and returns VERIFIED / FAILED / BLOCKED.
2. For FAILED/BLOCKED tasks, **AI Fix** asks the configured AI provider for a structured diagnosis and remediation plan.
3. OnboardX validates the proposed action against a server-side allowlist before executing it.
4. The connected demo source system is updated and queried again.
5. The task is marked VERIFIED only when the post-action source evidence confirms the success criteria.
6. A full **Verification Report** records the problem, AI diagnosis, remediation, post-action evidence, final status and audit trail.

The demo remediation connectors are intentionally simulated. Replace them with authorized APIs for production integrations. Aadhaar remains a separate employee flow and can still be skipped for the prototype.

## Phase 1–4: Day-1 Readiness Layer

This additive layer sits on top of the existing verification/remediation prototype. Existing task verification, AI verification, Aadhaar flow, login, MongoDB, Groq/Gemini provider switching, and remediation routes remain in place.

### Phase 1 — Readiness Engine
- Computes a separate Day-1 readiness score without overwriting the existing readiness field.
- Counts verified/unresolved work.
- Estimates remaining work time per task.
- Produces READY / AT_RISK / IN_PROGRESS state.

### Phase 2 — Deadline Awareness
- Treats the employee joining date as the Day-1 deadline.
- Uses 09:00 IST as the demo Day-1 start time.
- Calculates hours/minutes remaining.
- Detects overdue work and insufficient time to complete unresolved work.
- Highlights CRITICAL/HIGH blockers.

### Phase 3 — Autonomous Escalation
- Background orchestration runs alongside the existing automation worker.
- High/critical unresolved tasks close to Day-1 create a deduplicated escalation record.
- HR, Admin, and the responsible operational role receive in-app notifications.
- Escalations can be acknowledged from the Day-1 Control Center.

### Phase 4 — Dependency Graph
- Uses explicit task dependency IDs already present in the existing task model.
- Adds safe inferred relationships for common onboarding chains when an explicit dependency is absent.
- Shows which task is blocking another task.

### New API routes
- `GET /api/day1/overview`
- `GET /api/day1/:employeeId`
- `POST /api/day1/orchestrate`
- `POST /api/day1/:employeeId/orchestrate`
- `PATCH /api/day1/escalations/:id/ack`

Open **Risk & Escalation** after starting the app to see the new Day-1 Control Center.
