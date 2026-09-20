/* CareLink — email notifications + full Care Passport */

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const QUICK = ["TMT done this morning","Please confirm my slot","Need help with report","Reschedule to next week","Fasting needed?","Report uploaded"];

let state = {
  syncVersion: 0,
  patients: [], journeys: [], messages: [], appointments: [], notifications: [],
  stages: [], reports: [], hospitals: [], external_records: [], role: "patient", acting_patient_id: "p1",
  activeJourneyId: null, selectedDate: null,
  calYear: null, calMonth: null, calendarDays: {},
  consentGranted: false,
  pendingFetchQuery: null,
  lastFetchedQuery: null,
  accessLog: [],
};

function toast(msg, ms = 3000) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), ms);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function toDateStr(y, m, d) {
  return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}

function formatLocalDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function updateCurrentClock() {
  const clock = $("#current-clock");
  if (!clock) return;
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  clock.textContent = `${time} · ${timeZone}`;
  clock.title = `Current time: ${now.toLocaleString()} (${timeZone})`;
}

updateCurrentClock();
setInterval(updateCurrentClock, 1000);

function patientById(id) { return state.patients.find((p) => p.id === id); }
function journeyById(id) { return state.journeys.find((j) => j.id === id); }

function nextAction(journey) {
  for (const s of state.stages) {
    const st = journey.stages[s.id];
    if (st && ["pending", "overdue", "blocked"].includes(st.status)) {
      return { stage: s, status: st };
    }
  }
  return null;
}

$$(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    $$(".tab-panel").forEach((p) => p.classList.add("hidden"));
    $(`#tab-${btn.dataset.tab}`).classList.remove("hidden");
    if (btn.dataset.tab === "passport") renderPassport();
    if (btn.dataset.tab === "analytics") renderAnalytics();
    if (btn.dataset.tab === "messages") renderMessages();
    if (btn.dataset.tab === "verify") renderVerify();
    if (btn.dataset.tab === "calendar") { loadCalendar(); renderAppointments(); renderNotifications(); }
    if (btn.dataset.tab === "dashboard") renderDashboard();
    // Soft-clear strip emphasis when user opens dashboard
    if (btn.dataset.tab === "dashboard") {
      const strip = $("#tab-notify-strip");
      if (strip && computeStuckJourneys().length === 0) strip.classList.add("hidden");
    }
    updateTabBadgesAndTitle();
  });
});

async function loadAccessLog() {
  try {
    const res = await api("/api/access-log?limit=20");
    state.accessLog = res.entries || [];
  } catch (_) {
    state.accessLog = [];
  }
}

function renderAccessLog() {
  const list = $("#access-log-list");
  const count = $("#access-count");
  if (!list) return;
  if (count) count.textContent = state.accessLog.length;
  list.innerHTML = state.accessLog.length
    ? state.accessLog.map((e) => `
        <div class="access-item">
          <div>${esc(e.actor)} ${esc(e.action)}${e.subject ? " — " + esc(e.subject) : ""}</div>
          <div class="meta">${esc(e.relative || "")}</div>
        </div>`).join("")
    : `<p class="empty">No access events yet — fetch a patient or open a report</p>`;
}

/** Stuck = open journey with overdue/blocked, or pending stage older than ~7 days (from created_at). */
function computeStuckJourneys() {
  const STUCK_DAYS = 7;
  const now = Date.now();
  const out = [];
  state.journeys.filter((j) => j.status === "open").forEach((j) => {
    const p = patientById(j.patient_id);
    let worst = null;
    Object.entries(j.stages || {}).forEach(([sid, st]) => {
      if (!st || !["overdue", "blocked", "pending"].includes(st.status)) return;
      const label = state.stages.find((s) => s.id === sid)?.label || sid;
      const updated = st.updated_at ? Date.parse(st.updated_at) : null;
      const created = j.created_at ? Date.parse(j.created_at) : null;
      const base = updated || created || now;
      const days = Math.max(0, Math.floor((now - base) / 86400000));
      const isStuck =
        st.status === "overdue" ||
        st.status === "blocked" ||
        (st.status === "pending" && days >= STUCK_DAYS);
      if (!isStuck) return;
      if (!worst || ({ overdue: 0, blocked: 1, pending: 2 }[st.status] < { overdue: 0, blocked: 1, pending: 2 }[worst.status])) {
        worst = { stage: label, status: st.status, days, note: st.note || "" };
      }
    });
    if (worst) {
      out.push({ journey: j, patient: p, ...worst });
    }
  });
  out.sort((a, b) => {
    const rank = { overdue: 0, blocked: 1, pending: 2 };
    return (rank[a.status] - rank[b.status]) || (b.days - a.days);
  });
  return out;
}

function setBadge(id, n, soft) {
  const el = $(id);
  if (!el) return;
  if (n > 0) {
    el.textContent = n > 9 ? "9+" : String(n);
    el.classList.remove("hidden");
    if (soft) el.classList.add("soft");
    else el.classList.remove("soft");
  } else {
    el.classList.add("hidden");
  }
}

function updateTabBadgesAndTitle() {
  const stuck = computeStuckJourneys();
  const overdueBlocked = stuck.filter((s) => s.status === "overdue" || s.status === "blocked").length;
  const msgCount = (state.messages || []).filter((m) => m.from === "patient").length;
  // Unread-ish: patient messages without a later system reply is heavy; show recent patient msgs count capped
  const notifCount = (state.notifications || []).length;
  const verifyNeeded = state.journeys.filter((j) =>
    Object.values(j.stages || {}).some((st) => st && st.status === "pending" && st.verification === "none")
  ).length;

  setBadge("#badge-dashboard", stuck.length);
  setBadge("#badge-messages", Math.min(msgCount, 9), true);
  setBadge("#badge-calendar", notifCount, true);
  setBadge("#badge-verify", verifyNeeded);

  const strip = $("#tab-notify-strip");
  if (strip) {
    if (stuck.length > 0) {
      strip.classList.remove("hidden");
      const names = stuck.slice(0, 2).map((s) => s.patient?.name || "Patient").join(", ");
      strip.innerHTML = `<strong>${stuck.length} stuck referral${stuck.length > 1 ? "s" : ""}</strong> — ${esc(names)}${stuck.length > 2 ? "…" : ""}. Open Dashboard to act.`;
    } else if (notifCount > 0) {
      strip.classList.remove("hidden");
      strip.innerHTML = `<strong>${notifCount} notification${notifCount > 1 ? "s" : ""}</strong> — check Calendar & Book.`;
    } else {
      strip.classList.add("hidden");
      strip.innerHTML = "";
    }
  }

  // Browser tab title so user is notified even on another tab
  const base = "CareLink — Care Passport";
  if (stuck.length > 0) {
    document.title = `(${stuck.length}) Stuck · ${base}`;
  } else if (notifCount > 0) {
    document.title = `(${notifCount}) ${base}`;
  } else {
    document.title = base;
  }
}

function renderStuckBanner() {
  const banner = $("#stuck-banner");
  const title = $("#stuck-title");
  const detail = $("#stuck-detail");
  const list = $("#stuck-list");
  if (!banner) return;
  const stuck = computeStuckJourneys();
  if (!stuck.length) {
    banner.classList.add("hidden");
    return;
  }
  banner.classList.remove("hidden");
  if (title) title.textContent = `⚠ ${stuck.length} stuck referral${stuck.length > 1 ? "s" : ""} — care journey incomplete`;
  if (detail) {
    detail.textContent =
      "Referral leakage risk: overdue, blocked, or pending >7 days without progress. This is the core problem CareLink tracks.";
  }
  if (list) {
    list.innerHTML = stuck.slice(0, 5).map((s) => {
      const why =
        s.status === "overdue"
          ? `overdue · ${s.days}d`
          : s.status === "blocked"
            ? `blocked · ${s.days}d`
            : `pending · ${s.days}d`;
      return `<li><strong>${esc(s.patient?.name || "Patient")}</strong> — ${esc(s.journey.title)} · ${esc(s.stage)}
        <span class="days">(${esc(why)})</span>${s.note ? " — " + esc(s.note) : ""}</li>`;
    }).join("");
  }
}

function renderDashboard() {
  const open = state.journeys.filter((j) => j.status === "open");
  let overdue = 0, blocked = 0;
  open.forEach((j) => {
    Object.values(j.stages).forEach((s) => {
      if (s.status === "overdue") overdue++;
      if (s.status === "blocked") blocked++;
    });
  });
  const closed = state.journeys.filter((j) => j.status === "closed").length;
  const stuck = computeStuckJourneys();

  $("#metrics").innerHTML = `
    <div class="metric"><div class="k">${open.length}</div><div class="v">open journeys</div></div>
    <div class="metric"><div class="k ${overdue ? "danger" : ""}">${overdue}</div><div class="v">overdue stages</div></div>
    <div class="metric"><div class="k ${blocked ? "danger" : ""}">${blocked}</div><div class="v">blocked</div></div>
    <div class="metric"><div class="k ${stuck.length ? "danger" : ""}">${stuck.length}</div><div class="v">stuck referrals</div></div>
  `;
  renderStuckBanner();
  renderAccessLog();
  updateTabBadgesAndTitle();

  $("#journey-count").textContent = state.journeys.length;
  const list = $("#journey-list");
  list.innerHTML = state.journeys.map((j) => {
    const p = patientById(j.patient_id);
    const na = nextAction(j);
    return `<article class="journey-item" data-id="${j.id}">
      <div style="display:flex;justify-content:space-between;gap:.5rem">
        <div>
          <div class="name">${esc(p?.name || "Patient")}</div>
          <div class="meta">${esc(j.title)} · ${esc(j.facility)}</div>
          ${na ? `<div class="meta">Next: ${esc(na.stage.label)} (${esc(na.status.status)})</div>` : ""}
        </div>
        <span class="tag ${j.status}">${j.status}</span>
      </div>
    </article>`;
  }).join("") || `<p class="empty">No journeys</p>`;

  list.querySelectorAll(".journey-item").forEach((el) => {
    el.addEventListener("click", () => {
      state.activeJourneyId = el.dataset.id;
      $$(".tab").forEach((t) => t.classList.remove("active"));
      $$('.tab[data-tab="passport"]').classList.add("active");
      $$(".tab-panel").forEach((p) => p.classList.add("hidden"));
      $("#tab-passport").classList.remove("hidden");
      renderPassport();
    });
  });

  const alerts = [];
  state.journeys.forEach((j) => {
    const p = patientById(j.patient_id);
    Object.entries(j.stages).forEach(([sid, st]) => {
      if (["overdue", "blocked", "pending"].includes(st.status)) {
        const label = state.stages.find((s) => s.id === sid)?.label || sid;
        alerts.push({ journey: j, patient: p, stage: label, status: st.status, note: st.note });
      }
    });
  });
  alerts.sort((a, b) => {
    const rank = { overdue: 0, blocked: 1, pending: 2 };
    return (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
  });

  $("#alerts-list").innerHTML = alerts.slice(0, 12).map((a) => `
    <div class="alert-item">
      <div style="display:flex;justify-content:space-between;gap:.5rem">
        <div class="name">${esc(a.patient?.name)}</div>
        <span class="tag ${a.status}">${a.status}</span>
      </div>
      <div class="meta">${esc(a.stage)} · ${esc(a.journey.title)}</div>
      ${a.note ? `<div class="meta">${esc(a.note)}</div>` : ""}
    </div>
  `).join("") || `<p class="empty">No pending actions</p>`;
}

async function renderAnalytics() {
  const metrics = $("#analytics-metrics");
  if (!metrics) return;
  metrics.innerHTML = `<div class="metric"><div class="k">…</div><div class="v">loading analytics</div></div>`;
  try {
    const data = await api("/api/analytics");
    const o = data.overall || {};
    metrics.innerHTML = `
      <div class="metric"><div class="k">${esc(o.adherence_rate)}%</div><div class="v">stage adherence</div></div>
      <div class="metric"><div class="k ${o.missed_followups ? "danger" : ""}">${esc(o.missed_followups)}</div><div class="v">missed follow-ups</div></div>
      <div class="metric"><div class="k ${o.overdue_stages ? "danger" : ""}">${esc(o.overdue_stages)}</div><div class="v">overdue actions</div></div>
      <div class="metric"><div class="k ${o.at_risk_patients ? "danger" : ""}">${esc(o.at_risk_patients)}</div><div class="v">patients needing attention</div></div>`;
    const hospitals = $("#analytics-hospitals");
    hospitals.innerHTML = `<div class="analytics-row analytics-row-head"><span>Hospital</span><span>Adherence</span><span>Missed</span></div>` + (data.hospitals || []).map((h) => `
      <div class="analytics-row"><span><strong>${esc(h.hospital)}</strong><small>${esc(h.patients)} patients · ${esc(h.journeys)} journeys</small></span><span><b>${esc(h.adherence_rate)}%</b><i class="analytics-bar"><em style="width:${Math.max(0, Math.min(100, Number(h.adherence_rate) || 0))}%"></em></i></span><span class="analytics-number ${h.missed_followups ? "bad" : "good"}">${esc(h.missed_followups)}</span></div>`).join("") || `<p class="empty">No hospital journey data yet.</p>`;
    const missed = $("#analytics-missed");
    $("#analytics-missed-count").textContent = String((data.missed_followups || []).length);
    missed.innerHTML = (data.missed_followups || []).map((a) => `<div class="alert-item"><div class="analytics-item-head"><strong>${esc(a.patient)}</strong><span class="tag overdue">${esc(a.status)}</span></div><div class="meta">${esc(a.type)} · ${esc(a.hospital)} · ${esc(a.date)}</div><div class="meta">${esc(a.notes)}</div></div>`).join("") || `<p class="empty">No missed follow-ups found.</p>`;
    const risk = $("#analytics-risk");
    $("#analytics-risk-count").textContent = String((data.at_risk || []).length);
    risk.innerHTML = (data.at_risk || []).map((x) => `<article class="analytics-risk-item"><div class="analytics-item-head"><strong>${esc(x.patient)}</strong><span class="meta">${esc(x.facility)}</span></div><div class="meta">${esc(x.journey)}</div><ul>${(x.items || []).map((i) => `<li><b>${esc(i.kind)}</b>: ${esc(i.note)}</li>`).join("")}</ul></article>`).join("") || `<p class="empty">No overdue or blocked journeys.</p>`;
    const updated = $("#analytics-updated");
    if (updated) updated.textContent = data.generated_at ? `updated ${new Date(data.generated_at).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})}` : "updated";
  } catch (error) {
    metrics.innerHTML = `<div class="analytics-error">Analytics could not be loaded: ${esc(error.message)}</div>`;
  }
}

$("#btn-refresh-analytics")?.addEventListener("click", renderAnalytics);

let patientReportRequest = 0;

async function renderPatientCareUpdate(journeyId) {
  const box = $("#patient-care-update");
  if (!box) return;
  const requestId = ++patientReportRequest;
  box.innerHTML = `<div class="patient-care-loading">Preparing a simple care update…</div>`;
  try {
    const res = await api(`/api/patient-report/${encodeURIComponent(journeyId)}`);
    if (requestId !== patientReportRequest || state.activeJourneyId !== journeyId) return;
    const report = res.report;
    const list = (items, empty) => items?.length ? `<ul>${items.map((x) => `<li><strong>${esc(x.title || x.stage || x.name)}</strong>${x.source ? ` · ${esc(x.source)}` : ""}${x.status ? ` <span class="tag ${esc(x.status)}">${esc(x.status)}</span>` : ""}<br><span>${esc(x.detail || x.note || x.plain || "")}</span>${x.url ? ` <a href="${esc(x.url)}" target="_blank" rel="noopener">Official link</a>` : ""}</li>`).join("")}</ul>` : `<p class="muted">${esc(empty)}</p>`;
    box.innerHTML = `
      <div class="patient-care-head"><div><div class="eyebrow">For the patient and family</div><h3>What happened and what to do next</h3><p class="muted">Simple words, updated from the latest Care Passport records.</p></div><span class="tag done">updated</span></div>
      <div class="patient-care-grid">
        <section><h4>What happened</h4>${list(report.what_happened, "No examination record has been added yet.")}</section>
        <section><h4>Next steps</h4>${list(report.next_steps, "Your care team will add the next step.")}</section>
        <section class="attention"><h4>Missed or needs attention</h4>${list(report.missed_actions, "Nothing is marked missed right now.")}</section>
        <section><h4>Government health information</h4>${list(report.scheme_updates, "No scheme information is available.")}</section>
      </div>
      <div class="patient-news"><h4>Official updates and news</h4>${list(report.news_updates, "Check official sources for the latest updates.")}</div>
      <p class="patient-disclaimer">${esc(report.disclaimer)}</p>
    `;
  } catch (error) {
    if (requestId === patientReportRequest) box.innerHTML = `<div class="patient-care-error">We could not prepare the simple care update right now. Your Care Passport data is still available below.</div>`;
  }
}

function renderPassport() {
  const sel = $("#passport-journey");
  sel.innerHTML = state.journeys.map((j) => {
    const p = patientById(j.patient_id);
    return `<option value="${j.id}" ${j.id === state.activeJourneyId ? "selected" : ""}>${esc(p?.name)} — ${esc(j.title)}</option>`;
  }).join("");

  if (!state.activeJourneyId && state.journeys[0]) {
    state.activeJourneyId = state.journeys[0].id;
    sel.value = state.activeJourneyId;
  }

  const j = journeyById(state.activeJourneyId);
  if (!j) {
    $("#passport-header").innerHTML = "";
    $("#passport-stages").innerHTML = `<p class="empty">No passport selected</p>`;
    return;
  }
  const p = patientById(j.patient_id);
  renderPatientCareUpdate(j.id);
  $("#passport-header").innerHTML = `
    <div class="passport-heading-row">
      <div>
        <h3>${esc(p?.name)}</h3>
        <div class="meta">${esc(j.title)} · ${esc(j.facility)} · ${esc(p?.condition || "")}</div>
        <div class="meta" style="margin-top:.35rem"><span class="tag ${j.status}">${j.status}</span></div>
      </div>
      <div class="summary-actions" aria-label="Care summary actions">
        <button type="button" class="btn ghost small" id="btn-print-summary">Print specialist brief</button>
        <button type="button" class="btn primary small" id="btn-download-summary">Download report</button>
      </div>
    </div>
    <div class="summary-hint">One-page visit story · includes CareLink, hospital network, and uploaded records</div>
  `;

  $("#btn-print-summary")?.addEventListener("click", () => openCareSummary(j, "print"));
  $("#btn-download-summary")?.addEventListener("click", () => openCareSummary(j, "download"));

  $("#passport-stages").innerHTML = state.stages.map((s, i) => {
    const st = j.stages[s.id] || { status: "locked" };
    const canAct = ["pending", "overdue", "blocked", "done"].includes(st.status) || state.role === "doctor" || state.role === "asha";
    return `<div class="stage ${st.status}">
      <div class="stage-num">${i + 1}</div>
      <div>
        <div style="font-weight:600">${esc(s.label)} <span class="tag ${st.status}">${st.status}</span>
          ${st.verification && st.verification !== "none" ? ` · verified: ${esc(st.verification)}` : ""}
        </div>
        ${st.note ? `<div class="meta">${esc(st.note)}</div>` : ""}
        ${canAct && st.status !== "locked" ? `
          <div class="stage-actions">
            ${st.status !== "done" ? `<button class="btn small primary" data-act="done" data-stage="${s.id}">Mark done</button>` : ""}
            ${st.status !== "done" ? `<button class="btn small ghost" data-act="verify-asha" data-stage="${s.id}">Verify (ASHA)</button>` : ""}
            ${st.status !== "done" ? `<button class="btn small ghost" data-act="verify-provider" data-stage="${s.id}">Verify (Provider)</button>` : ""}
            ${st.status !== "done" && st.status !== "failed" ? `<button class="btn small ghost danger" data-act="failed" data-stage="${s.id}">Mark failed</button>` : ""}
            ${st.status !== "done" && st.status !== "blocked" ? `<button class="btn small ghost" data-act="blocked" data-stage="${s.id}">Mark blocked</button>` : ""}
          </div>` : ""}
      </div>
    </div>`;
  }).join("");

  renderReportsForJourney(j.id);
  renderExternalRecords(j);

  $("#passport-stages").querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const stageId = btn.dataset.stage;
      const act = btn.dataset.act;
      let status = "done";
      let verification = "none";
      let note = "";
      if (act === "verify-asha") verification = "asha";
      if (act === "verify-provider") verification = "provider";
      if (act === "failed") {
        status = "failed";
        note = prompt("What failed? (this is emailed to the patient)", "Could not complete this step") || "Could not complete this step";
      }
      if (act === "blocked") {
        status = "blocked";
        note = prompt("Why is it blocked? (emailed to patient)", "Temporarily unavailable") || "Temporarily unavailable";
      }
      try {
        const res = await api(`/api/journeys/${j.id}/stage`, {
          method: "POST",
          body: JSON.stringify({ stage_id: stageId, status, verification, note, notify_email: true }),
        });
        if (status === "failed" || status === "blocked") {
          toast(res.email?.ok ? "Updated & patient notified (SMS/email)" : "Updated (notification demo/failed)");
        } else {
          toast("Stage updated");
        }
        await refresh();
        renderPassport();
      } catch (e) {
        toast("Error: " + e.message);
      }
    });
  });
}

$("#passport-journey")?.addEventListener("change", (e) => {
  state.activeJourneyId = e.target.value;
  renderPassport();
});



function renderExternalRecords(journey) {
  const list = $("#external-record-list");
  const sel = $("#er-hospital");
  if (!list || !journey) return;

  if (sel) {
    sel.innerHTML = `<option value="">— Select hospital —</option>` +
      (state.hospitals || []).map((h) =>
        `<option value="${h.id}">${esc(h.name)}${h.city ? " (" + esc(h.city) + ")" : ""}</option>`
      ).join("");
  }

  const recs = (state.external_records || []).filter(
    (r) => r.journey_id === journey.id || r.patient_id === journey.patient_id
  );
  // group by hospital
  const byH = {};
  recs.forEach((r) => {
    const k = r.hospital_name || "Other";
    if (!byH[k]) byH[k] = [];
    byH[k].push(r);
  });
  const hospitals = Object.keys(byH).sort();
  list.innerHTML = hospitals.length
    ? hospitals.map((hn) => `
      <div class="appt-item">
        <div class="name">🏥 ${esc(hn)}</div>
        ${byH[hn].map((r) => `
          <div class="meta" style="margin-top:0.4rem">
            <strong>${esc(r.title)}</strong> · ${esc(r.record_type)} · ${esc(r.date || "")}
            ${r.notes ? "<br/>" + esc(r.notes) : ""}
            ${r.file_id ? ` · <a href="/api/reports/file/${r.file_id}" target="_blank">Open file</a>` : ""}
          </div>
        `).join("")}
      </div>`).join("")
    : `<p class="empty">No records from other hospitals yet. Add one above.</p>`;
}

function renderReportsForJourney(journeyId) {
  const box = $("#report-list");
  if (!box) return;
  const list = (state.reports || []).filter((r) => r.journey_id === journeyId);
  box.innerHTML = list.length
    ? list.map((r) => `
      <div class="appt-item">
        <div class="name">📄 ${esc(r.filename)}</div>
        <div class="meta">${esc(r.note || "")} · ${esc((r.uploaded_at || "").slice(0, 16).replace("T", " "))}</div>
        <div class="stage-actions">
          <a class="btn small ghost" href="/api/reports/file/${r.id}" target="_blank" rel="noopener">Open</a>
        </div>
      </div>`).join("")
    : `<p class="empty">No reports uploaded yet</p>`;
}

function formatSummaryDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function buildSpecialistBrief(journey) {
  const patient = patientById(journey.patient_id) || {};
  const records = (state.external_records || []).filter((r) => r.journey_id === journey.id || r.patient_id === journey.patient_id);
  const files = (state.reports || []).filter((r) => r.journey_id === journey.id);
  const appointments = (state.appointments || []).filter((a) => a.journey_id === journey.id || a.patient_name === patient.name).slice(0, 6);
  const stageRows = state.stages.map((stage) => {
    const item = journey.stages?.[stage.id] || { status: "locked" };
    return `<div class="story-row"><span class="story-step"><b>${esc(stage.label)}</b><small>${item.verification && item.verification !== "none" ? `Verified: ${esc(item.verification)}` : "Care Passport stage"}</small></span><span class="story-status ${esc(item.status)}">${esc(item.status)}</span><span class="story-note">${esc(item.note || "")}</span></div>`;
  }).join("");
  const recordRows = records.length ? records.slice(0, 10).map((r) => `<div class="record-row"><span><b>${esc(r.title || "Untitled record")}</b><small>${esc(r.record_type || "Record")} · ${esc(r.hospital_name || "CareLink")}</small></span><span>${esc(formatSummaryDate(r.date))}${r.file_id ? ` · <a href="${location.origin}/api/reports/file/${encodeURIComponent(r.file_id)}">Open file</a>` : ""}</span></div>`).join("") : `<p class="empty">No linked hospital records yet.</p>`;
  const fileRows = files.length ? files.slice(0, 6).map((r) => `<div class="record-row"><span><b>${esc(r.filename)}</b><small>${esc(r.note || "Uploaded report")}</small></span><a href="${location.origin}/api/reports/file/${encodeURIComponent(r.id)}">Open file</a></div>`).join("") : `<p class="empty">No uploaded files yet.</p>`;
  const appointmentRows = appointments.length ? appointments.map((a) => `<div class="record-row"><span><b>${esc(a.type || "Visit")}</b><small>${esc(a.facility || "CareLink")}</small></span><span>${esc(formatSummaryDate(a.date))} · ${esc(a.time || "")}</span></div>`).join("") : `<p class="empty">No appointment recorded.</p>`;
  const generated = new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>CareLink Specialist Brief — ${esc(patient.name)}</title><style>@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font:10.5pt Arial,sans-serif;color:#10231f;margin:0;line-height:1.35}h1,h2,h3,p{margin:0}a{color:#087f75}.sheet{max-width:780px;margin:auto}.top{display:flex;justify-content:space-between;gap:20px;border-bottom:3px solid #0d9488;padding-bottom:14px;margin-bottom:14px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;color:#0d9488;font-size:8pt;font-weight:700}.brand{font-size:24pt;font-weight:800;letter-spacing:-.04em}.sub{color:#52706a;margin-top:3px}.stamp{text-align:right;color:#52706a;font-size:8.5pt}.patient{display:grid;grid-template-columns:1.15fr 1fr 1fr;gap:10px;background:#eef8f5;border-radius:10px;padding:12px;margin-bottom:12px}.label{display:block;text-transform:uppercase;letter-spacing:.08em;font-size:7.5pt;color:#64837c;font-weight:700}.value{font-size:12pt;font-weight:700}.section{margin-top:12px}.section h2{font-size:12pt;margin-bottom:6px}.story,.record-list{border:1px solid #d6e6e1;border-radius:9px;overflow:hidden}.story-row,.record-row{display:grid;grid-template-columns:1.1fr auto 1.5fr;gap:10px;align-items:center;padding:7px 9px;border-bottom:1px solid #e6efec}.story-row:last-child,.record-row:last-child{border-bottom:0}.story-step small,.record-row small{display:block;color:#6a857e;font-size:8.5pt}.story-status{font-size:7.5pt;text-transform:uppercase;font-weight:800;padding:3px 6px;border-radius:5px;background:#edf2f1;color:#526962}.story-status.done{background:#d5f5e7;color:#087153}.story-status.pending,.story-status.overdue,.story-status.blocked{background:#fff0d2;color:#a25c00}.story-note{color:#526962;font-size:9pt}.record-row{grid-template-columns:1fr auto}.record-row span:last-child{color:#526962;font-size:9pt;text-align:right}.empty{color:#78918a;padding:10px}.footer{margin-top:16px;border-top:1px solid #d6e6e1;padding-top:8px;color:#6a857e;font-size:8pt;display:flex;justify-content:space-between}.print-tools{display:flex;gap:8px;margin-bottom:12px}@media print{.print-tools{display:none}.sheet{max-width:none}}</style></head><body><main class="sheet"><div class="print-tools"><button onclick="window.print()">Print / Save as PDF</button><button onclick="window.close()">Close</button></div><header class="top"><div><div class="eyebrow">CareLink · Specialist visit story</div><div class="brand">Care summary</div><div class="sub">A concise handoff for the next clinician</div></div><div class="stamp">Generated<br>${esc(generated)}<br><b>${esc(journey.facility || "CareLink")}</b></div></header><section class="patient"><div><span class="label">Patient</span><span class="value">${esc(patient.name || "Patient")}</span></div><div><span class="label">Contact</span><span class="value">${esc(patient.email || "—")}</span></div><div><span class="label">Reason for care</span><span class="value">${esc(patient.condition || journey.title || "—")}</span></div></section><section class="section"><h2>Journey at a glance</h2><div class="story">${stageRows}</div></section><section class="section"><h2>Visits & appointments</h2><div class="record-list">${appointmentRows}</div></section><section class="section"><h2>Records from CareLink & linked hospitals</h2><div class="record-list">${recordRows}</div></section><section class="section"><h2>Uploaded report files</h2><div class="record-list">${fileRows}</div></section><footer class="footer"><span>Consent-based sharing is simulated in this demo. Verify clinical details with the source facility.</span><span>CareLink · ${esc(journey.title || "Care Passport")}</span></footer></main></body></html>`;
}

function openCareSummary(journey, mode = "print") {
  const html = buildSpecialistBrief(journey);
  if (mode === "download") {
    const patient = patientById(journey.patient_id) || {};
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `carelink-specialist-brief-${(patient.name || "patient").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.html`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast("Specialist report downloaded");
    return;
  }
  const win = window.open("", "carelink-specialist-brief", "width=920,height=900");
  if (!win) { toast("Allow pop-ups to print the brief"); return; }
  win.document.write(html); win.document.close(); win.focus();
  setTimeout(() => win.print(), 350);
}

function renderMessages() {
  const threads = $("#thread-list");
  threads.innerHTML = state.journeys.map((j) => {
    const p = patientById(j.patient_id);
    return `<button type="button" class="thread-btn ${j.id === state.activeJourneyId ? "active" : ""}" data-id="${j.id}">
      <span class="t-name">${esc(p?.name)}</span>
      <span class="t-meta">${esc(j.title)}</span>
    </button>`;
  }).join("");

  threads.querySelectorAll(".thread-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeJourneyId = btn.dataset.id;
      renderMessages();
    });
  });

  if (!state.activeJourneyId && state.journeys[0]) state.activeJourneyId = state.journeys[0].id;
  const j = journeyById(state.activeJourneyId);
  const p = j ? patientById(j.patient_id) : null;
  $("#chat-header").textContent = j ? `${p?.name || "Patient"} · ${j.title}` : "Select a thread";

  const msgs = state.messages.filter((m) => m.journey_id === state.activeJourneyId);
  const body = $("#chat-body");
  body.innerHTML = msgs.map((m) => `
    <div class="bubble ${m.from}">
      <div class="who">${esc(m.from)}</div>
      ${esc(m.body)}
    </div>
  `).join("") || `<p class="empty">No messages yet. Try a quick reply below.</p>`;
  body.scrollTop = body.scrollHeight;

  $("#chat-quick").innerHTML = QUICK.map((q) =>
    `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`
  ).join("");
  $("#chat-quick").querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => sendChat(b.dataset.q));
  });
}

async function sendChat(text) {
  if (!state.activeJourneyId || !text?.trim()) return;
  try {
    const result = await api("/api/messages", {
      method: "POST",
      body: JSON.stringify({
        journey_id: state.activeJourneyId,
        body: text.trim(),
        from: "patient",
        client_now: new Date().toISOString(),
        client_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      }),
    });
    $("#chat-input").value = "";
    await refresh();
    renderMessages();
    await loadCalendar();
    renderCalendar();
    renderAppointments();
    if (result.booking) toast(`Calendar updated: ${result.booking.date} at ${result.booking.time} · booked ${formatLocalDateTime(result.booking.created_at)}`);
  } catch (e) {
    toast("Error: " + e.message);
  }
}

$("#chat-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  sendChat($("#chat-input").value);
});

function renderVerify() {
  const items = [];
  state.journeys.forEach((j) => {
    if (j.status === "closed") return;
    const p = patientById(j.patient_id);
    Object.entries(j.stages).forEach(([sid, st]) => {
      if (["pending", "overdue", "blocked"].includes(st.status)) {
        const label = state.stages.find((s) => s.id === sid)?.label || sid;
        items.push({ j, p, sid, label, st });
      }
    });
  });

  $("#verify-list").innerHTML = items.map((it) => `
    <div class="verify-item">
      <div class="name">${esc(it.p?.name)} · ${esc(it.label)}</div>
      <div class="meta">${esc(it.j.title)} · ${esc(it.j.facility)}</div>
      ${it.st.note ? `<div class="meta">${esc(it.st.note)}</div>` : ""}
      <div class="actions">
        <button class="btn primary small" data-jid="${it.j.id}" data-stage="${it.sid}" data-v="asha">Verify as ASHA</button>
        <button class="btn ghost small" data-jid="${it.j.id}" data-stage="${it.sid}" data-v="provider">Verify as Provider</button>
        <button class="btn ghost small" data-jid="${it.j.id}" data-stage="${it.sid}" data-v="patient">Patient self-report</button>
      </div>
    </div>
  `).join("") || `<p class="empty">Nothing pending verification</p>`;

  $("#verify-list").querySelectorAll("button[data-jid]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/api/journeys/${btn.dataset.jid}/stage`, {
          method: "POST",
          body: JSON.stringify({ stage_id: btn.dataset.stage, status: "done", verification: btn.dataset.v }),
        });
        toast("Verified");
        await refresh();
        renderVerify();
      } catch (e) {
        toast("Error: " + e.message);
      }
    });
  });
}

function initCal() {
  const n = new Date();
  state.calYear = n.getFullYear();
  state.calMonth = n.getMonth() + 1;
}

async function loadCalendar() {
  const data = await api(`/api/calendar?year=${state.calYear}&month=${state.calMonth}`);
  state.calendarDays = data.days || {};
  renderCalendar();
}

function renderCalendar() {
  $("#cal-title").textContent = `${MONTHS[state.calMonth - 1]} ${state.calYear}`;
  const first = new Date(state.calYear, state.calMonth - 1, 1);
  const startDow = first.getDay();
  const dim = new Date(state.calYear, state.calMonth, 0).getDate();
  const today = toDateStr(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());

  let html = DOW.map((d) => `<div class="cal-dow">${d}</div>`).join("");
  for (let i = 0; i < startDow; i++) html += `<div class="cal-day empty"></div>`;
  for (let d = 1; d <= dim; d++) {
    const ds = toDateStr(state.calYear, state.calMonth, d);
    const appts = state.calendarDays[ds] || [];
    const cls = ["cal-day"];
    if (ds === today) cls.push("today");
    if (ds === state.selectedDate) cls.push("selected");
    let dots = "";
    if (appts.length) {
      dots = `<div class="cal-dots">${appts.slice(0, 3).map(() => `<span class="cal-dot"></span>`).join("")}</div>`;
    }
    html += `<button type="button" class="${cls.join(" ")}" data-date="${ds}"><span>${d}</span>${dots}</button>`;
  }
  $("#calendar").innerHTML = html;
  $("#calendar").querySelectorAll("[data-date]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedDate = state.selectedDate === btn.dataset.date ? null : btn.dataset.date;
      if (state.selectedDate) $("#date").value = state.selectedDate;
      renderCalendar();
      renderAppointments();
    });
  });
}

function renderAppointments() {
  let list = state.appointments;
  if (state.selectedDate) {
    list = list.filter((a) => a.date === state.selectedDate);
    $("#appt-heading").textContent = `Appointments · ${state.selectedDate}`;
    $("#btn-clear-filter").classList.remove("hidden");
  } else {
    $("#appt-heading").textContent = "Appointments";
    $("#btn-clear-filter").classList.add("hidden");
  }
  $("#appt-count").textContent = list.length;
  $("#appt-list").innerHTML = list.map((a) => `
    <article class="appt-item" data-id="${a.id}">
      <div style="display:flex;justify-content:space-between">
        <div>
          <div class="name">${esc(a.patient_name)}</div>
          <div class="meta">${esc(a.type)} · ${esc(a.facility || "—")}</div>
          <div class="meta">${esc(a.email || "")}</div>
        </div>
        <span class="tag ${a.status}">${a.status}</span>
      </div>
      <div class="meta">📅 ${a.date} · 🕒 ${a.time} ${a.email_sent ? "· ✅ Patient notified" : ""} ${a.email_mode === "demo" ? "(SMS demo)" : ""}</div>
      <div class="meta booking-time">Booked at ${esc(formatLocalDateTime(a.created_at || a.booked_at))}</div>
      ${a.specialist_email ? `<div class="meta">✉ Specialist brief: ${esc(a.specialist_name || a.specialist_email)} · ${a.specialist_summary_sent ? "✅ sent" : "scheduled before visit"}</div>` : ""}
      <div class="stage-actions">
        <button class="btn small ghost" data-act="notify">Resend SMS/Email</button>
        <button class="btn small ghost" data-act="done">Mark Done</button>
      </div>
    </article>
  `).join("") || `<p class="empty">No appointments</p>`;

  $("#appt-list").querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.closest(".appt-item").dataset.id;
      try {
        if (btn.dataset.act === "notify") {
          await api(`/api/appointments/${id}/notify`, { method: "POST" });
          toast("Notification resent");
        } else {
          await api(`/api/appointments/${id}`, { method: "PATCH", body: JSON.stringify({ status: "completed" }) });
          toast("Marked done");
        }
        await refresh();
        renderAppointments();
        renderNotifications();
        loadCalendar();
      } catch (err) {
        toast(err.message);
      }
    });
  });
}

function renderNotifications() {
  const list = state.notifications || [];
  $("#notif-count").textContent = list.length;
  $("#notif-list").innerHTML = list.slice(0, 20).map((n) => `
    <div class="notif-item">
      <div style="display:flex;justify-content:space-between">
        <strong style="font-size:.85rem;color:var(--teal-dark)">${esc((n.type || "").replace(/_/g, " "))}</strong>
        <span class="meta">${esc((n.created_at || "").slice(0, 16).replace("T", " "))}</span>
      </div>
      <div class="meta" style="white-space:pre-line;max-height:3.5em;overflow:hidden">${esc((n.message || "").slice(0, 160))}</div>
      <div class="meta">${n.status === "sent" ? "✓ " + esc(n.to) : "✗ failed"}</div>
    </div>
  `).join("") || `<p class="empty">No notifications yet</p>`;
}

$("#appt-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = Object.fromEntries(fd.entries());
  const btn = $("#btn-submit");
  const msg = $("#form-msg");
  btn.disabled = true;
  btn.textContent = "Sending…";
  try {
    const res = await api("/api/appointments", { method: "POST", body: JSON.stringify(payload) });
    msg.className = "form-msg success";
    msg.textContent = res.email?.mode === "demo"
      ? (payload.specialist_email ? "✅ Booked. Patient notification is demo-logged; specialist brief is scheduled for the pre-visit automation." : "✅ Booked. 📱 SMS/WhatsApp notification logged (demo).")
      : res.email?.ok
        ? (payload.specialist_email ? "✅ Booked & patient notification sent. Specialist brief scheduled for the pre-visit window." : "✅ Booked & notification sent!")
        : "✅ Booked (notification failed — check Setup)";
    msg.classList.remove("hidden");
    e.target.reset();
    setDefaults();
    await refresh();
    renderAppointments();
    renderNotifications();
    loadCalendar();
    toast("Appointment booked");
  } catch (err) {
    msg.className = "form-msg error";
    msg.textContent = err.message;
    msg.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Book & Send Email";
  }
});

function setDefaults() {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  $("#date").value = toDateStr(t.getFullYear(), t.getMonth() + 1, t.getDate());
  $("#time").value = "10:00";
}

$("#role-select")?.addEventListener("change", async (e) => {
  try {
    await api("/api/role", { method: "POST", body: JSON.stringify({ role: e.target.value }) });
    state.role = e.target.value;
    toast("Role: " + e.target.value);
    renderDashboard();
    renderPassport();
    renderVerify();
  } catch (err) {
    toast(err.message);
  }
});

$("#btn-help")?.addEventListener("click", () => {
  $("#panel-help").classList.toggle("hidden");
  updateEmailStatus();
});
$("#btn-close-help")?.addEventListener("click", () => $("#panel-help").classList.add("hidden"));

$("#btn-reset")?.addEventListener("click", async () => {
  if (!confirm("Reset all demo data?")) return;
  await api("/api/reset", { method: "POST" });
  toast("Demo data reset");
  await refresh();
  renderAll();
});

$("#btn-test-email")?.addEventListener("click", async () => {
  const email = $("#test-email")?.value.trim();
  const msg = $("#test-email-msg");
  if (!email) {
    msg.className = "form-msg error";
    msg.textContent = "Enter email";
    msg.classList.remove("hidden");
    return;
  }
  try {
    const res = await api("/api/test-email", { method: "POST", body: JSON.stringify({ email }) });
    msg.className = "form-msg " + (res.ok ? "success" : "error");
    if (res.mode === "demo") msg.textContent = "Demo — logged in terminal. Add SMTP_* to .env.";
    else if (res.ok) msg.textContent = "✅ Test email sent! Check inbox (and spam).";
    else msg.textContent = "Error: " + (res.error || "failed");
    msg.classList.remove("hidden");
  } catch (e) {
    msg.className = "form-msg error";
    msg.textContent = e.message;
    msg.classList.remove("hidden");
  }
});

async function updateEmailStatus() {
  try {
    const h = await api("/api/health");
    const pill = $("#email-status");
    if (!pill) return;
    if (h.email_mode === "smtp") {
      pill.textContent = "Email: Live";
      pill.className = "status-pill live";
    } else {
      pill.textContent = "Email: Demo";
      pill.className = "status-pill demo";
    }
  } catch (_) {}
}

$("#cal-prev")?.addEventListener("click", async () => {
  state.calMonth--;
  if (state.calMonth < 1) { state.calMonth = 12; state.calYear--; }
  await loadCalendar();
});
$("#cal-next")?.addEventListener("click", async () => {
  state.calMonth++;
  if (state.calMonth > 12) { state.calMonth = 1; state.calYear++; }
  await loadCalendar();
});
$("#cal-today")?.addEventListener("click", async () => {
  const n = new Date();
  state.calYear = n.getFullYear();
  state.calMonth = n.getMonth() + 1;
  state.selectedDate = toDateStr(n.getFullYear(), n.getMonth() + 1, n.getDate());
  $("#date").value = state.selectedDate;
  await loadCalendar();
  renderAppointments();
});
$("#btn-clear-filter")?.addEventListener("click", () => {
  state.selectedDate = null;
  renderCalendar();
  renderAppointments();
});

async function refresh() {
  const data = await api("/api/bootstrap");
  state.patients = data.patients;
  state.journeys = data.journeys;
  state.messages = data.messages;
  state.appointments = data.appointments;
  state.notifications = data.notifications || [];
  state.stages = data.stages;
  state.reports = data.reports || [];
  state.hospitals = data.hospitals || [];
  state.external_records = data.external_records || [];
  if (data.sync_version != null) state.syncVersion = data.sync_version;
  state.role = data.role;
  state.acting_patient_id = data.acting_patient_id;
  $("#role-select").value = state.role;
  await updateEmailStatus();
  await loadAccessLog();
}

function renderAll() {
  renderDashboard();
  if (document.querySelector(".tab.active")?.dataset?.tab === "analytics") renderAnalytics();
  renderPassport();
  renderMessages();
  renderVerify();
  renderAppointments();
  renderNotifications();
  updateTabBadgesAndTitle();
}

$("#btn-demo-fetch")?.addEventListener("click", () => {
  $$(".tab").forEach((t) => t.classList.remove("active"));
  $$('.tab[data-tab="fetch"]').classList.add("active");
  $$(".tab-panel").forEach((p) => p.classList.add("hidden"));
  $("#tab-fetch")?.classList.remove("hidden");
  const input = $("#fetch-query");
  if (input) {
    input.value = "Meera Patel";
    input.focus();
  }
  toast("Demo: search Meera Patel → OTP 1234");
});

(async function init() {
  initCal();
  setDefaults();
  await refresh();
  renderAll();
  try { await loadCalendar(); } catch (_) {}
  startSyncPolling();
})();


$("#add-patient-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = Object.fromEntries(fd.entries());
  payload.start_journey = true;
  const msg = $("#add-patient-msg");
  try {
    const created = await api("/api/patients", { method: "POST", body: JSON.stringify(payload) });
    msg.className = "form-msg success";
    msg.textContent = "✅ Person added and Care Passport started.";
    msg.classList.remove("hidden");
    e.target.reset();
    await refresh();
    if (created.journey_id) state.activeJourneyId = created.journey_id;
    renderAll();
    toast("Person added");
  } catch (err) {
    msg.className = "form-msg error";
    msg.textContent = err.message;
    msg.classList.remove("hidden");
  }
});


$("#report-upload-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.activeJourneyId) {
    toast("Select a passport first");
    return;
  }
  const fileInput = $("#report-file");
  const note = $("#report-note")?.value || "";
  if (!fileInput?.files?.length) {
    toast("Choose a file");
    return;
  }
  const fd = new FormData();
  fd.append("file", fileInput.files[0]);
  fd.append("journey_id", state.activeJourneyId);
  fd.append("note", note);
  const msg = $("#report-upload-msg");
  try {
    const res = await fetch("/api/reports/upload", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    msg.className = "form-msg success";
    msg.textContent = data.email?.ok ? "✅ Report uploaded & patient notified (SMS/email)" : "✅ Report uploaded";
    msg.classList.remove("hidden");
    fileInput.value = "";
    if ($("#report-note")) $("#report-note").value = "";
    await refresh();
    renderPassport();
    toast("Report uploaded");
  } catch (err) {
    msg.className = "form-msg error";
    msg.textContent = err.message;
    msg.classList.remove("hidden");
  }
});

$("#btn-run-reminders")?.addEventListener("click", async () => {
  try {
    const res = await api("/api/reminders/run", { method: "POST", body: JSON.stringify({ force: false }) });
    toast(`Reminders sent: ${res.sent_count || 0}`);
    await refresh();
    renderNotifications();
    renderAppointments();
  } catch (e) {
    toast(e.message);
  }
});


$("#external-record-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const j = journeyById(state.activeJourneyId);
  if (!j) {
    toast("Select a passport first");
    return;
  }
  const msg = $("#er-msg");
  const fd = new FormData();
  fd.append("patient_id", j.patient_id);
  fd.append("journey_id", j.id);
  fd.append("hospital_id", $("#er-hospital")?.value || "");
  fd.append("hospital_name", $("#er-hospital-name")?.value || "");
  fd.append("title", $("#er-title")?.value || "");
  fd.append("record_type", $("#er-type")?.value || "Record");
  fd.append("date", $("#er-date")?.value || "");
  fd.append("notes", $("#er-notes")?.value || "");
  const file = $("#er-file")?.files?.[0];
  if (file) fd.append("file", file);

  try {
    const res = await fetch("/api/external-records", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    msg.className = "form-msg success";
    msg.textContent = data.email?.ok
      ? "✅ Hospital record added & patient notified"
      : "✅ Hospital record added";
    msg.classList.remove("hidden");
    e.target.reset();
    await refresh();
    renderPassport();
    toast("Hospital record added");
  } catch (err) {
    msg.className = "form-msg error";
    msg.textContent = err.message;
    msg.classList.remove("hidden");
  }
});


function showConsentModal(query) {
  state.pendingFetchQuery = query;
  state.consentGranted = false;
  const modal = $("#consent-modal");
  const otp = $("#consent-otp");
  const err = $("#consent-error");
  if (err) err.classList.add("hidden");
  if (otp) otp.value = "";
  modal?.classList.remove("hidden");
  setTimeout(() => otp?.focus(), 50);
}

function hideConsentModal() {
  $("#consent-modal")?.classList.add("hidden");
  state.pendingFetchQuery = null;
}

async function runFetchPatient(query, silent = false) {
  const msg = $("#fetch-msg");
  const progress = $("#fetch-progress");
  const bar = $("#fetch-bar-inner");
  const ptext = $("#fetch-progress-text");
  const results = $("#fetch-results");

  msg.classList.add("hidden");
  results.classList.add("hidden");
  results.innerHTML = "";
  progress.classList.remove("hidden");
  bar.style.width = "15%";
  ptext.textContent = "Looking up patient…";

  const steps = [
    [35, "Contacting linked hospitals…"],
    [55, "Collecting visits & appointments…"],
    [75, "Gathering reports & files…"],
    [90, "Building care summary…"],
  ];
  let i = 0;
  const tick = setInterval(() => {
    if (i < steps.length) {
      bar.style.width = steps[i][0] + "%";
      ptext.textContent = steps[i][1];
      i++;
    }
  }, 280);

  try {
    const actor = ($("#role-select")?.value || "Care Team");
    const res = await api("/api/fetch-patient", {
      method: "POST",
      body: JSON.stringify({ query, actor: actor === "doctor" ? "Dr. Mehta" : actor === "asha" ? "ASHA worker" : "Care Team" }),
    });
    clearInterval(tick);
    bar.style.width = "100%";
    ptext.textContent = "Done";
    setTimeout(() => progress.classList.add("hidden"), 400);

    const s = res.summary;
    state.lastFetchedQuery = query;
    const p = s.patient;
    let html = `
      <div class="card">
        <div class="card-head">
          <div>
            <h2>${esc(p.name)}</h2>
            <p class="meta">${esc(p.email || "")} · ${esc(p.condition || "")}</p>
          </div>
          <span class="badge">${s.hospital_count} hospital(s)</span>
        </div>
        <p class="muted">${esc(s.message)}</p>
        <div class="metrics" style="margin-top:0.75rem">
          <div class="metric"><div class="k">${s.hospital_count}</div><div class="v">hospitals</div></div>
          <div class="metric"><div class="k">${(s.journeys || []).length}</div><div class="v">journeys</div></div>
          <div class="metric"><div class="k">${(s.external_records || []).length}</div><div class="v">records</div></div>
          <div class="metric"><div class="k">${(s.reports || []).length}</div><div class="v">files</div></div>
        </div>
      </div>
      <div class="grid-2" style="margin-top:1rem">
        <div class="card">
          <h2>Hospitals visited</h2>
          <div class="list">
            ${(s.hospitals_visited || []).map((h) => `
              <div class="appt-item hospital-card">
                <div class="name">🏥 ${esc(h.name)}</div>
                <div class="meta">${esc(h.city || "")} · ${esc((h.sources || []).join(", "))}</div>
                <div class="meta">${h.journey_count} journey(s) · ${h.record_count} record(s) · ${h.appointment_count} appointment(s)</div>
                ${(h.records || []).slice(0, 5).map((r) =>
                  `<div class="meta">• ${esc(r.title)} (${esc(r.record_type)}) ${r.date ? "· " + esc(r.date) : ""}
                  ${r.file_id ? ` <a href="/api/reports/file/${r.file_id}" target="_blank">file</a>` : ""}</div>`
                ).join("")}
              </div>
            `).join("") || '<p class="empty">No hospitals linked yet</p>'}
          </div>
        </div>
        <div class="card">
          <h2>Timeline</h2>
          <div class="list">
            ${(s.timeline || []).slice(0, 20).map((t) => `
              <div class="timeline-item">
                <div class="name">${esc(t.title || t.kind)}</div>
                <div class="meta">${esc(t.date)} · ${esc(t.hospital || "")} · ${esc(t.kind)} ${t.detail ? "· " + esc(t.detail) : ""}
                ${t.file_id ? ` · <a href="/api/reports/file/${t.file_id}" target="_blank">Open</a>` : ""}</div>
              </div>
            `).join("") || '<p class="empty">No events yet</p>'}
          </div>
        </div>
      </div>
      <div class="card" style="margin-top:1rem">
        <h2>Consent-based sync (ABDM-style, simulated for demo)</h2>
        <div class="list">
          ${(s.network_hits || []).map((hit) => {
            if (hit.error) return `<div class="appt-item"><div class="name">⚠ ${esc(hit.hospital_key || "hospital")}</div><div class="meta">${esc(hit.error)} — is hospital network running on :5001?</div></div>`;
            const hp = hit.hospital || {};
            if (!hit.found) return `<div class="appt-item"><div class="name">🏥 ${esc(hp.name || "?")}</div><div class="meta">No record for this patient</div></div>`;
            const reps = ((hit.patient || {}).reports || []).map((r) => `• ${esc(r.title)} (${esc(r.date)})`).join("<br/>");
            return `<div class="appt-item"><div class="name">🏥 ${esc(hp.name)} <span class="tag done">linked</span></div>
              <div class="meta">${esc(hp.city)} · ${esc(hp.phone || "")}</div>
              <div class="meta">${reps || "Visits found"}</div></div>`;
          }).join("") || '<p class="empty">Start hospital network on port 5001 to query sites</p>'}
        </div>
      </div>
      <div class="card" style="margin-top:1rem">
        <h2>Care passports</h2>
        <div class="list">
          ${(s.journeys || []).map((j) => {
            const stages = Object.entries(j.stages || {}).map(([k, st]) => `${k}:${st.status}`).join(" · ");
            return `<div class="journey-item" data-open-passport="${j.id}">
              <div class="name">${esc(j.title)}</div>
              <div class="meta">${esc(j.facility)} · <span class="tag ${j.status}">${j.status}</span></div>
              <div class="meta">${esc(stages)}</div>
            </div>`;
          }).join("") || '<p class="empty">No passports</p>'}
        </div>
      </div>
    `;
    results.innerHTML = html;
    results.classList.remove("hidden");

    results.querySelectorAll("[data-open-passport]").forEach((el) => {
      el.style.cursor = "pointer";
      el.addEventListener("click", () => {
        state.activeJourneyId = el.dataset.openPassport;
        $$(".tab").forEach((t) => t.classList.remove("active"));
        $$('.tab[data-tab="passport"]').classList.add("active");
        $$(".tab-panel").forEach((p) => p.classList.add("hidden"));
        $("#tab-passport").classList.remove("hidden");
        renderPassport();
      });
    });

    await loadAccessLog();
    renderAccessLog();
    if (!silent) toast("Records fetched (consent granted)");
  } catch (err) {
    clearInterval(tick);
    progress.classList.add("hidden");
    msg.className = "form-msg error";
    msg.textContent = err.message;
    msg.classList.remove("hidden");
  }
}

$("#fetch-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const query = $("#fetch-query")?.value.trim();
  if (!query) return;
  // Consent gate: do not call API / show results until UI consent is granted
  showConsentModal(query);
});

function showConsentReceipt(query) {
  const id = "CL-DEMO-" + Math.random().toString(36).slice(2, 8).toUpperCase();
  const el = $("#consent-receipt");
  const text = $("#consent-receipt-text");
  if (text) {
    text.textContent = ` ID ${id} · patient “${query || "—"}” · purpose: specialist review · valid 24h (simulated)`;
  }
  el?.classList.remove("hidden");
  clearTimeout(el?._t);
  if (el) el._t = setTimeout(() => el.classList.add("hidden"), 12000);
}

$("#consent-receipt-dismiss")?.addEventListener("click", () => {
  $("#consent-receipt")?.classList.add("hidden");
});

$("#consent-grant")?.addEventListener("click", () => {
  const otp = ($("#consent-otp")?.value || "").trim();
  const err = $("#consent-error");
  if (!/^\d{4}$/.test(otp)) {
    err?.classList.remove("hidden");
    return;
  }
  err?.classList.add("hidden");
  state.consentGranted = true;
  const q = state.pendingFetchQuery;
  hideConsentModal();
  showConsentReceipt(q);
  if (q) runFetchPatient(q);
});

$("#consent-cancel")?.addEventListener("click", () => {
  hideConsentModal();
  toast("Consent not granted — records not shown");
});

$("#consent-otp")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    $("#consent-grant")?.click();
  }
});


function startSyncPolling() {
  setInterval(async () => {
    try {
      const st = await api("/api/sync/status");
      if (st.sync_version != null && st.sync_version > (state.syncVersion || 0)) {
        state.syncVersion = st.sync_version;
        await refresh();
        renderAll();
        const active = document.querySelector(".tab.active")?.dataset?.tab;
        if (active === "passport") renderPassport();
        if (active === "fetch" && state.lastFetchedQuery) runFetchPatient(state.lastFetchedQuery, true);
        toast("Consent-based sync: hospital data updated");
      }
    } catch (_) {}
  }, 3000);
}
