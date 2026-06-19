// ============================================================
// CONFIG
// ============================================================
const TOTAL_FRAMES = 171;
const PX_PER_FRAME = 70;   // scroll pixels per frame — more room to breathe
const EASE         = 0.06; // lerp smoothing factor — slower = silkier
const FADE_FRAMES  = 6;    // frames over which chapter labels fade in/out

// ============================================================
// STATE
// ============================================================
const images    = [];
let loadedCount = 0;
let currentFrame = 0;
let targetFrame  = 0;

// ============================================================
// DOM REFS
// ============================================================
const canvas       = document.getElementById('animation-canvas');
const ctx          = canvas.getContext('2d');
const preloader    = document.getElementById('preloader');
const loaderPct    = document.getElementById('loader-percentage');
const scrollDriver = document.getElementById('scroll-driver');
const scrollHint   = document.getElementById('scroll-hint');
const brandTitle   = document.getElementById('brand-title');
const bwLeft       = document.getElementById('bw-left');    // "Jabalpur"
const bwRight      = document.getElementById('bw-right');   // "Tea"

// Chapter labels: tiny text shown at the bottom of the canvas during a frame range
const labels = [
  { id: 'label-origin',  start: 38,  end: 88  },
  { id: 'label-alchemy', start: 93,  end: 132 },
  { id: 'label-ritual',  start: 137, end: 171 },
];
let labelEls = [];

// Cinematic text scenes
const sceneBloom   = document.getElementById('scene-bloom');
const sceneOrigin  = document.getElementById('scene-origin');
const sceneAlchemy = document.getElementById('scene-alchemy');
const sceneRitual  = document.getElementById('scene-ritual');
const srPour       = document.getElementById('sr-pour');
const srWait       = document.getElementById('sr-wait');
const srBreathe    = document.getElementById('sr-breathe');

// ============================================================
// FRAME PATH
// ============================================================
function getFramePath(i) {
  return `frames/frame_${String(i).padStart(4, '0')}.jpg`;
}

// ============================================================
// CANVAS — RESIZE
// ============================================================
function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  redraw();
}

// ============================================================
// CANVAS — DRAW (cover fit)
// ============================================================
function redraw() {
  const idx = Math.min(TOTAL_FRAMES - 1, Math.max(0, Math.round(currentFrame)));
  const img = images[idx];
  if (!img || !img.complete || img.naturalWidth === 0) return;

  const cW = canvas.width,  cH = canvas.height;
  const iW = img.naturalWidth, iH = img.naturalHeight;
  const iRatio = iW / iH, cRatio = cW / cH;

  let dW, dH, dX, dY;
  if (cRatio > iRatio) { dW = cW; dH = cW / iRatio; }
  else                  { dH = cH; dW = cH * iRatio; }
  dX = (cW - dW) / 2;
  dY = (cH - dH) / 2;

  ctx.clearRect(0, 0, cW, cH);
  ctx.drawImage(img, dX, dY, dW, dH);
}

// ============================================================
// LABEL + BRAND VISIBILITY — scroll-driven opacity & transform
// ============================================================

// Smooth ease-in-out curve  (t ∈ [0,1])
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// Expo ease-out — snappy, elegant entry (overshoots slightly)
function easeOutExpo(t) {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

// Ease-in cubic — dignified, unhurried exit
function easeInCubic(t) {
  return t * t * t;
}

// Smooth ease-in for opacity-only fade
function easeInQuad(t) {
  return t * t;
}

function updateLabels(frame) {
  // ---- Brand title: open / close animation ----
  // Phases:
  //  frames  0 –  8  : OPEN  (words slide to centre, t 0→1)
  //  frames  8 – 22  : HOLD  (fully together)
  //  frames 22 – 34  : CLOSE (words slide apart, t 1→0)
  //  frames 34+       : invisible
  if (brandTitle) {
    const OPEN_END   = 7;
    const HOLD_END   = 12;
    const CLOSE_END  = 18;
    const MAX_OFFSET = 130; // wider spread for dramatic entrance

    let t = 0;

    if (frame <= OPEN_END) {
      t = easeOutExpo(frame / OPEN_END);
    } else if (frame <= HOLD_END) {
      t = 1;
    } else if (frame <= CLOSE_END) {
      // Fade out with ease-in (words drift apart, accelerating)
      t = easeInOut(1 - (frame - HOLD_END) / (CLOSE_END - HOLD_END));
    } else {
      t = 0;
    }

    const offset  = (1 - t) * MAX_OFFSET;
    const opacity = frame < CLOSE_END ? t : 0;
    // Subtle scale: starts slightly small, snaps to full size on entry
    const scale   = 0.92 + 0.08 * t;
    const blur    = (1 - t) * 8;

    brandTitle.style.opacity = opacity;
    brandTitle.style.filter  = `blur(${blur.toFixed(2)}px)`;
    if (bwLeft)  {
      bwLeft.style.transform  = `translateX(-${offset}px) scale(${scale})`;
    }
    if (bwRight) {
      bwRight.style.transform = `translateX(${offset}px) scale(${scale})`;
    }
  }

  // Scroll hint fades out after first few frames
  if (scrollHint) {
    scrollHint.style.opacity = Math.max(0, 1 - frame / 8);
  }

  // Chapter labels
  labelEls.forEach(({ el, start, end }) => {
    let opacity = 0;
    if (frame >= start && frame <= end) {
      const fadeIn  = Math.min(1, (frame - start) / FADE_FRAMES);
      const fadeOut = Math.min(1, (end - frame)   / FADE_FRAMES);
      opacity = Math.min(fadeIn, fadeOut);
    }
    el.style.opacity = opacity;
  });
}

// ============================================================
// SCENE TEXT ANIMATION — frame-synced cinematic overlays
// ============================================================

// Smoother cubic ease — gentler entry & exit than quadratic
function easeCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Drives opacity + slide + blur for a scene container.
 * Entry:  expo-out ease — text snaps in with momentum
 * Hold:   fully visible, class 'scene-active' triggers CSS sub-animations
 * Exit:   cubic-in ease — text drifts away with quiet dignity
 *
 * isLeft: slide direction for horizontal entry
 */
function applyScene(el, frame, start, holdStart, holdEnd, end, isLeft) {
  if (!el) return;

  let tIn  = 0; // 0→1 during fade-in
  let tOut = 0; // 0→1 during fade-out
  let phase = 'hidden'; // 'in' | 'hold' | 'out' | 'hidden'

  if (frame <= start || frame >= end) {
    phase = 'hidden';
  } else if (frame < holdStart) {
    phase = 'in';
    tIn  = easeOutExpo((frame - start) / (holdStart - start));
  } else if (frame <= holdEnd) {
    phase = 'hold';
    tIn  = 1;
  } else {
    phase = 'out';
    tOut = easeInCubic((frame - holdEnd) / (end - holdEnd));
    tIn  = 1;
  }

  const opacity = phase === 'hidden' ? 0
    : phase === 'out' ? Math.max(0, 1 - tOut)
    : tIn;

  // Horizontal slide: enters from side, exits upward (vertical parallax)
  const slideH  = phase === 'hidden' ? 40
    : phase === 'out'    ? 0
    : (1 - tIn) * 40;

  // Vertical drift on exit: text floats gently upward as it fades
  const driftV  = phase === 'out' ? tOut * -18 : 0;

  // Blur: heavy when starting to appear, clears as it arrives; gentle blur on exit
  const blurIn  = phase === 'in'  ? (1 - tIn) * 10 : 0;
  const blurOut = phase === 'out' ? tOut * 4 : 0;
  const blur    = Math.max(blurIn, blurOut);

  const tx = isLeft ? `-${slideH}px` : `${slideH}px`;

  el.style.opacity   = opacity;
  el.style.filter    = `blur(${blur.toFixed(2)}px)`;
  el.style.transform = `translateY(calc(-50% + ${driftV}px)) translateX(${tx})`;

  // Toggle CSS class for eyebrow underline animation
  if (phase === 'hold' || phase === 'out') {
    el.classList.add('scene-active');
  } else {
    el.classList.remove('scene-active');
  }
}

/**
 * Staggers the three ritual words in and out with a refined cascade.
 * Each word rises from below with a scale snap and blur clear.
 */
function updateRitualWords(frame) {
  const words = [
    { el: srPour,    s: 137, hs: 140, he: 145, e: 148 },
    { el: srWait,    s: 149, hs: 152, he: 157, e: 160 },
    { el: srBreathe, s: 161, hs: 164, he: 168, e: 171 },
  ];

  words.forEach(({ el, s, hs, he, e }) => {
    if (!el) return;
    let tIn = 0, tOut = 0, phase = 'hidden';

    if (frame > s && frame < e) {
      if (frame < hs) {
        phase = 'in';
        tIn = easeOutExpo((frame - s) / (hs - s));
      } else if (frame <= he) {
        phase = 'hold';
        tIn = 1;
      } else {
        phase = 'out';
        tIn  = 1;
        tOut = easeInCubic((frame - he) / (e - he));
      }
    }

    const opacity = phase === 'hidden' ? 0
      : phase === 'out'  ? Math.max(0, 1 - tOut * 1.5)
      : tIn;

    // Rise from below on entry; gentle upward drift on exit
    const riseIn  = phase === 'in'  ? (1 - tIn)  * 28 : 0;
    const driftUp = phase === 'out' ? tOut * -14        : 0;
    const translateY = riseIn + driftUp;

    // Scale: slightly small on entry, snaps to 1 at hold
    const scale = phase === 'in'  ? (0.94 + 0.06 * tIn)
                : phase === 'out' ? (1 - tOut * 0.03)
                : 1;

    // Blur clears as word rises into place, gentle blur on exit
    const blur = phase === 'in'  ? (1 - tIn)  * 8
               : phase === 'out' ? tOut * 3
               : 0;

    el.style.opacity   = opacity;
    el.style.filter    = `blur(${blur.toFixed(2)}px)`;
    el.style.transform = `translateY(${translateY.toFixed(2)}px) scale(${scale.toFixed(4)})`;
  });
}

function updateScenes(frame) {
  // Scene 2 — Bloom: bag opens — starts AFTER brand title is fully gone (frame 18)
  applyScene(sceneBloom,   frame, 20,  30,  46,  56,  true);

  // Scene 3 — Origin: ingredients fall, frames 58–88
  applyScene(sceneOrigin,  frame, 58,  66,  80,  90,  false);

  // Scene 4 — Alchemy: cup fills, frames 93–132
  applyScene(sceneAlchemy, frame, 91, 102, 122, 133,  true);

  // Scene 5 — Ritual: hands hold cup, frames 137–171
  applyScene(sceneRitual,  frame, 135, 142, 164, 172, true);
  updateRitualWords(frame);
}

// ============================================================
// ANIMATION LOOP
// ============================================================
function tick() {
  requestAnimationFrame(tick);

  const scrollTop = window.scrollY;
  targetFrame = Math.min(TOTAL_FRAMES - 1, Math.max(0, scrollTop / PX_PER_FRAME));
  currentFrame += (targetFrame - currentFrame) * EASE;

  redraw();
  updateLabels(currentFrame);
  updateScenes(currentFrame);
}

// ============================================================
// PRELOAD
// ============================================================
function preloadFrames() {
  for (let i = 1; i <= TOTAL_FRAMES; i++) {
    const img = new Image();
    img.onload = () => {
      loadedCount++;
      loaderPct.textContent = `${Math.round((loadedCount / TOTAL_FRAMES) * 100)}%`;
      if (loadedCount === TOTAL_FRAMES) onAllLoaded();
    };
    img.onerror = () => {
      loadedCount++;
      if (loadedCount === TOTAL_FRAMES) onAllLoaded();
    };
    img.src = getFramePath(i);
    images.push(img);
  }
}

// ============================================================
// ON ALL LOADED
// ============================================================
function onAllLoaded() {
  setTimeout(() => {
    preloader.classList.add('fade-out');
    document.body.style.overflow = '';

    // Set tall scroll driver height
    scrollDriver.style.height = `calc(${(TOTAL_FRAMES - 1) * PX_PER_FRAME}px + 100vh)`;

    redraw();
    updateLabels(0);
    updateScenes(0);
    tick();
  }, 500);
}

// ============================================================
// INIT
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  document.body.style.overflow = 'hidden';

  labelEls = labels.map(l => ({
    el:    document.getElementById(l.id),
    start: l.start,
    end:   l.end,
  }));

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  preloadFrames();

  // ---- Product card scroll-reveal (IntersectionObserver) ----
  const cards = document.querySelectorAll('.product-card');
  if (cards.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target); // fire once only
        }
      });
    }, { threshold: 0.15 });

    cards.forEach(card => observer.observe(card));
  }
});
