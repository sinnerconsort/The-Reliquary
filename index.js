/**
 * The Reliquary — Main Entry Point
 * Sleep Token meets Venom meets your 3am conscience.
 */

import {
    getContext,
    extension_settings,
} from '../../../extensions.js';

import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    chat_metadata,
    saveChatDebounced,
} from '../../../../script.js';

import {
    EXT_ID,
    LOG_PREFIX,
    THEMES,
    TRIGGER_CATEGORIES,
    AGITATION,
    CONTROL_MODES,
    PRESET_VOICES,
    ENTITY_NATURES,
} from './src/config.js';

import {
    getSettings,
    saveSettings,
    initSettings,
    getChatState,
    saveChatState,
    loadChatState,
    resetChatState,
    isEnabled,
    hasEntity,
    saveVoice,
    loadVoice,
    deleteVoice,
} from './src/state.js';

// ============================================================
// RUNTIME STATE (not persisted)
// ============================================================

const EXT_PATH = `scripts/extensions/third-party/The-Reliquary`;

async function loadTemplate(name) {
    return await $.get(`${EXT_PATH}/${name}.html`);
}

let crystalAnimFrame = null;
let sloshTime = 0;
let prismaticPhase = 0;
let panelVisible = false;

// ============================================================
// INITIALIZATION
// ============================================================

jQuery(async () => {
    try {
        console.log(LOG_PREFIX, 'Starting initialization...');

        // 1. Init global settings
        initSettings();

        // 2. Add settings panel to Extensions tab
        try {
            await addExtensionSettings();
        } catch (err) {
            console.error(LOG_PREFIX, 'Settings panel failed:', err);
        }

        if (!isEnabled()) {
            console.log(LOG_PREFIX, 'Extension disabled');
            return;
        }

        // 3. Initialize UI
        try {
            await initUI();
        } catch (err) {
            console.error(LOG_PREFIX, 'UI init failed:', err);
            throw err;
        }

        // 4. Register events
        registerEvents();

        // 5. Load per-chat state if chat exists
        const ctx = getContext();
        if (ctx?.chat?.length > 0) {
            loadChatState();
            renderPanel();
        }

        console.log(LOG_PREFIX, '✅ Loaded successfully');

    } catch (err) {
        console.error(LOG_PREFIX, '❌ Critical failure:', err);
        toastr.error(
            'The Reliquary failed to initialize.',
            'Reliquary Error',
            { timeOut: 8000 }
        );
    }
});

// ============================================================
// SETTINGS PANEL (Extensions tab)
// ============================================================

async function addExtensionSettings() {
    const html = await loadTemplate('settings');
    $('#extensions_settings2').append(html);

    const settings = getSettings();

    // Enable toggle
    $('#reliquary-enabled')
        .prop('checked', settings.enabled)
        .on('change', async function () {
            const wasEnabled = settings.enabled;
            settings.enabled = $(this).prop('checked');
            saveSettings();

            if (settings.enabled && !wasEnabled) {
                await initUI();
                loadChatState();
                renderPanel();
            } else if (!settings.enabled && wasEnabled) {
                destroyUI();
            }
        });

    // Theme
    $('#reliquary-theme')
        .val(settings.theme)
        .on('change', function () {
            settings.theme = $(this).val();
            saveSettings();
            applyTheme();
        });

    // Control mode
    $('#reliquary-control-mode')
        .val(settings.controlMode)
        .on('change', function () {
            settings.controlMode = $(this).val();
            saveSettings();
            updateControlModeUI();
        });

    // Custom toggles
    const toggleMap = {
        'reliquary-toggle-sidebar': 'sidebar',
        'reliquary-toggle-directory': 'directory',
        'reliquary-toggle-intrusion': 'intrusion',
        'reliquary-toggle-struggle': 'struggle',
        'reliquary-toggle-possession': 'possession',
    };

    for (const [elemId, key] of Object.entries(toggleMap)) {
        $(`#${elemId}`)
            .prop('checked', settings.customToggles[key])
            .on('change', function () {
                settings.customToggles[key] = $(this).prop('checked');
                saveSettings();
            });
    }

    $('#reliquary-possession-cap')
        .val(settings.customToggles.possessionCap)
        .on('change', function () {
            settings.customToggles.possessionCap = parseInt($(this).val()) || 3;
            saveSettings();
        });

    // Observation settings
    $('#reliquary-obs-freq')
        .val(settings.observationFrequency)
        .on('change', function () {
            settings.observationFrequency = parseInt($(this).val()) || 10;
            saveSettings();
        });

    $('#reliquary-obs-max')
        .val(settings.maxObservations)
        .on('change', function () {
            settings.maxObservations = parseInt($(this).val()) || 20;
            saveSettings();
        });

    updateControlModeUI();
}

function updateControlModeUI() {
    const settings = getSettings();
    const mode = settings.controlMode;

    // Show/hide custom toggles
    $('#reliquary-custom-toggles').toggle(mode === 'custom');

    // Update description
    const desc = CONTROL_MODES[mode]?.desc || '';
    $('#reliquary-control-desc').text(desc);
}

// ============================================================
// MAIN UI
// ============================================================

async function initUI() {
    // Load panel template
    const panelHtml = await loadTemplate('template');
    $('body').append(panelHtml);

    // Apply theme
    applyTheme();

    // Create FAB
    createFAB();

    // Wire tabs
    $('.reliquary-tab').on('click', function () {
        const tab = $(this).data('tab');
        switchTab(tab);
    });

    // Wire create button
    $('#reliquary-btn-create').on('click', openCreationOverlay);

    // Wire library buttons
    $('#reliquary-btn-save-voice').on('click', onSaveVoice);
    $('#reliquary-btn-import-voice').on('click', onImportVoice);
    $('#reliquary-btn-export-voice').on('click', onExportVoice);

    // Start crystal animation
    startCrystalAnimation();

    // Build trigger list
    buildTriggerUI();

    console.log(LOG_PREFIX, 'UI initialized');
}

function destroyUI() {
    if (crystalAnimFrame) {
        cancelAnimationFrame(crystalAnimFrame);
        crystalAnimFrame = null;
    }
    $('#reliquary-panel').remove();
    $('.reliquary-fab').remove();
    panelVisible = false;
    console.log(LOG_PREFIX, 'UI destroyed');
}

// ============================================================
// FAB — Sigil (draggable, pulsing gold)
// ============================================================

function createFAB() {
    if ($('.reliquary-fab').length) return;

    const settings = getSettings();
    const pos = settings.fabPosition || { top: '80px', right: '12px' };

    const $fab = $(`<button class="reliquary-fab" title="The Reliquary">🜃</button>`);

    // Apply saved position
    if (pos.left && pos.left !== 'auto') {
        $fab.css({ top: pos.top, left: pos.left, right: 'auto' });
    } else {
        $fab.css({ top: pos.top, right: pos.right });
    }

    $('body').append($fab);
    $fab.addClass(`reliquary-theme-${settings.theme}`);

    // Desktop: hide FAB
    if (window.innerWidth > 1000) {
        $fab.hide();
    }

    // Drag state
    let startX, startY, startLeft, startTop, hasMoved = false, isDown = false;

    $fab[0].addEventListener('touchstart', onDown, { passive: false });
    $fab[0].addEventListener('mousedown', onDown);
    document.addEventListener('touchmove', onMoveDoc, { passive: false });
    document.addEventListener('mousemove', onMoveDoc);
    document.addEventListener('touchend', onUp);
    document.addEventListener('mouseup', onUp);

    function onDown(e) {
        const pt = e.touches ? e.touches[0] : e;
        isDown = true;
        hasMoved = false;
        const rect = $fab[0].getBoundingClientRect();
        startX = pt.clientX;
        startY = pt.clientY;
        startLeft = rect.left;
        startTop = rect.top;
    }

    function onMoveDoc(e) {
        if (!isDown) return;
        const pt = e.touches ? e.touches[0] : e;
        const dx = pt.clientX - startX;
        const dy = pt.clientY - startY;

        if (!hasMoved && Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        hasMoved = true;
        $fab.addClass('dragging');
        e.preventDefault();

        const newLeft = Math.max(0, Math.min(window.innerWidth - 56, startLeft + dx));
        const newTop = Math.max(0, Math.min(window.innerHeight - 56, startTop + dy));
        $fab.css({ left: newLeft + 'px', top: newTop + 'px', right: 'auto' });
    }

    function onUp() {
        if (!isDown) return;
        isDown = false;
        $fab.removeClass('dragging');

        if (hasMoved) {
            // Save position
            const s = getSettings();
            s.fabPosition = { top: $fab.css('top'), left: $fab.css('left'), right: 'auto' };
            saveSettings(s);
        } else {
            // It was a tap/click — toggle panel
            togglePanel();
        }
    }

    // Initialize agitation visual state
    updateFABState();
}

function updateFABState() {
    const $fab = $('.reliquary-fab');
    if (!$fab.length) return;

    const state = getChatState();
    const ag = state?.agitation || 0;

    $fab.removeClass('fab-agitated fab-danger');
    if (ag >= 75) {
        $fab.addClass('fab-danger');
    } else if (ag >= 35) {
        $fab.addClass('fab-agitated');
    }
}

function togglePanel() {
    panelVisible = !panelVisible;
    $('#reliquary-panel').toggle(panelVisible);

    if (panelVisible) {
        renderPanel();
    }
}

// ============================================================
// THEME
// ============================================================

function applyTheme() {
    const settings = getSettings();
    const theme = settings.theme || 'feathered';

    const $panel = $('#reliquary-panel');
    $panel.removeClass('reliquary-theme-veridian reliquary-theme-feathered');
    $panel.addClass(`reliquary-theme-${theme}`);

    // Update creed text based on theme
    const T = THEMES[theme] || THEMES.feathered;
    $('#reliquary-creed').text(T.creed.toUpperCase());

    // Update FAB theme too
    $('.reliquary-fab')
        .removeClass('reliquary-theme-veridian reliquary-theme-feathered')
        .addClass(`reliquary-theme-${theme}`);
}

// ============================================================
// TABS
// ============================================================

function switchTab(tabId) {
    const settings = getSettings();
    settings.activeTab = tabId;
    saveSettings();

    $('.reliquary-tab').removeClass('active');
    $(`.reliquary-tab[data-tab="${tabId}"]`).addClass('active');

    $('.reliquary-tab-pane').removeClass('active');
    $(`#reliquary-pane-${tabId}`).addClass('active');
}

// ============================================================
// PANEL RENDERING
// ============================================================

function renderPanel() {
    const state = getChatState();
    if (!state) return;

    renderHeader(state);
    renderStatus(state);
    renderEntityTab(state);
    renderTriggersTab(state);
    renderSidebarTab(state);
    renderLibraryTab();
}

function renderHeader(state) {
    if (state.entity) {
        $('#reliquary-empty-state').hide();
        $('#reliquary-entity-info').show();
        $('#reliquary-entity-name').text(state.entity.name);
        $('#reliquary-entity-nature').text(`${state.entity.nature || 'Unknown'}`);
        $('#reliquary-tag-mood').text(state.mood || 'watching');
        $('#reliquary-tag-relationship').text(state.relationship || 'curious');
    } else {
        $('#reliquary-entity-info').hide();
        $('#reliquary-empty-state').show();
    }
}

function renderStatus(state) {
    const ag = state.agitation || 0;
    let text = 'AWAITING';
    if (state.entity) {
        if (ag < 15) text = 'C O N T A I N E D';
        else if (ag < 35) text = 'R E S T L E S S';
        else if (ag < 55) text = 'S T R A I N I N G';
        else if (ag < 75) text = 'S T R U G G L I N G';
        else if (ag < 90) text = 'B R E A K I N G';
        else text = 'U N B O U N D';
    }
    $('#reliquary-status-line').text(text);
}

function renderEntityTab(state) {
    // Observations
    const $obs = $('#reliquary-observations');
    $obs.empty();
    if (state.observations.length === 0) {
        $obs.html('<div class="reliquary-empty-subtle">Entity has not formed observations yet.</div>');
    } else {
        state.observations.forEach(o => {
            const permClass = o.permanent ? ' permanent' : '';
            $obs.append(`
                <div class="reliquary-observation${permClass}">
                    <div class="obs-type">${o.type || 'behavioral'}</div>
                    ${o.text}
                </div>
            `);
        });
    }

    // Character opinions
    const $opinions = $('#reliquary-opinions');
    $opinions.empty();
    const chars = Object.entries(state.characterOpinions || {});
    if (chars.length === 0) {
        $opinions.html('<div class="reliquary-empty-subtle">No characters encountered yet.</div>');
    } else {
        chars.forEach(([name, data]) => {
            const notes = (data.notes || []).join(' · ');
            $opinions.append(`
                <div class="reliquary-opinion">
                    <div class="reliquary-opinion-name">${name}</div>
                    <div class="reliquary-opinion-state">${data.state || 'unknown'}</div>
                    ${notes ? `<div class="reliquary-opinion-notes">${notes}</div>` : ''}
                </div>
            `);
        });
    }

    // Developed tastes
    const $tastes = $('#reliquary-tastes');
    $tastes.empty();
    if (!state.developedTastes?.length) {
        $tastes.html('<div class="reliquary-empty-subtle">Entity has not formed preferences yet.</div>');
    } else {
        state.developedTastes.forEach(t => {
            $tastes.append(`<div class="reliquary-observation">${t}</div>`);
        });
    }
}

function renderTriggersTab(state) {
    const ag = state.agitation || 0;
    $('#reliquary-agitation-fill').css({
        width: `${ag}%`,
        background: ag > 75 ? 'rgba(180,50,50,0.7)' :
                    ag > 50 ? 'rgba(180,120,50,0.6)' :
                    'var(--rel-accent-dim)',
    });
    $('#reliquary-agitation-value').text(ag);
}

function renderSidebarTab(state) {
    const $log = $('#reliquary-commentary-log');
    $log.empty();
    if (!state.lastCommentary) {
        $log.html('<div class="reliquary-empty-subtle">Silence.</div>');
    } else {
        $log.html(`<div class="reliquary-commentary-entry">${state.lastCommentary}</div>`);
    }
}

function renderLibraryTab() {
    const settings = getSettings();
    const $list = $('#reliquary-voice-list');
    $list.empty();

    if (!settings.voiceLibrary?.length) {
        $list.html('<div class="reliquary-empty-subtle">No voices saved yet.</div>');
        return;
    }

    settings.voiceLibrary.forEach(voice => {
        const $card = $(`
            <div class="reliquary-voice-card" data-voice-id="${voice.id}">
                <div class="reliquary-voice-card-name">${voice.name}</div>
                <div class="reliquary-voice-card-nature">${voice.nature || 'Unknown'}</div>
            </div>
        `);
        $card.on('click', () => {
            if (loadVoice(voice.id)) {
                renderPanel();
                toastr.success(`Loaded voice: ${voice.name}`, 'Reliquary');
            }
        });
        $list.append($card);
    });
}

// ============================================================
// VOICE CREATION OVERLAY
// ============================================================

function openCreationOverlay() {
    // Hide main content, show creation container
    $('#reliquary-main-content').hide();
    const $container = $('#reliquary-creation-container');
    $container.empty().html(buildChoiceScreen()).show();

    // Scroll panel to top
    $('#reliquary-panel').scrollTop(0);
    $('#reliquary-panel').closest('.scrollableInner, .drawer-content, [class*="scroll"]').scrollTop(0);
}

function closeCreationOverlay() {
    $('#reliquary-creation-container').hide().empty();
    $('#reliquary-main-content').show();
}

function buildChoiceScreen() {
    let presetCards = '';
    for (const p of PRESET_VOICES) {
        presetCards += `
            <div class="rel-preset-card" data-preset-id="${p.id}">
                <div class="rel-preset-card-name">${p.name}</div>
                <div class="rel-preset-card-source">${p.source}</div>
                <div class="rel-preset-card-hook">${p.hook}</div>
                <div class="rel-preset-card-meta">
                    <span class="rel-preset-tag">${p.nature}</span>
                    <span class="rel-preset-tag">${p.manifestationType}</span>
                    <span class="rel-preset-tag">CHAT ${p.chattiness}/5</span>
                </div>
            </div>
        `;
    }

    const html = `
        <div class="rel-creation-header">
            <div class="rel-creation-title">◇ CREATE VOICE</div>
            <button class="rel-creation-close" data-action="close">✕</button>
        </div>
        <div class="rel-creation-body">
            <div class="rel-creation-section">CHOOSE A PRESET</div>
            <div class="rel-preset-grid">${presetCards}</div>

            <div class="rel-creation-section" style="margin-top:28px">FORGE YOUR OWN</div>
            <div class="rel-create-options">
                <div class="rel-create-option" data-action="editor">
                    <div class="rel-create-option-name">MANUAL CREATION</div>
                    <div class="rel-create-option-desc">Fill in each field yourself. Full control.</div>
                </div>
            </div>
        </div>
    `;

    // Wire events after a tick (needs to be in DOM)
    setTimeout(() => wireChoiceEvents(), 10);
    return html;
}

function wireChoiceEvents() {
    const $c = $('#reliquary-creation-container');

    // Close button
    $c.on('click', '[data-action="close"]', closeCreationOverlay);

    // Preset cards
    $c.on('click', '.rel-preset-card', function () {
        const presetId = $(this).data('preset-id');
        const preset = PRESET_VOICES.find(p => p.id === presetId);
        if (preset) showPresetPreview(preset);
    });

    // Manual editor
    $c.on('click', '[data-action="editor"]', showEntityEditor);
}

function showPresetPreview(preset) {
    const $c = $('#reliquary-creation-container');

    // Escape voice examples for display
    const voiceHtml = preset.voiceExample.replace(/\n/g, '<br>');

    $c.html(`
        <div class="rel-creation-header">
            <div class="rel-creation-title">◇ PREVIEW</div>
            <button class="rel-creation-close" data-action="close">✕</button>
        </div>
        <div class="rel-creation-body">
            <div class="rel-preview-name">${preset.name}</div>
            <div class="rel-preview-source">${preset.source} · ${preset.nature} · ${preset.manifestationType}</div>

            <div class="rel-preview-divider">✦ ◆ ✦</div>

            <div class="rel-preview-field">
                <div class="rel-preview-label">PERSONALITY</div>
                <div class="rel-preview-text">${preset.personality}</div>
            </div>

            <div class="rel-preview-field">
                <div class="rel-preview-label">SPEAKING STYLE</div>
                <div class="rel-preview-text">${preset.speakingStyle}</div>
            </div>

            <div class="rel-preview-field">
                <div class="rel-preview-label">OBSESSION</div>
                <div class="rel-preview-text">${preset.obsession}</div>
            </div>

            <div class="rel-preview-field">
                <div class="rel-preview-label">BLIND SPOT</div>
                <div class="rel-preview-text">${preset.blindSpot}</div>
            </div>

            <div class="rel-preview-field">
                <div class="rel-preview-label">OPINION OF YOU</div>
                <div class="rel-preview-text">${preset.opinionOfYou}</div>
            </div>

            <div class="rel-preview-field">
                <div class="rel-preview-label">WANTS</div>
                <div class="rel-preview-text">${preset.wants}</div>
            </div>

            <div class="rel-preview-field">
                <div class="rel-preview-label">HOW IT APPEARS</div>
                <div class="rel-preview-text">${preset.manifestation.hostPerception}</div>
            </div>

            <div class="rel-preview-field">
                <div class="rel-preview-label">VOICE EXAMPLE</div>
                <div class="rel-preview-voice">${voiceHtml}</div>
            </div>

            <button class="rel-btn-bind" data-action="bind-preset" data-preset-id="${preset.id}">
                ◇ BIND THIS ENTITY ◇
            </button>
            <button class="rel-btn-back" data-action="back-to-choice">← BACK</button>
        </div>
    `);

    // Wire events
    $c.off('click.preview').on('click.preview', '[data-action="bind-preset"]', function () {
        bindPresetEntity($(this).data('preset-id'));
    });
    $c.on('click.preview', '[data-action="back-to-choice"]', () => {
        $c.html(buildChoiceScreen());
    });
    $c.on('click.preview', '[data-action="close"]', closeCreationOverlay);

    // Scroll to top
    $c.scrollTop(0);
    $('#reliquary-panel').scrollTop(0);
    $('#reliquary-panel').closest('.scrollableInner, .drawer-content, [class*="scroll"]').scrollTop(0);
}

function showEntityEditor(existingData) {
    const $c = $('#reliquary-creation-container');
    const d = existingData || {};

    const natureOptions = (ENTITY_NATURES || []).map(n =>
        `<option value="${n.id}" ${d.nature === n.id ? 'selected' : ''}>${n.label} — ${n.desc}</option>`
    ).join('');

    const manifOptions = ['apparition', 'symbiote', 'vessel', 'impulse'].map(m =>
        `<option value="${m}" ${d.manifestationType === m ? 'selected' : ''}>${m.charAt(0).toUpperCase() + m.slice(1)}</option>`
    ).join('');

    $c.html(`
        <div class="rel-creation-header">
            <div class="rel-creation-title">◇ FORGE ENTITY</div>
            <button class="rel-creation-close" data-action="close">✕</button>
        </div>
        <div class="rel-creation-body">
            <div class="rel-editor-row">
                <div class="rel-editor-field">
                    <label class="rel-editor-label">NAME</label>
                    <input class="rel-editor-input" id="rel-ed-name" placeholder="What does it call itself?" value="${d.name || ''}">
                </div>
            </div>

            <div class="rel-editor-row">
                <div class="rel-editor-field">
                    <label class="rel-editor-label">NATURE</label>
                    <select class="rel-editor-select" id="rel-ed-nature">
                        <option value="">Choose...</option>
                        ${natureOptions}
                    </select>
                </div>
                <div class="rel-editor-field">
                    <label class="rel-editor-label">MANIFESTATION</label>
                    <select class="rel-editor-select" id="rel-ed-manifest">
                        <option value="">Choose...</option>
                        ${manifOptions}
                    </select>
                </div>
            </div>

            <div class="rel-editor-field">
                <label class="rel-editor-label">PERSONALITY</label>
                <textarea class="rel-editor-textarea" id="rel-ed-personality" rows="4" placeholder="How does it think? What drives it?">${d.personality || ''}</textarea>
            </div>

            <div class="rel-editor-field">
                <label class="rel-editor-label">SPEAKING STYLE</label>
                <textarea class="rel-editor-textarea" id="rel-ed-style" rows="3" placeholder="How does it talk? Short sentences? Formal? Pet names?">${d.speakingStyle || ''}</textarea>
            </div>

            <div class="rel-editor-field">
                <label class="rel-editor-label">OBSESSION</label>
                <textarea class="rel-editor-textarea" id="rel-ed-obsession" rows="2" placeholder="What does it fixate on? What does it always come back to?">${d.obsession || ''}</textarea>
            </div>

            <div class="rel-editor-field">
                <label class="rel-editor-label">BLIND SPOT</label>
                <textarea class="rel-editor-textarea" id="rel-ed-blind" rows="2" placeholder="What can it NOT see clearly about itself?">${d.blindSpot || ''}</textarea>
            </div>

            <div class="rel-editor-field">
                <label class="rel-editor-label">OPINION OF YOU</label>
                <textarea class="rel-editor-textarea" id="rel-ed-opinion" rows="2" placeholder="How does it feel about the host?">${d.opinionOfYou || ''}</textarea>
            </div>

            <div class="rel-editor-field">
                <label class="rel-editor-label">WANTS</label>
                <textarea class="rel-editor-textarea" id="rel-ed-wants" rows="2" placeholder="What does it want? What's its goal?">${d.wants || ''}</textarea>
            </div>

            <div class="rel-editor-row">
                <div class="rel-editor-field">
                    <label class="rel-editor-label">CHATTINESS (1-5)</label>
                    <input class="rel-editor-input" id="rel-ed-chat" type="number" min="1" max="5" value="${d.chattiness || 3}">
                    <div class="rel-editor-hint">1 = near-silent, 5 = never shuts up</div>
                </div>
            </div>

            <div class="rel-editor-field">
                <label class="rel-editor-label">VOICE EXAMPLE</label>
                <textarea class="rel-editor-textarea" id="rel-ed-voice" rows="4" placeholder="Write 2-3 lines in its voice...">${d.voiceExample || ''}</textarea>
            </div>

            <div class="rel-creation-section">MANIFESTATION</div>

            <div class="rel-editor-field">
                <label class="rel-editor-label">HOW IT APPEARS TO YOU</label>
                <textarea class="rel-editor-textarea" id="rel-ed-host-percep" rows="2" placeholder="What do you see/feel when it's present?">${d.manifestation?.hostPerception || ''}</textarea>
            </div>

            <div class="rel-editor-field">
                <label class="rel-editor-label">DURING POSSESSION</label>
                <textarea class="rel-editor-textarea" id="rel-ed-possess-desc" rows="2" placeholder="What changes when it takes the wheel?">${d.manifestation?.possessionDesc || ''}</textarea>
            </div>

            <button class="rel-btn-bind" data-action="bind-custom">
                ◇ BIND THIS ENTITY ◇
            </button>
            <button class="rel-btn-back" data-action="back-to-choice">← BACK</button>
        </div>
    `);

    // Wire events
    $c.off('click.editor').on('click.editor', '[data-action="bind-custom"]', bindCustomEntity);
    $c.on('click.editor', '[data-action="back-to-choice"]', () => {
        $c.html(buildChoiceScreen());
    });
    $c.on('click.editor', '[data-action="close"]', closeCreationOverlay);

    // Scroll to top
    $c.scrollTop(0);
    $('#reliquary-panel').scrollTop(0);
    $('#reliquary-panel').closest('.scrollableInner, .drawer-content, [class*="scroll"]').scrollTop(0);
}

function bindPresetEntity(presetId) {
    const preset = PRESET_VOICES.find(p => p.id === presetId);
    if (!preset) return;

    const state = getChatState();
    if (!state) return;

    state.entity = {
        id: `entity_${Date.now()}`,
        name: preset.name,
        nature: preset.nature,
        personality: preset.personality,
        speakingStyle: preset.speakingStyle,
        obsession: preset.obsession,
        blindSpot: preset.blindSpot,
        opinionOfYou: preset.opinionOfYou,
        wants: preset.wants,
        chattiness: preset.chattiness,
        voiceExample: preset.voiceExample,
        manifestationType: preset.manifestationType,
        manifestation: structuredClone(preset.manifestation),
        triggerPreferences: structuredClone(preset.triggerPreferences),
        source: preset.source,
        presetId: preset.id,
        created: Date.now(),
    };

    // Set default relationship/mood from preset
    state.relationship = preset.defaultRelationship || 'curious';
    state.mood = preset.defaultMood || 'watching';

    // Apply trigger preferences
    const settings = getSettings();
    if (preset.triggerPreferences) {
        for (const [key, val] of Object.entries(preset.triggerPreferences)) {
            if (settings.triggers[key]) {
                settings.triggers[key] = structuredClone(val);
            }
        }
        saveSettings();
    }

    // Reset dynamic state
    state.characterOpinions = {};
    state.observations = [];
    state.agitation = 0;
    state.developedTastes = [];
    state.directoryHistory = [];

    saveChatState();

    closeCreationOverlay();
    renderPanel();
    toastr.success(`${preset.name} bound to this chat.`, 'The Reliquary');
    console.log(LOG_PREFIX, `Preset bound: ${preset.name}`);
}

function bindCustomEntity() {
    const name = $('#rel-ed-name').val().trim();
    if (!name) {
        toastr.warning('The entity needs a name.', 'Reliquary');
        return;
    }

    const state = getChatState();
    if (!state) return;

    state.entity = {
        id: `entity_${Date.now()}`,
        name: name,
        nature: $('#rel-ed-nature').val() || 'custom',
        personality: $('#rel-ed-personality').val().trim(),
        speakingStyle: $('#rel-ed-style').val().trim(),
        obsession: $('#rel-ed-obsession').val().trim(),
        blindSpot: $('#rel-ed-blind').val().trim(),
        opinionOfYou: $('#rel-ed-opinion').val().trim(),
        wants: $('#rel-ed-wants').val().trim(),
        chattiness: parseInt($('#rel-ed-chat').val()) || 3,
        voiceExample: $('#rel-ed-voice').val().trim(),
        manifestationType: $('#rel-ed-manifest').val() || 'apparition',
        manifestation: {
            hostPerception: $('#rel-ed-host-percep').val().trim(),
            possessionDesc: $('#rel-ed-possess-desc').val().trim(),
            externalTells: '',
            sensorySignature: '',
        },
        created: Date.now(),
    };

    state.relationship = 'curious';
    state.mood = 'watching';
    state.characterOpinions = {};
    state.observations = [];
    state.agitation = 0;
    state.developedTastes = [];
    state.directoryHistory = [];

    saveChatState();

    closeCreationOverlay();
    renderPanel();
    toastr.success(`${name} bound to this chat.`, 'The Reliquary');
    console.log(LOG_PREFIX, `Custom entity bound: ${name}`);
}

// ============================================================
// TRIGGER UI BUILDER
// ============================================================

function buildTriggerUI() {
    const settings = getSettings();
    const $list = $('#reliquary-trigger-list');
    $list.empty();

    for (const [catId, cat] of Object.entries(TRIGGER_CATEGORIES)) {
        const $cat = $(`
            <div class="reliquary-trigger-category">
                <div class="reliquary-trigger-category-label">${cat.label}</div>
            </div>
        `);

        for (const [trigId, trigDef] of Object.entries(cat.triggers)) {
            const trigState = settings.triggers[trigId] || trigDef.default;

            const $row = $(`
                <div class="reliquary-trigger-row">
                    <input type="checkbox" class="reliquary-trigger-toggle"
                           data-trigger="${trigId}"
                           ${trigState.enabled ? 'checked' : ''}>
                    <span class="reliquary-trigger-name">${trigDef.label}</span>
                    <input type="range" class="reliquary-trigger-slider"
                           data-trigger="${trigId}"
                           min="1" max="5" value="${trigState.sensitivity || 3}">
                    <span class="reliquary-trigger-sens">${trigState.sensitivity || 3}</span>
                </div>
            `);

            // Wire toggle
            $row.find('.reliquary-trigger-toggle').on('change', function () {
                settings.triggers[trigId].enabled = $(this).prop('checked');
                saveSettings();
            });

            // Wire slider
            $row.find('.reliquary-trigger-slider').on('input', function () {
                const val = parseInt($(this).val());
                settings.triggers[trigId].sensitivity = val;
                $row.find('.reliquary-trigger-sens').text(val);
                saveSettings();
            });

            $cat.append($row);
        }

        $list.append($cat);
    }
}

// ============================================================
// VOICE LIBRARY ACTIONS
// ============================================================

function onSaveVoice() {
    const state = getChatState();
    if (!state?.entity) {
        toastr.warning('No entity to save.', 'Reliquary');
        return;
    }

    const voice = saveVoice(state.entity);
    if (voice) {
        toastr.success(`Saved: ${voice.name}`, 'Reliquary');
        renderLibraryTab();
    }
}

function onExportVoice() {
    const settings = getSettings();
    if (!settings.voiceLibrary?.length) {
        toastr.warning('No voices to export.', 'Reliquary');
        return;
    }

    const json = JSON.stringify(settings.voiceLibrary, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'reliquary-voices.json';
    a.click();
    URL.revokeObjectURL(url);
    toastr.success('Voices exported.', 'Reliquary');
}

function onImportVoice() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        try {
            const file = e.target.files[0];
            if (!file) return;
            const text = await file.text();
            const voices = JSON.parse(text);

            if (!Array.isArray(voices)) {
                toastr.error('Invalid voice file.', 'Reliquary');
                return;
            }

            const settings = getSettings();
            let count = 0;
            voices.forEach(v => {
                if (v.name && v.nature) {
                    v.id = `voice_${Date.now()}_${count}`;
                    settings.voiceLibrary.push(v);
                    count++;
                }
            });

            saveSettings();
            renderLibraryTab();
            toastr.success(`Imported ${count} voice(s).`, 'Reliquary');
        } catch (err) {
            console.error(LOG_PREFIX, 'Import failed:', err);
            toastr.error('Failed to import voices.', 'Reliquary');
        }
    };
    input.click();
}

// ============================================================
// CRYSTAL ANIMATION
// ============================================================

function startCrystalAnimation() {
    if (crystalAnimFrame) return;

    let lastTime = performance.now();

    function animate(now) {
        const dt = now - lastTime;
        lastTime = now;
        crystalAnimFrame = requestAnimationFrame(animate);

        // Only animate if panel is visible
        if (!panelVisible) return;

        const settings = getSettings();
        const state = getChatState();
        const agPct = (state?.agitation || 0) / 100;
        const T = THEMES[settings.theme] || THEMES.veridian;

        const rgb = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
        const lerp = (a, b, t) => a + (b - a) * t;
        const lerpC = (a, b, t) => [
            Math.round(lerp(a[0], b[0], t)),
            Math.round(lerp(a[1], b[1], t)),
            Math.round(lerp(a[2], b[2], t)),
        ];

        // Facet shading
        document.querySelectorAll('.reliquary-facet').forEach(el => {
            const shade = el.dataset.shade;
            const C = T.crystal;
            let fillAlpha, darken;

            if (shade === 'light') { fillAlpha = C.light; darken = 1; }
            else if (shade === 'mid') { fillAlpha = C.mid; darken = 0.84; }
            else { fillAlpha = C.dark; darken = 1 - C.darkOverlay * 4; }

            const r = Math.round(T.accent[0] * darken);
            const g = Math.round(T.accent[1] * darken);
            const b_ = Math.round(T.accent[2] * darken);
            el.setAttribute('fill', `rgba(${r},${g},${b_},${fillAlpha})`);
            el.setAttribute('stroke', rgb(T.accent, C.edgeAlpha));
        });

        // Veins
        document.querySelectorAll('.reliquary-vein').forEach(v => {
            v.setAttribute('stroke', rgb(T.accent, T.crystal.veinAlpha));
        });

        // Fill (bleed color rising)
        const fillY = 200 - agPct * 200;
        const fillAlpha = 0.05 + agPct * 0.22;
        const bleedCol = lerpC(T.bleed, T.bleedWarm, Math.sin(now * 0.0005) * 0.5 + 0.5);

        const fillRect = document.querySelector('.reliquary-fill-rect');
        if (fillRect) {
            fillRect.setAttribute('y', fillY - 12);
            fillRect.setAttribute('height', 220 - fillY + 12);
            fillRect.setAttribute('fill', rgb(bleedCol, fillAlpha));
        }

        // Slosh waves
        const speed = 0.0008 + (agPct * 0.008);
        const amp = 1.5 + (agPct * 8);
        sloshTime += dt * speed;

        const wave1 = document.querySelector('.reliquary-wave-1');
        const wave2 = document.querySelector('.reliquary-wave-2');

        if (wave1) {
            let d1 = `M -10 ${fillY}`;
            for (let x = -10; x <= 110; x += 3) {
                const w = Math.sin(x * 0.07 + sloshTime) * amp +
                          Math.sin(x * 0.11 + sloshTime * 1.4) * (amp * 0.4);
                d1 += ` L ${x} ${fillY + w}`;
            }
            d1 += ` L 110 210 L -10 210 Z`;
            wave1.setAttribute('d', d1);
            wave1.setAttribute('fill', rgb(bleedCol, 0.06 + agPct * 0.10));
        }

        if (wave2) {
            let d2 = `M -10 ${fillY}`;
            for (let x = -10; x <= 110; x += 3) {
                const w = Math.sin(x * 0.09 + sloshTime * 0.6 + 2) * (amp * 0.6) +
                          Math.sin(x * 0.05 + sloshTime * 1.2) * (amp * 0.35);
                d2 += ` L ${x} ${fillY + w + 3}`;
            }
            d2 += ` L 110 210 L -10 210 Z`;
            wave2.setAttribute('d', d2);
            wave2.setAttribute('fill', rgb(bleedCol, 0.04 + agPct * 0.06));
        }

        // Prismatic shimmer
        prismaticPhase += dt * 0.00008;
        const shimmer = document.querySelector('.reliquary-shimmer');
        if (shimmer) {
            const tx = Math.sin(prismaticPhase) * 40;
            const ty = Math.cos(prismaticPhase * 0.6) * 30;
            shimmer.setAttribute('transform', `translate(${tx}, ${ty})`);

            const prisAlpha = agPct < 0.5
                ? 0.25 + agPct * 0.5
                : 0.5 - (agPct - 0.5) * 0.3;
            shimmer.setAttribute('opacity', prisAlpha);
        }

        // Prismatic gradient hue shift
        const hueShift = now * 0.0001;
        document.querySelectorAll('.reliquary-pris-0').forEach(el =>
            el.setAttribute('stop-color', `hsla(${200 + Math.sin(hueShift) * 30}, 40%, 70%, 0.06)`));
        document.querySelectorAll('.reliquary-pris-1').forEach(el =>
            el.setAttribute('stop-color', `hsla(${45 + Math.sin(hueShift * 1.3) * 20}, 50%, 65%, 0.08)`));
        document.querySelectorAll('.reliquary-pris-2').forEach(el =>
            el.setAttribute('stop-color', `hsla(${330 + Math.sin(hueShift * 0.8) * 25}, 35%, 70%, 0.05)`));
        document.querySelectorAll('.reliquary-pris-3').forEach(el =>
            el.setAttribute('stop-color', `hsla(${160 + Math.sin(hueShift * 1.1) * 20}, 35%, 65%, 0.04)`));

        // Runes — bright host color
        const runeAlpha = 0.6 + agPct * 0.35;
        document.querySelectorAll('.reliquary-rune').forEach(r => {
            r.setAttribute('fill', rgb(T.accentBright, runeAlpha));
        });

        // Update FAB crystal colors (throttled — every ~500ms)
        if (!animate._lastFab || now - animate._lastFab > 500) {
            animate._lastFab = now;
            updateFABState();
        }
    }

    crystalAnimFrame = requestAnimationFrame(animate);
}

// ============================================================
// EVENT HANDLERS
// ============================================================

function registerEvents() {
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.MESSAGE_SENT, onMessageSent);

    console.log(LOG_PREFIX, 'Events registered');
}

function onChatChanged() {
    console.log(LOG_PREFIX, 'Chat changed');
    loadChatState();
    renderPanel();
}

function onMessageReceived() {
    if (!isEnabled()) return;

    const state = getChatState();
    if (!state || !state.entity) return;

    // Increment counters
    state.totalMessages++;
    state.messagesSinceLastObservation++;
    state.messagesSinceLastHijack++;

    // TODO Phase 3: Run classifier
    // TODO Phase 3: Generate sidebar commentary
    // TODO Phase 4: Run observation synthesis
    // TODO Phase 5: Relationship drift
    // TODO Phase 6: Hijack check

    saveChatState();
    renderPanel();
}

function onMessageSent() {
    if (!isEnabled()) return;

    // TODO Phase 6: Intercept for hijack check

    const state = getChatState();
    if (state) {
        saveChatState();
    }
}

// ============================================================
// EXPOSE FOR DEBUGGING (mobile/Termux)
// ============================================================

window.Reliquary = {
    getSettings,
    getChatState,
    renderPanel,
    togglePanel,
    resetChatState,
    version: '0.1.0',
};
