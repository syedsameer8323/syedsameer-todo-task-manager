/* Task Manager frontend - talks to the Django REST API only (no hardcoded data). */
const API = "/api/tasks/";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const state = { status: "", priority: "", due: "", ordering: "newest", search: "", needsReview: false, workflow: "assigned", page: 1, pageSize: 10, count: 0, editingId: null, deleteId: null, previewTask: null };

/* ---------- API helper ---------- */
class ApiError extends Error { constructor(msg, status, fields, extra = {}) { super(msg); this.status = status; this.fields = fields || {}; Object.assign(this, extra); } }
async function api(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  } catch { throw new ApiError("Can't reach the server. Check your connection and try again.", 0); }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) throw new ApiError((data && data.error) || `Request failed (${res.status}).`, res.status, data && data.fields, data || {});
  return data;
}

/* ---------- helpers ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = iso => iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "No deadline";
function dueNote(t) {
  if (t.days_left === null || t.status === "completed") return "";
  if (t.days_left < 0) return `Overdue by ${-t.days_left} day${t.days_left === -1 ? "" : "s"}`;
  if (t.days_left === 0) return "Due today";
  if (t.days_left === 1) return "Due tomorrow";
  return t.is_due_soon ? `Due in ${t.days_left} days` : `${t.days_left} days left`;
}
function toast(msg, type = "") {
  const el = Object.assign(document.createElement("div"), { className: "toast " + type, textContent: msg });
  $("#toasts").append(el); setTimeout(() => el.remove(), 3800);
}
const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ---------- loading ---------- */
let loadSeq = 0;
async function loadTasks() {
  const seq = ++loadSeq;
  const q = new URLSearchParams({ page: state.page, page_size: state.pageSize, ordering: state.ordering });
  ["status", "priority", "due", "search"].forEach(k => state[k] && q.set(k, state[k]));
  if (state.needsReview) q.set("needs_review", "true");
  $("#rows").innerHTML = '<tr class="skeleton"><td>.</td><td>.</td><td>.</td><td>.</td><td>.</td></tr>'.repeat(3);
  try {
    const data = await api(`${API}?${q}`);
    if (seq !== loadSeq) return;
    if (!data.results.length && state.page > 1) { state.page--; return loadTasks(); }
    state.count = data.count; renderRows(data.results); renderPager();
  } catch (e) { if (seq === loadSeq) { $("#rows").innerHTML = ""; showEmpty("Couldn't load tasks", e.message); toast(e.message, "error"); } }
}
async function loadStats() {
  try {
    const s = await api(API + "stats/");
    Object.entries(s).forEach(([k, v]) => { const el = $("#s-" + k); if (el) el.textContent = v; });
    $("#assignedCount").textContent = s.total ?? 0;
    $("#acceptedCount").textContent = s.in_progress ?? 0;
    $("#reviewCount").textContent = s.needs_review ?? 0;
  } catch { /* stats are non-critical */ }
}
const refresh = () => Promise.all([loadTasks(), loadStats()]);

function showEmpty(title, text) { const e = $("#empty"); e.hidden = false; e.innerHTML = `<b>${esc(title)}</b>${esc(text)}`; }
function renderRows(tasks) {
  const body = $("#rows");
  if (!tasks.length) {
    body.innerHTML = "";
    const filtered = state.status || state.priority || state.due || state.search || state.needsReview;
    return showEmpty(filtered ? "No tasks match this view" : "No tasks yet", filtered ? "Try clearing filters or add a task to this view." : "Select Create new task to add your first one.");
  }
  $("#empty").hidden = true;
  body.innerHTML = tasks.map(t => {
    const note = dueNote(t), cls = t.is_overdue ? "over" : t.is_due_soon ? "soon" : "";
    return `<tr data-id="${t.id}" class="${t.is_overdue ? "overdue" : ""} ${t.status === "completed" ? "done" : ""}">
      <td><button class="t-title title-link" data-act="preview" title="Preview ${esc(t.title)}">${esc(t.title)}</button>${t.description ? `<span class="t-desc">${esc(t.description)}</span>` : ""}${t.needs_review ? '<span class="review-label">Needs review</span>' : ""}</td>
      <td><span class="badge p-${t.priority}">${esc(t.priority_display)}</span></td>
      <td><span class="badge s-${t.status}">${esc(t.status_display)}</span></td>
      <td><span class="due ${cls}">${fmtDate(t.deadline)}${note ? `<small>${note}</small>` : ""}</span></td>
      <td><div class="acts">
        ${t.status === "pending" ? '<button class="mini-btn accept-task" data-act="accept" title="Accept this task">Accept</button>' : ""}
        <button class="icon-btn ok" data-act="done" ${t.status === "completed" ? "disabled" : ""} title="Mark as completed" aria-label="Mark as completed"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>
        <button class="icon-btn review-action ${t.needs_review ? "review-on" : ""}" data-act="review" title="${t.needs_review ? "Remove from review" : "Send for review"}" aria-label="${t.needs_review ? "Remove from review" : "Send for review"}"><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4zM8 12l3 3 5-6"/></svg></button>
        <button class="icon-btn" data-act="edit" title="Edit task" aria-label="Edit task"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
        <button class="icon-btn del" data-act="delete" title="Delete task" aria-label="Delete task"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg></button>
      </div></td></tr>`;
  }).join("");
}
function renderPager() {
  const from = state.count ? (state.page - 1) * state.pageSize + 1 : 0;
  const to = Math.min(state.page * state.pageSize, state.count);
  $("#range").textContent = `${from}-${to} of ${state.count}`;
  $("#prev").disabled = state.page <= 1;
  $("#next").disabled = to >= state.count;
}

/* ---------- filters / navigation ---------- */
function setStatus(s) { state.status = s; $$("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.status === s)); }
function applyView(v) {   // sidebar + stat cards presets
  state.workflow = "assigned"; state.needsReview = false;
  $$("#workflowTabs button").forEach(b => b.classList.toggle("active", b.dataset.workflow === "assigned"));
  setStatus(["pending", "in_progress", "completed"].includes(v) ? v : "");
  state.due = v === "overdue" || v === "soon" ? v : "";
  $("#fDue").value = state.due;
  $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === v));
  state.page = 1; loadTasks(); closeMenu();
}
$("#tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; state.workflow = "assigned"; state.needsReview = false; $$("#workflowTabs button").forEach(x => x.classList.toggle("active", x.dataset.workflow === "assigned")); setStatus(b.dataset.status); state.page = 1; loadTasks(); });
$("#workflowTabs").addEventListener("click", e => {
  const b = e.target.closest("[data-workflow]"); if (!b) return;
  state.workflow = b.dataset.workflow; state.page = 1; state.due = ""; $("#fDue").value = "";
  state.needsReview = state.workflow === "review";
  setStatus(state.workflow === "accepted" ? "in_progress" : "");
  $$("#workflowTabs button").forEach(x => x.classList.toggle("active", x === b));
  $$(".nav-btn").forEach(x => x.classList.toggle("active", x.id === (state.workflow === "review" ? "sidebarReview" : "sidebarAssigned")));
  loadTasks(); closeMenu();
});
$("#sidebarAssigned").onclick = () => $("#workflowTabs [data-workflow=assigned]").click();
$("#sidebarReview").onclick = () => $("#workflowTabs [data-workflow=review]").click();
$$("[data-view]").forEach(b => b.addEventListener("click", () => applyView(b.dataset.view)));
$("#fPriority").onchange = e => { state.priority = e.target.value; state.page = 1; loadTasks(); };
$("#fDue").onchange = e => { state.due = e.target.value; state.page = 1; loadTasks(); };
$("#fSort").onchange = e => { state.ordering = e.target.value; state.page = 1; loadTasks(); };
$("#pageSize").onchange = e => { state.pageSize = +e.target.value; state.page = 1; loadTasks(); };
$("#search").addEventListener("input", debounce(e => { state.search = e.target.value.trim(); state.page = 1; loadTasks(); }));
$("#clearBtn").onclick = () => {
  Object.assign(state, { priority: "", due: "", ordering: "newest", search: "", needsReview: false, workflow: "assigned", page: 1 });
  $$("#workflowTabs button").forEach(b => b.classList.toggle("active", b.dataset.workflow === "assigned"));
  $("#fPriority").value = ""; $("#fDue").value = ""; $("#fSort").value = "newest"; $("#search").value = "";
  applyView("all");
};
$("#prev").onclick = () => { state.page--; loadTasks(); };
$("#next").onclick = () => { state.page++; loadTasks(); };

/* Responsive sidebar: collapsible on desktop, slide-out drawer on mobile */
const closeMenu = () => {
  $("#sidebar").classList.remove("open");
  $("#scrim").classList.remove("show");
  $("#menuBtn").setAttribute("aria-label", "Open navigation menu");
  $("#menuBtn").setAttribute("aria-expanded", "false");
};
$("#menuBtn").onclick = () => {
  const sidebar = $("#sidebar");
  const isMobile = window.matchMedia("(max-width: 760px)").matches;
  const willOpen = !sidebar.classList.contains("open");
  sidebar.classList.toggle("open", willOpen);
  $("#scrim").classList.toggle("show", isMobile && willOpen);
  $("#menuBtn").setAttribute("aria-label", willOpen ? "Close navigation menu" : "Open navigation menu");
  $("#menuBtn").setAttribute("aria-expanded", String(willOpen));
};
$("#scrim").onclick = closeMenu;
window.addEventListener("resize", () => {
  if (!window.matchMedia("(max-width: 760px)").matches) $("#scrim").classList.remove("show");
  else if (!$("#sidebar").classList.contains("open")) $("#scrim").classList.remove("show");
});

/* ---------- create / edit ---------- */
const dlg = $("#taskDialog"), form = $("#taskForm");
function clearErrors() { $$(".err", form).forEach(e => e.textContent = ""); $$(".field", form).forEach(f => f.classList.remove("invalid")); $("#formError").hidden = true; }
function showErrors(fields = {}, message) {
  let shown = false;
  Object.entries(fields).forEach(([k, v]) => {
    const el = $(`.err[data-for="${k}"]`, form);
    if (el) { el.textContent = [].concat(v).join(" "); el.closest(".field").classList.add("invalid"); shown = true; }
  });
  if (!shown) { $("#formError").textContent = message; $("#formError").hidden = false; }
}
function openForm(task) {
  state.editingId = task ? task.id : null; form.reset(); clearErrors();
  $("#dlgTitle").textContent = task ? "Edit task" : "Create new task";
  $("#saveBtn").textContent = task ? "Save changes" : "Create task";
  // Past deadlines are allowed so users can record work that is already overdue.
  form.deadline.removeAttribute("min");
  if (task) { ["title", "description", "priority", "status"].forEach(k => form[k].value = task[k] || ""); form.deadline.value = task.deadline || ""; }
  dlg.showModal(); form.title.focus();
}
$("#newBtn").onclick = () => openForm(null);
$("#cancelBtn").onclick = () => dlg.close();
form.addEventListener("submit", async e => {
  e.preventDefault(); clearErrors();
  const body = { title: form.title.value.trim(), description: form.description.value.trim(), deadline: form.deadline.value || null, priority: form.priority.value, status: form.status.value };
  if (!body.title) return showErrors({ title: "Task title is required." });
  const btn = $("#saveBtn"); btn.disabled = true;
  try {
    const editing = state.editingId;
    const url = editing ? `${API}${editing}/` : API;
    try {
      await api(url, { method: editing ? "PUT" : "POST", body: JSON.stringify(body) });
    } catch (err) {
      if (!editing && err.duplicate) {
        const proceed = window.confirm(`A task named "${err.existing_task?.title || body.title}" with the same description already exists. Create another copy anyway?`);
        if (!proceed) return;
        await api(url, { method: "POST", body: JSON.stringify({ ...body, allow_duplicate: true }) });
      } else throw err;
    }
    dlg.close(); toast(editing ? "Task updated." : "Task created."); refresh(); loadNotifications();
  } catch (err) { showErrors(err.fields, err.message); }
  finally { btn.disabled = false; }
});

/* ---------- row actions ---------- */
$("#rows").addEventListener("click", async e => {
  const btn = e.target.closest("[data-act]"); if (!btn) return;
  const id = btn.closest("tr").dataset.id, act = btn.dataset.act;
  try {
    if (act === "preview") return openPreview(await api(`${API}${id}/`));
    if (act === "edit") return openForm(await api(`${API}${id}/`));
    if (act === "accept") {
      btn.disabled = true;
      await api(`${API}${id}/accept/`, { method: "POST", body: "{}" });
      toast("Task accepted. It is now in Accepted Tasks.");
      refresh(); loadNotifications();
      return;
    }
    if (act === "review") {
      const task = await api(`${API}${id}/`);
      await api(`${API}${id}/`, { method: "PATCH", body: JSON.stringify({ needs_review: !task.needs_review }) });
      toast(task.needs_review ? "Task removed from review." : "Task sent for review."); refresh(); loadNotifications(); return;
    }
    if (act === "done") { await api(`${API}${id}/`, { method: "PATCH", body: JSON.stringify({ status: "completed" }) }); toast("Task completed."); refresh(); }
    if (act === "delete") {
      state.deleteId = id; $("#confirmText").textContent = `"${btn.closest("tr").querySelector(".t-title").textContent}" will be removed permanently.`;
      $("#confirmDialog").showModal();
    }
  } catch (err) { toast(err.message, "error"); if (err.status === 404) refresh(); }
});
$("#confirmNo").onclick = () => $("#confirmDialog").close();
$("#confirmYes").onclick = async () => {
  try { await api(`${API}${state.deleteId}/`, { method: "DELETE" }); toast("Task deleted."); refresh(); }
  catch (err) { toast(err.message, "error"); if (err.status === 404) refresh(); }
  $("#confirmDialog").close();
};
$$("dialog").forEach(d => d.addEventListener("click", e => { if (e.target === d) d.close(); }));

/* ---------- task preview ---------- */
const previewDialog = $("#previewDialog");
function openPreview(task) {
  state.previewTask = task;
  $("#previewTitle").textContent = task.title;
  $("#previewContent").innerHTML = `
    <p>${esc(task.description || "No description provided.")}</p>
    <div class="preview-grid"><div><small>Priority</small><span class="badge p-${task.priority}">${esc(task.priority_display)}</span></div>
    <div><small>Status</small><span class="badge s-${task.status}">${esc(task.status_display)}</span></div>
    <div><small>Deadline</small><strong>${esc(fmtDate(task.deadline))}</strong></div>
    <div><small>Review</small><strong>${task.needs_review ? "Waiting for review" : "Not in review"}</strong></div>
    <div><small>Created</small><strong>${esc(new Date(task.created_at).toLocaleString())}</strong></div>
    <div><small>Last updated</small><strong>${esc(new Date(task.updated_at).toLocaleString())}</strong></div></div>`;
  $("#previewAcceptBtn").hidden = task.status !== "pending";
  previewDialog.showModal();
}
$("#previewAcceptBtn").onclick = async () => {
  const task = state.previewTask;
  if (!task) return;
  const btn = $("#previewAcceptBtn"); btn.disabled = true;
  try {
    await api(`${API}${task.id}/accept/`, { method: "POST", body: "{}" });
    previewDialog.close(); toast("Task accepted. It is now in Accepted Tasks.");
    refresh(); loadNotifications();
  } catch (err) { toast(err.message, "error"); }
  finally { btn.disabled = false; }
};
$("#previewEditBtn").onclick = () => { const task = state.previewTask; previewDialog.close(); if (task) openForm(task); };
$$("[data-close]").forEach(b => b.addEventListener("click", () => $("#" + b.dataset.close).close()));

/* ---------- profile (stored through the API in MySQL) ---------- */
const profileDialog = $("#profileDialog"), profileForm = $("#profileForm");
let profilePhotoData = "";
function initials(name) { return (name || "You").trim().split(/\s+/).map(x => x[0]).join("").slice(0, 2).toUpperCase() || "You"; }
function paintAvatar(name, photo = "") {
  const btn = $("#profileBtn"), preview = $("#profilePhotoPreview");
  [btn, preview].forEach(el => {
    el.textContent = "";
    if (photo) {
      const img = document.createElement("img"); img.src = photo; img.alt = "Profile photo"; el.append(img);
    } else el.textContent = initials(name);
  });
}
async function loadProfile() {
  try {
    const p = await api("/api/profile/");
    profileForm.display_name.value = p.display_name || ""; profileForm.email.value = p.email || ""; profileForm.phone.value = p.phone || "";
    profilePhotoData = p.photo_data || ""; paintAvatar(p.display_name, profilePhotoData);
  } catch (e) { toast("Could not load profile: " + e.message, "error"); }
}
$("#profileBtn").onclick = async () => { await loadProfile(); profileDialog.showModal(); };
$("#profilePhotoInput").addEventListener("change", e => {
  const file = e.target.files?.[0]; if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { toast("Choose a PNG, JPG, or WEBP image.", "error"); e.target.value = ""; return; }
  if (file.size > 2 * 1024 * 1024) { toast("Profile photos must be 2 MB or smaller.", "error"); e.target.value = ""; return; }
  const reader = new FileReader();
  reader.onload = () => { profilePhotoData = String(reader.result || ""); paintAvatar(profileForm.display_name.value, profilePhotoData); };
  reader.onerror = () => toast("Could not read that image. Try another file.", "error");
  reader.readAsDataURL(file);
});
$("#removeProfilePhoto").onclick = () => { profilePhotoData = ""; $("#profilePhotoInput").value = ""; paintAvatar(profileForm.display_name.value); };
profileForm.display_name.addEventListener("input", () => { if (!profilePhotoData) paintAvatar(profileForm.display_name.value); });
profileForm.addEventListener("submit", async e => {
  e.preventDefault(); $("#profileError").hidden = true; $$(`[data-profile-error]`).forEach(el => el.textContent = "");
  const btn = $("#saveProfileBtn"); btn.disabled = true;
  try {
    const data = await api("/api/profile/", { method: "PATCH", body: JSON.stringify({ display_name: profileForm.display_name.value.trim(), email: profileForm.email.value.trim(), phone: profileForm.phone.value.trim(), photo_data: profilePhotoData }) });
    profilePhotoData = data.photo_data || ""; paintAvatar(data.display_name, profilePhotoData);
    profileDialog.close(); toast("Profile saved.");
  } catch (err) {
    const fields = err.fields || {}; let shown = false;
    Object.entries(fields).forEach(([k, v]) => { const el = $(`[data-profile-error="${k}"]`); if (el) { el.textContent = [].concat(v).join(" "); shown = true; } });
    if (!shown) { $("#profileError").textContent = err.message; $("#profileError").hidden = false; }
  } finally { btn.disabled = false; }
});

/* ---------- persistent in-app notifications ---------- */
let knownUnread = 0;
function relativeTime(value) { const ms = Date.now() - new Date(value).getTime(); if (ms < 60000) return "Just now"; if (ms < 3600000) return `${Math.floor(ms/60000)}m ago`; if (ms < 86400000) return `${Math.floor(ms/3600000)}h ago`; return new Date(value).toLocaleDateString(); }
async function loadNotifications() {
  try {
    const data = await api("/api/notifications/");
    const count = data.unread_count || 0, badge = $("#notificationCount");
    badge.hidden = count === 0; badge.textContent = count > 99 ? "99+" : count;
    if (count > knownUnread && knownUnread !== 0) toast("You have a new task notification.");
    knownUnread = count;
    const list = $("#notificationList");
    if (!data.results.length) { list.innerHTML = '<div class="empty"><b>You are all caught up</b>No task notifications yet.</div>'; }
    else list.innerHTML = data.results.map(n => `<article class="notification-item ${n.is_read ? "read" : "unread"}" data-notification-id="${n.id}">
      <span class="notification-dot"></span><div class="notification-body"><strong>${esc(n.title)}</strong><p>${esc(n.message)}</p><small>${esc(relativeTime(n.created_at))}${n.task_title ? ` · ${esc(n.task_title)}` : ""}</small></div>
      <div class="notification-actions">${!n.is_read ? `<button class="mini-btn" data-notif-act="read" title="Mark read">Mark read</button>` : ""}<button class="mini-btn" data-notif-act="delete" title="Delete notification">×</button></div></article>`).join("");
    $("#notificationSummary").textContent = `${count} unread · ${data.results.length} recent notifications`;
  } catch (e) { $("#notificationList").innerHTML = `<div class="empty"><b>Notifications unavailable</b>${esc(e.message)}</div>`; }
}
$("#notificationsBtn").onclick = async () => { await loadNotifications(); $("#notificationsDialog").showModal(); };
$("#notificationList").addEventListener("click", async e => {
  const btn = e.target.closest("[data-notif-act]"); if (!btn) return;
  const item = btn.closest("[data-notification-id]"), id = item.dataset.notificationId;
  try { if (btn.dataset.notifAct === "read") await api(`/api/notifications/${id}/read/`, { method: "POST", body: "{}" }); else await api(`/api/notifications/${id}/`, { method: "DELETE" }); await loadNotifications(); }
  catch (err) { toast(err.message, "error"); }
});
$("#readAllBtn").onclick = async () => { try { await api("/api/notifications/read-all/", { method: "POST", body: "{}" }); await loadNotifications(); toast("All notifications marked as read."); } catch (e) { toast(e.message, "error"); } };
$("#clearReadBtn").onclick = async () => { try { await api("/api/notifications/", { method: "DELETE" }); await loadNotifications(); toast("Read notifications cleared."); } catch (e) { toast(e.message, "error"); } };

refresh();
loadProfile();
loadNotifications();
setInterval(loadNotifications, 60000);
