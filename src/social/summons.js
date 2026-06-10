/**
 * The Reliquary — Summons (the entity demands an audience)
 *
 * The game loop this enables:
 *   pressure builds (classifier/agitation) → the UI warns you (bleed/FAB)
 *   → you ignore it at your peril → the entity SUMMONS you to Commune
 *   → it confronts you about what stirred it → you choose how to answer:
 *
 *     SOOTHE — calm it down. Solid pressure relief. Safe.
 *     FEED   — give it what it wants. Biggest relief — but you met it
 *              on ITS terms, and it remembers that.
 *     DEFY   — refuse it. Least relief, it withdraws seething — but
 *              some entities respect spine.
 *
 *   Mechanical effects are guaranteed (agitation always moves). Mood and
 *   relationship are SELF-REPORTED by the entity via [MOOD:][BOND:] tags
 *   in its reply — the AI does the drifting, in character, with fallbacks
 *   if the tags don't survive generation.
 *
 * Never touches the main chat. All confrontation happens in Commune.
 */

import { AGITATION, RELATIONSHIP_STATES, LOG_PREFIX } from '../config.js';
import { generateSummonsTurn } from '../entity/engine.js';
import { saveChatState } from '../state.js';

// Minimum main-chat messages between summons. Without this, an unresolved
// high meter would re-summon every message.
const COOLDOWN_MESSAGES = 8;

export const SUMMONS_CHOICES = {
    soothe: {
        label: 'SOOTHE', hint: 'calm it',
        hostLine: "Easy. I'm here — I'm listening. Talk to me.",
        agitationDelta: -30,
        fallbackMood: 'settling',
    },
    feed: {
        label: 'FEED', hint: 'give in',
        hostLine: "Alright. You want it that badly? Fine. Take it — I'm not fighting you on this one.",
        agitationDelta: -45,
        fallbackMood: 'sated',
    },
    defy: {
        label: 'DEFY', hint: 'refuse',
        hostLine: "No. Whatever this is — stand down. We're not doing this.",
        agitationDelta: -15,
        fallbackMood: 'seething',
    },
};

/**
 * Can the entity summon right now?
 */
export function canSummon(state, settings) {
    if (!state?.entity) return false;
    if (state.activeSummons) return false;
    if ((state.agitation || 0) < AGITATION.thresholds.possession) return false;

    // Respect commune toggle in custom mode (summons lives in Commune)
    if (settings?.controlMode === 'custom' && settings?.customToggles?.directory === false) {
        return false;
    }

    const last = (state.lastSummonsAt ?? null);
    if (last !== null && (state.totalMessages || 0) - last < COOLDOWN_MESSAGES) {
        return false;
    }
    return true;
}

/**
 * Fire a summons: mark state immediately (UI flares even while the opener
 * generates), then generate the entity's confrontation opener.
 * @param {object} state - chat state (mutated)
 * @param {string} reason - human-readable stir description
 * @param {boolean} [force] - bypass nothing here; force handling is caller's job
 * @returns {Promise<string>} the opener text (AI or fallback)
 */
export async function triggerSummons(state, reason = '') {
    state.activeSummons = {
        reason,
        agitation: Math.round(state.agitation || 0),
        atMessage: state.totalMessages || 0,
        created: Date.now(),
    };
    state.lastSummonsAt = state.totalMessages || 0;
    saveChatState();

    let opener = null;
    try {
        opener = await generateSummonsTurn(state, 'opener', reason);
    } catch (err) {
        console.warn(LOG_PREFIX, 'Summons opener generation failed:', err);
    }
    if (!opener) opener = fallbackOpener(state, reason);

    if (!Array.isArray(state.directoryHistory)) state.directoryHistory = [];
    state.directoryHistory.push({
        role: 'assistant', text: opener, timestamp: Date.now(), summons: true,
    });
    trimHistory(state);

    if (!Array.isArray(state.summonsLog)) state.summonsLog = [];
    state.summonsLog.push({
        reason, agitation: state.activeSummons.agitation, t: Date.now(),
    });
    if (state.summonsLog.length > 20) state.summonsLog = state.summonsLog.slice(-20);

    saveChatState();
    return opener;
}

/**
 * Resolve an active summons with a player choice.
 * Always succeeds mechanically; AI reply falls back to canned text.
 * @returns {Promise<{reply:string, mood:string, bond:string}|null>}
 */
export async function resolveSummons(state, choiceId) {
    const choice = SUMMONS_CHOICES[choiceId];
    if (!choice || !state?.activeSummons) return null;

    const reason = state.activeSummons.reason || '';

    // The host's answer goes into the conversation
    if (!Array.isArray(state.directoryHistory)) state.directoryHistory = [];
    state.directoryHistory.push({ role: 'user', text: choice.hostLine, timestamp: Date.now() });
    saveChatState();

    // Entity reacts (AI, with canned fallback)
    let raw = null;
    try {
        raw = await generateSummonsTurn(state, choiceId, reason);
    } catch (err) {
        console.warn(LOG_PREFIX, 'Summons resolution generation failed:', err);
    }
    const { text, mood, bond } = parseSelfReport(raw || '');
    const replyText = text || fallbackResolution(choiceId, state);

    // ── Guaranteed mechanics ──
    state.agitation = Math.max(0, Math.min(AGITATION.max,
        (state.agitation || 0) + choice.agitationDelta));
    state.mood = mood || choice.fallbackMood;

    // Relationship: entity self-report wins, validated against known states
    if (bond && bond !== state.relationship) {
        if (!Array.isArray(state.relationshipHistory)) state.relationshipHistory = [];
        state.relationshipHistory.push({
            from: state.relationship, to: bond, via: `summons:${choiceId}`, t: Date.now(),
        });
        if (state.relationshipHistory.length > 20) {
            state.relationshipHistory = state.relationshipHistory.slice(-20);
        }
        state.relationship = bond;
    }

    state.directoryHistory.push({
        role: 'assistant', text: replyText, timestamp: Date.now(), summons: true,
    });
    trimHistory(state);

    state.activeSummons = null;
    saveChatState();

    return { reply: replyText, mood: state.mood, bond: state.relationship };
}

/**
 * Parse trailing [MOOD: x] [BOND: y] self-report tags out of a reply.
 * Tags are optional — generation can truncate them. BOND must be one of
 * the known relationship states or it's ignored.
 */
export function parseSelfReport(text) {
    const out = { text: (text || '').trim(), mood: null, bond: null };
    if (!out.text) { out.text = null; return out; }

    const moodMatch = out.text.match(/\[MOOD:\s*([^\]]+)\]/i);
    if (moodMatch) {
        const m = moodMatch[1].trim().toLowerCase();
        if (m.length >= 2 && m.length <= 30) out.mood = m;
    }

    const bondMatch = out.text.match(/\[BOND:\s*([^\]]+)\]/i);
    if (bondMatch) {
        const b = bondMatch[1].trim().toLowerCase();
        if (RELATIONSHIP_STATES.user.includes(b)) out.bond = b;
    }

    out.text = out.text
        .replace(/\[MOOD:[^\]]*\]/gi, '')
        .replace(/\[BOND:[^\]]*\]/gi, '')
        .trim();
    if (!out.text) out.text = null;

    return out;
}

// ── fallbacks (the no-console rule: features must degrade visibly, never die) ──

function fallbackOpener(state, reason) {
    const name = state?.entity?.name || 'It';
    const why = reason ? ` Something in that scene — ${reason} — has it clawing at the walls.` : '';
    return `${name} seizes your attention and will not let go.${why} The words don't come through clearly — the connection strains — but the demand underneath is unmistakable: *answer for this.*`;
}

function fallbackResolution(choiceId, state) {
    const name = state?.entity?.name || 'It';
    switch (choiceId) {
        case 'soothe': return `${name} subsides, slowly — the pressure easing like a held breath finally let out. It is not finished with this. But it is finished for now.`;
        case 'feed': return `Something in ${name} settles — heavy, satisfied, almost purring. It got what it wanted. You can feel it remembering that you gave it.`;
        case 'defy': return `${name} goes very still, then withdraws — not gone, never gone, just... further back. The silence it leaves behind has edges.`;
        default: return `${name} withdraws into watchful silence.`;
    }
}

function trimHistory(state) {
    if (Array.isArray(state.directoryHistory) && state.directoryHistory.length > 60) {
        state.directoryHistory = state.directoryHistory.slice(-60);
    }
}
