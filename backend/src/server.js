import "dotenv/config";
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { createWorker } from "tesseract.js";
import { v4 as uuid } from "uuid";
import { getDb } from "./services/store.js";
import { auth, allow, hashToken } from "./middleware/auth.js";
import { generateTasks, recalculate, addNotification, audit } from "./services/engine.js";
import { answerWithAI, aiConfigured, MODEL, PROVIDER, providerLabel, verifyTaskWithAI, collectTaskEvidence, diagnoseTaskWithAI } from "./services/ai.js";
import { remediationCapability, executeRemediation, postActionEvidence } from "./services/remediation.js";
import { sendEmail } from "./services/email.js";
import { runAutomations } from "./services/automation.js";
import { buildDay1Snapshot, runDay1Orchestration, acknowledgeEscalation } from "./services/day1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 4000);
const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:5173";
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
const MAX_UPLOAD = 10 * 1024 * 1024;

await fs.mkdir(UPLOAD_DIR, { recursive: true });

app.use(cors({ origin: WEB_ORIGIN === "*" ? true : WEB_ORIGIN }));
app.use(express.json({ limit: "1mb" }));

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: MAX_UPLOAD, files: 2 },
});

function now() { return new Date().toISOString(); }

function evaluateSourceEvidence(task, collected) {
  const result = collected?.records?.[0]?.result || {};
  const name = String(task?.name || '').toLowerCase();
  if (name.includes('access card')) return result.cardRecordFound === true && result.activated === true;
  if (name.includes('email account')) return result.accountExists === true && result.active === true;
  if (name.includes('laptop')) return result.assetAssigned === true && result.softwareInstalled === true;
  if (name.includes('system access')) return result.accountActive === true && result.requiredGroupsGranted === true && Array.isArray(result.applicationsProvisioned) && result.applicationsProvisioned.length >= 3;
  if (name.includes('workspace')) return result.deskAllocated === true;
  if (name.includes('mentor')) return result.mentorAssigned === true && result.initialProjectAssigned === true;
  return null;
}

function buildVerificationReport({ task, employee, initialResult, initialEvidence, diagnosis = null, remediation = null, postEvidence = null, finalStatus = null }) {
  const final = finalStatus || initialResult?.status || "BLOCKED";
  return {
    version: 1,
    generatedAt: now(),
    employee: { id: employee.id, name: employee.name, email: employee.email || employee.personalEmail, designation: employee.designation },
    task: { id: task.id, name: task.name, department: task.department, priority: task.priority, deadline: task.deadline },
    initial: { status: initialResult?.status || "UNKNOWN", confidence: initialResult?.confidence ?? 0, reason: initialResult?.reason || "No initial result.", evidence: initialEvidence || "", provider: initialResult?.provider || null, model: initialResult?.model || null },
    diagnosis: diagnosis ? { diagnosis: diagnosis.diagnosis, rootCause: diagnosis.rootCause, severity: diagnosis.severity, risk: diagnosis.risk, provider: diagnosis.provider || null, model: diagnosis.model || null } : null,
    remediation: remediation ? { action: remediation.action, executed: remediation.executed, message: remediation.message, sourceSystem: remediation.sourceSystem, policyBlocked: remediation.policyBlocked || false } : null,
    postActionVerification: postEvidence ? { evidence: postEvidence, sourceConfirmed: evaluateSourceEvidence(task, postEvidence) } : null,
    final: { status: final, confidence: final === "VERIFIED" ? 100 : (initialResult?.confidence ?? 0), reason: final === "VERIFIED" ? "Post-action source-system evidence satisfied the task success criteria." : (initialResult?.reason || "The task remains unresolved.") },
    auditTrail: [
      { step: "Initial evidence collected", at: now() },
      ...(diagnosis ? [{ step: "AI diagnosis and remediation plan generated", at: now() }] : []),
      ...(remediation?.executed ? [{ step: "Authorized remediation executed", at: now() }] : []),
      ...(postEvidence ? [{ step: "Source system rechecked after remediation", at: now() }] : []),
      { step: `Final status: ${final}`, at: now() },
    ],
  };
}
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString("hex"); }
function hashText(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function makeOtp() { return String(crypto.randomInt(100000, 1000000)); }
function normalize(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function normalizeAddress(value) { return String(value || "").toLowerCase().replace(/\b(india)\b/g, "").replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(Boolean); }
function tokenOverlap(a, b) {
  const aa = new Set(normalizeAddress(a));
  const bb = new Set(normalizeAddress(b));
  if (!aa.size || !bb.size) return 0;
  let matched = 0;
  for (const token of aa) if (bb.has(token)) matched++;
  return matched / Math.max(aa.size, bb.size);
}
function nameMatch(a, b) {
  const x = normalize(a), y = normalize(b);
  return Boolean(x && y) && (x === y || x.includes(y) || y.includes(x) || tokenSimilarity(x, y) >= 0.85);
}
function tokenSimilarity(a, b) {
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (!longer.length) return 1;
  const distance = levenshtein(longer, shorter);
  return (longer.length - distance) / longer.length;
}
function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function safeUser(user) {
  if (!user) return null;
  const copy = { ...user };
  delete copy.password;
  delete copy.passwordHash;
  return copy;
}

function fileKind(buffer) {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "JPEG";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "PNG";
  if (buffer.subarray(0, 4).toString() === "%PDF") return "PDF";
  return "UNKNOWN";
}

function toIsoDate(value) {
  const raw = String(value || "").trim();
  const m = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (!m) return raw;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function parseAadhaarText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map(s => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const joined = lines.join(" ");

  const dob = (joined.match(/(?:DOB|D\.O\.B|Date of Birth|Birth)\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i) || [])[1]
    || (joined.match(/(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/) || [])[1] || "";

  const nameIndex = lines.findIndex(l => /^(?:name|naam)\s*[:\-]?/i.test(l));
  let name = nameIndex >= 0
    ? lines[nameIndex].replace(/^(?:name|naam)\s*[:\-]?\s*/i, "").trim()
    : "";

  if (!name) {
    const likely = lines.find(l => /^[A-Za-z][A-Za-z .'-]{2,60}$/.test(l)
      && !/government|india|aadhaar|address|dob|date|male|female|year|unique|identification|authority|resident|enrol/i.test(l));
    name = likely || "";
  }

  // Aadhaar back-side OCR often does not preserve an explicit "Address" label.
  // Prefer the labelled block when available, otherwise collect lines around a PIN code.
  const addressIndex = lines.findIndex(l => /address|पता/i.test(l));
  let address = "";
  if (addressIndex >= 0) {
    address = lines.slice(addressIndex + 1, addressIndex + 7)
      .filter(l => !/www\.|uidai|1947|help/i.test(l))
      .join(" ");
  }
  if (!address) {
    const pinIndex = lines.findIndex(l => /\b\d{6}\b/.test(l));
    if (pinIndex >= 0) {
      address = lines.slice(Math.max(0, pinIndex - 4), pinIndex + 1)
        .filter(l => !/www\.|uidai|1947|help|unique identification authority/i.test(l))
        .join(" ");
    }
  }

  return { name, dob, address };
}

async function ocrImage(filePath) {
  const worker = await createWorker("eng");
  try {
    const result = await worker.recognize(filePath);
    return result.data.text || "";
  } finally {
    await worker.terminate();
  }
}

async function getInvite(req, token) {
  const invite = await req.db.collection("onboardingInvites").findOne({ tokenHash: hashToken(token) });
  if (!invite) return null;
  if (new Date(invite.expiresAt) < new Date()) return null;
  return invite;
}

app.get("/api/health", async (req, res) => {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    await migrateLegacyTasks(db);
    res.json({ ok: true, service: "OnboardX", database: "mongodb", databaseName: db.databaseName });
  } catch (error) {
    res.status(503).json({ ok: false, service: "OnboardX", database: "mongodb", error: error.message });
  }
});

app.use(async (req, res, next) => {
  try {
    req.db = await getDb();
    next();
  } catch (error) { next(error); }
});

// -------------------- Public employee onboarding --------------------
app.get("/api/onboarding/invite/:token", async (req, res, next) => {
  try {
    const invite = await getInvite(req, req.params.token);
    if (!invite) return res.status(404).json({ error: "Invitation is invalid or expired" });
    const employee = await req.db.collection("employees").findOne({ id: invite.employeeId });
    if (!employee) return res.status(404).json({ error: "Employee record not found" });
    const verification = await req.db.collection("identityVerifications").findOne({ employeeId: employee.id }, { sort: { createdAt: -1 } });
    res.json({
      company: invite.companyName || "Your organization",
      employee: {
        id: employee.id,
        name: employee.name,
        email: employee.email,
        personalEmail: employee.personalEmail,
        designation: employee.designation,
        department: employee.department,
        joiningDate: employee.joiningDate,
        dateOfBirth: employee.dateOfBirth,
        gender: employee.gender,
        phone: employee.phone,
        address: employee.address,
      },
      state: employee.onboardingState || { emailVerified: false, phoneVerified: false, profileCompleted: false, identityVerified: false, accountCreated: false },
      verification: verification ? {
        status: verification.status,
        level1: verification.level1,
        matches: verification.matches,
        extracted: verification.extracted,
        sides: verification.sideChecks,
        message: verification.message,
      } : null,
    });
  } catch (error) { next(error); }
});

app.post("/api/onboarding/:token/otp/start", async (req, res, next) => {
  try {
    const invite = await getInvite(req, req.params.token);
    if (!invite) return res.status(404).json({ error: "Invitation is invalid or expired" });
    const channel = req.body?.channel === "phone" ? "phone" : "email";
    const employee = await req.db.collection("employees").findOne({ id: invite.employeeId });
    if (!employee) return res.status(404).json({ error: "Employee record not found" });

    if (channel === "phone") {
      const phone = String(req.body?.phone || "").trim();
      if (!phone) return res.status(400).json({ error: "Phone number is required before phone verification" });
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 15) return res.status(400).json({ error: "Enter a valid phone number" });
      await req.db.collection("employees").updateOne({ id: invite.employeeId }, { $set: { phone, updatedAt: now() } });
    }

    const challengeId = uuid();
    const otp = makeOtp();
    await req.db.collection("otpChallenges").insertOne({
      id: challengeId, employeeId: employee.id, channel, otpHash: hashText(otp), attempts: 0,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), createdAt: now(),
    });
    let delivery = "development";
    let email = null;
    if (channel === "email") {
      email = await sendEmail({
        to: employee.personalEmail,
        subject: "Your OnboardX verification code",
        text: `Your OnboardX verification code is ${otp}. It expires in 10 minutes.`,
        html: `<p>Your OnboardX verification code is:</p><h2>${otp}</h2><p>This code expires in 10 minutes.</p>`,
      }).catch(error => ({ sent: false, mode: "error", error: error.message }));
      delivery = email?.sent ? "email" : "development";
    }
    await audit(req.db, null, "START_ONBOARDING_OTP", `${employee.id}:${channel}`);
    res.json({
      challengeId,
      message: `Verification code generated for ${channel}.`,
      demoMode: channel === "phone" || !email?.sent,
      demoCode: channel === "phone" || !email?.sent ? otp : undefined,
      delivery,
      email,
      note: channel === "phone" ? "SMS provider not configured; development mode returns the phone OTP." : "Email provider is used when RESEND_API_KEY is configured.",
    });
  } catch (error) { next(error); }
});

app.post("/api/onboarding/:token/otp/verify", async (req, res, next) => {
  try {
    const invite = await getInvite(req, req.params.token);
    if (!invite) return res.status(404).json({ error: "Invitation is invalid or expired" });
    const challenge = await req.db.collection("otpChallenges").findOne({ id: req.body?.challengeId, employeeId: invite.employeeId });
    if (!challenge) return res.status(400).json({ error: "Verification challenge not found" });
    if (new Date(challenge.expiresAt) < new Date()) return res.status(400).json({ error: "Verification code expired" });
    if (challenge.attempts >= 5) return res.status(429).json({ error: "Too many attempts" });
    const valid = hashText(String(req.body?.code || "")) === challenge.otpHash;
    await req.db.collection("otpChallenges").updateOne({ id: challenge.id }, { $inc: { attempts: 1 } });
    if (!valid) return res.status(400).json({ verified: false, error: "Invalid verification code" });
    const set = challenge.channel === "phone" ? { "onboardingState.phoneVerified": true } : { "onboardingState.emailVerified": true };
    await req.db.collection("employees").updateOne({ id: invite.employeeId }, { $set: { ...set, updatedAt: now() } });
    await audit(req.db, null, "VERIFY_ONBOARDING_OTP", `${invite.employeeId}:${challenge.channel}`);
    res.json({ verified: true, channel: challenge.channel });
  } catch (error) { next(error); }
});

app.post("/api/onboarding/:token/profile", async (req, res, next) => {
  try {
    const invite = await getInvite(req, req.params.token);
    if (!invite) return res.status(404).json({ error: "Invitation is invalid or expired" });
    const { name, dateOfBirth, gender, phone, personalEmail, address } = req.body || {};
    if (![name, dateOfBirth, gender, phone, personalEmail, address].every(v => String(v || "").trim())) {
      return res.status(400).json({ error: "Full name, date of birth, gender, phone, personal email and address are required" });
    }
    await req.db.collection("employees").updateOne({ id: invite.employeeId }, {
      $set: {
        name: String(name).trim(), dateOfBirth: String(dateOfBirth).trim(), gender: String(gender).trim(),
        phone: String(phone).trim(), personalEmail: String(personalEmail).trim().toLowerCase(), address: String(address).trim(),
        "onboardingState.profileCompleted": true, updatedAt: now(),
      },
    });
    await audit(req.db, null, "COMPLETE_ONBOARDING_PROFILE", invite.employeeId);
    res.json({ saved: true });
  } catch (error) { next(error); }
});

app.post("/api/onboarding/:token/identity", upload.fields([
  { name: "documentFront", maxCount: 1 },
  { name: "documentBack", maxCount: 1 },
]), async (req, res, next) => {
  try {
    const invite = await getInvite(req, req.params.token);
    if (!invite) return res.status(404).json({ error: "Invitation is invalid or expired" });

    const front = req.files?.documentFront?.[0];
    const back = req.files?.documentBack?.[0];
    if (!front || !back) {
      for (const f of [front, back]) if (f?.path) await fs.rm(f.path, { force: true }).catch(() => {});
      return res.status(400).json({ error: "Both front and back Aadhaar images are required" });
    }

    const files = [front, back];
    const buffers = await Promise.all(files.map(f => fs.readFile(f.path)));
    const hashes = buffers.map(buffer => crypto.createHash("sha256").update(buffer).digest("hex"));
    if (hashes[0] === hashes[1]) {
      for (const f of files) await fs.rm(f.path, { force: true });
      return res.status(400).json({ error: "Front and back must be two different Aadhaar images." });
    }
    const kinds = buffers.map(fileKind);
    const allowedMimes = ["image/jpeg", "image/png"];
    const sideChecks = files.map((f, i) => allowedMimes.includes(f.mimetype) && /\.(jpe?g|png)$/i.test(f.originalname) && f.size <= MAX_UPLOAD && ["JPEG", "PNG"].includes(kinds[i]));
    const level1 = sideChecks.every(Boolean);

    if (!level1) {
      for (const f of files) await fs.rm(f.path, { force: true });
      const failed = {
        id: uuid(), employeeId: invite.employeeId, documentType: "AADHAAR", status: "FAILED", level1: false,
        matches: { name: false, dob: false, address: false }, extracted: {}, sideChecks: { front: sideChecks[0], back: sideChecks[1] },
        evidence: {
          front: { filename: front.originalname, fileKind: kinds[0], mimeType: front.mimetype, size: front.size, sha256: hashes[0] },
          back: { filename: back.originalname, fileKind: kinds[1], mimeType: back.mimetype, size: back.size, sha256: hashes[1] },
        },
        message: "One or both Aadhaar images did not pass Level 1 structural validation.", createdAt: now(),
      };
      await req.db.collection("identityVerifications").insertOne(failed);
      await req.db.collection("tasks").updateOne({ employeeId: invite.employeeId, taskType: "IDENTITY_VERIFICATION" }, { $set: { status: "FAILED", evidence: failed.message, updatedAt: now() } });
      await req.db.collection("employees").updateOne({ id: invite.employeeId }, { $set: { identityVerificationStatus: "FAILED", "onboardingState.identityVerified": false, updatedAt: now() } });
      await recalculate(req.db, invite.employeeId);
      return res.status(400).json({ verified: false, level1: false, status: "FAILED", sides: { front: sideChecks[0], back: sideChecks[1] }, error: failed.message });
    }

    const employee = await req.db.collection("employees").findOne({ id: invite.employeeId });
    let ocrTextFront = "", ocrTextBack = "";
    let extracted = { name: "", dob: "", address: "" };
    let matches = { name: false, dob: false, address: false };
    let status = "NEEDS_REVIEW";
    let message = "Both images passed Level 1. OCR/matching is pending manual review.";

    try {
      [ocrTextFront, ocrTextBack] = await Promise.all([ocrImage(front.path), ocrImage(back.path)]);
      const frontExtracted = parseAadhaarText(ocrTextFront);
      const backExtracted = parseAadhaarText(ocrTextBack);
      extracted = {
        name: frontExtracted.name || backExtracted.name || "",
        dob: frontExtracted.dob || backExtracted.dob || "",
        address: backExtracted.address || frontExtracted.address || "",
      };
      matches = {
        name: nameMatch(employee.name || "", extracted.name),
        dob: Boolean(extracted.dob) && toIsoDate(extracted.dob) === String(employee.dateOfBirth || ""),
        address: tokenOverlap(employee.address || "", extracted.address) >= 0.60,
      };
      // For this MVP, name and address are the mandatory identity-consistency checks.
      // DOB is still checked and displayed when available, but a missing/unreliable DOB OCR result
      // should not block the employee from reaching account creation.
      if (extracted.name && extracted.address && matches.name && matches.address) {
        status = "VERIFIED";
        message = "Both Aadhaar images passed Level 1 and the OCR-extracted name and address matched the employee profile. Date of birth was also checked when confidently extracted. This is a prototype consistency check, not an official government authenticity confirmation.";
      } else {
        status = "NEEDS_REVIEW";
        message = "Both images passed Level 1, but the Aadhaar name and/or address could not be confidently extracted or matched. Human review is required.";
      }
    } catch (ocrError) {
      status = "NEEDS_REVIEW";
      message = `Both images passed Level 1, but OCR could not be completed: ${ocrError.message}`;
    }

    const verification = {
      id: uuid(), employeeId: invite.employeeId, documentType: "AADHAAR", status,
      level1: true, verificationType: "AADHAAR_CONSISTENCY_PROTOTYPE",
      sideChecks: { front: true, back: true }, matches, extracted,
      evidence: {
        front: { filename: front.originalname, storedPath: front.path, fileKind: kinds[0], mimeType: front.mimetype, size: front.size, sha256: hashes[0] },
        back: { filename: back.originalname, storedPath: back.path, fileKind: kinds[1], mimeType: back.mimetype, size: back.size, sha256: hashes[1] },
      },
      message, createdAt: now(), updatedAt: now(),
    };
    await req.db.collection("identityVerifications").insertOne(verification);
    await req.db.collection("employees").updateOne({ id: invite.employeeId }, {
      $set: {
        identityVerificationStatus: status,
        "onboardingState.identityVerified": status === "VERIFIED",
        updatedAt: now(),
      },
    });
    const taskStatus = status === "VERIFIED" ? "VERIFIED" : "IN_REVIEW";
    await req.db.collection("tasks").updateOne({ employeeId: invite.employeeId, taskType: "IDENTITY_VERIFICATION" }, {
      $set: { status: taskStatus, evidence: `Automated identity check: ${status}.`, updatedAt: now() },
    });
    await recalculate(req.db, invite.employeeId);
    await audit(req.db, null, "IDENTITY_VERIFICATION", `${invite.employeeId}:${status}`);
    await runAutomations(req.db).catch(error => console.error("[OnboardX automation]", error.message));
    res.json({ verified: status === "VERIFIED", level1: true, status, message, matches, extracted, sides: { front: true, back: true } });
  } catch (error) {
    for (const f of [req.files?.documentFront?.[0], req.files?.documentBack?.[0]]) if (f?.path && error) await fs.rm(f.path, { force: true }).catch(() => {});
    next(error);
  }
});


app.post("/api/onboarding/:token/skip-identity", async (req, res, next) => {
  try {
    const invite = await getInvite(req, req.params.token);
    if (!invite) return res.status(404).json({ error: "Invitation is invalid or expired" });
    const employee = await req.db.collection("employees").findOne({ id: invite.employeeId });
    if (!employee) return res.status(404).json({ error: "Employee record not found" });

    const verification = {
      id: uuid(),
      employeeId: employee.id,
      documentType: "AADHAAR",
      status: "SKIPPED",
      verificationType: "DEFERRED",
      level1: false,
      matches: { name: false, dob: false, address: false },
      extracted: {},
      sideChecks: { front: false, back: false },
      evidence: { reason: "Aadhaar verification deferred for prototype/demo." },
      message: "Aadhaar verification was skipped for now. This is not an identity verification result.",
      createdAt: now(),
      updatedAt: now(),
    };
    await req.db.collection("identityVerifications").insertOne(verification);
    await req.db.collection("employees").updateOne({ id: employee.id }, {
      $set: {
        identityVerificationStatus: "SKIPPED",
        "onboardingState.identityVerified": false,
        "onboardingState.identitySkipped": true,
        updatedAt: now(),
      }
    });
    await req.db.collection("tasks").updateOne(
      { employeeId: employee.id, taskType: "IDENTITY_VERIFICATION" },
      { $set: { status: "SKIPPED", mandatory: false, evidence: "Aadhaar verification deferred for prototype/demo.", updatedAt: now() } }
    );
    await recalculate(req.db, employee.id);
    await audit(req.db, null, "SKIP_IDENTITY_VERIFICATION", employee.id);
    await runAutomations(req.db).catch(error => console.error("[OnboardX automation]", error.message));
    res.json({ skipped: true, status: "SKIPPED", message: verification.message });
  } catch (error) { next(error); }
});

app.post("/api/onboarding/:token/complete", async (req, res, next) => {
  try {
    const invite = await getInvite(req, req.params.token);
    if (!invite) return res.status(404).json({ error: "Invitation is invalid or expired" });
    const employee = await req.db.collection("employees").findOne({ id: invite.employeeId });
    if (!employee) return res.status(404).json({ error: "Employee record not found" });
    const verification = await req.db.collection("identityVerifications").findOne({ employeeId: employee.id }, { sort: { createdAt: -1 } });
    const password = String(req.body?.password || "");
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    const state = employee.onboardingState || {};
    if (!state.emailVerified || !state.phoneVerified || !state.profileCompleted) return res.status(400).json({ error: "Complete email, phone and profile verification first" });
    if (!verification || !["VERIFIED", "SKIPPED"].includes(verification.status)) return res.status(400).json({ error: "Complete or skip the Aadhaar step before creating the employee login" });
    const existing = await req.db.collection("users").findOne({ email: String(employee.personalEmail || employee.email).trim().toLowerCase() });
    if (existing) return res.status(409).json({ error: "A login already exists for this email" });
    const salt = crypto.randomBytes(16).toString("hex");
    const derived = crypto.scryptSync(password, salt, 64).toString("hex");
    const user = {
      id: uuid(), name: employee.name, email: String(employee.personalEmail || employee.email).toLowerCase(),
      passwordHash: `${salt}:${derived}`, role: "EMPLOYEE", organizationId: employee.organizationId,
      department: employee.department, employeeId: employee.id, createdAt: now(),
    };
    await req.db.collection("users").insertOne(user);
    await req.db.collection("employees").updateOne({ id: employee.id }, { $set: { "onboardingState.accountCreated": true, onboardingStatus: "COMPLETED", updatedAt: now() } });
    const rawSession = randomToken();
    await req.db.collection("sessions").insertOne({ id: uuid(), tokenHash: hashToken(rawSession), userId: user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), createdAt: now() });
    await audit(req.db, user.id, "CREATE_EMPLOYEE_LOGIN", employee.id);
    await runAutomations(req.db).catch(error => console.error("[OnboardX automation]", error.message));
    res.json({ completed: true, user: safeUser(user), token: rawSession });
  } catch (error) { next(error); }
});

app.get("/api/onboarding/:token/state", async (req, res, next) => {
  try {
    const invite = await getInvite(req, req.params.token);
    if (!invite) return res.status(404).json({ error: "Invitation is invalid or expired" });
    const employee = await req.db.collection("employees").findOne({ id: invite.employeeId });
    const verification = await req.db.collection("identityVerifications").findOne({ employeeId: employee.id }, { sort: { createdAt: -1 } });
    res.json({ employee, verification });
  } catch (error) { next(error); }
});

// -------------------- Authenticated application --------------------
app.post("/api/auth/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const user = await req.db.collection("users").findOne({ email: String(email || "").trim().toLowerCase() });
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    let valid = false;
    if (user.passwordHash) {
      const [salt, stored] = user.passwordHash.split(":");
      const derived = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
      valid = crypto.timingSafeEqual(Buffer.from(stored, "hex"), Buffer.from(derived, "hex"));
    } else {
      valid = user.password === password;
    }
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });
    const token = randomToken();
    await req.db.collection("sessions").insertOne({ id: uuid(), tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), createdAt: now() });
    res.json({ user: safeUser(user), token });
  } catch (error) { next(error); }
});

app.use(auth);

app.post("/api/auth/logout", async (req, res, next) => {
  try {
    const header = req.header("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (token) await req.db.collection("sessions").deleteOne({ tokenHash: hashToken(token) });
    res.json({ loggedOut: true });
  } catch (error) { next(error); }
});

app.get("/api/me", (req, res) => res.json(safeUser(req.user)));

function employeeFilterFor(req) {
  if (req.user.role === "EMPLOYEE") return { id: req.user.employeeId, organizationId: req.user.organizationId };
  if (req.user.role === "MANAGER") return { organizationId: req.user.organizationId, manager: req.user.name };
  return { organizationId: req.user.organizationId };
}

// Existing prototype data can contain duplicate employee records from repeated
// demo/test runs. Do not delete data automatically: for read APIs we collapse
// exact duplicates into one canonical employee. The canonical record is the
// one with the most onboarding tasks, then the newest update.
async function canonicalEmployees(db, filter) {
  const employees = await db.collection("employees").find(filter).toArray();
  if (employees.length < 2) return employees;

  const taskCounts = await Promise.all(employees.map(async employee => ({
    id: employee.id,
    count: await db.collection("tasks").countDocuments({ employeeId: employee.id }),
  })));
  const countMap = new Map(taskCounts.map(x => [x.id, x.count]));
  const groups = new Map();

  for (const employee of employees) {
    const email = String(employee.email || employee.personalEmail || "").trim().toLowerCase();
    const fallback = `${String(employee.name || "").trim().toLowerCase()}|${String(employee.joiningDate || "").slice(0, 10)}`;
    const key = email || fallback;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(employee);
  }

  const canonical = [];
  for (const group of groups.values()) {
    group.sort((a, b) => {
      const taskDiff = (countMap.get(b.id) || 0) - (countMap.get(a.id) || 0);
      if (taskDiff) return taskDiff;
      return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
    });
    canonical.push(group[0]);
  }
  return canonical.sort((a, b) => String(a.joiningDate || "").localeCompare(String(b.joiningDate || "")) || String(a.name || "").localeCompare(String(b.name || "")));
}

function taskFilterFor(req) {
  if (req.user.role === "EMPLOYEE") return { employeeId: req.user.employeeId, organizationId: req.user.organizationId };
  if (req.user.role === "MANAGER") return { organizationId: req.user.organizationId, assignedRole: "MANAGER" };
  if (["IT", "FACILITIES", "FACULTY_IT"].includes(req.user.role)) return { organizationId: req.user.organizationId, assignedRole: { $in: ["IT", "FACILITIES"] } };
  return { organizationId: req.user.organizationId };
}

app.get("/api/dashboard/summary", async (req, res, next) => {
  try {
    const employees = await canonicalEmployees(req.db, employeeFilterFor(req));
    const tasks = await req.db.collection("tasks").find(taskFilterFor(req)).toArray();
    const today = now().slice(0, 10);
    res.json({
      total: employees.length,
      ready: employees.filter(e => e.status === "READY").length,
      inProgress: employees.filter(e => e.status === "IN_PROGRESS").length,
      atRisk: employees.filter(e => e.status === "AT_RISK").length,
      blocked: employees.filter(e => e.status === "BLOCKED").length,
      overdue: tasks.filter(t => t.status !== "VERIFIED" && t.deadline < today).length,
    });
  } catch (error) { next(error); }
});

app.get("/api/employees", async (req, res, next) => {
  try {
    const employees = await canonicalEmployees(req.db, employeeFilterFor(req));
    // Refresh the stored readiness fields so legacy/demo records cannot keep
    // showing a stale READY/100% state after their tasks change.
    const refreshed = await Promise.all(employees.map(async employee => {
      const result = await recalculate(req.db, employee.id);
      return result?.employee || employee;
    }));
    res.json(refreshed);
  } catch (error) { next(error); }
});

app.post("/api/employees", allow("ADMIN", "HR"), async (req, res, next) => {
  try {
    const { name, email, employeeCode, department, designation, manager, joiningDate, location } = req.body || {};
    if (!name || !email || !joiningDate) return res.status(400).json({ error: "Name, email and joining date are required" });
    const normalizedEmail = String(email).trim().toLowerCase();
    const existingEmployee = await req.db.collection("employees").findOne({ organizationId: req.user.organizationId, $or: [{ email: normalizedEmail }, { personalEmail: normalizedEmail }] });
    if (existingEmployee) return res.status(409).json({ error: "An employee with this email already exists", employeeId: existingEmployee.id });
    const employee = {
      id: uuid(), organizationId: req.user.organizationId, name: String(name).trim(), email: normalizedEmail,
      personalEmail: normalizedEmail, employeeCode: employeeCode || `EMP-${Date.now()}`,
      department: department || "General", designation: designation || "Employee", manager: manager || "",
      joiningDate, location: location || "", status: "IN_PROGRESS", readiness: 0, onboardingStatus: "INVITED",
      onboardingState: { emailVerified: false, phoneVerified: false, profileCompleted: false, identityVerified: false, accountCreated: false },
      createdAt: now(), updatedAt: now(),
    };
    const tasks = generateTasks(employee);
    await req.db.collection("employees").insertOne(employee);
    await req.db.collection("tasks").insertMany(tasks);
    await recalculate(req.db, employee.id);
    const rawInviteToken = randomToken(24);
    await req.db.collection("onboardingInvites").insertOne({
      id: uuid(), employeeId: employee.id, organizationId: employee.organizationId,
      companyName: process.env.COMPANY_NAME || "Your organization", tokenHash: hashToken(rawInviteToken),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), createdAt: now(), createdBy: req.user.id,
    });
    const inviteUrl = `${WEB_ORIGIN}/onboard?token=${rawInviteToken}`;
    const emailResult = await sendEmail({
      to: employee.personalEmail,
      subject: `Complete your OnboardX onboarding - ${process.env.COMPANY_NAME || "Your organization"}`,
      text: `You have been invited to complete your onboarding. Open this secure link: ${inviteUrl}`,
      html: `<p>You have been invited to complete your onboarding with <b>${process.env.COMPANY_NAME || "Your organization"}</b>.</p><p><a href="${inviteUrl}">Start your secure onboarding</a></p><p>This invitation expires in 30 days.</p>`,
    }).catch(error => ({ sent: false, mode: "error", error: error.message }));
    await runAutomations(req.db).catch(error => console.error("[OnboardX automation]", error.message));
    await audit(req.db, req.user.id, "CREATE_EMPLOYEE_INVITE", employee.id);
    const updated = await req.db.collection("employees").findOne({ id: employee.id });
    res.status(201).json({ employee: updated, tasks, inviteUrl, email: emailResult });
  } catch (error) { next(error); }
});

app.delete("/api/employees/:id", allow("ADMIN", "HR"), async (req, res, next) => {
  try {
    const employee = await req.db.collection("employees").findOne({ id: req.params.id, organizationId: req.user.organizationId });
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    // Keep a deletion audit entry even though the employee's operational data is removed.
    await audit(req.db, req.user.id, "DELETE_EMPLOYEE", employee.id);

    const employeeUsers = await req.db.collection("users").find({ employeeId: employee.id, organizationId: req.user.organizationId }).toArray();
    const employeeUserIds = employeeUsers.map(u => u.id);

    const verifications = await req.db.collection("identityVerifications").find({ employeeId: employee.id }).toArray();
    for (const verification of verifications) {
      const storedPath = verification?.evidence?.storedPath;
      if (storedPath) await fs.rm(storedPath, { force: true }).catch(() => {});
    }

    await Promise.all([
      req.db.collection("sessions").deleteMany({ userId: { $in: employeeUserIds } }),
      req.db.collection("notifications").deleteMany({ userId: { $in: employeeUserIds } }),
      req.db.collection("tasks").deleteMany({ employeeId: employee.id }),
      req.db.collection("onboardingInvites").deleteMany({ employeeId: employee.id }),
      req.db.collection("identityVerifications").deleteMany({ employeeId: employee.id }),
      req.db.collection("otpChallenges").deleteMany({ employeeId: employee.id }),
      req.db.collection("escalations").deleteMany({ employeeId: employee.id }),
      req.db.collection("users").deleteMany({ employeeId: employee.id, organizationId: req.user.organizationId }),
      req.db.collection("employees").deleteOne({ id: employee.id, organizationId: req.user.organizationId }),
    ]);

    res.json({ deleted: true, employeeId: employee.id });
  } catch (error) { next(error); }
});

app.get("/api/employees/:id", async (req, res, next) => {
  try {
    const employee = await req.db.collection("employees").findOne({ id: req.params.id, organizationId: req.user.organizationId });
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    const allowed = req.user.role === "HR" || req.user.role === "ADMIN" || req.user.role === "EMPLOYEE" && req.user.employeeId === employee.id || req.user.role === "MANAGER" && employee.manager === req.user.name || ["IT", "FACILITIES", "FACULTY_IT"].includes(req.user.role);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });
    const tasks = await req.db.collection("tasks").find({ employeeId: employee.id }).sort({ createdAt: 1 }).toArray();
    const verification = await req.db.collection("identityVerifications").findOne({ employeeId: employee.id }, { sort: { createdAt: -1 } });
    const risk = await recalculate(req.db, employee.id);
    res.json({ employee: risk?.employee || employee, tasks, risk, verification: verification ? {
      status: verification.status, level1: verification.level1, matches: verification.matches, sides: verification.sideChecks, extracted: req.user.role === "EMPLOYEE" || ["HR", "ADMIN"].includes(req.user.role) ? verification.extracted : undefined, message: verification.message,
    } : null });
  } catch (error) { next(error); }
});

app.get("/api/tasks", async (req, res, next) => {
  try { res.json(await req.db.collection("tasks").find(taskFilterFor(req)).sort({ deadline: 1, priority: -1 }).toArray()); }
  catch (error) { next(error); }
});

app.patch("/api/tasks/:id", async (req, res, next) => {
  try {
    const task = await req.db.collection("tasks").findOne({ id: req.params.id });
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (task.taskType === "IDENTITY_VERIFICATION") return res.status(400).json({ error: "Identity verification is automatic. The employee must complete the verification flow." });
    const permitted = ["ADMIN", "HR"].includes(req.user.role)
      || req.user.role === task.assignedRole
      || ["IT", "FACILITIES", "FACULTY_IT"].includes(req.user.role) && ["IT", "FACILITIES"].includes(task.assignedRole)
      || req.user.role === "MANAGER" && task.assignedRole === "MANAGER";
    if (!permitted) return res.status(403).json({ error: "You cannot edit this task" });
    const update = { updatedAt: now() };
    if (req.body.status) update.status = req.body.status;
    if (req.body.evidence !== undefined) update.evidence = req.body.evidence;
    const updateDoc = { $set: update };
    if (req.body.status === "COMPLETED" || req.body.evidence !== undefined) {
      updateDoc.$unset = { verification: "", verificationReport: "" };
    }
    await req.db.collection("tasks").updateOne({ id: task.id }, updateDoc);
    const r = await recalculate(req.db, task.employeeId);
    await audit(req.db, req.user.id, "UPDATE_TASK", task.id);
    await runAutomations(req.db).catch(error => console.error("[OnboardX automation]", error.message));
    res.json({ task: await req.db.collection("tasks").findOne({ id: task.id }), risk: r });
  } catch (error) { next(error); }
});


app.post("/api/tasks/:id/verify-ai", async (req, res, next) => {
  try {
    const task = await req.db.collection("tasks").findOne({ id: req.params.id });
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (task.taskType === "IDENTITY_VERIFICATION") return res.status(400).json({ error: "Identity verification uses the onboarding identity flow." });

    const permitted = ["ADMIN", "HR"].includes(req.user.role)
      || req.user.role === task.assignedRole
      || (req.user.role === "FACULTY_IT" && ["IT", "FACILITIES"].includes(task.assignedRole))
      || (req.user.role === "MANAGER" && task.assignedRole === "MANAGER");
    if (!permitted) return res.status(403).json({ error: "Cannot verify this task" });

    const employee = await req.db.collection("employees").findOne({ id: task.employeeId, organizationId: req.user.organizationId });
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    // AI Verify no longer asks the operator to type evidence. It first collects
    // evidence from a source-system adapter, then gives that evidence to Gemini.
    const suppliedEvidence = String(req.body?.evidence ?? task.evidence ?? "").trim();
    const collected = suppliedEvidence ? null : await collectTaskEvidence({ task, employee });
    const evidence = suppliedEvidence || (collected ? JSON.stringify(collected) : "");
    if (evidence.length < 10) return res.status(400).json({ error: "No connected source system has evidence for this task yet. Connect the relevant system or submit evidence manually." });

    const result = await verifyTaskWithAI({ task, employee, evidence });
    if (!result) return res.status(503).json({ error: "AI provider is not configured. Add the configured provider API key to backend/.env." });

    const report = buildVerificationReport({ task, employee, initialResult: result, initialEvidence: evidence });
    await req.db.collection("tasks").updateOne({ id: task.id }, {
      $set: {
        status: result.status,
        evidence,
        verification: { ...result, checkedAt: now(), evidenceSource: collected?.source || "USER_SUPPLIED" },
        verificationReport: report,
        updatedAt: now(),
      }
    });
    const risk = await recalculate(req.db, task.employeeId);
    await audit(req.db, req.user.id, "AI_VERIFY_TASK", `${task.id}:${result.status}`);
    await runAutomations(req.db).catch(error => console.error("[OnboardX automation]", error.message));

    res.json({ verified: result.status === "VERIFIED", result, report, task: await req.db.collection("tasks").findOne({ id: task.id }), risk });
  } catch (error) { next(error); }
});


app.post("/api/tasks/:id/remediate-ai", async (req, res, next) => {
  try {
    const task = await req.db.collection("tasks").findOne({ id: req.params.id });
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (task.taskType === "IDENTITY_VERIFICATION") return res.status(400).json({ error: "Identity verification cannot be autonomously remediated." });

    const permitted = ["ADMIN", "HR"].includes(req.user.role)
      || req.user.role === task.assignedRole
      || (req.user.role === "FACULTY_IT" && ["IT", "FACILITIES"].includes(task.assignedRole))
      || (req.user.role === "MANAGER" && task.assignedRole === "MANAGER");
    if (!permitted) return res.status(403).json({ error: "Cannot remediate this task" });

    const employee = await req.db.collection("employees").findOne({ id: task.employeeId, organizationId: req.user.organizationId });
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    if (!aiConfigured()) return res.status(503).json({ error: "AI provider is not configured." });

    const collected = await collectTaskEvidence({ task, employee });
    const evidence = String(task.evidence || "").trim() || (collected ? JSON.stringify(collected) : "");
    if (evidence.length < 10) return res.status(400).json({ error: "No source-system evidence is available to diagnose this task." });

    const initial = task.verification || { status: task.status, confidence: 0, reason: "The task is not currently verified." };
    const diagnosis = await diagnoseTaskWithAI({ task, employee, evidence });
    const capability = remediationCapability(task);
    const remediation = await executeRemediation({ db: req.db, task, employee, plan: diagnosis });

    let postEvidence = null;
    let finalStatus = initial.status;
    let finalResult = initial;
    if (remediation.executed) {
      const refreshedEmployee = await req.db.collection("employees").findOne({ id: employee.id });
      postEvidence = await postActionEvidence({ task, employee: refreshedEmployee || employee });
      const sourceConfirmed = evaluateSourceEvidence(task, postEvidence);
      if (sourceConfirmed === true) {
        finalStatus = "VERIFIED";
        finalResult = {
          status: "VERIFIED", confidence: 100,
          reason: "The authorized remediation completed and the connected source system confirmed the required conditions.",
          missingEvidence: [], provider: diagnosis?.provider || providerLabel(), model: diagnosis?.model || MODEL,
        };
      } else if (sourceConfirmed === false) {
        finalStatus = "FAILED";
        finalResult = { ...initial, status: "FAILED", confidence: 100, reason: "The remediation executed, but the post-action source-system check still shows a required condition is not satisfied." };
      } else {
        finalStatus = "BLOCKED";
        finalResult = { ...initial, status: "BLOCKED", confidence: 0, reason: "The remediation executed, but the source system did not provide enough evidence for a safe post-action verification." };
      }
    } else {
      finalStatus = "BLOCKED";
      finalResult = { ...initial, status: "BLOCKED", confidence: 0, reason: remediation.message || diagnosis?.actionReason || "No safe remediation was executed." };
    }

    const report = buildVerificationReport({ task, employee, initialResult: initial, initialEvidence: evidence, diagnosis, remediation: { ...remediation, action: diagnosis?.action || capability.action }, postEvidence, finalStatus });
    report.remediation.capability = capability;
    report.diagnosis.action = diagnosis?.action || "NO_ACTION";
    report.diagnosis.actionReason = diagnosis?.actionReason || "";
    report.diagnosis.successCriteria = diagnosis?.successCriteria || [];

    await req.db.collection("tasks").updateOne({ id: task.id }, { $set: {
      status: finalStatus,
      evidence: postEvidence ? JSON.stringify(postEvidence) : evidence,
      verification: { ...finalResult, checkedAt: now(), automated: true, remediation: true },
      verificationReport: report,
      updatedAt: now(),
    }});
    const risk = await recalculate(req.db, task.employeeId);
    await audit(req.db, req.user.id, "AI_REMEDIATE_TASK", `${task.id}:${finalStatus}:${diagnosis?.action || "NO_ACTION"}`);
    await runAutomations(req.db).catch(error => console.error("[OnboardX automation]", error.message));

    res.json({ fixed: finalStatus === "VERIFIED", result: finalResult, diagnosis, remediation, report, task: await req.db.collection("tasks").findOne({ id: task.id }), risk });
  } catch (error) { next(error); }
});

app.post("/api/tasks/:id/verify", async (req, res, next) => {
  try {
    const task = await req.db.collection("tasks").findOne({ id: req.params.id });
    if (!task) return res.status(404).json({ error: "Task not found" });
    if (task.taskType === "IDENTITY_VERIFICATION") return res.status(400).json({ error: "This task is verified by the employee onboarding identity flow, not by an HR checkbox." });
    if (!["ADMIN", "HR", task.assignedRole].includes(req.user.role) && !(req.user.role === "FACULTY_IT" && ["IT", "FACILITIES"].includes(task.assignedRole))) return res.status(403).json({ error: "Cannot verify this task" });
    if (!task.evidence || String(task.evidence).trim().length < 4) {
      await req.db.collection("tasks").updateOne({ id: task.id }, { $set: { status: "FAILED", updatedAt: now() } });
      await recalculate(req.db, task.employeeId);
      return res.status(400).json({ verified: false, error: "Evidence is required for verification" });
    }
    await req.db.collection("tasks").updateOne({ id: task.id }, { $set: { status: "VERIFIED", updatedAt: now() } });
    const r = await recalculate(req.db, task.employeeId);
    await audit(req.db, req.user.id, "VERIFY_TASK", task.id);
    res.json({ verified: true, task: await req.db.collection("tasks").findOne({ id: task.id }), risk: r });
  } catch (error) { next(error); }
});

app.get("/api/notifications", async (req, res, next) => {
  try { res.json(await req.db.collection("notifications").find({ userId: req.user.id }).sort({ createdAt: -1 }).toArray()); }
  catch (error) { next(error); }
});

app.patch("/api/notifications/:id/read", async (req, res, next) => {
  try {
    const n = await req.db.collection("notifications").findOne({ id: req.params.id, userId: req.user.id });
    if (!n) return res.status(404).json({ error: "Notification not found" });
    await req.db.collection("notifications").updateOne({ id: n.id }, { $set: { read: true } });
    res.json({ ...n, read: true });
  } catch (error) { next(error); }
});

app.get("/api/escalations", async (req, res, next) => {
  try {
    const filter = ["HR", "ADMIN"].includes(req.user.role) ? { } : { toRole: req.user.role };
    res.json(await req.db.collection("escalations").find(filter).sort({ createdAt: -1 }).toArray());
  } catch (error) { next(error); }
});

app.post("/api/tasks/:id/escalate", async (req, res, next) => {
  try {
    const task = await req.db.collection("tasks").findOne({ id: req.params.id });
    if (!task) return res.status(404).json({ error: "Task not found" });
    const toRole = task.assignedRole === "IT" ? "IT" : task.assignedRole === "FACILITIES" ? "FACILITIES" : "HR";
    const reason = req.body.reason || "Task requires attention";
    const emp = await req.db.collection("employees").findOne({ id: task.employeeId });
    if (!emp) return res.status(404).json({ error: "Employee not found" });

    // Keep the legacy escalation record for compatibility, but also create a
    // Day-1 escalation so the button feeds the same queue shown in Risk &
    // Escalation. This makes manual escalation immediately visible there.
    const esc = { id: uuid(), taskId: task.id, employeeId: task.employeeId, from: req.user.email, toRole, reason, createdAt: now(), status: "OPEN" };
    await req.db.collection("escalations").insertOne(esc);
    const day1Key = `manual-escalation:${task.id}:${new Date().toISOString().slice(0, 10)}`;
    const existingDay1 = await req.db.collection("day1Escalations").findOne({ key: day1Key, status: "OPEN" });
    const day1Esc = existingDay1 || { id: uuid(), key: day1Key, employeeId: task.employeeId, taskId: task.id, level: task.priority === "CRITICAL" ? "CRITICAL" : task.priority === "HIGH" ? "HIGH" : "MEDIUM", reason: `Manually escalated by ${req.user.email}: ${reason}`, createdAt: now(), status: "OPEN", source: "MANUAL" };
    if (!existingDay1) await req.db.collection("day1Escalations").insertOne(day1Esc);

    const recipients = await req.db.collection("users").find({
      $or: [{ role: { $in: ["HR", "ADMIN"] } }, { role: task.assignedRole }], organizationId: emp.organizationId,
    }).toArray();
    await Promise.all(recipients.map(u => addNotification(req.db, u.id, "Task escalated", `${task.name} for employee ${emp.name} needs attention.`, "ESCALATION")));
    await audit(req.db, req.user.id, "ESCALATE_TASK", task.id);
    res.status(201).json({ ...esc, day1Escalation: day1Esc });
  } catch (error) { next(error); }
});

app.get("/api/ai/status", (req, res) => {
  res.json({ configured: aiConfigured(), provider: providerLabel(), providerId: PROVIDER, model: MODEL });
});

app.post("/api/ai/chat", async (req, res, next) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "Ask a question first" });

    const employees = await canonicalEmployees(req.db, employeeFilterFor(req));
    const tasks = await req.db.collection("tasks").find(taskFilterFor(req)).toArray();
    const notifications = await req.db.collection("notifications").find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(10).toArray();
    const context = {
      user: { role: req.user.role, name: req.user.name },
      employees: employees.map(e => ({ id: e.id, name: e.name, email: e.email, department: e.department, designation: e.designation, joiningDate: e.joiningDate, readiness: e.readiness, status: e.status, identityVerificationStatus: e.identityVerificationStatus, onboardingStatus: e.onboardingStatus })),
      tasks: tasks.map(t => ({ id: t.id, employeeId: t.employeeId, name: t.name, assignedRole: t.assignedRole, priority: t.priority, deadline: t.deadline, status: t.status, taskType: t.taskType })),
      recentNotifications: notifications.map(n => ({ title: n.title, message: n.message, type: n.type, read: n.read, createdAt: n.createdAt })),
    };

    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const aiAnswer = await answerWithAI({ question: message, history, context, role: req.user.role });
    if (aiAnswer) return res.json({ answer: aiAnswer, provider: providerLabel(), model: MODEL, configured: true });

    const q = message.toLowerCase();
    if (q.includes("block") || q.includes("risk")) {
      const lines = [];
      for (const e of employees) {
        const r = await recalculate(req.db, e.id);
        lines.push(`${e.name}: ${r.readiness}% ready; blockers: ${r.blockers.join(", ") || "none"}.`);
      }
      return res.json({ answer: lines.join(" "), provider: "OnboardX fallback", model: null, configured: false });
    }
    if (q.includes("week") || q.includes("joining")) return res.json({ answer: employees.map(e => `${e.name} joins ${e.joiningDate} and is ${e.readiness}% ready.`).join(" "), provider: "OnboardX fallback", model: null, configured: false });
    if (q.includes("task")) return res.json({ answer: tasks.length ? tasks.map(t => `${t.name} for employee ${t.employeeId} is ${t.status} and due ${t.deadline}.`).join(" ") : "There are no tasks in your current view.", provider: "OnboardX fallback", model: null, configured: false });
    res.json({ answer: "AI is not configured yet. Add the configured AI provider API key to backend/.env to enable the full OnboardX AI Assistant. I can already answer a few onboarding status questions from the current app data.", provider: "OnboardX fallback", model: null, configured: false });
  } catch (error) { next(error); }
});

app.post("/api/ai/generate-tasks", allow("ADMIN", "HR"), async (req, res, next) => {
  try {
    const employee = await req.db.collection("employees").findOne({ id: req.body?.employeeId, organizationId: req.user.organizationId });
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    const tasks = generateTasks(employee);
    await req.db.collection("tasks").insertMany(tasks);
    res.json({ tasks });
  } catch (error) { next(error); }
});


// -------------------- Day-1 readiness orchestration (additive layer) --------------------
app.get("/api/day1/overview", async (req, res, next) => {
  try {
    const employees = await canonicalEmployees(req.db, employeeFilterFor(req));
    const snapshots = [];
    for (const employee of employees) {
      const snapshot = await buildDay1Snapshot(req.db, employee.id);
      if (snapshot) snapshots.push(snapshot);
    }
    const openEscalations = await req.db.collection("day1Escalations").find({ status: "OPEN", employeeId: { $in: employees.map(e => e.id) } }).sort({ createdAt: -1 }).toArray();
    res.json({ generatedAt: new Date().toISOString(), employees: snapshots, escalations: openEscalations });
  } catch (error) { next(error); }
});

app.get("/api/day1/:employeeId", async (req, res, next) => {
  try {
    const employee = await req.db.collection("employees").findOne({ id: req.params.employeeId, organizationId: req.user.organizationId });
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    const allowed = req.user.role === "HR" || req.user.role === "ADMIN"
      || (req.user.role === "EMPLOYEE" && req.user.employeeId === employee.id)
      || (req.user.role === "MANAGER" && employee.manager === req.user.name)
      || ["IT", "FACILITIES", "FACULTY_IT"].includes(req.user.role);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });
    const snapshot = await buildDay1Snapshot(req.db, employee.id);
    const escalations = await req.db.collection("day1Escalations").find({ employeeId: employee.id }).sort({ createdAt: -1 }).limit(50).toArray();
    res.json({ ...snapshot, escalations });
  } catch (error) { next(error); }
});

app.post("/api/day1/orchestrate", allow("ADMIN", "HR"), async (req, res, next) => {
  try {
    const result = await runDay1Orchestration(req.db);
    res.json({ ok: true, ...result });
  } catch (error) { next(error); }
});

app.post("/api/day1/:employeeId/orchestrate", async (req, res, next) => {
  try {
    const employee = await req.db.collection("employees").findOne({ id: req.params.employeeId, organizationId: req.user.organizationId });
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    if (!["ADMIN", "HR", "MANAGER", "IT", "FACILITIES", "FACULTY_IT"].includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    const result = await runDay1Orchestration(req.db);
    const snapshot = await buildDay1Snapshot(req.db, employee.id);
    res.json({ ok: true, result, snapshot });
  } catch (error) { next(error); }
});

app.patch("/api/day1/escalations/:id/ack", async (req, res, next) => {
  try {
    const escalation = await req.db.collection("day1Escalations").findOne({ id: req.params.id });
    if (!escalation) return res.status(404).json({ error: "Escalation not found" });
    const employee = await req.db.collection("employees").findOne({ id: escalation.employeeId, organizationId: req.user.organizationId });
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    if (!["ADMIN", "HR", "MANAGER", "IT", "FACILITIES", "FACULTY_IT"].includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    const updated = await acknowledgeEscalation(req.db, escalation.id, req.user.id);
    res.json({ escalation: updated });
  } catch (error) { next(error); }
});

app.post("/api/automation/run", allow("ADMIN", "HR"), async (req, res, next) => {
  try {
    const result = await runAutomations(req.db);
    const day1 = await runDay1Orchestration(req.db);
    res.json({ ok: true, ...result, day1 });
  } catch (error) { next(error); }
});

app.post("/api/n8n/webhook", (req, res) => res.json({ received: true, message: "OnboardX webhook received", payload: req.body }));
app.get("/api/audit", allow("ADMIN", "HR"), async (req, res, next) => {
  try { res.json(await req.db.collection("auditLogs").find({}).sort({ createdAt: -1 }).limit(500).toArray()); }
  catch (error) { next(error); }
});

async function migrateLegacyTasks(db) {
  // Normalize the old identity task name/type.
  await db.collection("tasks").updateMany(
    { name: "Verify documents", taskType: { $exists: false } },
    { $set: { name: "Complete identity verification", taskType: "IDENTITY_VERIFICATION", assignedRole: "EMPLOYEE", department: "EMPLOYEE", updatedAt: now() } }
  );

  // Older generated tasks did not carry organizationId. The task API is
  // organization-scoped, so backfill the field from each task's employee.
  const missingOrgTasks = await db.collection("tasks").find({ organizationId: { $exists: false } }).toArray();
  for (const task of missingOrgTasks) {
    if (!task.employeeId) continue;
    const employee = await db.collection("employees").findOne({ id: task.employeeId });
    if (employee?.organizationId) {
      await db.collection("tasks").updateOne(
        { id: task.id },
        { $set: { organizationId: employee.organizationId, updatedAt: now() } }
      );
    }
  }
}

app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File exceeds the 10 MB limit" });
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_COUNT") return res.status(400).json({ error: "Upload exactly two Aadhaar images: one front and one back." });
  if (err instanceof multer.MulterError && err.code === "LIMIT_UNEXPECTED_FILE") return res.status(400).json({ error: "Upload only one image in each Aadhaar slot: front and back." });
  res.status(500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, async () => {
  console.log(`OnboardX API running on http://localhost:${PORT}`);
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    await migrateLegacyTasks(db);
    await runAutomations(db);
    await runDay1Orchestration(db).catch(error => console.error("[OnboardX Day-1 orchestration]", error.message));
    console.log(`MongoDB connected: ${db.databaseName}`);
    const interval = Math.max(15000, Number(process.env.AUTOMATION_INTERVAL_MS || 60000));
    setInterval(() => {
      runAutomations(db).catch(error => console.error("[OnboardX automation]", error.message));
      runDay1Orchestration(db).catch(error => console.error("[OnboardX Day-1 orchestration]", error.message));
    }, interval);
    console.log(`OnboardX automation worker running every ${interval} ms`);
  } catch (error) {
    console.error(`MongoDB connection failed: ${error.message}`);
  }
});
