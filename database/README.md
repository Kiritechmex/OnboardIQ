# PostgreSQL/Supabase migration plan

The MVP uses `backend/src/data/store.json` to make the hackathon demo zero-setup.

For production, create PostgreSQL tables:

organizations
users
departments
employees
onboardings
tasks
task_dependencies
task_assignments
evidence
verification_results
risk_assessments
escalations
notifications
audit_logs
workflow_templates
workflow_rules

Every organization-owned row should contain `organization_id`.

Recommended production controls:
- PostgreSQL foreign keys
- indexes on organization_id, employee_id, status, deadline
- Supabase Row Level Security if using Supabase
- password/auth handled by Supabase Auth rather than storing passwords
