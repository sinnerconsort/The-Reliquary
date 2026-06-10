/**
 * The Reliquary — Bleed System (Phase 7)
 * As agitation rises, the OPPOSING theme leaks into the current one.
 * Veridian's gold-on-green gets invaded by warm cream. Feathered's
 * cream gets stained with forest green. The UI itself becomes the
 * tell that something inside is pushing against containment.
 *
 * Not a setting — a state. Driven entirely by agitation.
 *
 * Three layers:
 *  1. CSS variable interpolation — every themed color drifts toward the
 *     opposing palette (panel + FAB, so the FAB warns you even when closed).
 *  2. The veil — patchy radial blooms of the opposing color that pulse
 *     over the panel, faster as pressure builds.
 *  3. Creed flicker — the motto stutters into the opposing creed and back.
 *     Past 90% bleed, the OTHER creed has taken over and yours is the
 *     intruder.
 *
 * No API calls. Ticked from the existing animation loop (~400ms).
 * Must never throw.
 */

import { THEMES } from '../config.js';

let currentBleed = 0;       // eased value, 0–1
let varsActive = false;     // are inline overrides currently applied?
let veilEl = null;
let flickerLock = false;

// Alpha table for regenerating every derived CSS variable from one mixed RGB.
const VAR_ALPHAS = {
    '--rel-accent-dim': 0.5,
    '--rel-accent-ghost': 0.12,
    '--rel-accent-bright': 0.9,
    '--rel-accent-faint': 0.06,
    '--rel-accent-glow': 0.15,
    '--rel-text': 0.72,
    '--rel-text-bright': 0.9,
    '--rel-text-dim': 0.4,
    '--rel-text-ghost': 0.2,
    '--rel-border': 0.1,
    '--rel-border-bright': 0.25,
    '--rel-bg-card': 0.03,
};

const ALL_VARS = ['--rel-accent', '--rel-bg', '--rel-bg-deep', ...Object.keys(VAR_ALPHAS)];

// ── helpers ──
const lerp = (a, b, t) => a + (b - a) * t;
const mixC = (a, b, t) => [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

function otherThemeId(theme) {
    return theme === 'veridian' ? 'feathered' : 'veridian';
}

// ── public API ──

/** Current eased bleed amount (0–1). Used by the crystal animation. */
export function getCurrentBleed() {
    return currentBleed;
}

/**
 * Bleed target from agitation. Quiet below 25, full takeover near 90.
 * Smoothstepped so it eases at both ends.
 */
export function computeBleedTarget(state) {
    const ag = state?.agitation || 0;
    const t = Math.max(0, Math.min(1, (ag - 25) / 65));
    return t * t * (3 - 2 * t);
}

/**
 * Main tick. Call ~every 400ms (panel open or closed — the FAB bleeds too).
 */
export function tickBleed(state, settings, dtMs = 400) {
    try {
        const target = state?.entity ? computeBleedTarget(state) : 0;

        // Ease toward target — slow seep in, slow drain out (~1.2s settle)
        currentBleed += (target - currentBleed) * Math.min(1, dtMs / 1200);
        if (Math.abs(target - currentBleed) < 0.004) currentBleed = target;

        const theme = settings?.theme || 'feathered';
        applyVars(theme, currentBleed);
        updateVeil(theme, currentBleed);
        updateCreed(theme, currentBleed, dtMs);
    } catch (err) {
        console.warn('[Reliquary] Bleed tick error (ignored):', err);
    }
}

/** Remove the veil and all inline overrides (call on UI teardown). */
export function destroyBleed() {
    try {
        clearVars();
        if (veilEl) { veilEl.remove(); veilEl = null; }
        currentBleed = 0;
    } catch { /* teardown must not throw */ }
}

// ── Layer 1: CSS variable interpolation ──

function bleedTargets() {
    return [
        document.getElementById('reliquary-panel'),
        document.querySelector('.reliquary-fab'),
    ].filter(Boolean);
}

function clearVars() {
    if (!varsActive) return;
    for (const el of bleedTargets()) {
        for (const v of ALL_VARS) el.style.removeProperty(v);
    }
    varsActive = false;
}

function applyVars(theme, bleed) {
    if (bleed < 0.02) { clearVars(); return; }

    const T = THEMES[theme] || THEMES.feathered;
    const O = THEMES[otherThemeId(theme)] || THEMES.veridian;

    // Accent drifts hard (85% at full bleed) — it's the voice of the UI.
    // Backgrounds drift gently (45%) — the room darkens differently, it
    // doesn't become a different room.
    const accent = mixC(T.accent, O.accent, bleed * 0.85);
    const bg = mixC(hexToRgb(T.bg), hexToRgb(O.bg), bleed * 0.45);
    const bgDeep = mixC(hexToRgb(T.bgDeep), hexToRgb(O.bgDeep), bleed * 0.45);

    for (const el of bleedTargets()) {
        el.style.setProperty('--rel-accent', rgb(accent));
        el.style.setProperty('--rel-bg', rgb(bg));
        el.style.setProperty('--rel-bg-deep', rgb(bgDeep));
        for (const [varName, alpha] of Object.entries(VAR_ALPHAS)) {
            el.style.setProperty(varName, rgba(accent, alpha));
        }
    }
    varsActive = true;
}

// ── Layer 2: the veil ──

function ensureVeil() {
    if (veilEl && document.body.contains(veilEl)) return veilEl;
    veilEl = document.createElement('div');
    veilEl.className = 'reliquary-bleed-veil';
    document.body.appendChild(veilEl);
    return veilEl;
}

function updateVeil(theme, bleed) {
    const panel = document.getElementById('reliquary-panel');
    const panelVisible = panel && getComputedStyle(panel).display !== 'none';

    if (!panelVisible || bleed < 0.05) {
        if (veilEl) veilEl.style.opacity = '0';
        return;
    }

    const veil = ensureVeil();
    const O = THEMES[otherThemeId(theme)] || THEMES.veridian;
    const c = O.accent;

    // Track the panel's on-screen rect (fixed overlay — doesn't scroll away)
    const r = panel.getBoundingClientRect();
    veil.style.top = `${r.top}px`;
    veil.style.left = `${r.left}px`;
    veil.style.width = `${r.width}px`;
    veil.style.height = `${r.height}px`;

    // Patchy organic blooms of the invading color
    veil.style.background = `
        radial-gradient(ellipse 45% 22% at 18% 12%, ${rgba(c, 0.11)} 0%, transparent 70%),
        radial-gradient(ellipse 55% 30% at 88% 38%, ${rgba(c, 0.09)} 0%, transparent 70%),
        radial-gradient(ellipse 48% 26% at 28% 72%, ${rgba(c, 0.10)} 0%, transparent 70%),
        radial-gradient(ellipse 38% 18% at 72% 92%, ${rgba(c, 0.08)} 0%, transparent 70%)`;

    // Opacity and pulse speed scale with pressure
    veil.style.opacity = String(Math.min(0.95, bleed));
    veil.style.animationDuration = `${(6 - bleed * 4).toFixed(2)}s`;
    veil.classList.toggle('rel-veil-breaking', bleed > 0.75);
}

// ── Layer 3: creed flicker ──

function updateCreed(theme, bleed, dtMs) {
    const el = document.getElementById('reliquary-creed');
    if (!el) return;

    const own = (THEMES[theme]?.creed || '').toUpperCase();
    const other = (THEMES[otherThemeId(theme)]?.creed || '').toUpperCase();

    // Past 90% bleed the other creed has TAKEN OVER — yours is the flicker.
    const dominant = bleed > 0.9 ? other : own;
    const intruder = bleed > 0.9 ? own : other;

    if (!flickerLock && el.textContent !== dominant) {
        el.textContent = dominant;
    }

    if (bleed < 0.35 || flickerLock) return;

    // Flicker chance scales with bleed (~0 at 0.35 → ~30% per tick at 1.0)
    const chance = (bleed - 0.35) * 0.5 * (dtMs / 400);
    if (Math.random() < chance) {
        flickerLock = true;
        el.textContent = intruder;
        el.classList.add('rel-creed-flicker');
        setTimeout(() => {
            try {
                el.textContent = dominant;
                el.classList.remove('rel-creed-flicker');
            } finally {
                flickerLock = false;
            }
        }, 140 + Math.random() * 360);
    }
}
