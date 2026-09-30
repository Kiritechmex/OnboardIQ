# OnboardX Phase 1–4 — Readiness Fixes

This additive patch fixes three Day-1 readiness consistency problems without replacing the working AI verification/remediation flows.

## 1. 100% readiness with unresolved blocker
- Readiness is now based on mandatory onboarding tasks.
- A READY state requires 100% mandatory completion, zero high/critical blockers, and enough remaining time.
- Optional tasks cannot create a contradiction with READY.

## 2. Zero tasks shown as ready
- Employees with no required onboarding tasks are now `NOT_CONFIGURED`.
- Readiness displays `N/A` instead of `0%`.
- The UI explains that readiness cannot be calculated until tasks are configured.
- The orchestration button is disabled until required tasks exist.

## 3. Duplicate employee records in the UI
- Read-only employee lists now collapse exact duplicates by normalized email (or name + joining date when no email exists).
- The canonical record is selected using task count and then latest update time, so the record containing the actual onboarding work is retained for display.
- New employee creation rejects an existing email in the same organization with HTTP 409.
- No existing database records are automatically deleted or destroyed.

## Validation
- Backend JavaScript syntax checks pass for the changed backend files.
- Frontend dependency installation/build could not be completed in the build environment because `npm install` timed out; the source changes are included for the existing local Vite setup.
