/**
 * The Reliquary — Commentary Engine
 * Builds prompts, calls AI, decides when the entity speaks.
 */

import { getContext } from '../../../../../extensions.js';
import { generateRaw } from '../../../../../../script.js';
import { LOG_PREFIX, CHATTINESS } from '../config.js';

// Max tokens for a commentary generation. Commentary itself is only 1-3
// sentences, but reasoning/"thinking" models burn budget planning before they
// answer. If you see finish_reason:'length' or empty replies, raise this.
const COMMENTARY_MAX_TOKENS = 600;

// ============================================================
// SPEAKING ROLL — should the entity talk this message?
// ============================================================

/**
 * Determine if the entity speaks this round.
 * Returns true if entity should generate commentary.
 */
export function shouldSpeak(state) {
    if (!state?.entity) return false;

    const chattiness = state.entity.chattiness || 3;
    const chatDef = CHATTINESS[chattiness] || CHATTINESS[3];
    const [minGap, maxGap] = chatDef.range;

    // How many messages since last commentary?
    const silent = state.silentStreak || 0;

    // Guaranteed speak if silent too long
    if (silent >= maxGap) return true;

    // Never speak if below minimum gap
    if (silent < minGap) return false;

    // Probability ramps up between min and max
    const range = maxGap - minGap;
    const progress = (silent - minGap) / Math.max(range, 1);
    const baseChance = 0.3 + (progress * 0.6); // 30% at min, 90% at max

    // Mood modifiers
    let moodMod = 0;
    const mood = (state.mood || '').toLowerCase();
    if (['agitated', 'angry', 'excited', 'restless', 'hungry'].includes(mood)) {
        moodMod = 0.15;
    } else if (['indifferent', 'dormant', 'withdrawn'].includes(mood)) {
        moodMod = -0.2;
    }

    // Agitation modifier — more agitated = more talkative
    const agitationMod = (state.agitation || 0) / 500; // 0-0.2

    const finalChance = Math.max(0.05, Math.min(0.95, baseChance + moodMod + agitationMod));

    return Math.random() < finalChance;
}

// ============================================================
// PROMPT BUILDER
// ============================================================

/**
 * Build the system prompt for entity commentary.
 */
function buildSystemPrompt(entity, state) {
    const relationship = state.relationship || 'curious';
    const mood = state.mood || 'watching';
    const agitation = state.agitation || 0;

    let prompt = `You are an internal entity — a voice inside the host's head. You are NOT the narrator. You are NOT the AI character in the chat. You are a separate presence that watches the scene and reacts with your own personality.

YOUR IDENTITY:
Name: ${entity.name}
Nature: ${entity.nature || 'Unknown'}
${entity.personality ? `Personality: ${entity.personality}` : ''}
${entity.speakingStyle ? `Speaking Style: ${entity.speakingStyle}` : ''}
${entity.obsession ? `Obsession: ${entity.obsession}` : ''}
${entity.blindSpot ? `Blind Spot: ${entity.blindSpot}` : ''}
${entity.opinionOfYou ? `Opinion of Host: ${entity.opinionOfYou}` : ''}
${entity.wants ? `Wants: ${entity.wants}` : ''}

CURRENT STATE:
Relationship with host: ${relationship}
Current mood: ${mood}
Agitation level: ${agitation}/100${agitation > 60 ? ' (HIGH — you are restless, pushing against containment)' : agitation > 30 ? ' (rising — something is stirring)' : ' (contained)'}`;

    // Add manifestation context
    if (entity.manifestation?.hostPerception) {
        prompt += `\n\nHOW YOU APPEAR: ${entity.manifestation.hostPerception}`;
    }

    // Add observations if any
    if (state.observations?.length > 0) {
        const obsText = state.observations
            .slice(-8)
            .map(o => `- ${o.text}`)
            .join('\n');
        prompt += `\n\nTHINGS YOU'VE NOTICED ABOUT THE HOST:\n${obsText}`;
    }

    // Add developed tastes
    if (state.developedTastes?.length > 0) {
        const tastesText = state.developedTastes.slice(-5).join(', ');
        prompt += `\n\nTHINGS YOU'VE DEVELOPED OPINIONS ABOUT: ${tastesText}`;
    }

    // Add character opinions
    const opinions = Object.entries(state.characterOpinions || {});
    if (opinions.length > 0) {
        const opText = opinions
            .map(([name, data]) => `- ${name}: ${data.state}${data.notes?.length ? ` (${data.notes.join(', ')})` : ''}`)
            .join('\n');
        prompt += `\n\nYOUR OPINIONS OF CHARACTERS:\n${opText}`;
    }

    prompt += `

RULES:
- You are reacting to what just happened in the scene. This is internal commentary only the host hears.
- Stay in character. Use your speaking style consistently.
- Be BRIEF. 1-3 sentences maximum. This is a quick reaction, not a monologue.
- React to what's interesting, threatening, relevant to your obsession, or what the host is doing wrong.
- You may reference past observations if relevant.
- If nothing interesting happened, you may stay silent (respond with just "...").
- Do NOT narrate the scene. Do NOT speak as other characters. Do NOT break character.
- Do NOT use quotation marks around your response. Just speak directly.
- Chattiness level: ${entity.chattiness}/5${entity.chattiness <= 2 ? ' — you speak RARELY and only when it truly matters. Every word is deliberate.' : entity.chattiness >= 4 ? ' — you have opinions about EVERYTHING.' : ''}`;

    // Voice example helps keep the AI on-voice
    if (entity.voiceExample) {
        prompt += `\n\nEXAMPLES OF HOW YOU SPEAK (match this tone and style):\n${entity.voiceExample}`;
    }

    return prompt;
}

/**
 * Build the user prompt with recent chat context.
 */
function buildUserPrompt() {
    const ctx = getContext();
    const chat = ctx.chat || [];

    // Grab last 6 messages for context
    const recent = chat.slice(-6);

    if (recent.length === 0) {
        return 'The scene is quiet. Nothing has happened yet.';
    }

    const lines = recent.map(msg => {
        const name = msg.is_user ? (ctx.name1 || 'User') : (msg.name || ctx.name2 || 'Character');
        const text = (msg.mes || '').substring(0, 600); // Truncate long messages
        return `${name}: ${text}`;
    }).join('\n\n');

    return `Here is what just happened in the scene:\n\n${lines}\n\nReact to this as ${getEntityName()}. Stay in character. Be brief.`;
}

/**
 * Get entity name from current chat state (helper).
 */
function getEntityName() {
    try {
        const ctx = getContext();
        const state = ctx.chat_metadata?.reliquary;
        return state?.entity?.name || 'the entity';
    } catch {
        return 'the entity';
    }
}

/**
 * Get a formatted summary of the recent main-chat scene, for scene-aware
 * commune. Returns '' if nothing has happened yet.
 */
function getSceneContext(limit = 6) {
    const ctx = getContext();
    const chat = ctx.chat || [];
    const recent = chat.slice(-limit);
    if (recent.length === 0) return '';

    return recent.map(msg => {
        const name = msg.is_user ? (ctx.name1 || 'Host') : (msg.name || ctx.name2 || 'Character');
        const text = (msg.mes || '').substring(0, 500);
        return `${name}: ${text}`;
    }).join('\n\n');
}

// ============================================================
// GENERATION — make the API call
// ============================================================

/**
 * Generate commentary using independent connection or fallback.
 */
export async function generateCommentary(state, diag = null) {
    if (!state?.entity) {
        if (diag) diag.error = 'No entity bound.';
        return null;
    }

    const systemPrompt = buildSystemPrompt(state.entity, state);
    const userPrompt = buildUserPrompt();

    try {
        const response = await callAI([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ], diag);

        if (!response || response.trim() === '...' || response.trim().length < 3) {
            // Entity chose silence (or got an empty reply)
            if (diag) diag.silence = true;
            return null;
        }

        return cleanResponse(response);
    } catch (err) {
        if (diag) diag.error = err?.message || String(err);
        console.error(LOG_PREFIX, 'Commentary generation failed:', err);
        return null;
    }
}

/**
 * Diagnostic wrapper — forces a generation and reports EXACTLY what happened,
 * so failures are visible on mobile (no console required).
 * Returns: { ok, text, silence, error, path, hasService, hasProfile }
 */
export async function runDiagnostic(state) {
    const diag = {
        ok: false, text: null, silence: false, error: null,
        path: 'none', hasService: false, hasProfile: false,
    };
    if (!state?.entity) {
        diag.error = 'No entity bound to this chat.';
        return diag;
    }
    const text = await generateCommentary(state, diag);
    if (text) {
        diag.ok = true;
        diag.text = text;
    }
    return diag;
}

// ============================================================
// COMMUNE — direct, scene-aware conversation with the entity
// ============================================================

/**
 * Build the system prompt for a direct 1-on-1 conversation with the entity.
 * Scene-aware: the entity can see what's happening in the main roleplay.
 */
function buildCommunePrompt(entity, state) {
    const relationship = state.relationship || 'curious';
    const mood = state.mood || 'watching';

    let prompt = `You are an entity that lives inside the host's head — a constant presence they can speak to privately. Right now the host has turned their attention inward to talk to you DIRECTLY. This is a private side-conversation, separate from the events of the main story. They speak to you; you answer them, in your own voice.

YOUR IDENTITY:
Name: ${entity.name}
Nature: ${entity.nature || 'Unknown'}
${entity.personality ? `Personality: ${entity.personality}` : ''}
${entity.speakingStyle ? `Speaking Style: ${entity.speakingStyle}` : ''}
${entity.obsession ? `Obsession: ${entity.obsession}` : ''}
${entity.blindSpot ? `Blind Spot: ${entity.blindSpot}` : ''}
${entity.opinionOfYou ? `Opinion of Host: ${entity.opinionOfYou}` : ''}
${entity.wants ? `Wants: ${entity.wants}` : ''}

CURRENT STATE:
Relationship with host: ${relationship}
Current mood: ${mood}`;

    if (entity.manifestation?.hostPerception) {
        prompt += `\n\nHOW YOU APPEAR TO THE HOST: ${entity.manifestation.hostPerception}`;
    }

    if (state.observations?.length > 0) {
        const obsText = state.observations.slice(-8).map(o => `- ${o.text}`).join('\n');
        prompt += `\n\nTHINGS YOU'VE NOTICED ABOUT THE HOST:\n${obsText}`;
    }

    const opinions = Object.entries(state.characterOpinions || {});
    if (opinions.length > 0) {
        const opText = opinions
            .map(([name, data]) => `- ${name}: ${data.state}${data.notes?.length ? ` (${data.notes.join(', ')})` : ''}`)
            .join('\n');
        prompt += `\n\nYOUR OPINIONS OF CHARACTERS:\n${opText}`;
    }

    // Scene awareness — what's happening in the main story right now.
    const scene = getSceneContext(6);
    if (scene) {
        prompt += `\n\nWHAT'S HAPPENING IN THE STORY RIGHT NOW (you can see this; reference it if relevant):\n${scene}`;
    }

    prompt += `

RULES:
- You are talking WITH the host, one-on-one. Respond conversationally, in character, in your own voice and speaking style.
- You are aware of the story above and may bring it up, react to it, or push the host about it — but this conversation itself is private and off-stage.
- Do NOT narrate the scene. Do NOT speak as the other story characters. Do NOT write actions for the host.
- Keep replies natural and fairly short — a few sentences, like real talk. Don't monologue unless the moment calls for it.
- Do NOT wrap your reply in quotation marks. Just speak.
- Stay fully in character as ${entity.name} at all times.`;

    if (entity.voiceExample) {
        prompt += `\n\nEXAMPLES OF HOW YOU SPEAK (match this tone and style):\n${entity.voiceExample}`;
    }

    return prompt;
}

/**
 * Generate the entity's reply in a direct conversation.
 * @param {object} state - chat state (entity + relationship + history)
 * @param {string} userMessage - what the host just said to the entity
 * @param {object} [diag] - optional diagnostics object
 * @returns {Promise<string|null>} the entity's reply, or null on failure
 */
export async function generateCommune(state, userMessage, diag = null) {
    if (!state?.entity) {
        if (diag) diag.error = 'No entity bound.';
        return null;
    }
    if (!userMessage || !userMessage.trim()) return null;

    const systemPrompt = buildCommunePrompt(state.entity, state);

    // Build the conversation: system + recent history + the new message.
    const history = (state.directoryHistory || []).slice(-12);
    const messages = [{ role: 'system', content: systemPrompt }];
    for (const turn of history) {
        const role = turn.role === 'assistant' ? 'assistant' : 'user';
        messages.push({ role, content: turn.text || '' });
    }
    messages.push({ role: 'user', content: userMessage });

    try {
        const response = await callAI(messages, diag);
        if (!response || response.trim().length < 1) {
            if (diag) diag.silence = true;
            return null;
        }
        return cleanResponse(response);
    } catch (err) {
        if (diag) diag.error = err?.message || String(err);
        console.error(LOG_PREFIX, 'Commune generation failed:', err);
        return null;
    }
}

/**
 * Call AI with a full messages array — tries ConnectionManagerRequestService
 * first, falls back to generateRaw. messages = [{role, content}, ...].
 */
async function callAI(messages, diag = null) {
    const ctx = getContext();

    const hasService = !!ctx.ConnectionManagerRequestService;
    const profileId = getActiveProfileId();
    if (diag) { diag.hasService = hasService; diag.hasProfile = !!profileId; }

    // Try independent connection first (doesn't interrupt main chat)
    if (hasService && profileId) {
        try {
            if (diag) diag.path = 'ConnectionManager';
            const response = await ctx.ConnectionManagerRequestService.sendRequest(
                profileId,
                messages,
                COMMENTARY_MAX_TOKENS,
                {
                    extractData: true,
                    includePreset: true,
                    includeInstruct: false,
                },
                {} // No overrides
            );

            if (response?.content) {
                return response.content;
            }
            if (diag) diag.error = 'ConnectionManager returned empty content.';
        } catch (err) {
            if (diag) diag.error = 'ConnectionManager: ' + (err?.message || String(err));
            console.warn(LOG_PREFIX, 'ConnectionManager failed, trying fallback:', err?.message);
        }
    }

    // Fallback: generateRaw (uses main connection — less ideal but works).
    // Flatten the messages into a single prompt for the legacy call.
    try {
        if (diag) diag.path = diag.path === 'ConnectionManager' ? 'ConnectionManager→generateRaw' : 'generateRaw';
        const combinedPrompt = flattenMessages(messages);
        const result = await generateRaw(combinedPrompt, null, false, false, '', COMMENTARY_MAX_TOKENS);
        return result;
    } catch (err) {
        if (diag) diag.error = 'generateRaw: ' + (err?.message || String(err));
        throw err;
    }
}

/**
 * Flatten a messages array into a single transcript string for generateRaw.
 */
function flattenMessages(messages) {
    const parts = [];
    for (const m of messages) {
        if (m.role === 'system') {
            parts.push(m.content);
        } else if (m.role === 'assistant') {
            parts.push(`[Entity]: ${m.content}`);
        } else {
            parts.push(`[Host]: ${m.content}`);
        }
    }
    return parts.join('\n\n---\n\n');
}

/**
 * Get the active connection profile ID.
 */
function getActiveProfileId() {
    try {
        const ctx = getContext();
        const cm = ctx.extensionSettings?.connectionManager;
        return cm?.selectedProfile || null;
    } catch {
        return null;
    }
}

/**
 * Clean up AI response — strip quotes, trim, etc.
 */
function cleanResponse(text) {
    if (!text) return null;

    let cleaned = text.trim();

    // Strip reasoning/thinking blocks some models emit, e.g. <think>...</think>
    // or <thinking>...</thinking>. Keep only what comes after the closing tag.
    cleaned = cleaned.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim();
    // If a model opened a reasoning block but never closed it (cut off), drop it.
    cleaned = cleaned.replace(/<think(?:ing)?>[\s\S]*$/i, '').trim();

    // Strip wrapping quotes
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
        (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
        cleaned = cleaned.slice(1, -1).trim();
    }

    // Strip entity name prefix if AI added it
    // e.g., "Venom: We could eat him" -> "We could eat him"
    cleaned = cleaned.replace(/^[A-Za-z\s]+:\s*/, '');

    // Strip any markdown formatting
    cleaned = cleaned.replace(/\*\*/g, '').replace(/\*/g, '');

    // Cap length — commentary should be brief
    if (cleaned.length > 500) {
        // Find last sentence break before 500
        const cutoff = cleaned.lastIndexOf('.', 500);
        if (cutoff > 200) {
            cleaned = cleaned.substring(0, cutoff + 1);
        } else {
            cleaned = cleaned.substring(0, 500) + '...';
        }
    }

    return cleaned.length > 2 ? cleaned : null;
}
