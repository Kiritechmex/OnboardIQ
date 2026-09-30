import { v4 as uuid } from "uuid";
import { collectTaskEvidence } from "./ai.js";

function now() { return new Date().toISOString(); }

function supportedActionForTask(task) {
  const name = String(task?.name || "").toLowerCase();
  if (name.includes("access card")) return "CREATE_ACCESS_CARD";
  if (name.includes("email account")) return "CREATE_EMAIL_ACCOUNT";
  if (name.includes("laptop")) return "ASSIGN_LAPTOP";
  if (name.includes("system access")) return "PROVISION_SYSTEM_ACCESS";
  if (name.includes("workspace")) return "ALLOCATE_WORKSPACE";
  if (name.includes("mentor")) return "ASSIGN_MENTOR";
  return null;
}

export function remediationCapability(task) {
  const action = supportedActionForTask(task);
  return {
    available: Boolean(action),
    action,
    label: action ? action.replaceAll("_", " ").toLowerCase() : null,
  };
}

export async function executeRemediation({ db, task, employee, plan }) {
  const expectedAction = supportedActionForTask(task);
  if (!expectedAction) {
    return {
      executed: false,
      action: null,
      message: "No safe automated remediation is configured for this task. It can be escalated to the assigned team.",
      sourceSystem: "OnboardX policy engine",
    };
  }

  if (plan?.action && plan.action !== expectedAction) {
    return {
      executed: false,
      action: plan.action,
      message: `AI proposed ${plan.action}, but OnboardX policy only permits ${expectedAction} for this task. No action was executed.`,
      sourceSystem: "OnboardX policy engine",
      policyBlocked: true,
    };
  }

  const state = {
    id: uuid(),
    employeeId: employee.id,
    taskId: task.id,
    action: expectedAction,
    executedAt: now(),
    status: "COMPLETED",
    actor: "OnboardX Automation",
    plan: plan || null,
  };
  await db.collection("demoRemediationEvents").insertOne(state);

  // The demo source-system adapters read this collection after a remediation.
  // In production, these branches become real API calls to the corresponding
  // source systems (IdP, ITAM, facilities, badge system, etc.).
  const patch = { updatedAt: now() };
  if (expectedAction === "CREATE_ACCESS_CARD") {
    patch.demoAccessCard = { cardRecordFound: true, activated: true, cardId: `CARD-${String(employee.id).slice(-6).toUpperCase()}` };
  } else if (expectedAction === "CREATE_EMAIL_ACCOUNT") {
    patch.demoEmailAccount = { accountExists: true, active: true, account: `${String(employee.name || "employee").toLowerCase().replace(/\s+/g, ".")}@demo.com` };
  } else if (expectedAction === "ASSIGN_LAPTOP") {
    patch.demoLaptop = { assetAssigned: true, assetId: `LAP-${String(employee.id).slice(-4).toUpperCase()}`, softwareProfile: "CSE-Standard", softwareInstalled: true };
  } else if (expectedAction === "PROVISION_SYSTEM_ACCESS") {
    patch.demoSystemAccess = { accountActive: true, requiredGroupsGranted: true, applicationsProvisioned: ["Email", "GitHub", "Jira", "Google Workspace"] };
  } else if (expectedAction === "ALLOCATE_WORKSPACE") {
    patch.demoWorkspace = { deskAllocated: true, desk: `A-${String(employee.id).slice(-2).toUpperCase()}`, location: "Engineering Floor" };
  } else if (expectedAction === "ASSIGN_MENTOR") {
    patch.demoMentor = { mentorAssigned: true, mentor: "Priya", initialProjectAssigned: true };
  }

  await db.collection("employees").updateOne({ id: employee.id }, { $set: patch });

  return {
    executed: true,
    action: expectedAction,
    message: `OnboardX executed ${expectedAction.replaceAll("_", " ").toLowerCase()} in the connected demo source system.`,
    sourceSystem: "Demo connected source system",
    eventId: state.id,
  };
}

export async function postActionEvidence({ task, employee }) {
  return collectTaskEvidence({ task, employee });
}
