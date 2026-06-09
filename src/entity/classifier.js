/**
 * The Reliquary — Classifier (Phase 3A, lite)
 * Cheap keyword/regex scan of incoming messages. No API calls.
 * Maps message content to trigger relevance scores (0–1 per trigger).
 *
 * Design notes:
 * - This runs on EVERY message, so it must stay cheap and never throw.
 * - Scores are fuzzy by design. One clear keyword ≈ 0.45, two ≈ 0.8, three+ = 1.
 *   The agitation engine multiplies these by sensitivity, so a faint match on
 *   a sensitivity-5 trigger still matters more than a strong match on a 1.
 * - Pattern triggers (accumulated, stacking, random) are NOT matched here —
 *   they're derived in agitation.js from history. Lunar/manual/denial are
 *   skipped entirely for now.
 */

// Human-readable labels for prompt-building and diagnostics.
export const TRIGGER_LABELS = {
    rage: 'rage', fear: 'fear / threat', grief: 'grief', desire: 'desire',
    jealousy: 'jealousy', shame: 'shame', euphoria: 'euphoria',
    combat: 'violence', intimacy: 'intimacy', deception: 'deception',
    betrayal: 'betrayal', isolation: 'isolation', temptation: 'temptation',
    accumulated: 'accumulated irritation', stacking: 'everything at once',
    random: 'restlessness', characterPresent: 'THAT one is here',
};

// Each trigger: array of regexes. Word boundaries where it matters.
const PATTERNS = {
    rage: [
        /\b(fury|furious|rage|raging|enraged|livid|seeth\w*|wrath)\b/i,
        /\b(snarl|growl|snap)(s|ed|ing)?\b/i,
        /\b(scream|shout|yell|roar)(s|ed|ing)?\b/i,
        /\b(slam|smash|hurl)(s|med|ed|ing)?\b/i,
        /fists? (clench|tighten|ball)/i,
        /through (gritted|clenched) teeth/i,
    ],
    fear: [
        /\b(fear(ful|s)?|terror|afraid|terrif\w+|dread\w*|panic\w*|horrif\w+|frighten\w*|anxious|nervous)\b/i,
        /\b(trembl|shiver|shudder|quak)\w*\b/i,
        /\bflinch\w*\b/i,
        /heart (pound|hammer|race)\w*/i,
        /\b(frozen|paralyzed) (in|with)\b/i,
        /backs? away|recoil\w*/i,
        /\b(threat|threaten\w*|danger\w*|menac\w+)\b/i,
    ],
    grief: [
        /\b(grief|griev\w+|mourn\w*|sorrow)\b/i,
        /\b(weep|sob|wept)(s|ing)?\b/i,
        /\btears?\b.{0,30}\b(fall|well|stream|stung|blur)/i,
        /\b(funeral|grave|buried|memorial)\b/i,
        /\b(lost|losing) (him|her|them|everything|everyone)\b/i,
        /\bgone\b.{0,20}\bforever\b/i,
    ],
    desire: [
        /\b(desire|lust|yearn\w*|crav\w+|ach\w+ for)\b/i,
        /\bhunger(s|ed|ing)? for\b/i,
        /breath (hitch|catch)\w*/i,
        /\b(heat|warmth) (pool|spread|ris)\w*/i,
        /\bwant(s|ed)? (you|him|her|them)\b/i,
    ],
    jealousy: [
        /\b(jealous\w*|envy|envious|covet\w*)\b/i,
        /\bpossessive\w*\b/i,
        /eyes (narrow|darken)\w*.{0,40}(him|her|them)/i,
    ],
    shame: [
        /\b(shame|asham\w+|humiliat\w+|embarrass\w+|mortif\w+|disgrace\w*)\b/i,
        /cheeks (burn|flush|redden)\w*/i,
        /can'?t (meet|look)\b.{0,20}eyes/i,
    ],
    euphoria: [
        /\b(joy|joyful|elat\w+|euphori\w+|ecsta\w+|thrilled|overjoyed)\b/i,
        /\b(laugh|giggl|grin)(s|ed|ing)?\b/i,
        /\b(celebrat\w+|triumph\w*|victor\w+)\b/i,
        /\bdelight\w*\b/i,
    ],
    combat: [
        /\b(blood|bleed\w*|wound\w*|gash|bruis\w+)\b/i,
        /\b(blade|sword|dagger|knife|gun|pistol|rifle|axe|bow)\b/i,
        /\b(fight|brawl|battle|combat|duel|skirmish)\w*\b/i,
        /\b(punch|strike|stab|slash|shoot|fire[sd]?|swing|parr\w+|dodge|lunge)\w*\b/i,
        /\b(attack\w*|assault\w*|ambush\w*)\b/i,
        /\b(kill|killed|killing|slay|slain|murder\w*|corpse|dead body)\b/i,
    ],
    intimacy: [
        /\b(kiss|kisse[sd]|kissing)\b/i,
        /\b(embrace|caress|cuddl\w+|nuzzl\w+)\w*\b/i,
        /\b(tender\w*|gentl[ye])\b.{0,30}\b(touch|hand|finger|stroke)/i,
        /\bwhisper(s|ed|ing)? (in|against|into)\b/i,
        /hold(s|ing)? (you|him|her|them) close/i,
        /\b(intimate|vulnerab\w+)\b/i,
    ],
    deception: [
        /\b(lie|lies|lied|lying|liar)\b/i,
        /\b(deceit\w*|decept\w+|deceiv\w+)\b/i,
        /\b(pretend\w*|feign\w*|fake[sd]?|bluff\w*)\b/i,
        /\b(hide|hiding|hid|conceal\w*)\b.{0,25}\b(truth|secret)/i,
        /mask (slips|cracks|falls)/i,
        /\bhalf[- ]truth\w*\b/i,
    ],
    betrayal: [
        /\b(betray\w*|traitor\w*|treacher\w+)\b/i,
        /\b(backstab\w*|double[- ]cross\w*)\b/i,
        /\b(broke|breaking|broken)\b.{0,20}\b(trust|promise|oath|word)\b/i,
        /sold (you|us|them|me) out/i,
        /\bturn(s|ed)? (on|against) (you|us|me)\b/i,
    ],
    isolation: [
        /\b(alone|lonel\w+|solitude|solitary)\b/i,
        /\b(abandon\w*|forsak\w+)\b/i,
        /\bno one (else|left|came|would)\b/i,
        /\bempty (room|house|hall|street)\w*\b/i,
        /\bisolat\w+\b/i,
    ],
    temptation: [
        /\b(tempt\w*|forbidden|illicit)\b/i,
        /\bjust (this )?once\b/i,
        /no one (would|will|has to|needs? to) know/i,
        /\bshouldn'?t\b.{0,25}\bbut\b/i,
        /\b(urge|impulse|itch) to\b/i,
    ],
};

// How much one regex hit is worth. Two hits ≈ 0.8, three caps at 1.0.
const HIT_VALUE = 0.45;

/**
 * Classify a message against all text-matchable triggers.
 * @param {string} text - the message content
 * @param {object} settings - global settings (for characterPresent target)
 * @returns {{ matches: Object<string, number>, matchedIds: string[] }}
 */
export function classifyMessage(text, settings) {
    const result = { matches: {}, matchedIds: [] };
    if (!text || typeof text !== 'string') return result;

    // Strip code blocks / OOC brackets so meta-text doesn't trigger the entity
    const scanText = text
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/\[OOC:[\s\S]*?\]/gi, ' ')
        .substring(0, 4000); // wall-of-text guard

    try {
        for (const [triggerId, patterns] of Object.entries(PATTERNS)) {
            let hits = 0;
            for (const re of patterns) {
                if (re.test(scanText)) hits++;
                if (hits >= 3) break;
            }
            if (hits > 0) {
                const score = Math.min(1, hits * HIT_VALUE);
                result.matches[triggerId] = score;
                result.matchedIds.push(triggerId);
            }
        }

        // Special: characterPresent (name match against configured target)
        const cp = settings?.triggers?.characterPresent;
        if (cp?.enabled && cp.target && cp.target.trim().length > 1) {
            const safe = cp.target.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (new RegExp(`\\b${safe}\\b`, 'i').test(scanText)) {
                result.matches.characterPresent = 1;
                result.matchedIds.push('characterPresent');
            }
        }
    } catch (err) {
        // Classifier must NEVER break the message flow. Fail silent, fail empty.
        console.warn('[Reliquary] Classifier error (ignored):', err);
    }

    return result;
}
