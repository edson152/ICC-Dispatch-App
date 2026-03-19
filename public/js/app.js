// ICC Dispatch System v7 — Client JS

// ── Live clock ──────────────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById('topbarClock');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleDateString('en-ZA',{weekday:'short',day:'2-digit',month:'short',year:'numeric'})
    + ' · ' + now.toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
updateClock();
setInterval(updateClock, 1000);

// ── Dark mode ────────────────────────────────────────────────────────
function initDarkMode() {
  const saved = localStorage.getItem('icc-theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  updateDarkIcon(saved);
}
function toggleDark() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('icc-theme', next);
  updateDarkIcon(next);
}
function updateDarkIcon(theme) {
  const btn = document.getElementById('darkToggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
}
initDarkMode();

// ── Responsive sidebar ───────────────────────────────────────────────
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.sidebar-overlay');
  if (!sidebar) return;
  sidebar.classList.toggle('open');
  if (overlay) overlay.classList.toggle('active');
}
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('sidebar-overlay')) toggleSidebar();
});

// ── Modal helpers ────────────────────────────────────────────────────
function openModal(id) { const el = document.getElementById(id); if (el) el.classList.add('active'); }
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('active'); }
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('active');
});

// ── Toast notifications ──────────────────────────────────────────────
function showToast(message, type = 'success', duration = 5000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : '⚠️';
  toast.innerHTML = `<span style="font-size:18px;">${icon}</span><span style="flex:1;">${message}</span><button class="toast-close" onclick="this.parentElement.remove()">✕</button>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toast-out 0.3s forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Convert flash alerts to toasts
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.alert').forEach(alert => {
    const type = alert.classList.contains('alert-success') ? 'success' : 'error';
    const text = alert.textContent.trim().replace(/^[✅⚠]\s*/, '');
    showToast(text, type);
    alert.remove();
  });
});

// ── Confirm dialog ───────────────────────────────────────────────────
function iccConfirm(message, onConfirm, title = 'Are you sure?', icon = '⚠️') {
  let overlay = document.getElementById('confirmOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.id = 'confirmOverlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-icon" id="confirmIcon"></div>
        <div class="confirm-title" id="confirmTitle"></div>
        <div class="confirm-msg" id="confirmMsg"></div>
        <div class="confirm-actions">
          <button class="btn btn-outline" onclick="document.getElementById('confirmOverlay').classList.remove('active')">Cancel</button>
          <button class="btn btn-danger" id="confirmOk">Confirm</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }
  document.getElementById('confirmIcon').textContent = icon;
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMsg').textContent = message;
  const okBtn = document.getElementById('confirmOk');
  okBtn.onclick = () => { overlay.classList.remove('active'); onConfirm(); };
  overlay.classList.add('active');
}

// ── Button loading state ─────────────────────────────────────────────
document.addEventListener('submit', (e) => {
  const form = e.target;
  const btn = form.querySelector('button[type="submit"]');
  if (btn && !btn.dataset.noload) {
    btn.classList.add('loading');
    btn.disabled = true;
    // Re-enable after 10s in case of error
    setTimeout(() => { btn.classList.remove('loading'); btn.disabled = false; }, 10000);
  }
});

// ── Auto-dismiss alerts ──────────────────────────────────────────────
document.querySelectorAll('.alert').forEach(a => {
  setTimeout(() => { a.style.opacity='0'; a.style.transition='opacity 0.5s'; setTimeout(()=>a.remove(),500); }, 5000);
});

// ── License plate uppercase ──────────────────────────────────────────
document.querySelectorAll('input[name="license_plate"]').forEach(el => {
  el.addEventListener('input', () => { el.value = el.value.toUpperCase(); });
});

// ── Week stats on dashboard ──────────────────────────────────────────
async function loadWeekStats() {
  const container = document.getElementById('weekStats');
  if (!container) return;
  try {
    const r = await fetch('/admin/api/weekly-stats');
    const d = await r.json();
    const ordersChange = d.last_week > 0 ? Math.round((d.this_week - d.last_week) / d.last_week * 100) : 0;
    const valueChange = d.last_week_value > 0 ? Math.round((d.this_week_value - d.last_week_value) / d.last_week_value * 100) : 0;
    container.innerHTML = `
      <div class="week-card">
        <div style="font-size:11px;font-weight:700;color:var(--dark-grey);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">This Week vs Last Week</div>
        <div style="display:flex;gap:20px;flex-wrap:wrap;">
          <div>
            <div style="font-size:22px;font-weight:800;color:var(--deep-blue);">${d.this_week}</div>
            <div style="font-size:11px;color:var(--dark-grey);">orders this week</div>
            <div class="${ordersChange>=0?'week-change-up':'week-change-down'}">${ordersChange>=0?'↑':'↓'} ${Math.abs(ordersChange)}% vs last week</div>
          </div>
          <div style="border-left:1px solid var(--mid-grey);padding-left:20px;">
            <div style="font-size:22px;font-weight:800;color:var(--deep-blue);">R ${parseFloat(d.this_week_value).toLocaleString('en-ZA',{minimumFractionDigits:0})}</div>
            <div style="font-size:11px;color:var(--dark-grey);">value this week</div>
            <div class="${valueChange>=0?'week-change-up':'week-change-down'}">${valueChange>=0?'↑':'↓'} ${Math.abs(valueChange)}% vs last week</div>
          </div>
        </div>
      </div>`;
  } catch(e) {}
}
loadWeekStats();
