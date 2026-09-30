import { v4 as uuid } from "uuid";
import { addNotification } from "./engine.js";
import { sendEmail } from "./email.js";
import { verifyTaskWithAI, collectTaskEvidence, aiConfigured } from "./ai.js";

function now() { return new Date().toISOString(); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function dayStart(value = new Date()) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}
function userQueryForRole(role, organizationId) {
  if (role === "EMPLOYEE") return { role: "EMPLOYEE", organizationId };
  if (role === "FACULTY_IT") return { role: { $in: ["FACULTY_IT", "IT", "FACILITIES"] }, organizationId };
  return { role, organizationId };
}

async function eventOnce(db, key) {
  const existing = await db.collection("automationEvents").findOne({ key });
  if (existing) return false;
  await db.collection("automationEvents").insertOne({ id: uuid(), key, createdAt: now() });
  return true;
}

async function notifyAndEmail({ db, user, title, message, type = "INFO", subject, html, dedupeKey }) {
  if (dedupeKey && !(await eventOnce(db, dedupeKey))) return false;
  if (user?.id) await addNotification(db, user.id, title, message, type);
  if (user?.email) {
    await sendEmail({
      to: user.email,
      subject: subject || title,
      text: message,
      html: html || `<p>${message}</p>`,
    }).catch(error => console.error("[OnboardX email automation]", error.message));
  }
  return true;
}

async function ensureReviewTask(db, employee) {
  const status = employee.identityVerificationStatus;
  const existing = await db.collection("tasks").findOne({ employeeId: employee.id, taskType: "IDENTITY_REVIEW" });
  if (status === "NEEDS_REVIEW") {
    if (existing?.status === "VERIFIED") return existing;
    if (!existing) {
      const task = {
        id: uuid(),
        employeeId: employee.id,
        organizationId: employee.organizationId,
        department: "HR",
        name: "Review identity verification",
        description: "Review the automated Aadhaar consistency result and resolve the verification exception.",
        assignedRole: "HR",
        priority: "HIGH",
        taskType: "IDENTITY_REVIEW",
        status: "PENDING",
        deadline: employee.joiningDate,
        dependencyId: null,
        mandatory: true,
        evidence: "",
        automationKey: `identity-review:${employee.id}`,
        createdAt: now(),
        updatedAt: now(),
      };
      await db.collection("tasks").insertOne(task);
      return task;
    }
  }
  if (status === "VERIFIED" && existing && existing.status !== "VERIFIED") {
    await db.collection("tasks").updateOne({ id: existing.id }, { $set: { status: "VERIFIED", evidence: "Auto-closed because identity verification passed.", updatedAt: now() } });
    return { ...existing, status: "VERIFIED" };
  }
  return existing;
}

export async function runAutomations(db) {
  const employees = await db.collection("employees").find({}).toArray();
  let actions = 0;
  const today = dayStart();

  for (const employee of employees) {
    await ensureReviewTask(db, employee);

    const tasks = await db.collection("tasks").find({ employeeId: employee.id }).toArray();
    const orgId = employee.organizationId;

    // Autonomous evidence verification. A checkbox/COMPLETED state is only a
    // claim. The worker asks a source-system adapter for evidence and then
    // sends that evidence to Gemini. No operator prompt is required.
    if (aiConfigured()) {
      for (const task of tasks.filter(t => ["PENDING", "COMPLETED"].includes(t.status) && !t.verification && t.taskType !== "IDENTITY_VERIFICATION" && t.taskType !== "IDENTITY_REVIEW")) {
        const collected = await collectTaskEvidence({ task, employee }).catch(error => {
          console.error("[OnboardX evidence collector]", error.message);
          return null;
        });
        const evidence = String(task.evidence || "").trim() || (collected ? JSON.stringify(collected) : "");
        if (evidence.length < 10) continue;
        const result = await verifyTaskWithAI({ task, employee, evidence }).catch(error => {
          console.error("[OnboardX AI verification]", error.message);
          return null;
        });
        if (result) {
          await db.collection("tasks").updateOne({ id: task.id }, {
            $set: {
              status: result.status,
              evidence,
              verification: { ...result, checkedAt: now(), automated: true, evidenceSource: collected?.source || "USER_SUPPLIED" },
              updatedAt: now(),
            }
          });
          actions++;
          // Keep free-tier providers below burst/rate limits when several tasks are checked together.
          await sleep(1500);
        }
      }
    }
    const employeeUser = await db.collection("users").findOne({ employeeId: employee.id, organizationId: orgId });
    const roleUsers = new Map();

    for (const task of tasks) {
      if (task.status === "VERIFIED") continue;

      const deadline = task.deadline ? dayStart(task.deadline) : null;
      const overdue = deadline && deadline < today;
      const dueSoon = deadline && deadline.getTime() === today.getTime();
      if (overdue || dueSoon) {
        const urgency = overdue ? "overdue" : "due today";
        const message = `${task.name} for ${employee.name} is ${urgency}. OnboardX has flagged it for attention.`;
        if (employeeUser) {
          const key = `task-reminder:${task.id}:${today.toISOString().slice(0, 10)}:${overdue ? "overdue" : "due"}:employee`;
          if (await notifyAndEmail({ db, user: employeeUser, title: overdue ? "Onboarding task overdue" : "Onboarding task due today", message, type: overdue ? "ESCALATION" : "REMINDER", dedupeKey: key })) actions++;
        }
        const assignedRole = task.assignedRole === "FACILITIES" || task.assignedRole === "IT" ? "FACULTY_IT" : task.assignedRole;
        if (!roleUsers.has(assignedRole)) {
          const users = await db.collection("users").find(userQueryForRole(assignedRole, orgId)).toArray();
          roleUsers.set(assignedRole, users);
        }
        for (const user of roleUsers.get(assignedRole) || []) {
          const key = `task-reminder:${task.id}:${today.toISOString().slice(0, 10)}:${overdue ? "overdue" : "due"}:${user.id}`;
          if (await notifyAndEmail({ db, user, title: overdue ? "Task overdue" : "Task due today", message, type: overdue ? "ESCALATION" : "REMINDER", dedupeKey: key })) actions++;
        }
      }
    }

    for (const task of tasks.filter(t => t.status === "VERIFIED" && t.dependencyId)) {
      const dependents = tasks.filter(t => t.dependencyId === task.id && t.status !== "VERIFIED");
      for (const dependent of dependents) {
        const assignedRole = dependent.assignedRole === "FACILITIES" || dependent.assignedRole === "IT" ? "FACULTY_IT" : dependent.assignedRole;
        const users = await db.collection("users").find(userQueryForRole(assignedRole, orgId)).toArray();
        for (const user of users) {
          const key = `dependency-cleared:${dependent.id}:${task.id}:${user.id}`;
          const message = `${task.name} for ${employee.name} is verified. ${dependent.name} can now be actioned.`;
          if (await notifyAndEmail({ db, user, title: "Next onboarding task unlocked", message, type: "INFO", dedupeKey: key })) actions++;
        }
      }
    }

    const reviewTask = await db.collection("tasks").findOne({ employeeId: employee.id, taskType: "IDENTITY_REVIEW", status: "PENDING" });
    if (reviewTask) {
      const hrUsers = await db.collection("users").find({ organizationId: orgId, role: { $in: ["HR", "ADMIN"] } }).toArray();
      for (const user of hrUsers) {
        const key = `identity-review:${employee.id}:${user.id}`;
        const message = `Automated identity verification for ${employee.name} needs human review before account creation can complete.`;
        if (await notifyAndEmail({ db, user, title: "Identity review required", message, type: "ESCALATION", dedupeKey: key })) actions++;
      }
    }
  }

  return { employees: employees.length, actions };
}
