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
// alpha: false drastically improves GPU rendering performance
const ctx          = canvas.getContext('2d', { alpha: false });
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
  const dpr = window.devicePixelRatio || 1;
  // Multiply internal resolution by device ratio to completely eliminate blur
  canvas.width  = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  
  // Maintain exact CSS layout footprint
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  
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

  // High quality draw. No clearRect needed because image fully covers opaque canvas.
  ctx.globalAlpha = 1;
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
let lastActiveFrame = -1;

function tick() {
  requestAnimationFrame(tick);

  const scrollTop = window.scrollY;
  targetFrame = Math.min(TOTAL_FRAMES - 1, Math.max(0, scrollTop / PX_PER_FRAME));
  
  const diff = targetFrame - currentFrame;
  
  if (Math.abs(diff) > 0.001) {
    currentFrame += diff * EASE;
    redraw();
    updateLabels(currentFrame);
    updateScenes(currentFrame);
    lastActiveFrame = currentFrame;
  } else if (currentFrame !== targetFrame) {
    currentFrame = targetFrame;
    redraw();
    updateLabels(currentFrame);
    updateScenes(currentFrame);
  }
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
function initExperience() {
  document.body.style.overflow = 'hidden';

  labelEls = labels.map(l => ({
    el:    document.getElementById(l.id),
    start: l.start,
    end:   l.end,
  }));

  resizeCanvas();
  resizeHeroCanvas();
  window.addEventListener('resize', () => {
    resizeCanvas();
    resizeHeroCanvas();
  });
  preloadFrames();
  preloadHeroFrames();

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

  // ---- Collection header gold-underline reveal ----
  const collectionHeader = document.querySelector('.collection-header');
  if (collectionHeader) {
    const headerObserverColl = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          headerObserverColl.unobserve(entry.target);
        }
      });
    }, { threshold: 0.3 });
    headerObserverColl.observe(collectionHeader);
  }

  // ---- Header Scroll-Spy Theme Switcher (IntersectionObserver) ----
  const header = document.querySelector('header');
  const themedSections = document.querySelectorAll('[data-header-theme]');
  if (header) {
    const updateHeaderScrollState = () => {
      if (window.scrollY > 40) {
        header.classList.add('header--scrolled');
      } else {
        header.classList.remove('header--scrolled');
      }
    };
    window.addEventListener('scroll', updateHeaderScrollState);
    updateHeaderScrollState();

    if (themedSections.length) {
      const headerObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const theme = entry.target.getAttribute('data-header-theme');
            if (theme === 'dark') {
              header.classList.add('header--dark-theme');
            } else {
              header.classList.remove('header--dark-theme');
            }
          }
        });
      }, {
        rootMargin: '0px 0px -90% 0px',
        threshold: 0
      });

      themedSections.forEach(section => headerObserver.observe(section));
    }
  }

  // ---- Custom Cinematic Smooth Scroll for Anchor Links ----
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;
      const targetElement = document.querySelector(targetId);
      if (targetElement) {
        e.preventDefault();
        const startY = window.scrollY;
        // account for header height if needed, but it's transparent so it's fine
        const targetY = targetElement.getBoundingClientRect().top + window.scrollY;
        const distance = targetY - startY;
        const duration = 1800; // 1.8 seconds cinematic journey
        let startTime = null;

        function scrollAnim(currentTime) {
          if (startTime === null) startTime = currentTime;
          const timeElapsed = currentTime - startTime;
          const progress = Math.min(timeElapsed / duration, 1);
          
          // Easing: easeInOutQuart for an ultra-smooth, buttery glide
          const ease = progress < 0.5 
            ? 8 * Math.pow(progress, 4)
            : 1 - Math.pow(-2 * progress + 2, 4) / 2;

          window.scrollTo(0, startY + (distance * ease));

          if (timeElapsed < duration) {
            requestAnimationFrame(scrollAnim);
          }
        }
        requestAnimationFrame(scrollAnim);
      }
    });
  });
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initExperience);
} else {
  initExperience();
}



/* --- RESERVE PAGE JS --- */

    // ── STATE ──
    let quantities = {
      DAWN: 0,
      DUSK: 1,
      NIGHT: 0
    };
    let addonTotal = 0;

    // ── PARTICLES ──
    const particleContainer = document.getElementById('particles');
    for (let i = 0; i < 18; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.left = Math.random() * 100 + '%';
      p.style.bottom = Math.random() * 20 + '%';
      p.style.setProperty('--dur', (6 + Math.random() * 8) + 's');
      p.style.setProperty('--delay', (Math.random() * 8) + 's');
      particleContainer.appendChild(p);
    }

    // ── INITIALISE BLEND FROM URL ──
    function initReserveFromUrl() {
      const urlParams = new URLSearchParams(window.location.search);
      const blendParam = urlParams.get('blend');
      if (blendParam) {
        const upperBlend = blendParam.toUpperCase();
        if (quantities.hasOwnProperty(upperBlend)) {
          selectBlend(upperBlend);
        }
      }
    }

    // ── BLEND SELECT ──
    function selectBlend(blendName) {
      for (const b in quantities) {
        quantities[b] = (b === blendName) ? 1 : 0;
      }
      updateQtyDisplays();
      updatePrice();
    }

    // ── UPDATE QUANTITY DISPLAYS ──
    function updateQtyDisplays() {
      for (const b in quantities) {
        const qtyEl = document.getElementById(`qty-${b.toLowerCase()}`);
        const itemEl = document.getElementById(`item-${b.toLowerCase()}`);
        if (qtyEl) {
          qtyEl.textContent = quantities[b];
        }
        if (itemEl) {
          if (quantities[b] > 0) {
            itemEl.classList.add('active');
          } else {
            itemEl.classList.remove('active');
          }
        }
      }
    }

    // ── CHANGE BLEND QUANTITY ──
    function changeBlendQty(blendName, delta) {
      if (quantities.hasOwnProperty(blendName)) {
        quantities[blendName] = Math.max(0, Math.min(10, quantities[blendName] + delta));
        
        // Add micro-animation bounce effect on changes
        const qtyEl = document.getElementById(`qty-${blendName.toLowerCase()}`);
        if (qtyEl) {
          qtyEl.style.transform = 'scale(1.3)';
          setTimeout(() => {
            qtyEl.style.transform = 'scale(1)';
          }, 150);
        }

        updateQtyDisplays();
        updatePrice();
      }
    }

    // ── ADD-ONS ──
    function toggleAddon(item) {
      item.classList.toggle('checked');
      addonTotal = 0;
      document.querySelectorAll('.addon-item.checked').forEach(a => {
        addonTotal += parseInt(a.dataset.price);
      });
      updatePrice();
    }

    // ── PRICE ──
    function updatePrice() {
      let total = 0;
      let totalTins = 0;
      let breakdownParts = [];
      let selectedParts = [];

      const blendPrices = { DAWN: 1099, DUSK: 999, NIGHT: 1199 };

      for (const blend in quantities) {
        const qty = quantities[blend];
        if (qty > 0) {
          const price = blendPrices[blend];
          total += qty * price;
          totalTins += qty;
          breakdownParts.push(`${qty} × ${blend} · ₹${qty * price}`);
          selectedParts.push(`${qty} × ${blend}`);
        }
      }

      const totalWithAddons = total + (totalTins > 0 ? addonTotal : 0);
      document.getElementById('total-price').textContent = totalWithAddons.toLocaleString('en-IN');
      
      const addonsText = (addonTotal > 0 && totalTins > 0) ? ` + ₹${addonTotal} add-ons` : '';
      
      document.getElementById('price-breakdown').textContent = 
        totalTins > 0 
          ? `${breakdownParts.join(' · ')}${addonsText}`
          : 'No tins selected';

      // Update selected blend display banner in Step 01
      const blendDisplay = document.getElementById('selected-blend-display');
      if (blendDisplay) {
        blendDisplay.textContent = selectedParts.join(', ') || 'None';
      }
    }

    // ── PERSONALISE TOGGLE ──
    function togglePersonalise() {
      const fields = document.getElementById('personalise-fields');
      const checked = document.getElementById('personalise-toggle').checked;
      fields.classList.toggle('open', checked);
    }

    // ── RESERVATION SUBMIT ──
    function submitReservation() {
      const name    = document.getElementById('f-name').value.trim();
      const phone   = document.getElementById('f-phone').value.trim();
      const email   = document.getElementById('f-email').value.trim();
      const city    = document.getElementById('f-city').value.trim();
      const address = document.getElementById('f-address').value.trim();
      const notes   = document.getElementById('f-notes').value.trim();
      const tinName = document.getElementById('tin-name').value.trim();
      const tinMsg  = document.getElementById('tin-message').value.trim();

      if (!name || !phone) {
        // Subtle highlight required fields
        ['f-name','f-phone'].forEach(id => {
          const el = document.getElementById(id);
          if (!el.value.trim()) {
            el.style.borderColor = 'rgba(201,100,76,0.7)';
            setTimeout(() => el.style.borderColor = '', 2000);
          }
        });
        return;
      }

      // Build WhatsApp message
      const checkedAddons = [...document.querySelectorAll('.addon-item.checked')]
        .map(a => a.querySelector('.addon-name').textContent).join(', ') || 'None';

      const personalise = document.getElementById('personalise-toggle').checked
        ? `\nPersonalisation: ${tinName || '—'} / "${tinMsg || '—'}"`
        : '';

      let total = 0;
      let totalTins = 0;
      let blendsList = [];
      for (const blend in quantities) {
        const qty = quantities[blend];
        if (qty > 0) {
          total += qty * 890;
          totalTins += qty;
          blendsList.push(`${blend} (${qty} tin${qty > 1 ? 's' : ''})`);
        }
      }

      if (totalTins === 0) {
        alert("Please select at least one tin to reserve.");
        return;
      }

      const finalTotal = total + addonTotal;

      // Generate reservation ID
      const refId = 'JBP-' + Date.now().toString().slice(-4);

      const payload = {
        refId,
        name,
        phone,
        email,
        city,
        address,
        blends: blendsList,
        addons: checkedAddons,
        personalise: personalise ? { tinName, tinMsg } : null,
        total: finalTotal,
        notes,
        createdAt: new Date().toISOString()
      };

      // Submit to backend
      const reserveBtn = document.getElementById('reserve-btn');
      if (reserveBtn) reserveBtn.classList.add('is-loading');

      fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(res => res.json())
      .then(data => {
        if (reserveBtn) reserveBtn.classList.remove('is-loading');
        if (data.success) {
          document.getElementById('success-ref').textContent = `Reservation #${refId}`;

          // Show success overlay
          const overlay = document.getElementById('success-overlay');
          overlay.classList.add('show');
          setTimeout(() => {
            overlay.querySelector('.seal').classList.add('animate');
            overlay.querySelector('.success-title').classList.add('animate');
            overlay.querySelector('.success-sub').classList.add('animate');
            overlay.querySelector('.success-ref').classList.add('animate');
            overlay.querySelector('.success-back').classList.add('animate');
          }, 100);
        } else {
          alert("Failed to submit reservation. Please try again.");
        }
      })
      .catch(err => {
        if (reserveBtn) reserveBtn.classList.remove('is-loading');
        console.error("Error submitting reservation:", err);
        alert("An error occurred while submitting. Please try again later.");
      });
    }

    // ── SCROLL REVEAL ──
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

    // ── ENTRANCE REVEAL (from pour transition) ──
    (function() {
      const params = new URLSearchParams(window.location.search);
      if (params.get('transition') !== 'pour') return;

      // Clean URL
      params.delete('transition');
      const cleanSearch = params.toString();
      const cleanUrl = window.location.pathname + (cleanSearch ? '?' + cleanSearch : '');
      window.history.replaceState({}, '', cleanUrl);

      // Mark body for CSS entrance
      document.body.classList.add('pour-entrance');

      // Create the amber overlay
      const overlay = document.createElement('div');
      overlay.id = 'entrance-overlay';
      const eCanvas = document.createElement('canvas');
      overlay.appendChild(eCanvas);
      document.body.appendChild(overlay);

      // Create shimmer element
      const shimmer = document.createElement('div');
      shimmer.className = 'entrance-shimmer';
      document.body.appendChild(shimmer);

      // Size canvas
      const dpr = window.devicePixelRatio || 1;
      eCanvas.width = window.innerWidth * dpr;
      eCanvas.height = window.innerHeight * dpr;
      const ectx = eCanvas.getContext('2d');
      ectx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Draw initial amber fill
      const w = window.innerWidth;
      const h = window.innerHeight;
      const amberGrad = ectx.createLinearGradient(0, 0, 0, h);
      amberGrad.addColorStop(0, 'rgba(201, 168, 76, 0.35)');
      amberGrad.addColorStop(0.3, 'rgba(139, 105, 20, 0.45)');
      amberGrad.addColorStop(0.7, 'rgba(58, 31, 4, 0.6)');
      amberGrad.addColorStop(1, 'rgba(12, 13, 12, 0.95)');
      ectx.fillStyle = amberGrad;
      ectx.fillRect(0, 0, w, h);

      // Show overlay immediately
      overlay.classList.add('active');

      // Dissolve after a brief moment
      requestAnimationFrame(() => {
        setTimeout(() => {
          overlay.classList.add('dissolving');
          shimmer.classList.add('sweep');

          // Reveal content with cascade
          setTimeout(() => {
            document.body.classList.add('revealed');
          }, 150);

          // Cleanup
          setTimeout(() => {
            overlay.remove();
            shimmer.remove();
          }, 1500);
        }, 100);
      });
    })();
  
initReserveFromUrl();

function selectBlendFromLink(blend) {
  selectBlend(blend, 890); // Hardcoding 890 as all blends are 890
}

// ============================================================
// BACKGROUND COFFEE BEANS CANVAS ANIMATION (RESERVE HERO)
// ============================================================

// We use every 2nd frame (1, 3, 5 ... 95) = 48 frames total.
// This cuts download from ~72MB to ~36MB while keeping it silky smooth.
const HERO_SOURCE_FRAMES = 95;
const HERO_STEP = 2; // use every 2nd frame
const HERO_FRAME_INDICES = (() => {
  const arr = [];
  for (let i = 1; i <= HERO_SOURCE_FRAMES; i += HERO_STEP) arr.push(i);
  return arr;
})();
const HERO_TOTAL_FRAMES = HERO_FRAME_INDICES.length; // 48

const heroImages = new Array(HERO_TOTAL_FRAMES).fill(null);
let heroCurrentFrame = 0;
let heroLoadedCount = 0;
const HERO_START_THRESHOLD = 12; // start playing after 12 frames load
let isHeroAnimationRunning = false;
let heroCanvasCached = null;
let heroCtxCached = null;
let lastHeroTickTime = 0;

const HERO_FPS = 15; // 15fps perfectly matches halved frame count
const HERO_FRAME_DURATION = 1000 / HERO_FPS;

function getHeroFramePath(frameNum) {
  return `Coffee_beans_falling_in_frames/frame_${String(frameNum).padStart(3, '0')}.png`;
}

function preloadHeroFrames() {
  heroCanvasCached = document.getElementById('hero-animation-canvas');
  if (heroCanvasCached) {
    heroCtxCached = heroCanvasCached.getContext('2d');
  }

  HERO_FRAME_INDICES.forEach((frameNum, index) => {
    const img = new Image();
    img.onload = () => {
      heroImages[index] = img;
      heroLoadedCount++;
      // Start playing as soon as first batch is ready — don't wait for all!
      if (heroLoadedCount === HERO_START_THRESHOLD) {
        startHeroAnimation();
      }
    };
    img.onerror = () => {
      heroLoadedCount++;
      if (heroLoadedCount === HERO_START_THRESHOLD && !isHeroAnimationRunning) {
        startHeroAnimation();
      }
    };
    img.src = getHeroFramePath(frameNum);
  });
}

function resizeHeroCanvas() {
  const heroSection = document.getElementById('reserve-hero');
  if (!heroCanvasCached || !heroSection) return;

  const rect = heroSection.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  heroCanvasCached.width = rect.width * dpr;
  heroCanvasCached.height = rect.height * dpr;
  heroCanvasCached.style.width = `${rect.width}px`;
  heroCanvasCached.style.height = `${rect.height}px`;

  drawHeroFrame();
}

function drawHeroFrame() {
  if (!heroCtxCached) return;

  const imgCurrent = heroImages[heroCurrentFrame];
  // Skip this frame if it hasn't loaded yet — never stall the animation
  if (!imgCurrent || !imgCurrent.complete || imgCurrent.naturalWidth === 0) return;

  const cW = heroCanvasCached.width,  cH = heroCanvasCached.height;
  const iW = imgCurrent.naturalWidth, iH = imgCurrent.naturalHeight;
  const iRatio = iW / iH, cRatio = cW / cH;

  let dW, dH, dX, dY;
  if (cRatio > iRatio) { dW = cW; dH = cW / iRatio; }
  else                  { dH = cH; dW = cH * iRatio; }
  dX = (cW - dW) / 2;
  dY = (cH - dH) / 2;

  heroCtxCached.clearRect(0, 0, cW, cH);
  heroCtxCached.drawImage(imgCurrent, dX, dY, dW, dH);
}

function startHeroAnimation() {
  if (isHeroAnimationRunning) return;
  isHeroAnimationRunning = true;

  resizeHeroCanvas();
  window.addEventListener('resize', resizeHeroCanvas);

  requestAnimationFrame(heroTick);
}

function heroTick(timestamp) {
  if (!isHeroAnimationRunning) return;
  requestAnimationFrame(heroTick);

  if (!lastHeroTickTime) lastHeroTickTime = timestamp;

  if (timestamp - lastHeroTickTime >= HERO_FRAME_DURATION - 2) {
    lastHeroTickTime = timestamp;
    heroCurrentFrame = (heroCurrentFrame + 1) % HERO_TOTAL_FRAMES;
    drawHeroFrame();
  }
}


// ============================================================

// MAGNETIC BUTTONS
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const magneticButtons = document.querySelectorAll('.card-cta');

  magneticButtons.forEach(btn => {
    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      
      // Calculate how far to pull the button toward the cursor
      const deltaX = (x - centerX) * 0.3; 
      const deltaY = (y - centerY) * 0.3;

      btn.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      // Fast transition so it follows the mouse closely
      btn.style.transition = 'transform 0.05s linear, background 0.3s, color 0.3s, border-color 0.3s';
    });

    btn.addEventListener('mouseleave', () => {
      // Snap back to original position
      btn.style.transform = `translate(0px, 0px)`;
      // Smooth, elastic transition for snapping back
      btn.style.transition = 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1), background 0.3s, color 0.3s, border-color 0.3s';
    });
  });
});

// ============================================================
// ORDER HISTORY
// ============================================================

function openHistoryModal(e) {
  if (e) e.preventDefault();
  const overlay = document.getElementById('history-overlay');
  overlay.classList.add('show');
  // Reset fields
  document.getElementById('history-phone').value = '';
  document.getElementById('history-results').innerHTML = '';
}

function closeHistoryModal() {
  const overlay = document.getElementById('history-overlay');
  overlay.classList.remove('show');
}

function fetchOrderHistory() {
  const phone = document.getElementById('history-phone').value.trim();
  const resultsContainer = document.getElementById('history-results');

  if (!phone) {
    resultsContainer.innerHTML = '<p style="color:#c9644c; font-size:0.9rem;">Please enter a valid phone number.</p>';
    return;
  }

  resultsContainer.innerHTML = '<div style="color:var(--text); font-size:0.9rem;">Searching for your rituals...</div>';

  fetch(`/api/orders?phone=${encodeURIComponent(phone)}`)
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        if (data.orders.length === 0) {
          resultsContainer.innerHTML = '<p style="color:var(--muted); font-size:0.9rem;">No rituals found for this number.</p>';
          return;
        }

        let html = '';
        data.orders.forEach(order => {
          const date = new Date(order.createdAt).toLocaleDateString('en-IN', {
            year: 'numeric', month: 'long', day: 'numeric'
          });
          const blendsStr = order.blends && order.blends.length > 0 
            ? order.blends.join(', ') 
            : 'No blends specified';
            
          html += `
            <div class="history-card">
              <div class="hc-header">
                <span class="hc-ref">${order.refId || 'N/A'}</span>
                <span class="hc-date">${date}</span>
              </div>
              <div class="hc-body">
                <p class="hc-blends">${blendsStr}</p>
                <p class="hc-total">₹${(order.total || 0).toLocaleString('en-IN')}</p>
              </div>
            </div>
          `;
        });
        resultsContainer.innerHTML = html;
      } else {
        resultsContainer.innerHTML = '<p style="color:#c9644c; font-size:0.9rem;">Failed to fetch orders. Please try again.</p>';
      }
    })
    .catch(err => {
      console.error(err);
      resultsContainer.innerHTML = '<p style="color:#c9644c; font-size:0.9rem;">An error occurred. Please try again.</p>';
    });
}

// ---- Enter key support for history phone input ----
document.addEventListener('DOMContentLoaded', () => {
  const historyPhoneInput = document.getElementById('history-phone');
  if (historyPhoneInput) {
    historyPhoneInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        fetchOrderHistory();
      }
    });
  }
});

