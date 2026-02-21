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
    $('#reliquary-btn-create').on('click', () => {
        // TODO: Phase 2 — voice creation flow
        toastr.info('Voice creation coming in Phase 2!', 'Reliquary');
    });

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
// FAB — Mini Crystal (draggable, color-shifting)
// ============================================================

const FAB_CRYSTAL_SVG = `<svg viewBox="0 0 48 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="fabGlow" cx="50%" cy="40%" r="50%">
      <stop offset="0%" class="reliquary-fab-glow-inner" stop-color="rgba(207,191,162,0.2)"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
  </defs>
  <!-- Glow halo -->
  <ellipse cx="24" cy="28" rx="18" ry="22" fill="url(#fabGlow)" opacity="0.6"/>
  <!-- Crystal facets (simplified) -->
  <polygon class="reliquary-fab-facet" data-shade="light" points="17,4 24,0 31,4 24,9"/>
  <polygon class="reliquary-fab-facet" data-shade="mid" points="17,4 24,9 20,36 9,10"/>
  <polygon class="reliquary-fab-facet" data-shade="light" points="31,4 39,10 28,36 24,9"/>
  <polygon class="reliquary-fab-facet" data-shade="dark" points="9,10 20,36 5,27 4,17"/>
  <polygon class="reliquary-fab-facet" data-shade="mid" points="39,10 44,17 43,27 28,36"/>
  <polygon class="reliquary-fab-facet" data-shade="light" points="20,36 28,36 30,41 24,44 18,41"/>
  <polygon class="reliquary-fab-facet" data-shade="mid" points="5,27 20,36 18,41 14,58 6,39"/>
  <polygon class="reliquary-fab-facet" data-shade="dark" points="43,27 42,39 34,58 30,41 28,36"/>
  <polygon class="reliquary-fab-facet" data-shade="mid" points="18,41 24,44 30,41 34,58 32,64 24,64 16,64 14,58"/>
  <!-- Veins -->
  <line class="reliquary-fab-vein" x1="24" y1="0" x2="24" y2="44"/>
  <line class="reliquary-fab-vein" x1="9" y1="10" x2="39" y2="10"/>
  <line class="reliquary-fab-vein" x1="5" y1="27" x2="43" y2="27"/>
</svg>`;

// Color palettes for FAB lerp
const FAB_COLORS = {
    calm: { // Feathered Host (warm cream) — you, the host
        light: [207, 191, 162],
        mid:   [207, 191, 162],
        dark:  [207, 191, 162],
        edge:  [207, 191, 162],
        glow:  [207, 191, 162],
        lightA: 0.35, midA: 0.2, darkA: 0.1, edgeA: 0.5, glowA: 0.2,
    },
    agitated: { // Veridian (green/gold) — the entity
        light: [155, 127, 54],
        mid:   [155, 127, 54],
        dark:  [80, 120, 60],
        edge:  [155, 127, 54],
        glow:  [155, 127, 54],
        lightA: 0.45, midA: 0.3, darkA: 0.15, edgeA: 0.6, glowA: 0.35,
    },
};

function createFAB() {
    if ($('.reliquary-fab').length) return;

    const settings = getSettings();
    const pos = settings.fabPosition || { top: '80px', right: '12px' };

    const $fab = $(`<button class="reliquary-fab" title="The Reliquary">${FAB_CRYSTAL_SVG}</button>`);
    $fab.css({ top: pos.top, right: pos.right });
    $('body').append($fab);

    $fab.on('click', (e) => {
        // Don't toggle if we just finished dragging
        if ($fab.data('justDragged')) {
            $fab.data('justDragged', false);
            return;
        }
        togglePanel();
    });

    // Apply theme class for FAB colors
    $fab.addClass(`reliquary-theme-${settings.theme}`);

    // Desktop: hide FAB (use drawers or shortcut instead)
    if (window.innerWidth > 1000) {
        $fab.hide();
    }

    // Initialize FAB colors
    updateFABColors();

    // Make draggable
    makeFABDraggable($fab);
}

function makeFABDraggable($fab) {
    let isDragging = false;
    let startX, startY, startLeft, startTop;
    let hasMoved = false;

    const onStart = (e) => {
        const touch = e.touches ? e.touches[0] : e;
        isDragging = true;
        hasMoved = false;

        const rect = $fab[0].getBoundingClientRect();
        startX = touch.clientX;
        startY = touch.clientY;
        startLeft = rect.left;
        startTop = rect.top;

        $fab.addClass('dragging');
        e.preventDefault();
    };

    const onMove = (e) => {
        if (!isDragging) return;
        const touch = e.touches ? e.touches[0] : e;
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;

        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasMoved = true;
        if (!hasMoved) return;

        const newLeft = Math.max(0, Math.min(window.innerWidth - 48, startLeft + dx));
        const newTop = Math.max(0, Math.min(window.innerHeight - 64, startTop + dy));

        $fab.css({
            left: newLeft + 'px',
            top: newTop + 'px',
            right: 'auto',
        });
    };

    const onEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        $fab.removeClass('dragging');

        if (hasMoved) {
            $fab.data('justDragged', true);
            // Save position
            const settings = getSettings();
            settings.fabPosition = {
                top: $fab.css('top'),
                left: $fab.css('left'),
                right: 'auto',
            };
            saveSettings(settings);

            // Reset justDragged after a tick so click doesn't fire
            setTimeout(() => $fab.data('justDragged', false), 300);
        }
    };

    $fab[0].addEventListener('touchstart', onStart, { passive: false });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    $fab[0].addEventListener('mousedown', onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
}

function updateFABColors() {
    const $fab = $('.reliquary-fab');
    if (!$fab.length) return;

    const state = getChatState();
    const agPct = Math.min(1, (state?.agitation || 0) / 100);

    const calm = FAB_COLORS.calm;
    const hot = FAB_COLORS.agitated;

    const lerp = (a, b, t) => Math.round(a + (b - a) * t);
    const lerpA = (a, b, t) => a + (b - a) * t;
    const rgb = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

    const lC = [lerp(calm.light[0], hot.light[0], agPct), lerp(calm.light[1], hot.light[1], agPct), lerp(calm.light[2], hot.light[2], agPct)];
    const mC = [lerp(calm.mid[0], hot.mid[0], agPct), lerp(calm.mid[1], hot.mid[1], agPct), lerp(calm.mid[2], hot.mid[2], agPct)];
    const dC = [lerp(calm.dark[0], hot.dark[0], agPct), lerp(calm.dark[1], hot.dark[1], agPct), lerp(calm.dark[2], hot.dark[2], agPct)];
    const eC = [lerp(calm.edge[0], hot.edge[0], agPct), lerp(calm.edge[1], hot.edge[1], agPct), lerp(calm.edge[2], hot.edge[2], agPct)];
    const gC = [lerp(calm.glow[0], hot.glow[0], agPct), lerp(calm.glow[1], hot.glow[1], agPct), lerp(calm.glow[2], hot.glow[2], agPct)];

    const lA = lerpA(calm.lightA, hot.lightA, agPct);
    const mA = lerpA(calm.midA, hot.midA, agPct);
    const dA = lerpA(calm.darkA, hot.darkA, agPct);
    const eA = lerpA(calm.edgeA, hot.edgeA, agPct);

    $fab.find('.reliquary-fab-facet').each(function() {
        const shade = $(this).attr('data-shade');
        if (shade === 'light') {
            $(this).attr('fill', rgb(lC, lA)).attr('stroke', rgb(eC, eA));
        } else if (shade === 'mid') {
            $(this).attr('fill', rgb(mC, mA)).attr('stroke', rgb(eC, eA));
        } else {
            $(this).attr('fill', rgb(dC, dA)).attr('stroke', rgb(eC, eA));
        }
    });

    $fab.find('.reliquary-fab-vein').each(function() {
        $(this).attr('stroke', rgb(eC, eA * 0.7));
    });

    // Update glow
    $fab.find('.reliquary-fab-glow-inner').attr('stop-color', rgb(gC, lerpA(calm.glowA, hot.glowA, agPct)));
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
            updateFABColors();
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
