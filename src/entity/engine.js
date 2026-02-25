/**
 * The Reliquary — Commentary Engine
 * Builds prompts, calls AI, decides when the entity speaks.
 */

import { getContext } from '../../../../../extensions.js';
import { generateRaw } from '../../../../../../script.js';
import { LOG_PREFIX, CHATTINESS } from '../config.js';

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

// ============================================================
// GENERATION — make the API call
// ============================================================

/**
 * Generate commentary using independent connection or fallback.
 */
export async function generateCommentary(state) {
    if (!state?.entity) return null;

    const systemPrompt = buildSystemPrompt(state.entity, state);
    const userPrompt = buildUserPrompt();

    try {
        const response = await callAI(systemPrompt, userPrompt);

        if (!response || response.trim() === '...' || response.trim().length < 3) {
            // Entity chose silence
            return null;
        }

        return cleanResponse(response);
    } catch (err) {
        console.error(LOG_PREFIX, 'Commentary generation failed:', err);
        return null;
    }
}

/**
 * Call AI — tries ConnectionManagerRequestService first, falls back to generateRaw.
 */
async function callAI(systemPrompt, userPrompt) {
    const ctx = getContext();

    // Try independent connection first (doesn't interrupt main chat)
    if (ctx.ConnectionManagerRequestService) {
        try {
            const profileId = getActiveProfileId();
            if (profileId) {
                const response = await ctx.ConnectionManagerRequestService.sendRequest(
                    profileId,
                    [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt },
                    ],
                    300, // Keep responses short
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
            }
        } catch (err) {
            console.warn(LOG_PREFIX, 'ConnectionManager failed, trying fallback:', err.message);
        }
    }

    // Fallback: generateRaw (uses main connection — less ideal but works)
    const combinedPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;
    const result = await generateRaw(combinedPrompt, null, false, false, '', 300);
    return result;
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
