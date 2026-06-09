/**
 * The Reliquary — Agitation Engine (Phase 3B)
 * Converts classifier output into agitation movement.
 * No API calls. Runs every message, must never throw.
 *
 * Flow: classification → enabled-trigger filter → sensitivity points →
 *       nature & mood modifiers → derived triggers (stacking/accumulated/
 *       random) → cascade → decay → clamp → log.
 */

import { AGITATION } from '../config.js';
import { TRIGGER_LABELS } from './classifier.js';

// Triggers the entity's nature cares about more. Keys are matched as
// case-insensitive substrings of entity.nature (presets use free text like
// 'Ghost'; guided creation uses ids like 'predator').
const NATURE_MODIFIERS = {
    predator:  { combat: 1.4, fear: 1.2, desire: 1.2 },
    beast:     { combat: 1.4, fear: 1.2, desire: 1.2 },
    protector: { fear: 1.4, betrayal: 1.3, combat: 1.2 },
    guardian:  { fear: 1.4, betrayal: 1.3, combat: 1.2 },
    shadow:    { shame: 1.4, deception: 1.3, temptation: 1.2 },
    parasite:  { jealousy: 1.4, isolation: 1.3, desire: 1.2 },
    symbiote:  { jealousy: 1.4, isolation: 1.3, desire: 1.2 },
    trickster: { deception: 1.4, temptation: 1.3, euphoria: 1.2 },
    ancient:   { betrayal: 1.3, shame: 1.2, grief: 1.2 },
    ghost:     { grief: 1.4, isolation: 1.3, betrayal: 1.2 },
    impulse:   { temptation: 1.4, combat: 1.3, intimacy: 1.2 },
};

// Global gain on trigger points. The sensitivityPoints table assumes one
// binary trigger per message; real RP text matches 2-3 fuzzy triggers at
// once, so without this the meter pegs at 100 in three messages.
const GAIN = 0.5;

// Hard cap on how much a single message can move the needle upward.
// One purple wall of violence shouldn't max the meter from zero.
const MAX_DELTA_PER_MESSAGE = 22;

function getNatureMod(nature, triggerId) {
    if (!nature) return 1;
    const n = String(nature).toLowerCase();
    for (const [key, mods] of Object.entries(NATURE_MODIFIERS)) {
        if (n.includes(key) && mods[triggerId]) return mods[triggerId];
    }
    return 1;
}

function sensPoints(sensitivity) {
    return AGITATION.sensitivityPoints[sensitivity] ?? AGITATION.sensitivityPoints[3];
}

/**
 * Update agitation from a classification result.
 * @param {object} state - per-chat state (mutated)
 * @param {object} classification - output of classifyMessage()
 * @param {object} settings - global settings (trigger config)
 * @param {object} [opts] - { source: 'ai' | 'user' }
 * @returns {{ value:number, delta:number, matched:Array, stirred:boolean }}
 */
export function updateAgitation(state, classification, settings, opts = {}) {
    const summary = { value: state?.agitation || 0, delta: 0, matched: [], stirred: false };
    if (!state?.entity) return summary;

    try {
        const triggers = settings?.triggers || {};
        const matches = classification?.matches || {};
        let delta = 0;

        // ── Direct text-matched triggers ──
        for (const [triggerId, relevance] of Object.entries(matches)) {
            const cfg = triggers[triggerId];
            if (!cfg?.enabled) continue;
            if (relevance < 0.1) continue;

            const points = relevance
                * sensPoints(cfg.sensitivity)
                * getNatureMod(state.entity.nature, triggerId)
                * GAIN;

            delta += points;
            summary.matched.push({
                id: triggerId,
                label: TRIGGER_LABELS[triggerId] || triggerId,
                score: Math.round(relevance * 100) / 100,
                points: Math.round(points),
                sensitivity: cfg.sensitivity,
            });
        }

        // ── Derived: stacking (3+ distinct triggers in one message) ──
        if (summary.matched.length >= 3 && triggers.stacking?.enabled) {
            const bonus = sensPoints(triggers.stacking.sensitivity) * 0.5;
            delta += bonus;
            summary.matched.push({
                id: 'stacking', label: TRIGGER_LABELS.stacking,
                score: 1, points: Math.round(bonus),
            });
        }

        // ── Derived: accumulated irritation (sustained pressure) ──
        // If the last 4 logged messages ALL had at least one match, the
        // entity is fraying. Small bonus, fires repeatedly under siege.
        if (triggers.accumulated?.enabled && summary.matched.length > 0) {
            const log = state.agitationLog || [];
            const recent = log.slice(-4);
            if (recent.length === 4 && recent.every(e => (e.m || 0) > 0)) {
                const bonus = sensPoints(triggers.accumulated.sensitivity) * 0.3;
                delta += bonus;
                summary.matched.push({
                    id: 'accumulated', label: TRIGGER_LABELS.accumulated,
                    score: 1, points: Math.round(bonus),
                });
            }
        }

        // ── Derived: random restlessness ──
        if (triggers.random?.enabled) {
            const chance = (triggers.random.sensitivity || 1) * 0.02; // 2–10%
            if (Math.random() < chance) {
                const bonus = 5 + Math.random() * 10;
                delta += bonus;
                summary.matched.push({
                    id: 'random', label: TRIGGER_LABELS.random,
                    score: 1, points: Math.round(bonus),
                });
            }
        }

        // ── Modifiers ──
        // Cascade: already agitated = easier to push further
        if (state.agitation > 40 && delta > 0) delta *= 1.2;

        // Mood
        const mood = (state.mood || '').toLowerCase();
        if (['hostile', 'seething', 'restless', 'hungry', 'agitated'].includes(mood)) {
            if (delta > 0) delta *= 1.25;
        } else if (['content', 'indifferent', 'steady', 'dormant'].includes(mood)) {
            if (delta > 0) delta *= 0.75;
        }

        // Cap the upward spike
        delta = Math.min(delta, MAX_DELTA_PER_MESSAGE);

        // ── Decay when nothing stirred ──
        if (delta === 0) {
            // Decay scales with pressure: a maxed meter bleeds off faster.
            // User messages decay at half rate so running both hooks
            // (MESSAGE_SENT + MESSAGE_RECEIVED) doesn't drain it twice as fast.
            const scale = opts.source === 'user' ? 0.5 : 1;
            const base = AGITATION.decay.perMessage + (state.agitation || 0) * 0.05;
            delta = -base * scale;
        }

        // ── Apply, clamp, log ──
        state.agitation = Math.max(0, Math.min(AGITATION.max, (state.agitation || 0) + delta));

        if (!Array.isArray(state.agitationLog)) state.agitationLog = [];
        state.agitationLog.push({
            d: Math.round(delta),             // delta
            m: summary.matched.length,        // match count
            ids: summary.matched.map(x => x.id),
            t: Date.now(),
        });
        if (state.agitationLog.length > 30) {
            state.agitationLog = state.agitationLog.slice(-30);
        }

        summary.value = Math.round(state.agitation);
        summary.delta = Math.round(delta);
        summary.stirred = summary.matched.length > 0;
    } catch (err) {
        console.warn('[Reliquary] Agitation error (ignored):', err);
    }

    return summary;
}

/**
 * One-line human description of what just stirred — for prompts & diagnostics.
 * e.g. "deception (strong), betrayal (faint)"
 */
export function describeStir(summary) {
    if (!summary?.matched?.length) return '';
    return summary.matched
        .filter(m => !['random'].includes(m.id))
        .map(m => {
            const strength = m.score >= 0.8 ? 'strong' : m.score >= 0.45 ? 'clear' : 'faint';
            return `${m.label} (${strength})`;
        })
        .join(', ');
}

/**
 * Status word for the current agitation value — mirrors renderStatus().
 */
export function agitationWord(ag) {
    if (ag < 15) return 'contained';
    if (ag < 35) return 'restless';
    if (ag < 55) return 'straining';
    if (ag < 75) return 'struggling';
    if (ag < 90) return 'breaking';
    return 'unbound';
}
