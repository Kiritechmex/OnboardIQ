const PROVIDER = String(process.env.AI_PROVIDER || (process.env.GROQ_API_KEY ? "groq" : "gemini")).trim().toLowerCase();
const MODEL = PROVIDER === "groq"
  ? (process.env.GROQ_MODEL || "openai/gpt-oss-20b")
  : (process.env.GEMINI_MODEL || "gemini-flash-latest");

export function aiConfigured() {
  if (PROVIDER === "groq") return Boolean(String(process.env.GROQ_API_KEY || "").trim());
  return Boolean(String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim());
}

function providerLabel() {
  return PROVIDER === "groq" ? "Groq" : "Gemini";
}

async function callGroq({ system, messages = [], temperature = 0, maxTokens = 900, json = false }) {
  const key = String(process.env.GROQ_API_KEY || "").trim();
  if (!key) throw new Error("GROQ_API_KEY is not configured");

  const body = {
    model: MODEL,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      ...messages,
    ],
    temperature,
    max_completion_tokens: maxTokens,
  };
  if (json) body.response_format = { type: "json_object" };

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.error?.message || `Groq request failed with HTTP ${response.status}`;
    throw new Error(detail);
  }
  return String(data?.choices?.[0]?.message?.content || "").trim();
}

let geminiClient = null;
async function getGeminiClient() {
  const key = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  if (!key) return null;
  if (!geminiClient) {
    const { GoogleGenAI } = await import("@google/genai");
    geminiClient = new GoogleGenAI({ apiKey: key });
  }
  return geminiClient;
}

async function callGemini({ system, contents, temperature = 0, maxTokens = 900, json = false }) {
  const ai = await getGeminiClient();
  if (!ai) throw new Error("GEMINI_API_KEY is not configured");
  const response = await ai.models.generateContent({
    model: MODEL,
    contents,
    config: {
      ...(system ? { systemInstruction: system } : {}),
      temperature,
      maxOutputTokens: maxTokens,
      ...(json ? { responseMimeType: "application/json" } : {}),
    },
  });
  return String(
    response?.text ??
    response?.candidates?.[0]?.content?.parts?.map(part => part?.text || "").join("") ??
    ""
  ).trim();
}

async function generateText({ system, messages, temperature = 0.2, maxTokens = 900, json = false }) {
  if (!aiConfigured()) return null;
  if (PROVIDER === "groq") {
    return callGroq({ system, messages, temperature, maxTokens, json });
  }
  return callGemini({
    system,
    contents: messages.map(m => ({ role: m.role === "assistant" ? "model" : m.role, parts: [{ text: m.content }] })),
    temperature,
    maxTokens,
    json,
  });
}

export async function answerWithAI({ question, history = [], context = {}, role = "USER" }) {
  if (!aiConfigured()) return null;

  const safeHistory = Array.isArray(history)
    ? history
        .filter((m) => m && ["user", "assistant", "model"].includes(m.role) && typeof m.content === "string")
        .slice(-8)
    : [];

  const instructions = `You are the OnboardX AI Assistant inside an employee onboarding platform.
Role of the current user: ${role}.

Your job:
- Answer questions about onboarding, employees, tasks, blockers, readiness, verification states, notifications, and workflow operations using the supplied application context.
- For organization-specific questions, use ONLY the supplied context. Never invent an employee, task, status, deadline, verification result, or permission.
- You may answer general questions about HR/onboarding/software when they are not organization-specific.
- Never reveal passwords, API keys, session tokens, raw identity-document contents, Aadhaar numbers, or other secrets.
- Be concise but useful. Do not claim an action happened unless the application context confirms it.
- If the data is insufficient, say what is missing instead of guessing.

Application context:
${JSON.stringify(context, null, 2)}`;

  const messages = [
    ...safeHistory.map((m) => ({
      role: m.role === "assistant" || m.role === "model" ? "assistant" : "user",
      content: m.content,
    })),
    { role: "user", content: question },
  ];

  return generateText({ system: instructions, messages, temperature: 0.2, maxTokens: 900 });
}

function extractJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(unfenced); } catch {}
  const first = unfenced.indexOf("{");
  if (first < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = first; i < unfenced.length; i++) {
    const ch = unfenced[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(unfenced.slice(first, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

export async function verifyTaskWithAI({ task, employee, evidence }) {
  if (!aiConfigured()) return null;

  const instructions = `You are the evidence verification engine for OnboardX.
Verify whether an onboarding task is actually completed from the supplied evidence.

Rules:
- Do not trust a checkbox, task status, or the word "completed" as proof.
- Evaluate ONLY the task requirements, employee context, and source-system evidence supplied below.
- Never invent records or facts.
- VERIFIED means every required condition is directly supported by evidence.
- FAILED means evidence directly shows one or more required conditions are not satisfied.
- BLOCKED means evidence is missing, ambiguous, contradictory, or insufficient.
- Confidence must be an integer from 0 to 100.
- Keep reason short and factual.
- missingEvidence must contain concrete missing requirements; use [] when none.

Return ONLY JSON:
{"status":"VERIFIED|FAILED|BLOCKED","confidence":0,"reason":"short factual explanation","missingEvidence":[]}`;

  const input = JSON.stringify({
    task: {
      id: task.id, name: task.name, description: task.description,
      department: task.department, assignedRole: task.assignedRole,
      priority: task.priority, mandatory: task.mandatory,
    },
    employee: {
      id: employee.id, name: employee.name,
      email: employee.email || employee.personalEmail,
      department: employee.department, designation: employee.designation,
    },
    evidence: String(evidence || "").slice(0, 12000),
  }, null, 2);

  let raw;
  try {
    raw = await generateText({
      system: instructions,
      messages: [{ role: "user", content: `INPUT:\n${input}` }],
      temperature: 0,
      maxTokens: 500,
      json: true,
    });
  } catch (error) {
    console.error(`[OnboardX ${providerLabel()} verification]`, error.message);
    return {
      status: "BLOCKED",
      confidence: 0,
      reason: `${providerLabel()} verification failed: ${String(error.message).slice(0, 500)}`,
      missingEvidence: ["Successful AI verification response"],
      provider: providerLabel(),
      model: MODEL,
      error: true,
    };
  }

  const parsed = extractJson(raw);
  const allowed = ["VERIFIED", "FAILED", "BLOCKED"];
  if (!parsed || typeof parsed !== "object") {
    console.error(`[OnboardX ${providerLabel()} verification] Invalid structured response:`, String(raw || "").slice(0, 1000));
    return {
      status: "BLOCKED",
      confidence: 0,
      reason: `${providerLabel()} responded, but its verification result could not be safely parsed. The task was not marked verified.`,
      missingEvidence: ["Valid AI verification result"],
      provider: providerLabel(), model: MODEL,
    };
  }

  const status = String(parsed.status || "").toUpperCase();
  const confidenceNumber = Number(parsed.confidence);
  const confidence = Number.isFinite(confidenceNumber) ? Math.max(0, Math.min(100, Math.round(confidenceNumber))) : 0;
  return {
    status: allowed.includes(status) ? status : "BLOCKED",
    confidence,
    reason: String(parsed.reason || "The evidence could not be verified.").slice(0, 1000),
    missingEvidence: Array.isArray(parsed.missingEvidence) ? parsed.missingEvidence.map(String).slice(0, 10) : [],
    provider: providerLabel(), model: MODEL,
  };
}

export { MODEL, PROVIDER, providerLabel };

export async function collectTaskEvidence({ task, employee }) {
  // Demo source-system adapters. In production these are replaced by real
  // integrations (Google Workspace, Intune/Jamf, Okta, badge system, etc.).
  const name = String(task.name || '').toLowerCase();
  const sources = [];
  const demo = employee.demoAccessCard || employee.demoEmailAccount || employee.demoLaptop || employee.demoSystemAccess || employee.demoWorkspace || employee.demoMentor || {};

  if (name.includes('email')) {
    sources.push({
      system: 'Demo Google Workspace directory',
      query: employee.email || employee.personalEmail || employee.name,
      result: employee.demoEmailAccount || { accountExists: true, account: `${String(employee.name || 'employee').toLowerCase().replace(/\s+/g, '.')}@demo.com`, active: true }
    });
  } else if (name.includes('laptop')) {
    sources.push({
      system: 'Demo IT asset management',
      query: employee.id,
      result: employee.demoLaptop || { assetAssigned: true, assetId: `LAP-${String(employee.id).slice(-4).toUpperCase()}`, softwareProfile: 'CSE-Standard', softwareInstalled: true }
    });
  } else if (name.includes('system access')) {
    sources.push({
      system: 'Demo identity and access management',
      query: employee.id,
      result: employee.demoSystemAccess || { accountActive: true, requiredGroupsGranted: true, applicationsProvisioned: ['Email', 'GitHub', 'Jira'] }
    });
  } else if (name.includes('access card')) {
    // Intentionally incomplete so the demo can show BLOCKED instead of
    // falsely claiming that a physical badge was activated.
    sources.push({
      system: 'Demo building access control',
      query: employee.id,
      result: employee.demoAccessCard || { cardRecordFound: false, activated: false }
    });
  } else if (name.includes('workspace')) {
    sources.push({
      system: 'Demo facilities system',
      query: employee.id,
      result: employee.demoWorkspace || { deskAllocated: true, desk: 'A-14', location: 'Engineering Floor' }
    });
  } else if (name.includes('mentor')) {
    sources.push({
      system: 'Demo HR/manager directory',
      query: employee.id,
      result: employee.demoMentor || { mentorAssigned: true, mentor: 'Priya', initialProjectAssigned: true }
    });
  }

  if (!sources.length) return null;
  return {
    source: 'DEMO_CONNECTOR',
    collectedAt: new Date().toISOString(),
    records: sources,
  };
}



export async function diagnoseTaskWithAI({ task, employee, evidence }) {
  if (!aiConfigured()) return null;
  const instructions = `You are the remediation planner for OnboardX. Diagnose an onboarding verification failure and propose a safe remediation.
Rules:
- Use only the supplied task, employee, and source-system evidence.
- Do not invent records.
- Choose only one action from this allowlist: CREATE_ACCESS_CARD, CREATE_EMAIL_ACCOUNT, ASSIGN_LAPTOP, PROVISION_SYSTEM_ACCESS, ALLOCATE_WORKSPACE, ASSIGN_MENTOR, NO_ACTION.
- If the evidence shows the task is already complete, choose NO_ACTION.
- If the problem cannot safely be fixed by an authorized connected system, choose NO_ACTION and explain why.
- The backend will enforce the action allowlist and will execute the action; you are not directly executing anything.
- Return ONLY JSON:
{"diagnosis":"short factual diagnosis","rootCause":"short factual root cause","severity":"LOW|MEDIUM|HIGH|CRITICAL","action":"CREATE_ACCESS_CARD|CREATE_EMAIL_ACCOUNT|ASSIGN_LAPTOP|PROVISION_SYSTEM_ACCESS|ALLOCATE_WORKSPACE|ASSIGN_MENTOR|NO_ACTION","actionReason":"why this action is appropriate","successCriteria":["concrete condition to verify after action"],"risk":"short factual risk if unresolved"}`;
  const input = JSON.stringify({
    task: { id: task.id, name: task.name, description: task.description, department: task.department, assignedRole: task.assignedRole, priority: task.priority },
    employee: { id: employee.id, name: employee.name, department: employee.department, designation: employee.designation },
    evidence: String(evidence || '').slice(0, 12000),
  }, null, 2);
  try {
    const raw = await generateText({ system: instructions, messages: [{ role: 'user', content: `INPUT:\n${input}` }], temperature: 0, maxTokens: 650, json: true });
    const parsed = extractJson(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('AI remediation plan could not be parsed safely');
    const actions = ['CREATE_ACCESS_CARD','CREATE_EMAIL_ACCOUNT','ASSIGN_LAPTOP','PROVISION_SYSTEM_ACCESS','ALLOCATE_WORKSPACE','ASSIGN_MENTOR','NO_ACTION'];
    const action = actions.includes(String(parsed.action || '').toUpperCase()) ? String(parsed.action).toUpperCase() : 'NO_ACTION';
    return {
      diagnosis: String(parsed.diagnosis || 'The task could not be verified.').slice(0, 1000),
      rootCause: String(parsed.rootCause || 'Insufficient source-system evidence.').slice(0, 1000),
      severity: ['LOW','MEDIUM','HIGH','CRITICAL'].includes(String(parsed.severity).toUpperCase()) ? String(parsed.severity).toUpperCase() : 'HIGH',
      action,
      actionReason: String(parsed.actionReason || 'No safe automated remediation was identified.').slice(0, 1000),
      successCriteria: Array.isArray(parsed.successCriteria) ? parsed.successCriteria.map(String).slice(0, 8) : [],
      risk: String(parsed.risk || 'The onboarding dependency may remain unresolved.').slice(0, 1000),
      provider: providerLabel(), model: MODEL,
    };
  } catch (error) {
    console.error(`[OnboardX ${providerLabel()} remediation]`, error.message);
    return {
      diagnosis: 'AI could not safely generate a remediation plan.',
      rootCause: 'AI remediation planning was unavailable.',
      severity: 'HIGH', action: 'NO_ACTION',
      actionReason: `${providerLabel()} remediation failed: ${String(error.message).slice(0, 500)}`,
      successCriteria: [], risk: 'Manual review or escalation is required.',
      provider: providerLabel(), model: MODEL, error: true,
    };
  }
}
