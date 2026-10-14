import './splash.css';
import { nebulaUrl } from './art';

type SplashApi = {
  onStep(fn: (l: string) => void): void;
  onFail(fn: (m: string) => void): void;
  onDone(fn: () => void): void;
  skip(): void;
  quit(): void;
};
const api = (window as unknown as { splash: SplashApi }).splash;
const $ = (id: string) => document.getElementById(id)!;
const sp = $('sp');
if (nebulaUrl) $('neb').style.backgroundImage = `url("${nebulaUrl}")`;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

$('ver').textContent =
  `v${new URLSearchParams(location.hash.slice(1)).get('v') ?? ''}`;

function toFinal() {
  sp.classList.remove('run');
  sp.classList.add('final');
  if (!reduced) sp.classList.add('breathe');
}

if (reduced) toFinal();
else {
  sp.classList.add('run');
  const cnt = $('cnt');
  const t0 = performance.now();
  const tick = (t: number) => {
    const p = Math.min(1, Math.max(0, (t - t0 - 300) / 1150));
    cnt.textContent = String(Math.round(1440 * (1 - (1 - p) ** 3))).padStart(
      4,
      '0',
    );
    if (p < 1 && sp.classList.contains('run')) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setTimeout(toFinal, 2400);
}

const skip = () => {
  toFinal();
  api.skip();
};
window.addEventListener('keydown', skip, { once: true });
window.addEventListener('mousedown', skip, { once: true });

api.onStep((l) => {
  $('step').textContent = l;
});
api.onFail((m) => {
  toFinal();
  sp.classList.remove('breathe');
  $('failmsg').textContent = m;
  $('fail').hidden = false;
  $('quit').addEventListener('click', () => api.quit());
});
api.onDone(() => sp.classList.add('out'));
