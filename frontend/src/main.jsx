import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard, Users, ClipboardCheck, Bell, ShieldAlert, LogOut, Brain,
  CheckCircle2, Clock3, ArrowRight, FileCheck2, UserRound, Building2, KeyRound,
  Smartphone, Mail, MapPin, BadgeCheck, AlertTriangle, Copy, ExternalLink, Trash2,
} from "lucide-react";
import "./styles.css";
import { Day1ControlCenter } from "./day1.jsx";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

async function api(path, options = {}) {
  const token = localStorage.getItem("onboardx_token");
  const isForm = options.body instanceof FormData;
  const headers = {
    ...(isForm ? {} : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const r = await fetch(API + path, { ...options, headers });
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || "Request failed" }; }
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}

function useRoute() {
  const [route, setRoute] = useState(window.location.pathname + window.location.search);
  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname + window.location.search);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = (to) => {
    window.history.pushState({}, "", to);
    setRoute(to);
    window.scrollTo(0, 0);
  };
  return { route, navigate };
}

const roleLabel = (role) => ({
  ADMIN: "Administrator", HR: "HR", MANAGER: "Manager", IT: "Faculty / IT", FACILITIES: "Faculty / IT", FACULTY_IT: "Faculty / IT", EMPLOYEE: "Employee",
}[role] || role);

function Landing({ navigate }) {
  return <div className="landing">
    <header className="landing-nav">
      <div className="brand dark">ONBOARD<span>X</span></div>
      <button className="text-button" onClick={() => navigate("/login?portal=employee")}>Existing user login</button>
    </header>
    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow">AUTONOMOUS EMPLOYEE ONBOARDING</div>
        <h1>Verify the work.<br /><span>Not the checkbox.</span></h1>
        <p>OnboardX guides every new hire through secure onboarding, identity checks, evidence collection and Day-1 readiness while HR, managers and operations see the live state.</p>
        <div className="hero-actions">
          <button className="primary large" onClick={() => navigate("/onboard")}>Start Employee Onboarding <ArrowRight size={18} /></button>
          <button className="secondary large" onClick={() => navigate("/login?portal=hr")}>Staff portals</button>
        </div>
        <div className="trust-row"><span>✓ Self-service onboarding</span><span>✓ Evidence-based verification</span><span>✓ Role-based access</span></div>
      </div>
      <div className="hero-panel">
        <div className="hero-panel-head"><span>Live onboarding state</span><span className="live-dot">● Live</span></div>
        <div className="hero-score"><div><small>Day-1 readiness</small><strong>92%</strong></div><div className="ring">92</div></div>
        <div className="mini-check"><span><CheckCircle2 size={17} /> Identity</span><b>Verified</b></div>
        <div className="mini-check"><span><CheckCircle2 size={17} /> Documents</span><b>Verified</b></div>
        <div className="mini-check"><span><AlertTriangle size={17} /> Laptop</span><b className="warn">Pending</b></div>
        <div className="mini-check"><span><CheckCircle2 size={17} /> Manager tasks</span><b>Verified</b></div>
      </div>
    </section>
    <section className="role-section">
      <div><div className="eyebrow">ORGANIZATION PORTALS</div><h2>Everyone gets the dashboard they actually need.</h2></div>
      <div className="role-cards">
        <PortalCard icon={<ShieldAlert />} title="HR" desc="Invitations, verification status, readiness and escalations." onClick={() => navigate("/login?portal=hr")} />
        <PortalCard icon={<UserRound />} title="Manager" desc="Team readiness, manager tasks, mentors and blockers." onClick={() => navigate("/login?portal=manager")} />
        <PortalCard icon={<Building2 />} title="Faculty / IT" desc="Accounts, equipment, access and operational tasks." onClick={() => navigate("/login?portal=it")} />
      </div>
    </section>
    <footer className="landing-footer">OnboardX · Verification-first onboarding architecture</footer>
  </div>;
}

function PortalCard({ icon, title, desc, onClick }) {
  return <button className="portal-card" onClick={onClick}><div className="portal-icon">{icon}</div><div><h3>{title}</h3><p>{desc}</p></div><ArrowRight size={18} /></button>;
}

function Login({ portal, onLogin, navigate }) {
  const defaults = portal === "hr" ? "hr@demo.com" : portal === "manager" ? "manager@demo.com" : portal === "it" ? "it@demo.com" : "employee@demo.com";
  const [email, setEmail] = useState(defaults), [password, setPassword] = useState("demo123"), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const d = await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      localStorage.setItem("onboardx_token", d.token);
      localStorage.setItem("onboardx_email", d.user.email);
      onLogin(d.user);
      navigate("/app");
    } catch (x) { setError(x.message); } finally { setBusy(false); }
  };
  return <div className="login-shell">
    <div className="login-card modern">
      <button className="back-link" onClick={() => navigate("/")}>← Back to OnboardX</button>
      <div className="brand dark">ONBOARD<span>X</span></div>
      <p className="eyebrow">{portal === "employee" ? "EMPLOYEE ACCESS" : "STAFF PORTAL"}</p>
      <h1>{portal === "employee" ? "Employee login" : `${roleLabel(portal.toUpperCase())} login`}</h1>
      <p className="muted">Your role is checked by the backend after authentication.</p>
      <form onSubmit={submit} className="login-form">
        <label>Email<input value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>
        {error && <div className="error">{error}</div>}
        <button className="primary large" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <div className="demo"><b>Local demo accounts</b><br />HR · hr@demo.com<br />Manager · manager@demo.com<br />Faculty / IT · it@demo.com<br />Employee · employee@demo.com<br /><span>Password: demo123</span></div>
    </div>
  </div>;
}

function OnboardingStart({ navigate }) {
  const params = new URLSearchParams(window.location.search);
  const [token, setToken] = useState(params.get("token") || "");
  const [info, setInfo] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const start = async () => {
    if (!token.trim()) return setError("Paste the secure invitation token from your onboarding link.");
    setBusy(true); setError("");
    try { const d = await api(`/onboarding/invite/${encodeURIComponent(token.trim())}`); setInfo(d); navigate(`/onboard/verify?token=${encodeURIComponent(token.trim())}`); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <div className="onboard-shell"><div className="onboard-card">
    <div className="brand dark">ONBOARD<span>X</span></div><div className="eyebrow">EMPLOYEE ONBOARDING</div><h1>Start your secure onboarding</h1>
    <p className="muted">Your HR team sends a unique invitation link. We use it to connect your onboarding to the correct company and employee record.</p>
    <label>Invitation token<input placeholder="Paste token" value={token} onChange={e => setToken(e.target.value)} /></label>
    {error && <div className="error">{error}</div>}
    <button className="primary large" onClick={start} disabled={busy}>{busy ? "Checking invitation…" : "Continue"} <ArrowRight size={18} /></button>
    <button className="text-button" onClick={() => navigate("/")}>Back to landing</button>
  </div></div>;
}

function EmployeeOnboarding({ navigate }) {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const isAccountPath = window.location.pathname.startsWith("/onboard/account");
  const [info, setInfo] = useState(null), [step, setStep] = useState(0), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState({}), [otp, setOtp] = useState(""), [demoCode, setDemoCode] = useState("");
  const [form, setForm] = useState({ name: "", dateOfBirth: "", gender: "", phone: "", personalEmail: "", address: "" });
  const [frontFile, setFrontFile] = useState(null), [backFile, setBackFile] = useState(null), [verification, setVerification] = useState(null), [password, setPassword] = useState(""), [complete, setComplete] = useState(false);

  useEffect(() => {
    if (!token) return setError("This onboarding link is missing its invitation token.");
    api(`/onboarding/invite/${encodeURIComponent(token)}`).then(d => {
      setInfo(d); const e = d.employee || {};
      setForm({ name: e.name || "", dateOfBirth: e.dateOfBirth || "", gender: e.gender || "", phone: e.phone || "", personalEmail: e.personalEmail || e.email || "", address: e.address || "" });
      if (d.verification) setVerification(d.verification);
      if (isAccountPath) {
        if (["VERIFIED", "SKIPPED"].includes(d.verification?.status)) setStep(4);
        else {
          setStep(3);
          navigate(`/onboard/verify?token=${encodeURIComponent(token)}`);
        }
      } else if (d.state?.profileCompleted) setStep(3);
      else if (d.state?.phoneVerified) setStep(2);
      else if (d.state?.emailVerified) setStep(1);
      else setStep(0);
    }).catch(e => setError(e.message));
  }, [token, isAccountPath]);

  const refresh = async () => { const d = await api(`/onboarding/invite/${encodeURIComponent(token)}`); setInfo(d); if (d.verification) setVerification(d.verification); return d; };
  const beginOtp = async (channel) => {
    if (channel === "phone" && !form.phone.trim()) return setError("Enter your phone number before requesting the verification code.");
    setBusy(true); setError("");
    try {
      const payload = channel === "phone" ? { channel, phone: form.phone.trim() } : { channel };
      const d = await api(`/onboarding/${encodeURIComponent(token)}/otp/start`, { method: "POST", body: JSON.stringify(payload) });
      setChallenge({ channel, id: d.challengeId }); setDemoCode(d.demoCode || "");
    } catch(e) { setError(e.message); } finally { setBusy(false); }
  };
  const verifyOtp = async () => { setBusy(true); setError(""); try { await api(`/onboarding/${encodeURIComponent(token)}/otp/verify`, { method: "POST", body: JSON.stringify({ challengeId: challenge.id, code: otp }) }); await refresh(); setOtp(""); setDemoCode(""); setChallenge({}); setStep(challenge.channel === "email" ? 1 : 2); } catch(e) { setError(e.message); } finally { setBusy(false); } };
  const saveProfile = async (e) => { e.preventDefault(); setBusy(true); setError(""); try { await api(`/onboarding/${encodeURIComponent(token)}/profile`, { method: "POST", body: JSON.stringify(form) }); await refresh(); setStep(3); } catch(e) { setError(e.message); } finally { setBusy(false); } };
  const verifyIdentity = async () => {
    if (!frontFile || !backFile) return setError("Upload both the front and back Aadhaar images before continuing.");
    setBusy(true); setError("");
    const fd = new FormData(); fd.append("documentFront", frontFile); fd.append("documentBack", backFile);
    try {
      const d = await api(`/onboarding/${encodeURIComponent(token)}/identity`, { method: "POST", body: fd });
      setVerification(d); await refresh();
      if (d.status === "VERIFIED") {
        setStep(4);
        navigate(`/onboard/account?token=${encodeURIComponent(token)}`);
      }
    } catch(e) { setError(e.message); } finally { setBusy(false); }
  };
  const skipIdentity = async () => {
    if (!window.confirm("Skip Aadhaar verification for now? The employee will be allowed to create a login, but Aadhaar will remain UNVERIFIED.")) return;
    setBusy(true); setError("");
    try {
      const d = await api(`/onboarding/${encodeURIComponent(token)}/skip-identity`, { method: "POST" });
      setVerification(d); await refresh(); setStep(4);
    } catch(e) { setError(e.message); } finally { setBusy(false); }
  };
  const createAccount = async (e) => { e.preventDefault(); setBusy(true); setError(""); try { const d = await api(`/onboarding/${encodeURIComponent(token)}/complete`, { method: "POST", body: JSON.stringify({ password }) }); localStorage.setItem("onboardx_token", d.token); localStorage.setItem("onboardx_email", d.user.email); setComplete(true); } catch(e) { setError(e.message); } finally { setBusy(false); } };

  if (complete) return <div className="onboard-shell"><div className="onboard-card success-card"><div className="success-icon"><CheckCircle2 /></div><div className="eyebrow">ONBOARDING COMPLETE</div><h1>Your employee account is ready.</h1><p>Your verified onboarding record is now connected to your employee login.</p><div className="credential-box"><b>Login ID</b><span>{form.personalEmail}</span></div><button className="primary large" onClick={() => navigate("/app?portal=employee")}>Open Employee Dashboard <ArrowRight size={18} /></button></div></div>;
  if (!info) return <div className="onboard-shell"><div className="onboard-card"><div className="brand dark">ONBOARD<span>X</span></div><h1>Loading onboarding…</h1>{error && <div className="error">{error}</div>}</div></div>;

  const steps = ["Email", "Phone", "Profile", "Identity", "Account"];
  return <div className="onboard-shell"><div className="onboard-wide">
    <div className="onboard-top"><div className="brand dark">ONBOARD<span>X</span></div><span>{info.company}</span></div>
    <div className="stepper">{steps.map((s, i) => <div className={"step " + (i === step ? "active " : "") + (i < step ? "done" : "")} key={s}><span>{i < step ? "✓" : i + 1}</span>{s}</div>)}</div>
    {error && <div className="error page-error">{error}</div>}
    {step === 0 && <><VerificationStep title="Verify your email" icon={<Mail />} text={`We will confirm control of ${form.personalEmail}.`} challenge={challenge} otp={otp} setOtp={setOtp} demoCode={demoCode} begin={() => beginOtp("email")} verify={verifyOtp} busy={busy} /><StepBackButton onClick={() => navigate(`/onboard?token=${encodeURIComponent(token)}`)} label="Back" /></>}
    {step === 1 && <><PhoneVerificationStep phone={form.phone} setPhone={value => setForm({ ...form, phone: value })} challenge={challenge} otp={otp} setOtp={setOtp} demoCode={demoCode} begin={() => beginOtp("phone")} verify={verifyOtp} busy={busy} /><StepBackButton onClick={() => setStep(0)} label="Back" /></>}
    {step === 2 && <><form className="onboard-form" onSubmit={saveProfile}><div><div className="eyebrow">YOUR DETAILS</div><h1>Complete your profile</h1><p className="muted">These details become the employee record that the identity verification checks against.</p><div className="profile-name-note"><b>Name spelling matters.</b><span>Enter your full name exactly as it appears on your Aadhaar. Keep the same spelling, initials and name order.</span></div></div><div className="form-grid">
      <Field label="Full name"><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Date of birth"><input required type="date" value={form.dateOfBirth} onChange={e => setForm({ ...form, dateOfBirth: e.target.value })} /></Field>
      <Field label="Gender"><select required value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}><option value="">Select</option><option>Male</option><option>Female</option><option>Other</option><option>Prefer not to say</option></select></Field>
      <Field label="Phone"><input required value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></Field>
      <Field label="Personal email"><input required readOnly type="email" value={form.personalEmail} onChange={e => setForm({ ...form, personalEmail: e.target.value })} /></Field>
      <Field label="Address" wide><textarea required value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></Field>
    </div><button className="primary large" disabled={busy}>{busy ? "Saving…" : "Save profile & continue"} <ArrowRight size={18} /></button></form><StepBackButton onClick={() => setStep(1)} label="Back" /></>}
    {step === 3 && <><IdentityStep frontFile={frontFile} setFrontFile={setFrontFile} backFile={backFile} setBackFile={setBackFile} verify={verifyIdentity} skip={skipIdentity} verification={verification} busy={busy} employee={form} /><StepBackButton onClick={() => setStep(2)} label="Back" /></>}
    {step === 4 && <><form className="onboard-form narrow" onSubmit={createAccount}><div className={`verification-banner ${verification?.status === "SKIPPED" ? "skipped" : ""}`}><BadgeCheck /><div><b>{verification?.status === "SKIPPED" ? "Identity verification deferred" : "Identity verification complete"}</b><span>{verification?.status === "SKIPPED" ? "Aadhaar was skipped for this prototype. The account can be created, but the identity remains unverified." : "Your Aadhaar consistency check passed. Real government authenticity should be added later through an authorized provider."}</span></div></div><div className="eyebrow">CREATE LOGIN</div><h1>Choose your password</h1><p className="muted">Your login ID will be your verified personal email.</p><Field label="Password"><input required type="password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} /></Field><button className="primary large" disabled={busy}>{busy ? "Creating account…" : "Create employee login"} <KeyRound size={18} /></button></form><StepBackButton onClick={() => setStep(3)} label="Back" /></>}
  </div></div>;
}

function VerificationStep({ title, icon, text, challenge, otp, setOtp, demoCode, begin, verify, busy }) {
  return <div className="onboard-form centered-step"><div className="big-step-icon">{icon}</div><div className="eyebrow">SECURE VERIFICATION</div><h1>{title}</h1><p className="muted">{text}</p>{!challenge.id ? <button className="primary large" onClick={begin} disabled={busy}>{busy ? "Generating code…" : "Send verification code"}</button> : <><div className="otp-box"><input inputMode="numeric" maxLength={6} placeholder="6-digit code" value={otp} onChange={e => setOtp(e.target.value)} /></div>{demoCode && <div className="demo-code">Development mode code: <b>{demoCode}</b></div>}<button className="primary large" onClick={verify} disabled={busy || otp.length < 6}>{busy ? "Verifying…" : "Verify code"} <CheckCircle2 size={18} /></button></>}</div>;
}

function PhoneVerificationStep({ phone, setPhone, challenge, otp, setOtp, demoCode, begin, verify, busy }) {
  return <div className="onboard-form centered-step"><div className="big-step-icon"><Smartphone /></div><div className="eyebrow">SECURE VERIFICATION</div><h1>Verify your phone</h1><p className="muted">Enter the phone number you want to use for onboarding alerts. We will send a one-time verification code to this number.</p>{!challenge.id ? <><div className="phone-field"><Field label="Phone number"><input required type="tel" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" value={phone} onChange={e => setPhone(e.target.value)} /></Field></div><button className="primary large" onClick={begin} disabled={busy || !phone.trim()}>{busy ? "Generating code…" : "Send verification code"}</button></> : <><div className="verified-destination">Code sent to <b>{phone}</b></div><div className="otp-box"><input inputMode="numeric" maxLength={6} placeholder="6-digit code" value={otp} onChange={e => setOtp(e.target.value)} /></div>{demoCode && <div className="demo-code">Development mode code: <b>{demoCode}</b></div>}<button className="primary large" onClick={verify} disabled={busy || otp.length < 6}>{busy ? "Verifying…" : "Verify code"} <CheckCircle2 size={18} /></button></>}</div>;
}

function StepBackButton({ onClick, label = "Back" }) { return <div className="step-back-wrap"><button type="button" className="step-back" onClick={onClick}>← {label}</button></div>; }

function IdentityStep({ frontFile, setFrontFile, backFile, setBackFile, verify, skip, verification, busy }) {
  return <div className="onboard-form"><div className="eyebrow">AADHAAR · LEVEL 1 + CONSISTENCY CHECK</div><h1>Verify your identity document</h1><p className="muted">Upload clear images of both sides of your Aadhaar. OnboardX validates each file, extracts visible text with OCR, and checks that your name and address match the details you entered. Date of birth is also checked when confidently extracted.</p><div className="aadhaar-upload-grid">
    <AadhaarUpload label="Front side" file={frontFile} onFile={setFrontFile} />
    <AadhaarUpload label="Back side" file={backFile} onFile={setBackFile} />
  </div><div className="privacy-note">For this prototype, this is a document consistency check—not a claim of official Aadhaar authenticity. Use only the required document images. Raw document files should be moved to encrypted object storage before production.</div><div className="actions identity-actions"><button className="primary large" onClick={verify} disabled={busy || !frontFile || !backFile}>{busy ? "Checking both sides…" : "Validate & verify"} <BadgeCheck size={18} /></button><button type="button" className="secondary large" onClick={skip} disabled={busy}>Skip Aadhaar for now</button></div>{verification && <VerificationResult result={verification} />}</div>;
}

function AadhaarUpload({ label, file, onFile }) {
  return <label className="upload-box aadhaar-upload"><FileCheck2 size={28} /><strong>{label}</strong><b>{file ? file.name : `Choose ${label.toLowerCase()} image`}</b><span>JPG / PNG · max 10 MB</span><input type="file" accept="image/jpeg,image/png" onChange={e => onFile(e.target.files?.[0] || null)} /></label>;
}

function VerificationResult({ result }) {
  const rows = [
    ["Front image validation", result.sides?.front ?? result.level1, (result.sides?.front ?? result.level1) ? "Passed" : "Failed"],
    ["Back image validation", result.sides?.back ?? result.level1, (result.sides?.back ?? result.level1) ? "Passed" : "Failed"],
    ["Name match", result.matches?.name, result.matches?.name ? "Matched" : "Not matched"],
    ["Date of birth match", result.matches?.dob, result.matches?.dob ? "Matched" : "Not matched"],
    ["Address match", result.matches?.address, result.matches?.address ? "Matched" : "Not matched"],
  ];
  return <div className="verification-result"><div className="result-head"><span className={`result-status ${result.status}`}>{result.status}</span><small>{result.message}</small></div>{rows.map(([label, ok, value]) => <div className="result-row" key={label}><span>{label}</span><b className={ok ? "ok" : "bad"}>{ok ? "✓ " : "⚠ "}{value}</b></div>)}{result.status === "VERIFIED" && <a className="continue-link" href={`/onboard/account?token=${encodeURIComponent(new URLSearchParams(window.location.search).get("token") || "")}`}>Continue to account creation <ArrowRight size={16} /></a>}</div>;
}

function Field({ label, children, wide }) { return <label className={wide ? "field wide" : "field"}><span>{label}</span>{children}</label>; }

function AppShell({ user, navigate, onLogout }) {
  const [page, setPage] = useState("dashboard");
  const [data, setData] = useState({ employees: [], tasks: [], notifications: [] });
  const [summary, setSummary] = useState({});
  const [selectedEmployee, setSelectedEmployee] = useState(null);

  useEffect(() => { refresh(); }, [user, page]);
  async function refresh() { try { const [s, e, t, n] = await Promise.all([api("/dashboard/summary"), api("/employees"), api("/tasks"), api("/notifications")]); setSummary(s); setData({ employees: e, tasks: t, notifications: n }); } catch {} }

  const role = user.role;
  const isOps = ["IT", "FACILITIES", "FACULTY_IT"].includes(role);
  const nav = useMemo(() => {
    if (role === "EMPLOYEE") return [["dashboard", "My onboarding", LayoutDashboard], ["tasks", "My tasks", ClipboardCheck], ["ai", "AI Assistant", Brain], ["notifications", "Notifications", Bell]];
    if (role === "MANAGER") return [["dashboard", "Team dashboard", LayoutDashboard], ["tasks", "Manager tasks", ClipboardCheck], ["risk", "Team risks", ShieldAlert], ["ai", "AI Assistant", Brain], ["notifications", "Notifications", Bell]];
    if (isOps) return [["dashboard", "Operations", LayoutDashboard], ["tasks", "IT & access tasks", ClipboardCheck], ["risk", "Readiness", ShieldAlert], ["ai", "AI Assistant", Brain], ["notifications", "Notifications", Bell]];
    return [["dashboard", "Dashboard", LayoutDashboard], ["employees", "Employees", Users], ["tasks", "Tasks", ClipboardCheck], ["risk", "Risk & Escalation", ShieldAlert], ["ai", "AI Assistant", Brain], ["notifications", "Notifications", Bell]];
  }, [role, isOps]);

  const pageTitle = nav.find(n => n[0] === page)?.[1] || "Dashboard";
  return <div className="app"><aside><div className="brand small">ONBOARD<span>X</span></div><div className="role">{roleLabel(role)}</div><nav>{nav.map(([id, label, Icon]) => <button className={page === id ? "active" : ""} onClick={() => setPage(id)} key={id}><Icon size={18} />{label}</button>)}</nav><button className="logout" onClick={onLogout}><LogOut size={18} /> Logout</button></aside><main><header><div><h1>{pageTitle}</h1><p className="muted">{user.name} · {roleLabel(role)}</p></div><div className="avatar">{user.name?.[0] || "U"}</div></header>
    {page === "dashboard" && <RoleDashboard user={user} summary={summary} employees={data.employees} tasks={data.tasks} role={role} isOps={isOps} onEmployee={(e) => { setSelectedEmployee(e); setPage("employee-detail"); }} />}
    {page === "employees" && <Employees employees={data.employees} canCreate={role === "HR" || role === "ADMIN"} refresh={refresh} />}
    {page === "employee-detail" && selectedEmployee && <EmployeeDetail employee={selectedEmployee} onBack={() => setPage("employees")} />}
    {page === "tasks" && <Tasks tasks={data.tasks} employees={data.employees} refresh={refresh} user={user} />}
    {page === "risk" && <><Day1ControlCenter api={api} employees={data.employees} user={user} /><Risk employees={data.employees} tasks={data.tasks} role={role} /></>}
    {page === "ai" && <Assistant />}
    {page === "notifications" && <Notifications notifications={data.notifications} refresh={refresh} />}
  </main></div>;
}

function RoleDashboard({ user, summary, employees, tasks, role, isOps, onEmployee }) {
  if (role === "EMPLOYEE") return <EmployeeDashboard user={user} employees={employees} tasks={tasks} />;
  if (role === "MANAGER") return <ManagerDashboard summary={summary} employees={employees} tasks={tasks} onEmployee={onEmployee} />;
  if (isOps) return <OpsDashboard summary={summary} employees={employees} tasks={tasks} />;
  return <HRDashboard summary={summary} employees={employees} onEmployee={onEmployee} />;
}

function HRDashboard({ summary, employees, onEmployee }) { return <><div className="cards"><Card title="Total onboarding" value={summary.total || 0} icon={<Users />} /><Card title="Day-1 ready" value={summary.ready || 0} icon={<CheckCircle2 />} /><Card title="At risk" value={summary.atRisk || 0} icon={<ShieldAlert />} /><Card title="Overdue tasks" value={summary.overdue || 0} icon={<Clock3 />} /></div><EmployeeTable title="Onboarding overview" employees={employees} onEmployee={onEmployee} /></>; }
function ManagerDashboard({ summary, employees, tasks, onEmployee }) { return <><div className="cards"><Card title="My new hires" value={summary.total || 0} icon={<Users />} /><Card title="Team ready" value={summary.ready || 0} icon={<CheckCircle2 />} /><Card title="At risk" value={summary.atRisk || 0} icon={<ShieldAlert />} /><Card title="My pending tasks" value={tasks.filter(t => t.status !== "VERIFIED").length} icon={<ClipboardCheck />} /></div><EmployeeTable title="My team onboarding" employees={employees} onEmployee={onEmployee} /><section className="panel"><div className="section-title"><h2>Manager responsibilities</h2><span>Complete in Tasks</span></div><div className="manager-grid"><MiniTask label="Assign mentor" /><MiniTask label="Prepare first project" /><MiniTask label="Schedule introduction" /></div></section></>; }
function OpsDashboard({ summary, employees, tasks }) { return <><div className="cards"><Card title="Employees" value={summary.total || 0} icon={<Users />} /><Card title="Ready" value={summary.ready || 0} icon={<CheckCircle2 />} /><Card title="At risk" value={summary.atRisk || 0} icon={<ShieldAlert />} /><Card title="Pending ops" value={tasks.filter(t => t.status !== "VERIFIED").length} icon={<Building2 />} /></div><EmployeeTable title="Operations readiness" employees={employees} /><section className="panel"><div className="section-title"><h2>Provisioning checks</h2><span>Evidence-based status</span></div><div className="ops-list"><div><KeyRound /> Corporate account creation</div><div><Building2 /> Workspace & access card</div><div><ShieldAlert /> VPN / system access</div><div><FileCheck2 /> Equipment evidence</div></div></section></>; }
function EmployeeDashboard({ user, employees, tasks }) { const e = employees[0]; return <><div className="employee-welcome"><div><div className="eyebrow">WELCOME TO ONBOARDX</div><h2>{e?.name || user.name}</h2><p className="muted">{e?.designation || "Employee"} · joining {e?.joiningDate || "—"}</p></div><div className="employee-score"><span>Day-1 readiness</span><strong>{e?.readiness || 0}%</strong></div></div><div className="cards"><Card title="Verification" value={e?.identityVerificationStatus === "VERIFIED" ? "PASS" : "PENDING"} icon={<BadgeCheck />} /><Card title="Pending tasks" value={tasks.filter(t => t.status !== "VERIFIED").length} icon={<ClipboardCheck />} /><Card title="Joining" value={e?.joiningDate || "—"} icon={<Clock3 />} /><Card title="Employee ID" value={e?.employeeCode || "—"} icon={<UserRound />} /></div><section className="panel"><div className="section-title"><h2>My onboarding state</h2><span>Evidence-backed</span></div><OnboardingState employee={e} tasks={tasks} /></section></>; }

function OnboardingState({ employee, tasks }) {
  const checks = [
    ["Email verification", employee?.onboardingState?.emailVerified], ["Phone verification", employee?.onboardingState?.phoneVerified], ["Profile", employee?.onboardingState?.profileCompleted], ["Aadhaar consistency check", employee?.identityVerificationStatus === "VERIFIED"], ["Employee account", employee?.onboardingState?.accountCreated],
  ];
  return <div className="state-grid">{checks.map(([label, ok]) => <div className="state-item" key={label}><span>{ok ? <CheckCircle2 /> : <Clock3 />}{label}</span><b className={ok ? "ok" : "pending-text"}>{ok ? "Completed" : "Pending"}</b></div>)}<div className="state-item full"><span>Remaining onboarding tasks</span><div className="task-chips">{tasks.filter(t => t.status !== "VERIFIED").slice(0, 8).map(t => <span key={t.id}>{t.name}</span>)}</div></div></div>;
}

function EmployeeTable({ title, employees, onEmployee, canDelete, onDelete }) {
  return <section className="panel"><div className="section-title"><h2>{title}</h2><span>{employees.length} record{employees.length === 1 ? "" : "s"}</span></div><table><thead><tr><th>Employee</th><th>Role</th><th>Joining</th><th>Readiness</th><th>Status</th>{canDelete && <th>Actions</th>}</tr></thead><tbody>{employees.map(e => <tr key={e.id} className={onEmployee ? "clickable" : ""} onClick={() => onEmployee?.(e)}><td><b>{e.name}</b><small>{e.email}</small></td><td>{e.designation}</td><td>{e.joiningDate}</td><td><div className="progress"><i style={{ width: `${e.readiness}%` }} /></div>{e.readiness}%</td><td><Status s={e.status} /></td>{canDelete && <td onClick={ev => ev.stopPropagation()}><button className="danger-button" onClick={() => onDelete?.(e)}><Trash2 size={14} /> Delete</button></td>}</tr>)}</tbody></table>{!employees.length && <div className="empty">No employees are assigned to this portal yet.</div>}</section>; }
function Card({ title, value, icon }) { return <div className="card"><div><span>{title}</span><strong>{value}</strong></div><div className="card-icon">{icon}</div></div>; }
function Status({ s }) { return <span className={`status ${s}`}>{String(s || "PENDING").replaceAll("_", " ")}</span>; }
function MiniTask({ label }) { return <div className="mini-task"><span>{label}</span><span className="status PENDING">Pending</span></div>; }

function Employees({ employees, canCreate, refresh }) {
  const [open, setOpen] = useState(false), [created, setCreated] = useState(null), [form, setForm] = useState({ name: "", email: "", designation: "Software Engineer", department: "Engineering", joiningDate: "2026-10-10", manager: "Engineering Manager", location: "" });
  const create = async (e) => { e.preventDefault(); try { const d = await api("/employees", { method: "POST", body: JSON.stringify(form) }); setCreated(d); refresh(); } catch (x) { alert(x.message); } };
  const copy = async () => { await navigator.clipboard.writeText(created?.inviteUrl || ""); };
  const remove = async (employee) => {
    if (!window.confirm(`Delete ${employee.name} and all of their onboarding data? This cannot be undone.`)) return;
    try { await api(`/employees/${employee.id}`, { method: "DELETE" }); refresh(); } catch (x) { alert(x.message); }
  };
  return <><div className="toolbar"><div><div className="eyebrow">HR OPERATIONS</div><h2>Employees</h2><p className="muted">Create the employee record and send a secure self-service invitation. HR never needs to upload the employee's documents.</p></div>{canCreate && <button className="primary" onClick={() => { setOpen(true); setCreated(null); }}>+ Invite employee</button>}</div><EmployeeTable title="Central onboarding records" employees={employees} canDelete={canCreate} onDelete={remove} />{open && <div className="modal"><div className="modal-card wide-modal">{!created ? <form onSubmit={create}><h2>Create employee invitation</h2><p className="muted">These fields establish the employment record. The employee supplies personal details and identity documents themselves.</p><div className="form-grid"><Field label="Full name"><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field><Field label="Personal email"><input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field><Field label="Designation"><input required value={form.designation} onChange={e => setForm({ ...form, designation: e.target.value })} /></Field><Field label="Department"><input required value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} /></Field><Field label="Joining date"><input required type="date" value={form.joiningDate} onChange={e => setForm({ ...form, joiningDate: e.target.value })} /></Field><Field label="Manager"><input value={form.manager} onChange={e => setForm({ ...form, manager: e.target.value })} /></Field><Field label="Location"><input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} /></Field></div><div className="actions"><button type="button" onClick={() => setOpen(false)}>Cancel</button><button className="primary">Create & generate invitation</button></div></form> : <><div className="success-icon"><CheckCircle2 /></div><h2>Invitation created</h2><p className="muted">Send this secure link to <b>{created.employee.email}</b>. The employee will complete the verification journey without HR uploading documents.</p><div className="invite-box"><span>{created.inviteUrl}</span><button onClick={copy}><Copy size={16} /> Copy</button></div><div className="invite-actions"><a className="secondary-link" href={created.inviteUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open onboarding</a><button className="primary" onClick={() => setOpen(false)}>Done</button></div></>}</div></div>}</>;
}

function EmployeeDetail({ employee, onBack }) { const [detail, setDetail] = useState(null); useEffect(() => { api(`/employees/${employee.id}`).then(setDetail).catch(() => {}); }, [employee.id]); if (!detail) return <div className="panel">Loading employee…</div>; const v = detail.verification; return <><button className="back-link" onClick={onBack}>← Back to employees</button><div className="detail-head"><div><div className="eyebrow">EMPLOYEE RECORD</div><h1>{detail.employee.name}</h1><p className="muted">{detail.employee.designation} · {detail.employee.department} · joining {detail.employee.joiningDate}</p></div><Status s={detail.employee.status} /></div><div className="detail-grid"><section className="panel"><h2>Readiness</h2><div className="detail-score">{detail.employee.readiness}%</div><div className="big-progress"><i style={{ width: `${detail.employee.readiness}%` }} /></div></section><section className="panel"><h2>Aadhaar verification</h2>{v ? <><div className={`verification-banner compact ${v.status}`}><BadgeCheck /><div><b>{v.status}</b><span>{v.message}</span></div></div><div className="match-list"><Match label="Name" ok={v.matches?.name} /><Match label="Date of birth" ok={v.matches?.dob} /><Match label="Address" ok={v.matches?.address} /></div></> : <div className="empty small">Not submitted yet. The employee completes this themselves.</div>}</section></div><section className="panel"><div className="section-title"><h2>Evidence-backed tasks</h2><span>HR view</span></div><table><thead><tr><th>Task</th><th>Owner</th><th>Priority</th><th>Status</th></tr></thead><tbody>{detail.tasks.map(t => <tr key={t.id}><td><b>{t.name}</b><small>{t.description}</small></td><td>{roleLabel(t.assignedRole)}</td><td>{t.priority}</td><td><Status s={t.status} /></td></tr>)}</tbody></table></section></>; }
function Match({ label, ok }) { return <div className="match-row"><span>{label}</span><b className={ok ? "ok" : "bad"}>{ok ? "Matched ✓" : "Not matched"}</b></div>; }

function Tasks({ tasks, employees, refresh, user }) {
  const isEmployee = user.role === "EMPLOYEE";
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(isEmployee ? (user.employeeId || employees[0]?.id || "") : (employees[0]?.id || ""));
  const [report, setReport] = useState(null);
  const [busyAction, setBusyAction] = useState("");
  useEffect(() => {
    if (!employees.length) { setSelectedEmployeeId(""); return; }
    if (isEmployee) {
      if (selectedEmployeeId !== user.employeeId) setSelectedEmployeeId(user.employeeId || employees[0].id);
      return;
    }
    if (!employees.some(e => e.id === selectedEmployeeId)) setSelectedEmployeeId(employees[0].id);
  }, [employees, isEmployee, selectedEmployeeId, user.employeeId]);
  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId) || null;
  const visibleTasks = selectedEmployeeId ? tasks.filter(t => t.employeeId === selectedEmployeeId) : [];
  const update = async (t, status) => {
    try {
      if (status === "COMPLETED") {
        const evidence = window.prompt(`Evidence for "${t.name}"\n\nEnter concrete proof. The automation worker will send this evidence for verification.`) || "";
        if (evidence.trim().length < 10) return;
        await api(`/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ status, evidence: evidence.trim() }) });
      } else {
        await api(`/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      }
      refresh();
    } catch (e) { alert(e.message); }
  };
  const verify = async t => { try { await api(`/tasks/${t.id}/verify`, { method: "POST" }); refresh(); } catch (e) { alert(e.message); } };
  const verifyWithAI = async t => {
    setBusyAction(`verify:${t.id}`);
    try {
      const d = await api(`/tasks/${t.id}/verify-ai`, { method: "POST" });
      setReport(d.report || t.verificationReport || { task: { name: t.name }, final: d.result, initial: d.result });
      refresh();
    } catch (e) { alert(e.message); } finally { setBusyAction(""); }
  };
  const fixWithAI = async t => {
    setBusyAction(`fix:${t.id}`);
    try {
      const d = await api(`/tasks/${t.id}/remediate-ai`, { method: "POST" });
      setReport(d.report || null);
      refresh();
    } catch (e) { alert(e.message); } finally { setBusyAction(""); }
  };
  const viewReport = t => setReport(t.verificationReport || null);
  const escalate = async t => { setBusyAction(`escalate:${t.id}`); try { const d = await api(`/tasks/${t.id}/escalate`, { method: "POST", body: JSON.stringify({ reason: `${t.name} requires attention` }) }); await refresh(); alert(`Escalated: ${t.name}\nOwner: ${d.toRole || "HR"}\nThe responsible team has been notified and the escalation is now visible in the Day-1 escalation queue.`); } catch (e) { alert(e.message); } finally { setBusyAction(""); } };
  return <>
    <section className="panel"><div className="section-title"><div><h2>{isEmployee ? "My tasks" : "Employee tasks"}</h2><p className="muted">{isEmployee ? "View the status of your onboarding tasks. HR and responsible teams handle task completion and verification." : "Select an employee to view only that employee's tasks."}</p></div><span>{visibleTasks.length} task{visibleTasks.length === 1 ? "" : "s"}</span></div>
      <div className="task-filter"><label htmlFor="employee-task-select">Employee</label>{isEmployee ? <div className="selected-employee-readonly">{selectedEmployee ? `${selectedEmployee.name} — ${selectedEmployee.designation}` : "No employee record"}</div> : <select id="employee-task-select" value={selectedEmployeeId} onChange={e => setSelectedEmployeeId(e.target.value)}><option value="">Select employee</option>{employees.map(e => <option key={e.id} value={e.id}>{e.name} — {e.email} — {e.designation} ({e.joiningDate})</option>)}</select>}</div>
      {selectedEmployee && <div className="selected-employee-banner"><div><b>{selectedEmployee.name}</b><span>{selectedEmployee.designation} · joining {selectedEmployee.joiningDate}</span></div><Status s={selectedEmployee.status} /></div>}
      <table><thead><tr><th>Task</th><th>Department</th><th>Priority</th><th>Deadline</th><th>Status</th>{!isEmployee && <th>Actions</th>}</tr></thead><tbody>{visibleTasks.map(t => <tr key={t.id}>
        <td><b>{t.name}</b><small>{selectedEmployee?.name || t.employeeId}</small>{t.verification?.reason && <small className="ai-evidence-note">AI: {t.verification.reason}</small>}</td>
        <td>{t.department}</td><td>{t.priority}</td><td>{t.deadline}</td><td><Status s={t.status} /></td>
        {!isEmployee && <td className="actions">{t.taskType === "IDENTITY_VERIFICATION" ? <span className="auto-badge"><BadgeCheck size={14} /> Auto-verified by employee flow</span> : <>
          {t.status !== "VERIFIED" && <><button onClick={() => update(t, "COMPLETED")}>Complete</button><button onClick={() => verifyWithAI(t)} disabled={busyAction === `verify:${t.id}`}>{busyAction === `verify:${t.id}` ? "Checking…" : "AI Verify"}</button>{["FAILED", "BLOCKED"].includes(t.status) && <button className="ai-fix-button" onClick={() => fixWithAI(t)} disabled={busyAction === `fix:${t.id}`}>{busyAction === `fix:${t.id}` ? "AI Fixing…" : "AI Fix"}</button>}<button onClick={() => verify(t)}>Manual Verify</button><button onClick={() => escalate(t)} disabled={busyAction === `escalate:${t.id}`}>{busyAction === `escalate:${t.id}` ? "Escalating…" : "Escalate"}</button></>}
          {t.status === "VERIFIED" && t.verificationReport && <button onClick={() => viewReport(t)}>Report</button>}
        </>}</td>}
      </tr>)}</tbody></table>
      {!selectedEmployeeId && <div className="empty small">Select an employee above to load only their tasks.</div>}
      {selectedEmployeeId && !visibleTasks.length && <div className="empty small">No tasks found for this employee.</div>}
    </section>
    {report && <VerificationReportModal report={report} onClose={() => setReport(null)} />}
  </>;
}

function VerificationReportModal({ report, onClose }) {
  const final = report.final || {};
  const initial = report.initial || {};
  const diagnosis = report.diagnosis;
  const remediation = report.remediation;
  const post = report.postActionVerification;
  return <div className="modal" onClick={onClose}><div className="modal-card wide-modal report-modal" onClick={e => e.stopPropagation()}>
    <div className="report-header"><div><div className="eyebrow">ONBOARDX · AUTONOMOUS VERIFICATION REPORT</div><h2>{report.task?.name || "Task verification"}</h2><p className="muted">{report.employee?.name || "Employee"} · {report.task?.department || "—"} · {report.task?.priority || "—"}</p></div><button className="icon-button" onClick={onClose}>×</button></div>
    <div className={`report-final ${final.status || "BLOCKED"}`}><div><span>FINAL RESULT</span><strong>{final.status || "BLOCKED"}</strong></div><b>{final.confidence ?? 0}% confidence</b></div>
    <div className="report-grid">
      <div className="report-section"><h3>1. Problem detected</h3><p><b>Initial status:</b> {initial.status || "—"}</p><p>{initial.reason || "No initial diagnosis."}</p></div>
      {diagnosis && <div className="report-section"><h3>2. AI diagnosis</h3><p><b>Root cause:</b> {diagnosis.rootCause || "—"}</p><p><b>Diagnosis:</b> {diagnosis.diagnosis || "—"}</p><p><b>Severity:</b> {diagnosis.severity || "—"}</p><p><b>Risk:</b> {diagnosis.risk || "—"}</p><p><b>Recommended action:</b> {diagnosis.action || "NO_ACTION"}</p>{diagnosis.actionReason && <p>{diagnosis.actionReason}</p>}</div>}
      {remediation && <div className="report-section"><h3>3. Remediation</h3><p><b>Action:</b> {remediation.action || "—"}</p><p><b>Status:</b> {remediation.executed ? "Executed by OnboardX Automation" : "Not executed"}</p><p>{remediation.message || "—"}</p><p><b>Source:</b> {remediation.sourceSystem || "—"}</p></div>}
      {post && <div className="report-section"><h3>4. Post-action verification</h3><p><b>Source system confirmed:</b> {post.sourceConfirmed === true ? "YES ✓" : post.sourceConfirmed === false ? "NO ✕" : "INSUFFICIENT EVIDENCE"}</p><pre>{JSON.stringify(post.evidence?.records || post.evidence || {}, null, 2)}</pre></div>}
    </div>
    <div className="report-section full"><h3>Audit trail</h3><div className="audit-trail">{(report.auditTrail || []).map((item, i) => <div key={i}><span>{item.step}</span><small>{new Date(item.at).toLocaleTimeString()}</small></div>)}</div></div>
    <div className="report-footer"><span>AI provider: {report.diagnosis?.provider || report.initial?.provider || "—"} · {report.diagnosis?.model || report.initial?.model || "—"}</span><button className="primary" onClick={onClose}>Done</button></div>
  </div></div>;
}

function Risk({ employees, tasks }) {
  return <div className="risk-grid">{employees.map(e => {
    const employeeTasks = tasks.filter(t => t.employeeId === e.id);
    const blockers = employeeTasks.filter(t => t.status !== "VERIFIED" && t.mandatory !== false);
    const configured = employeeTasks.some(t => t.mandatory !== false);
    const score = Number.isFinite(Number(e.readiness)) ? Number(e.readiness) : null;
    return <div className="panel risk-card" key={e.id}>
      <div className="risk-head"><div><h2>{e.name}</h2><p className="muted">{e.designation} · joining {e.joiningDate}</p></div><Status s={configured ? e.status : "NOT_CONFIGURED"} /></div>
      <div className="big-progress"><i style={{ width: `${score == null ? 0 : Math.max(0, Math.min(100, score))}%` }} /></div>
      <h3>{configured && score != null ? `${score}% Day-1 ready` : "Readiness not configured"}</h3>
      <p className="muted">Blocking items</p>
      {!configured ? <p className="empty small">No required onboarding tasks configured yet. Readiness cannot be calculated.</p> : blockers.length ? <ul>{blockers.map(t => <li key={t.id}>{t.name} <span>{t.priority}</span></li>)}</ul> : e.status === "READY" ? <p className="success">No blockers — ready.</p> : <p className="muted">No high/critical blockers. Onboarding is still in progress.</p>}
    </div>;
  })}</div>;
}

function Assistant() {
  const [q, setQ] = useState("Which employees are at risk?"), [messages, setMessages] = useState([]), [busy, setBusy] = useState(false), [status, setStatus] = useState(null);
  useEffect(() => { api("/ai/status").then(setStatus).catch(() => setStatus({ configured: false })); }, []);
  const ask = async () => {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true);
    try {
      const history = messages.slice(-8).map(m => ({ role: m.role, content: m.content }));
      const d = await api("/ai/chat", { method: "POST", body: JSON.stringify({ message: question, history }) });
      setMessages(prev => [...prev, { role: "user", content: question }, { role: "assistant", content: d.answer }]);
      setQ("");
      if (status) setStatus(prev => ({ ...prev, configured: d.configured, provider: d.provider, model: d.model }));
    } catch (e) { setMessages(prev => [...prev, { role: "assistant", content: e.message }]); } finally { setBusy(false); }
  };
  const prompts = ["Which employees are at risk?", "What tasks are due today?", "What is blocking Day-1 readiness?", "How does identity verification work?"];
  return <div className="assistant"><div className="panel"><div className="ai-title"><Brain /><div><h2>OnboardX AI Assistant</h2><p className="muted">Ask about onboarding, blockers, risk, readiness or general HR workflows.</p></div><span className={`ai-status ${status?.configured ? "connected" : "demo"}`}>{status?.configured ? `AI connected · ${status.model || "Gemini"}` : "Demo mode · add GEMINI_API_KEY"}</span></div><div className="prompt-chips">{prompts.map(p => <button key={p} onClick={() => setQ(p)}>{p}</button>)}</div><div className="prompt-row"><input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && ask()} placeholder="Ask anything about this onboarding workspace…" /><button className="primary" onClick={ask}>{busy ? "Thinking…" : "Ask AI"}</button></div><div className="ai-thread">{messages.map((m, i) => <div key={i} className={`ai-message ${m.role}`}><span>{m.role === "user" ? "You" : "OnboardX AI"}</span><p>{m.content}</p></div>)}{!messages.length && <div className="ai-empty">Your AI answers will appear here. The assistant only receives the records your role is allowed to see.</div>}</div></div></div>; }
function Notifications({ notifications, refresh }) { const read = async id => { await api(`/notifications/${id}/read`, { method: "PATCH" }); refresh(); }; return <div className="notifications">{notifications.map(n => <div className={`notification ${n.type}`} key={n.id}><div><b>{n.title}</b><p>{n.message}</p><small>{new Date(n.createdAt).toLocaleString()}</small></div>{!n.read && <button onClick={() => read(n.id)}>Mark read</button>}</div>)}{!notifications.length && <div className="panel empty">No notifications.</div>}</div>; }

function App() {
  const { route, navigate } = useRoute();
  const [user, setUser] = useState(null);
  useEffect(() => { const token = localStorage.getItem("onboardx_token"); if (!token) { setUser(null); return; } api("/me").then(setUser).catch(() => { localStorage.removeItem("onboardx_token"); localStorage.removeItem("onboardx_email"); setUser(null); }); }, [route]);
  const logout = async () => { try { await api("/auth/logout", { method: "POST" }); } catch {} localStorage.removeItem("onboardx_token"); localStorage.removeItem("onboardx_email"); setUser(null); navigate("/"); };

  if (route === "/" || route === "") return <Landing navigate={navigate} />;
  if (route.startsWith("/onboard/verify")) return <EmployeeOnboarding navigate={navigate} />;
  if (route.startsWith("/onboard/account")) return <EmployeeOnboarding navigate={navigate} />;
  if (route.startsWith("/onboard")) return <OnboardingStart navigate={navigate} />;
  if (route.startsWith("/login")) { const portal = new URLSearchParams(window.location.search).get("portal") || "employee"; return <Login portal={portal} onLogin={setUser} navigate={navigate} />; }
  if (route.startsWith("/app")) return user ? <AppShell user={user} navigate={navigate} onLogout={logout} /> : <Login portal="employee" onLogin={setUser} navigate={navigate} />;
  return <Landing navigate={navigate} />;
}

createRoot(document.getElementById("root")).render(<App />);
