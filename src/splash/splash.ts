import './splash.css';

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

$('ver').textContent =
  `v${new URLSearchParams(location.hash.slice(1)).get('v') ?? ''}`;

const skip = () => api.skip();
window.addEventListener('keydown', skip, { once: true });
window.addEventListener('mousedown', skip, { once: true });

api.onStep((l) => {
  $('step').textContent = l;
});
api.onFail((m) => {
  sp.classList.add('failed');
  $('failmsg').textContent = m;
  $('fail').hidden = false;
  $('quit').addEventListener('click', () => api.quit());
});
api.onDone(() => sp.classList.add('out'));
