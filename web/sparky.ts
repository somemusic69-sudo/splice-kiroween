// Sparky: a stitched ghost that guides judges through the Kiroween demo.
// Decorative only: aria-hidden, pointer-events: none, and still under reduced motion.

export type Step = 'review' | 'diagnose' | 'test' | 'done';

// side: 'left' sits beside the target; 'inside' floats in the target's empty lower right.
const moods: Record<Step, { target: string; side: 'left' | 'inside'; say: string; mood: string }> = {
  review: { target: 'demo-steps', side: 'left', say: 'Boo… the worker keeps crashing. Review the errors!', mood: 'calm' },
  diagnose: { target: 'review', side: 'left', say: 'Eek! It retries after 2 ms. The upstream needs 2,000!', mood: 'scared' },
  test: { target: 'apply', side: 'left', say: 'Kiro says: seconds vs milliseconds. Test the fix!', mood: 'thinking' },
  done: { target: 'terminal', side: 'inside', say: 'IT’S ALIVE! The retry waits 2 seconds now.', mood: 'happy' },
};

const mouths: Record<string, string> = {
  calm: 'M40 70 Q50 64 60 70',
  scared: 'M42 73 Q50 61 58 73',
  thinking: 'M42 70 L58 70',
  happy: 'M37 65 Q50 82 63 65',
};

const svg = `<svg viewBox="0 0 100 110" aria-hidden="true">
  <path class="sparky-body" d="M15 55 Q15 10 50 10 Q85 10 85 55 L85 98 L74 90 L62 100 L50 90 L38 100 L26 90 L15 98 Z"/>
  <path class="sparky-stitch" d="M26 32 h12 M29 28 v8 M35 28 v8"/>
  <path class="sparky-bolt" d="M60 16 l7 9 l-6 1 l7 10"/>
  <circle class="sparky-eye" cx="38" cy="52" r="6"/><circle class="sparky-eye" cx="62" cy="52" r="6"/>
  <path class="sparky-mouth" d="${mouths.calm}"/>
</svg>`;

let root: HTMLElement | undefined;
let current: Step = 'review';
let frame = 0;

function place() {
  frame = 0;
  if (!root) return;
  const target = document.getElementById(moods[current].target);
  const compact = matchMedia('(max-width: 850px)').matches;
  if (!target || compact || target.getBoundingClientRect().width === 0) {
    root.style.transform = '';
    root.classList.add('docked');
    return;
  }
  root.classList.remove('docked');
  const box = target.getBoundingClientRect();
  const size = root.offsetWidth;
  const height = size * 1.1;
  let x: number;
  let y: number;
  if (moods[current].side === 'inside') {
    x = box.right - size - 30;
    y = box.top + 90;
  } else {
    x = box.left - size - 18;
    y = box.top - 10;
  }
  x = Math.max(8, Math.min(x, innerWidth - size - 8));
  y = Math.max(8, Math.min(y, innerHeight - height - 8));
  root.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(place);
}

export function sparky(step: Step) {
  if (!root) {
    root = document.createElement('div');
    root.className = 'sparky';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `<div class="sparky-pet">${svg}</div><p class="sparky-bubble"></p>`;
    document.body.append(root);
    const flash = document.createElement('div');
    flash.className = 'sparky-flash';
    flash.setAttribute('aria-hidden', 'true');
    document.body.append(flash);
    const night = document.createElement('div');
    night.className = 'night';
    night.setAttribute('aria-hidden', 'true');
    night.innerHTML = '<span class="fog"></span><span class="fog fog-slow"></span><span class="bat">🦇</span><span class="bat bat-late">🦇</span>';
    document.body.prepend(night);
    addEventListener('resize', schedule);
    addEventListener('scroll', schedule, { passive: true });
    new ResizeObserver(schedule).observe(document.body);
  }
  const changed = step !== current;
  current = step;
  const { say, mood } = moods[step];
  root.dataset.mood = mood;
  const bubble = root.querySelector<HTMLElement>('.sparky-bubble')!;
  bubble.textContent = say;
  bubble.style.animation = 'none';
  void bubble.offsetWidth;
  bubble.style.animation = '';
  root.querySelector('.sparky-mouth')!.setAttribute('d', mouths[mood]);
  schedule();
  if (changed && step === 'done' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelector('.sparky-flash')!.animate(
      [{ opacity: 0 }, { opacity: 0.7 }, { opacity: 0 }, { opacity: 0.45 }, { opacity: 0 }],
      { duration: 650, easing: 'ease-out' },
    );
  }
}
