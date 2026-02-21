/**
 * The Reliquary — Configuration
 * Constants, palettes, trigger definitions, defaults.
 */

export const EXT_NAME = 'The-Reliquary';
export const EXT_ID = 'reliquary';
export const LOG_PREFIX = '[Reliquary]';

// ============================================================
// THEME PALETTES
// ============================================================

export const THEMES = {
    veridian: {
        id: 'veridian',
        creed: 'The house must endure',
        // Core colors
        bg: '#042112',
        bgDeep: '#021a0e',
        accent: [155, 127, 54],         // gold
        accentBright: [200, 170, 70],    // bright gold
        // Bleed colors (feathered invading)
        bleed: [207, 191, 162],          // cream
        bleedWarm: [190, 170, 140],
        // Crystal facet shading
        crystal: {
            light: 0.14,
            mid: 0.06,
            dark: 0.02,
            darkOverlay: 0.10,
            edgeAlpha: 0.22,
            veinAlpha: 0.30,
        },
    },
    feathered: {
        id: 'feathered',
        creed: 'The cycle must end',
        bg: '#1c1a14',
        bgDeep: '#14120e',
        accent: [207, 191, 162],         // cream
        accentBright: [230, 215, 185],   // bright cream
        bleed: [40, 100, 60],            // forest green
        bleedWarm: [30, 80, 45],
        crystal: {
            light: 0.12,
            mid: 0.05,
            dark: 0.015,
            darkOverlay: 0.10,
            edgeAlpha: 0.20,
            veinAlpha: 0.26,
        },
    },
};

// ============================================================
// ENTITY NATURES (for voice creation)
// ============================================================

export const ENTITY_NATURES = [
    { id: 'predator', label: 'Predator', desc: 'Beast, hunger, instinct' },
    { id: 'protector', label: 'Protector', desc: 'Guardian, shield, warden' },
    { id: 'shadow', label: 'Shadow', desc: 'Mirror, double, the parts you hide' },
    { id: 'parasite', label: 'Parasite', desc: 'Symbiote, bonded, consuming' },
    { id: 'trickster', label: 'Trickster', desc: 'Deceiver, shapeshifter, chaos' },
    { id: 'ancient', label: 'Ancient', desc: 'Spirit, bound, old power' },
    { id: 'custom', label: 'Custom', desc: 'Something else entirely' },
];

// ============================================================
// RELATIONSHIP STATES
// ============================================================

export const RELATIONSHIP_STATES = {
    // Entity → User (host)
    user: [
        'bonded', 'protective', 'curious', 'resentful', 'hostile',
        'possessive', 'devoted', 'indifferent', 'amused', 'grieving',
    ],
    // Entity → Characters (NPCs)
    character: [
        'intrigued', 'fond', 'threatened', 'jealous',
        'contemptuous', 'fascinated', 'wary',
    ],
};

// ============================================================
// TRIGGER DEFINITIONS
// ============================================================

export const TRIGGER_CATEGORIES = {
    emotional: {
        label: 'Emotional',
        triggers: {
            rage:     { label: 'Rage / Anger',        default: { enabled: true, sensitivity: 3 } },
            fear:     { label: 'Fear / Threat',        default: { enabled: true, sensitivity: 3 } },
            grief:    { label: 'Grief / Loss',         default: { enabled: false, sensitivity: 2 } },
            desire:   { label: 'Desire / Lust',        default: { enabled: false, sensitivity: 2 } },
            jealousy: { label: 'Jealousy',             default: { enabled: false, sensitivity: 2 } },
            shame:    { label: 'Shame / Humiliation',  default: { enabled: false, sensitivity: 2 } },
            euphoria: { label: 'Euphoria / Joy',       default: { enabled: false, sensitivity: 1 } },
        },
    },
    situational: {
        label: 'Situational',
        triggers: {
            combat:     { label: 'Combat / Violence',    default: { enabled: true, sensitivity: 3 } },
            intimacy:   { label: 'Intimacy / Vulnerability', default: { enabled: false, sensitivity: 2 } },
            deception:  { label: 'Deception / Lying',    default: { enabled: true, sensitivity: 3 } },
            betrayal:   { label: 'Betrayal',             default: { enabled: true, sensitivity: 4 } },
            isolation:  { label: 'Isolation / Solitude',  default: { enabled: false, sensitivity: 2 } },
            temptation: { label: 'Temptation',           default: { enabled: false, sensitivity: 2 } },
        },
    },
    pattern: {
        label: 'Pattern',
        triggers: {
            accumulated: { label: 'Accumulated Irritation', default: { enabled: true, sensitivity: 3 } },
            denial:      { label: 'Repeated Denial',        default: { enabled: true, sensitivity: 3 } },
            stacking:    { label: 'Trigger Stacking',        default: { enabled: true, sensitivity: 3 } },
        },
    },
    special: {
        label: 'Special',
        triggers: {
            lunar:            { label: 'Lunar Cycle',         default: { enabled: false, sensitivity: 3 } },
            characterPresent: { label: 'Character Present',   default: { enabled: false, sensitivity: 3, target: '' } },
            random:           { label: 'Random Chance',       default: { enabled: false, sensitivity: 1 } },
            manual:           { label: 'Manual Invocation',   default: { enabled: true, sensitivity: 0 } },
        },
    },
};

// ============================================================
// AGITATION THRESHOLDS
// ============================================================

export const AGITATION = {
    max: 100,
    thresholds: {
        intrusion: 30,    // Tier 1
        struggle: 50,     // Tier 2
        possession: 75,   // Tier 3
    },
    sensitivityPoints: {
        1: 5,
        2: 10,
        3: 20,
        4: 35,
        5: 50,
    },
    decay: {
        perMessage: 5,       // no triggers matched
        directConvo: 15,     // user talks in 1-on-1
        entitySatisfied: 10, // entity got what it wanted
        forceOverride: -10,  // INCREASES (user forced)
    },
};

// ============================================================
// CONTROL MODES
// ============================================================

export const CONTROL_MODES = {
    manual: {
        label: 'Full Manual',
        desc: 'Entity speaks in sidebar and 1-on-1 only. Cannot touch the main chat.',
    },
    auto: {
        label: 'Full Auto',
        desc: 'Entity can fully take over based on triggers, mood, and relationship.',
    },
    custom: {
        label: 'Custom',
        desc: 'Granular control over each hijack tier and feature.',
    },
};

// ============================================================
// OBSERVATION SYSTEM
// ============================================================

export const OBSERVATION = {
    defaultFrequency: 10,    // Synthesize every N messages
    maxObservations: 20,     // Cap
    types: ['behavioral', 'emotional', 'relational', 'physical'],
};

// ============================================================
// CHATTINESS LEVELS
// ============================================================

export const CHATTINESS = {
    1: { label: 'Near-silent', range: [10, 15] },  // speaks every 10-15 messages
    2: { label: 'Quiet',       range: [5, 8] },
    3: { label: 'Moderate',    range: [2, 4] },
    4: { label: 'Chatty',      range: [1, 2] },
    5: { label: 'Never shuts up', range: [1, 1] },
};
