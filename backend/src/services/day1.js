import { v4 as uuid } from "uuid";
import { addNotification, audit } from "./engine.js";

const IST = "+05:30";
const DEFAULT_ESTIMATES = {
  "identity verification": 20,
  "email account": 15,
  "laptop": 45,
  "system access": 30,
  "access card": 60,
  "workspace": 20,
  "mentor": 20,
  "identity review": 30,
};

function now() { return new Date().toISOString(); }
function startOfDay(value) { const d = new Date(value); d.setHours(0, 0, 0, 0); return d; }
function hoursUntilJoining(employee) {
  const raw = String(employee?.joiningDate || "").slice(0, 10);
  if (!raw) return null;
  // Day-1 starts at 09:00 IST for the demo. This is configurable per employee later.
  const joining = new Date(`${raw}T09:00:00${IST}`);
  return (joining.getTime() - Date.now()) / 3600000;
}
function estimateMinutes(task) {
  if (Number.isFinite(Number(task?.estimatedMinutes))) return Number(task.estimatedMinutes);
  const name = String(task?.name || "").toLowerCase();
  for (const [key, minutes] of Object.entries(DEFAULT_ESTIMATES)) if (name.includes(key)) return minutes;
  return 30;
}
function taskKey(task) { return String(task?.name || "").toLowerCase(); }
function autoFixAvailable(task) {
  const n = taskKey(task);
  return ["access card", "email account", "laptop", "system access", "workspace", "mentor"].some(k => n.includes(k));
}
function dependencyState(task, byId) {
  if (!task?.dependencyId) return { blocked: false, dependency: null };
  const dep = byId.get(task.dependencyId);
  if (!dep) return { blocked: true, dependency: { id: task.dependencyId, name: "Unknown dependency", status: "MISSING" } };
  return { blocked: dep.status !== "VERIFIED", dependency: { id: dep.id, name: dep.name, status: dep.status } };
}
function inferDependencies(tasks) {
  const list = [...tasks];
  const byName = new Map(list.map(t => [taskKey(t), t]));
  const get = needle => list.find(t => taskKey(t).includes(needle));
  const edges = [];
  for (const t of list) {
    if (t.dependencyId) {
      const dep = list.find(x => x.id === t.dependencyId);
      if (dep) edges.push({ from: dep.id, to: t.id, fromName: dep.name, toName: t.name, source: "explicit" });
      continue;
    }
    const n = taskKey(t);
    let dep = null;
    if (n.includes("system access")) dep = get("email account");
    else if (n.includes("laptop")) dep = get("email account");
    else if (n.includes("access card")) dep = get("workspace");
    else if (n.includes("workspace")) dep = get("identity verification");
    if (dep && dep.id !== t.id) edges.push({ from: dep.id, to: t.id, fromName: dep.name, toName: t.name, source: "inferred" });
  }
  return edges;
}

export async function buildDay1Snapshot(db, employeeId) {
  const employee = await db.collection("employees").findOne({ id: employeeId });
  if (!employee) return null;
  const tasks = await db.collection("tasks").find({ employeeId }).sort({ priority: -1, deadline: 1 }).toArray();
  const byId = new Map(tasks.map(t => [t.id, t]));
  const hours = hoursUntilJoining(employee);

  // Readiness is based on mandatory onboarding work. An employee with no tasks is
  // not considered ready; the system must explicitly say that readiness cannot
  // be calculated until onboarding tasks are configured.
  const mandatoryTasks = tasks.filter(t => t.mandatory !== false);
  const verifiedMandatory = mandatoryTasks.filter(t => t.status === "VERIFIED");
  const readinessScore = mandatoryTasks.length
    ? Math.round((verifiedMandatory.length / mandatoryTasks.length) * 100)
    : null;
  const enriched = tasks.map(task => {
    const dep = dependencyState(task, byId);
    const estimate = estimateMinutes(task);
    const unresolved = task.status !== "VERIFIED";
    const overdue = unresolved && task.deadline && startOfDay(task.deadline) < startOfDay();
    const dueWithin24h = unresolved && hours !== null && hours <= 24;
    const dependencyBlocked = unresolved && dep.blocked;
    const insufficientTime = unresolved && hours !== null && hours * 60 < estimate;
    let risk = "LOW";
    if (overdue || (task.priority === "CRITICAL" && unresolved)) risk = "CRITICAL";
    else if (dependencyBlocked || insufficientTime || (task.priority === "HIGH" && dueWithin24h)) risk = "HIGH";
    else if (dueWithin24h || unresolved) risk = "MEDIUM";
    return {
      ...task,
      estimateMinutes: estimate,
      hoursUntilJoining: hours,
      overdue,
      dueWithin24h,
      insufficientTime,
      dependencyBlocked,
      dependency: dep.dependency,
      autoFixAvailable: autoFixAvailable(task),
      risk,
      actionability: unresolved ? (autoFixAvailable(task) ? "AUTOFIX_OR_ESCALATE" : "ESCALATE") : "DONE",
    };
  });

  // Only mandatory unresolved work can block Day-1 readiness. Optional tasks
  // may remain open without contradicting a READY state.
  const blockers = enriched.filter(t => t.mandatory !== false && t.status !== "VERIFIED" && (t.risk === "CRITICAL" || t.risk === "HIGH" || t.dependencyBlocked));
  const unresolved = enriched.filter(t => t.mandatory !== false && t.status !== "VERIFIED");
  const estimatedWorkMinutes = unresolved.reduce((sum, t) => sum + t.estimateMinutes, 0);
  const availableMinutes = hours === null ? null : Math.max(0, Math.round(hours * 60));
  const capacityRatio = availableMinutes === null || estimatedWorkMinutes === 0 ? 1 : availableMinutes / estimatedWorkMinutes;
  const timeRisk = availableMinutes !== null && estimatedWorkMinutes > availableMinutes;
  const status = mandatoryTasks.length === 0
    ? "NOT_CONFIGURED"
    : (readinessScore === 100 && blockers.length === 0 && !timeRisk ? "READY" : (timeRisk || blockers.length ? "AT_RISK" : "IN_PROGRESS"));
  const dependencyEdges = inferDependencies(tasks);

  return {
    employee: {
      id: employee.id, name: employee.name, email: employee.email || employee.personalEmail,
      designation: employee.designation, department: employee.department, joiningDate: employee.joiningDate,
      status: employee.status, storedReadiness: employee.readiness ?? 0,
    },
    day1: {
      joiningAt: employee.joiningDate ? `${String(employee.joiningDate).slice(0, 10)}T09:00:00${IST}` : null,
      hoursUntilJoining: hours === null ? null : Math.round(hours * 10) / 10,
      availableMinutes,
      estimatedWorkMinutes,
      capacityRatio: Math.round(capacityRatio * 100) / 100,
      readinessScore,
      status,
      readinessConfigured: mandatoryTasks.length > 0,
      blockers: blockers.map(t => ({ id: t.id, name: t.name, priority: t.priority, risk: t.risk, reason: t.dependencyBlocked ? `Blocked by ${t.dependency?.name || "dependency"}` : t.overdue ? "Overdue" : t.insufficientTime ? "Estimated work exceeds time remaining" : "Unresolved before Day-1" })),
      unresolvedCount: unresolved.length,
      verifiedCount: verifiedMandatory.length,
      totalTasks: mandatoryTasks.length,
      optionalTaskCount: tasks.length - mandatoryTasks.length,
    },
    tasks: enriched,
    dependencies: dependencyEdges,
    generatedAt: now(),
  };
}

async function findRecipients(db, employee, task) {
  const roles = new Set(["HR", "ADMIN"]);
  if (task?.assignedRole) roles.add(task.assignedRole === "IT" || task.assignedRole === "FACILITIES" ? "FACULTY_IT" : task.assignedRole);
  return db.collection("users").find({ organizationId: employee.organizationId, role: { $in: [...roles] } }).toArray();
}

export async function runDay1Orchestration(db) {
  const employees = await db.collection("employees").find({}).toArray();
  let actions = 0;
  for (const employee of employees) {
    const snapshot = await buildDay1Snapshot(db, employee.id);
    if (!snapshot) continue;
    for (const task of snapshot.tasks.filter(t => t.status !== "VERIFIED" && (t.risk === "CRITICAL" || t.risk === "HIGH"))) {
      const hours = snapshot.day1.hoursUntilJoining;
      const threshold = task.risk === "CRITICAL" ? 48 : 24;
      if (hours !== null && hours > threshold) continue;
      const key = `day1-escalation:${task.id}:${new Date().toISOString().slice(0, 10)}:${task.risk}`;
      const existing = await db.collection("day1Escalations").findOne({ key });
      if (existing) continue;
      const reason = task.dependencyBlocked ? `Blocked by ${task.dependency?.name || "an unmet dependency"}.` : task.overdue ? "Task is overdue." : `Only ${Math.max(0, Math.round(hours * 10) / 10)} hours remain before Day-1.`;
      const escalation = { id: uuid(), key, employeeId: employee.id, taskId: task.id, level: task.risk === "CRITICAL" ? "CRITICAL" : "HIGH", reason, createdAt: now(), status: "OPEN" };
      await db.collection("day1Escalations").insertOne(escalation);
      const recipients = await findRecipients(db, employee, task);
      await Promise.all(recipients.map(user => addNotification(db, user.id, `Day-1 ${task.risk.toLowerCase()} risk`, `${employee.name}: ${task.name}. ${reason}`, "ESCALATION")));
      await audit(db, "SYSTEM", "DAY1_ESCALATION", `${employee.id}:${task.id}:${reason}`);
      actions++;
    }
  }
  return { employees: employees.length, actions };
}

export async function acknowledgeEscalation(db, id, userId) {
  const updated = await db.collection("day1Escalations").findOneAndUpdate({ id }, { $set: { status: "ACKNOWLEDGED", acknowledgedBy: userId, acknowledgedAt: now() } }, { returnDocument: "after" });
  return updated.value || updated;
}
