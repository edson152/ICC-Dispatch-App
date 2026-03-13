// ICC Dispatch System — Client JS

// Live clock in topbar
function updateClock() {
  const el = document.getElementById('topbarClock');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleDateString('en-ZA', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
  }) + ' · ' + now.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
updateClock();
setInterval(updateClock, 1000);

// Modal helpers
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('active');
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
  }
});

// Auto-dismiss alerts after 5 seconds
document.querySelectorAll('.alert').forEach(a => {
  setTimeout(() => {
    a.style.transition = 'opacity 0.5s';
    a.style.opacity = '0';
    setTimeout(() => a.remove(), 500);
  }, 5000);
});

// PIN input: uppercase license plate
document.querySelectorAll('input[name="license_plate"]').forEach(el => {
  el.addEventListener('input', () => { el.value = el.value.toUpperCase(); });
});
