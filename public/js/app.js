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

// ── File preview for media uploads ──────────────────────────────────────────
function previewFiles(input, previewContainerId) {
  const container = document.getElementById(previewContainerId);
  if (!container) return;
  container.innerHTML = '';
  const files = Array.from(input.files);
  if (!files.length) return;

  files.forEach(file => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;width:100px;height:100px;border-radius:8px;overflow:hidden;border:2px solid #e2e8f0;background:#f8fafc;flex-shrink:0;';

    if (file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      const reader = new FileReader();
      reader.onload = e => { img.src = e.target.result; };
      reader.readAsDataURL(file);
      wrap.appendChild(img);
    } else if (file.type.startsWith('video/')) {
      const vid = document.createElement('video');
      vid.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      vid.muted = true;
      const src = document.createElement('source');
      src.src = URL.createObjectURL(file);
      src.type = file.type;
      vid.appendChild(src);
      wrap.appendChild(vid);
    } else {
      const icon = document.createElement('div');
      icon.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:32px;';
      icon.textContent = '📄';
      wrap.appendChild(icon);
    }

    const label = document.createElement('div');
    label.style.cssText = 'position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.6);color:white;font-size:9px;padding:2px 4px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;';
    label.textContent = file.name;
    wrap.appendChild(label);
    container.appendChild(wrap);
  });
}

// Auto-attach preview to goods_media and receipt_media inputs
document.addEventListener('DOMContentLoaded', () => {
  const goodsInput = document.querySelector('input[name="goods_media"]');
  if (goodsInput) {
    // Create preview container if not existing
    let preview = document.getElementById('goodsPreview');
    if (!preview) {
      preview = document.createElement('div');
      preview.id = 'goodsPreview';
      preview.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;';
      goodsInput.after(preview);
    }
    goodsInput.addEventListener('change', () => previewFiles(goodsInput, 'goodsPreview'));
  }

  const receiptInput = document.querySelector('input[name="receipt_media"]');
  if (receiptInput) {
    let preview = document.getElementById('receiptPreview');
    if (!preview) {
      preview = document.createElement('div');
      preview.id = 'receiptPreview';
      preview.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;';
      receiptInput.after(preview);
    }
    receiptInput.addEventListener('change', () => previewFiles(receiptInput, 'receiptPreview'));
  }
});
