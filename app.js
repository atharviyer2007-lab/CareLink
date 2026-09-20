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
    if (btn.dataset.tab === "messages") renderMessages();
    if (btn.dataset.tab === "verify") renderVerify();
    if (btn.dataset.tab === "calendar") { loadCalendar(); renderAppointments(); renderNotifications(); }
  });
});

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

  $("#metrics").innerHTML = `
    <div class="metric"><div class="k">${open.length}</div><div class="v">open journeys</div></div>
    <div class="metric"><div class="k ${overdue ? "danger" : ""}">${overdue}</div><div class="v">overdue stages</div></div>
    <div class="metric"><div class="k ${blocked ? "danger" : ""}">${blocked}</div><div class="v">blocked</div></div>
    <div class="metric"><div class="k">${closed}</div><div class="v">closed passports</div></div>
  `;

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
  $("#passport-header").innerHTML = `
    <h3>${esc(p?.name)}</h3>
    <div class="meta">${esc(j.title)} · ${esc(j.facility)} · ${esc(p?.condition || "")}</div>
    <div class="meta" style="margin-top:.35rem"><span class="tag ${j.status}">${j.status}</span></div>
  `;

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
          toast(res.email?.ok ? "Updated & email sent to patient" : "Updated (email demo/failed)");
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
    await api("/api/messages", {
      method: "POST",
      body: JSON.stringify({ journey_id: state.activeJourneyId, body: text.trim(), from: "patient" }),
    });
    $("#chat-input").value = "";
    await refresh();
    renderMessages();
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
      <div class="meta">📅 ${a.date} · 🕒 ${a.time} ${a.email_sent ? "· ✅ Email" : ""} ${a.email_mode === "demo" ? "(demo)" : ""}</div>
      <div class="stage-actions">
        <button class="btn small ghost" data-act="notify">Resend Email</button>
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
          toast("Email resent");
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
      ? "✅ Booked. Email logged (demo). Use ⚙️ Setup for live email."
      : res.email?.ok
        ? "✅ Booked & email sent!"
        : "✅ Booked (email failed — check Setup)";
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
}

function renderAll() {
  renderDashboard();
  renderPassport();
  renderMessages();
  renderVerify();
  renderAppointments();
  renderNotifications();
}

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
    await api("/api/patients", { method: "POST", body: JSON.stringify(payload) });
    msg.className = "form-msg success";
    msg.textContent = "✅ Person added and Care Passport started.";
    msg.classList.remove("hidden");
    e.target.reset();
    await refresh();
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
    msg.textContent = data.email?.ok ? "✅ Report uploaded & patient emailed" : "✅ Report uploaded";
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
      ? "✅ Hospital record added & patient emailed"
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


$("#fetch-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = $("#fetch-query")?.value.trim();
  const msg = $("#fetch-msg");
  const progress = $("#fetch-progress");
  const bar = $("#fetch-bar-inner");
  const ptext = $("#fetch-progress-text");
  const results = $("#fetch-results");
  if (!query) return;

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
    const res = await api("/api/fetch-patient", {
      method: "POST",
      body: JSON.stringify({ query }),
    });
    clearInterval(tick);
    bar.style.width = "100%";
    ptext.textContent = "Done";
    setTimeout(() => progress.classList.add("hidden"), 400);

    const s = res.summary;
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
        <h2>Live hospital network response</h2>
        <div class="list">
          ${(s.network_hits || []).map((hit) => {
            if (hit.error) return `<div class="appt-item"><div class="name">⚠ ${esc(hit.hospital_key || "hospital")}</div><div class="meta">${esc(hit.error)} — is hospital network running on :5001?</div></div>`;
            const hp = hit.hospital || {};
            if (!hit.found) return `<div class="appt-item"><div class="name">🏥 ${esc(hp.name || "?")}</div><div class="meta">No record for this patient</div></div>`;
            const reps = ((hit.patient || {}).reports || []).map((r) => `• ${esc(r.title)} (${esc(r.date)})`).join("<br/>");
            return `<div class="appt-item"><div class="name">🏥 ${esc(hp.name)} <span class="tag done">linked</span></div>
              <div class="meta">${esc(hp.city)} · ${esc(hp.phone || "")}</div>
              <div class="meta">${reps || "Visits found"}</div></div>`;
          }).join("") || '<p class="empty">Start hospital network on port 5001 to query live sites</p>'}
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

    toast("Records fetched");
  } catch (err) {
    clearInterval(tick);
    progress.classList.add("hidden");
    msg.className = "form-msg error";
    msg.textContent = err.message;
    msg.classList.remove("hidden");
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
        toast("Live sync: hospital data updated");
      }
    } catch (_) {}
  }, 3000);
}
