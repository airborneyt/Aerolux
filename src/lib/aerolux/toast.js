// src/lib/aerolux/toast.js
// lightweight toast system for Aerolux

export function showToast(msg, type = 'info', duration = 3000) {
  const container = document.getElementById('al-toasts');
  const el = document.createElement('div');
  el.className = `al-toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, duration);
}