import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, GitBranch, RefreshCw, ShieldAlert, Zap } from "lucide-react";

export function Day1ControlCenter({ api, employees = [], user }) {
  const [overview, setOverview] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    try {
      const data = await api("/day1/overview");
      setOverview(data);
      if (!selectedId && data.employees?.[0]?.employee?.id) setSelectedId(data.employees[0].employee.id);
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, [employees.length]);

  const selected = overview?.employees?.find(x => x.employee.id === selectedId) || overview?.employees?.[0] || null;
  useEffect(() => { if (selected && selected.employee.id !== selectedId) setSelectedId(selected.employee.id); }, [selected?.employee?.id]);

  const orchestrate = async () => {
    setBusy(true);
    try {
      await api("/day1/orchestrate", { method: "POST" });
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const statusCounts = useMemo(() => {
    const list = overview?.employees || [];
    return {
      ready: list.filter(x => x.day1.status === "READY").length,
      risk: list.filter(x => x.day1.status === "AT_RISK").length,
      progress: list.filter(x => x.day1.status === "IN_PROGRESS").length,
    };
  }, [overview]);

  return <section className="panel day1-control">
    <div className="section-title day1-title">
      <div>
        <div className="eyebrow">PHASE 1–4 · DAY-1 CONTROL CENTER</div>
        <h2>Will every employee be ready before Day-1?</h2>
        <p className="muted">Deadline-aware readiness, autonomous escalation and dependency-aware blockers.</p>
      </div>
      {user?.role !== "EMPLOYEE" && <button className="secondary day1-run" onClick={orchestrate} disabled={busy}><RefreshCw size={15} className={busy ? "spin" : ""} />{busy ? "Checking…" : "Run orchestration"}</button>}
    </div>
    {error && <div className="day1-error">{error}</div>}
    <div className="day1-kpis">
      <Day1Kpi label="Ready" value={statusCounts.ready} icon={<CheckCircle2 />} />
      <Day1Kpi label="At risk" value={statusCounts.risk} icon={<ShieldAlert />} />
      <Day1Kpi label="In progress" value={statusCounts.progress} icon={<Clock3 />} />
      <Day1Kpi label="Open escalations" value={overview?.escalations?.length || 0} icon={<AlertTriangle />} />
    </div>

    {selected && <>
      <div className="day1-selector">
        <div><b>Employee readiness</b><span className="muted">Select an employee to inspect the complete Day-1 path.</span></div>
        <select value={selected.employee.id} onChange={e => setSelectedId(e.target.value)}>
          {(overview?.employees || []).map(x => <option key={x.employee.id} value={x.employee.id}>{x.employee.name} · {x.employee.joiningDate}</option>)}
        </select>
      </div>
      <Day1Employee snapshot={selected} api={api} onRefresh={load} />
    </>}
  </section>;
}

function Day1Kpi({ label, value, icon }) {
  return <div className="day1-kpi"><div className="day1-kpi-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong></div></div>;
}

function Day1Employee({ snapshot, api, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const { employee, day1, tasks, dependencies, escalations = [] } = snapshot;
  const runEmployee = async () => {
    setBusy(true);
    try { await api(`/day1/${employee.id}/orchestrate`, { method: "POST" }); await onRefresh(); }
    catch (e) { window.alert(e.message); }
    finally { setBusy(false); }
  };
  const ack = async id => {
    try { await api(`/day1/escalations/${id}/ack`, { method: "PATCH" }); await onRefresh(); }
    catch (e) { window.alert(e.message); }
  };
  const hours = day1.hoursUntilJoining;
  const configured = day1.readinessConfigured !== false && day1.totalTasks > 0;
  const scoreLabel = configured && Number.isFinite(day1.readinessScore) ? `${day1.readinessScore}%` : "N/A";
  const timeLabel = hours == null ? "Joining date unavailable" : hours <= 0 ? "Day-1 has started" : `${hours}h remaining`;
  return <>
    <div className={`day1-hero ${day1.status}`}>
      <div><span>DAY-1 READINESS</span><strong>{scoreLabel}</strong><b>{day1.status === "NOT_CONFIGURED" ? "NOT CONFIGURED" : day1.status.replaceAll("_", " ")}</b></div>
      <div className="day1-time"><Clock3 size={18} /><b>{timeLabel}</b><small>Joining: {employee.joiningDate || "—"} · 09:00 IST</small></div>
      <div className="day1-capacity"><span>Estimated work</span><b>{day1.estimatedWorkMinutes} min</b><small>Available: {day1.availableMinutes == null ? "—" : `${day1.availableMinutes} min`}</small></div>
    </div>

    <div className="day1-progress"><i style={{ width: `${configured ? Math.max(0, Math.min(100, day1.readinessScore || 0)) : 0}%` }} /></div>
    <div className="day1-summary-row"><span>✓ {day1.verifiedCount} verified</span><span>• {day1.unresolvedCount} unresolved</span><span>• {day1.blockers.length} critical/high blockers</span><button className="secondary" onClick={runEmployee} disabled={busy || !configured}><Zap size={14} />{busy ? "Running…" : configured ? "Check & escalate" : "Configure tasks first"}</button></div>

    {!configured && <div className="day1-empty-state"><b>No onboarding tasks configured.</b><span>Day-1 readiness cannot be calculated until this employee has required onboarding tasks.</span></div>}

    <div className="day1-columns">
      <section className="day1-section"><div className="day1-section-head"><h3>Deadline & blocker analysis</h3><span>{tasks.length} tasks</span></div>
        <div className="day1-task-list">{tasks.map(t => <div className={`day1-task ${t.status} ${t.risk}`} key={t.id}>
          <div><b>{t.name}</b><small>{t.status} · {t.priority} · {t.estimateMinutes} min estimate</small></div>
          <div className="day1-task-right"><span className={`risk-pill ${t.risk}`}>{t.risk}</span>{t.dependencyBlocked && <small>Blocked by {t.dependency?.name}</small>}{t.overdue && <small>Overdue</small>}{t.autoFixAvailable && t.status !== "VERIFIED" && <small className="autofix-label">AI fix available</small>}</div>
        </div>)}</div>
      </section>

      <section className="day1-section"><div className="day1-section-head"><h3><GitBranch size={15} /> Dependency graph</h3><span>{dependencies.length} links</span></div>
        {dependencies.length ? <div className="dependency-graph">{dependencies.map((d, i) => <div className="dependency-row" key={`${d.from}-${d.to}-${i}`}><div className="dependency-node"><b>{d.fromName}</b><small>{tasks.find(t => t.id === d.from)?.status || "—"}</small></div><ArrowRight size={15} /><div className="dependency-node"><b>{d.toName}</b><small>{tasks.find(t => t.id === d.to)?.status || "—"}</small></div><span className="dependency-source">{d.source}</span></div>)}</div> : <div className="empty small">No dependencies are currently defined for this employee.</div>}
      </section>
    </div>

    <section className="day1-section"><div className="day1-section-head"><h3>Autonomous escalation queue</h3><span>{escalations.filter(e => e.status === "OPEN").length} open</span></div>
      {escalations.length ? <div className="escalation-list">{escalations.slice(0, 8).map(e => <div className={`escalation-item ${e.level}`} key={e.id}><div><b>{e.level} · {tasks.find(t => t.id === e.taskId)?.name || "Task"}</b><p>{e.reason}</p><small>{new Date(e.createdAt).toLocaleString()}</small></div>{e.status === "OPEN" ? <button className="secondary" onClick={() => ack(e.id)}>Acknowledge</button> : <span className="ack-pill">Acknowledged</span>}</div>)}</div> : <div className="empty small">No autonomous escalations for this employee.</div>}
    </section>
  </>;
}
