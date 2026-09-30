import { v4 as uuid } from "uuid";

export function generateTasks(employee) {
  const base = [
    ["EMPLOYEE", "Complete identity verification", "Upload your identity document and complete the automated identity checks.", "EMPLOYEE", "HIGH", "IDENTITY_VERIFICATION"],
    ["IT", "Create email account", "Create corporate email account.", "IT", "HIGH", "STANDARD"],
    ["IT", "Prepare laptop", "Assign laptop and install required software.", "IT", "HIGH", "STANDARD"],
    ["IT", "Configure system access", "Provision required applications and access.", "IT", "HIGH", "STANDARD"],
    ["FACILITIES", "Activate access card", "Create and activate building access card.", "FACILITIES", "CRITICAL", "STANDARD"],
    ["FACILITIES", "Allocate workspace", "Allocate desk/workspace.", "FACILITIES", "MEDIUM", "STANDARD"],
    ["MANAGER", "Assign mentor", "Assign a team mentor and initial project.", "MANAGER", "MEDIUM", "STANDARD"],
  ];

  const ids = base.map(() => uuid());
  return base.map((x, i) => ({
    id: ids[i],
    employeeId: employee.id,
    organizationId: employee.organizationId,
    department: x[0],
    name: x[1],
    description: x[2],
    assignedRole: x[3],
    priority: x[4],
    taskType: x[5],
    status: "PENDING",
    deadline: employee.joiningDate,
    dependencyId: i === 1 ? ids[0] : i === 2 ? ids[1] : null,
    mandatory: true,
    evidence: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
}

export async function readiness(db, employeeId) {
  const tasks = await db.collection("tasks").find({ employeeId, mandatory: { $ne: false } }).toArray();

  // Zero tasks means onboarding has not been configured. It must never be
  // interpreted as 0% ready or, worse, as READY.
  if (!tasks.length) {
    return { readiness: null, status: "NOT_CONFIGURED", blockers: [], configured: false, verified: 0, total: 0 };
  }

  const verified = tasks.filter((t) => t.status === "VERIFIED").length;
  const pct = Math.round((verified / tasks.length) * 100);
  const critical = tasks.filter((t) => ["CRITICAL", "HIGH"].includes(t.priority) && t.status !== "VERIFIED");
  const blockers = tasks.filter((t) => t.status !== "VERIFIED").map((t) => t.name);
  const status = pct === 100 && critical.length === 0 ? "READY" : critical.length ? "AT_RISK" : "IN_PROGRESS";
  return { readiness: pct, status, blockers, configured: true, verified, total: tasks.length };
}

export async function addNotification(db, userId, title, message, type = "INFO") {
  await db.collection("notifications").insertOne({
    id: uuid(), userId, title, message, type, read: false, createdAt: new Date().toISOString(),
  });
}

export async function audit(db, userId, action, details) {
  await db.collection("auditLogs").insertOne({
    id: uuid(), userId, action, details, createdAt: new Date().toISOString(),
  });
}

export async function recalculate(db, employeeId) {
  const emp = await db.collection("employees").findOne({ id: employeeId });
  if (!emp) return null;
  const r = await readiness(db, employeeId);
  await db.collection("employees").updateOne(
    { id: employeeId },
    { $set: { readiness: r.readiness, status: r.status, updatedAt: new Date().toISOString() } }
  );
  return { ...r, employee: { ...emp, readiness: r.readiness, status: r.status } };
}
