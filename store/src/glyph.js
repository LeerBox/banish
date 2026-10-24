// Fills every <span class="g"> with the Banish mark (data-s="ok" → check mark).
const BAN = '<circle cx="12" cy="12" r="7.6"/><path d="M6.6 6.6l10.8 10.8"/>';
const CHECK = '<path d="M6 12.4l4 4L18.2 8"/>';
document.querySelectorAll('.g').forEach((el) => {
  const s = el.classList.contains('ok') ? CHECK : BAN;
  el.innerHTML = `<svg viewBox="0 0 24 24"><g class="l c">${s}</g><g class="l r">${s}</g><g class="l w">${s}</g></svg>`;
});
