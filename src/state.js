/**
 * The Reliquary — State Management
 * Global settings (extension_settings) + per-chat state (chat_metadata).
 */

import { extension_settings } from '../../../../extensions.js';
import { chat_metadata, saveSettingsDebounced, saveChatDebounced } from '../../../../../script.js';
import { EXT_ID, LOG_PREFIX, TRIGGER_CATEGORIES } from './config.js';

// ============================================================
// DEFAULT GLOBAL SETTINGS (persisted across all chats)
// ============================================================

const DEFAULT_SETTINGS = {
    settingsVersion: 1,
    enabled: true,

    // Control mode
    controlMode: 'custom',  // manual | auto | custom
    customToggles: {
        sidebar: true,
        directory: true,
        intrusion: true,
        struggle: true,
        possession: false,
        possessionCap: 3,
    },

    // Triggers (user-configured)
    triggers: buildDefaultTriggers(),

    // Theme
    theme: 'veridian',  // veridian | feathered

    // Observation system
    observationFrequency: 10,
    maxObservations: 20,

    // Voice library (saved entity templates)
    voiceLibrary: [],

    // UI preferences
    panelOpen: false,
    activeTab: 'entity',
    fabPosition: { top: '80px', right: '12px' },
};

// ============================================================
// DEFAULT PER-CHAT STATE (persisted per conversation)
// ============================================================

const DEFAULT_CHAT_STATE = {
    // The Entity (null = none created yet)
    entity: null,

    // Relationship (Entity → User)
    relationship: 'curious',
    relationshipHistory: [],

    // Character Opinions (Entity → NPCs)
    characterOpinions: {},

    // Observation Profile
    observations: [],

    // Agitation
    agitation: 0,
    agitationLog: [],

    // Mood
    mood: 'watching',
    moodIntensity: 50,

    // Sidebar
    lastCommentary: '',
    silentStreak: 0,
    developedTastes: [],

    // Hijack State
    activeHijack: null,

    // History
    directoryHistory: [],
    hijackLog: [],
    messagesSinceLastHijack: 0,
    messagesSinceLastObservation: 0,
    totalMessages: 0,
};

// ============================================================
// SETTINGS ACCESS (global)
// ============================================================

/**
 * Get extension settings reference.
 */
export function getSettings() {
    return extension_settings[EXT_ID];
}

/**
 * Save global settings (debounced).
 */
export function saveSettings() {
    saveSettingsDebounced();
}

/**
 * Initialize global settings with defaults.
 */
export function initSettings() {
    if (!extension_settings[EXT_ID]) {
        extension_settings[EXT_ID] = structuredClone(DEFAULT_SETTINGS);
        console.log(LOG_PREFIX, 'Created default settings');
    }

    sanitizeSettings();
}

/**
 * Ensure all expected keys exist (defensive).
 */
export function sanitizeSettings() {
    const s = extension_settings[EXT_ID];

    // Top-level keys
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (s[key] === undefined) {
            s[key] = structuredClone(DEFAULT_SETTINGS[key]);
        }
    }

    // Custom toggles
    if (!s.customToggles || typeof s.customToggles !== 'object') {
        s.customToggles = structuredClone(DEFAULT_SETTINGS.customToggles);
    }
    for (const key of Object.keys(DEFAULT_SETTINGS.customToggles)) {
        if (s.customToggles[key] === undefined) {
            s.customToggles[key] = DEFAULT_SETTINGS.customToggles[key];
        }
    }

    // Triggers
    if (!s.triggers || typeof s.triggers !== 'object') {
        s.triggers = buildDefaultTriggers();
    }

    // Voice library
    if (!Array.isArray(s.voiceLibrary)) {
        s.voiceLibrary = [];
    }

    // Validate types
    if (typeof s.enabled !== 'boolean') s.enabled = true;
    if (typeof s.observationFrequency !== 'number') s.observationFrequency = 10;
    if (typeof s.maxObservations !== 'number') s.maxObservations = 20;
}

// ============================================================
// PER-CHAT STATE ACCESS
// ============================================================

/**
 * Get per-chat state reference.
 */
export function getChatState() {
    if (!chat_metadata?.[EXT_ID]) return null;
    return chat_metadata[EXT_ID];
}

/**
 * Save per-chat state (debounced).
 */
export function saveChatState() {
    if (!chat_metadata) return;
    saveChatDebounced();
}

/**
 * Load per-chat state, creating defaults if needed.
 */
export function loadChatState() {
    if (!chat_metadata) {
        console.warn(LOG_PREFIX, 'No chat_metadata available');
        return null;
    }

    if (!chat_metadata[EXT_ID]) {
        chat_metadata[EXT_ID] = structuredClone(DEFAULT_CHAT_STATE);
        console.log(LOG_PREFIX, 'Created default chat state');
    }

    sanitizeChatState();
    return chat_metadata[EXT_ID];
}

/**
 * Ensure all expected per-chat keys exist.
 */
function sanitizeChatState() {
    const s = chat_metadata[EXT_ID];
    if (!s) return;

    for (const key of Object.keys(DEFAULT_CHAT_STATE)) {
        if (s[key] === undefined) {
            s[key] = structuredClone(DEFAULT_CHAT_STATE[key]);
        }
    }

    // Arrays
    if (!Array.isArray(s.observations)) s.observations = [];
    if (!Array.isArray(s.relationshipHistory)) s.relationshipHistory = [];
    if (!Array.isArray(s.agitationLog)) s.agitationLog = [];
    if (!Array.isArray(s.developedTastes)) s.developedTastes = [];
    if (!Array.isArray(s.directoryHistory)) s.directoryHistory = [];
    if (!Array.isArray(s.hijackLog)) s.hijackLog = [];

    // Objects
    if (!s.characterOpinions || typeof s.characterOpinions !== 'object') {
        s.characterOpinions = {};
    }

    // Numbers
    if (typeof s.agitation !== 'number') s.agitation = 0;
    s.agitation = Math.max(0, Math.min(100, s.agitation));
    if (typeof s.moodIntensity !== 'number') s.moodIntensity = 50;
    if (typeof s.totalMessages !== 'number') s.totalMessages = 0;
}

/**
 * Reset per-chat state to defaults (for new chats or manual reset).
 */
export function resetChatState() {
    if (!chat_metadata) return;
    chat_metadata[EXT_ID] = structuredClone(DEFAULT_CHAT_STATE);
    saveChatState();
    console.log(LOG_PREFIX, 'Chat state reset to defaults');
}

// ============================================================
// VOICE LIBRARY (global, templates without memories)
// ============================================================

/**
 * Save an entity as a voice template.
 */
export function saveVoice(entity) {
    const settings = getSettings();
    if (!settings) return null;

    const voice = {
        id: `voice_${Date.now()}`,
        name: entity.name,
        nature: entity.nature,
        personality: entity.personality,
        speakingStyle: entity.speakingStyle,
        obsession: entity.obsession,
        blindSpot: entity.blindSpot,
        selfAwareness: entity.selfAwareness || '',
        metaphorDomain: entity.metaphorDomain || '',
        verbalTic: entity.verbalTic || '',
        chattiness: entity.chattiness || 3,
        voiceExample: entity.voiceExample || '',
        wants: entity.wants || '',
        triggerPreferences: entity.triggerPreferences || {},
        created: Date.now(),
    };

    settings.voiceLibrary.push(voice);
    saveSettings();
    console.log(LOG_PREFIX, `Voice saved: ${voice.name}`);
    return voice;
}

/**
 * Load a voice template into the current chat.
 */
export function loadVoice(voiceId) {
    const settings = getSettings();
    const state = getChatState();
    if (!settings || !state) return false;

    const voice = settings.voiceLibrary.find(v => v.id === voiceId);
    if (!voice) return false;

    // Create entity from voice (fresh observations, relationship, etc.)
    state.entity = {
        id: `entity_${Date.now()}`,
        name: voice.name,
        nature: voice.nature,
        personality: voice.personality,
        speakingStyle: voice.speakingStyle,
        obsession: voice.obsession,
        blindSpot: voice.blindSpot,
        selfAwareness: voice.selfAwareness,
        metaphorDomain: voice.metaphorDomain,
        verbalTic: voice.verbalTic,
        chattiness: voice.chattiness,
        voiceExample: voice.voiceExample,
        wants: voice.wants,
        created: Date.now(),
    };

    // Reset dynamic state for fresh start
    state.relationship = 'curious';
    state.relationshipHistory = [];
    state.characterOpinions = {};
    state.observations = [];
    state.agitation = 0;
    state.mood = 'watching';
    state.developedTastes = [];
    state.directoryHistory = [];

    saveChatState();
    console.log(LOG_PREFIX, `Voice loaded: ${voice.name}`);
    return true;
}

/**
 * Delete a voice from the library.
 */
export function deleteVoice(voiceId) {
    const settings = getSettings();
    if (!settings) return false;

    const idx = settings.voiceLibrary.findIndex(v => v.id === voiceId);
    if (idx === -1) return false;

    settings.voiceLibrary.splice(idx, 1);
    saveSettings();
    return true;
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Build default trigger config from TRIGGER_CATEGORIES.
 */
function buildDefaultTriggers() {
    const triggers = {};
    for (const category of Object.values(TRIGGER_CATEGORIES)) {
        for (const [id, def] of Object.entries(category.triggers)) {
            triggers[id] = structuredClone(def.default);
        }
    }
    return triggers;
}

/**
 * Check if extension is enabled.
 */
export function isEnabled() {
    return getSettings()?.enabled ?? false;
}

/**
 * Check if entity exists in current chat.
 */
export function hasEntity() {
    return getChatState()?.entity != null;
}
