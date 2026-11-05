const indicator = document.querySelector('[data-work-mode]');
let edited = false;
let timer;
let lastCheck = 0;
function schedule(ms) { clearTimeout(timer); timer = setTimeout(checkClock, ms + 500); }
document.addEventListener('input', () => { edited = true; });
async function checkClock() {
  if (Date.now() - lastCheck < 1500) return;
  lastCheck = Date.now();
  try {
    const response = await fetch('/work/status');
    if (!response.ok) return;
    const current = await response.json();
    if (current.date === indicator.dataset.date && current.mode === indicator.dataset.workMode) return schedule(current.untilChange);
    if (!edited) {
      location.reload();
    } else {
      indicator.textContent = 'Vaqt oynasi o‘zgardi. Jadvalni yangilash uchun sahifani qayta oching.';
    }
  } catch {
    schedule(60000);
  }
}
schedule(Number(indicator.dataset.untilChange));
window.addEventListener('focus', checkClock);


