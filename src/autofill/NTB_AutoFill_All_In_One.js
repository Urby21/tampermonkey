// ==UserScript==
// @name         NTB_AutoFill_All_In_One
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  AutoFill (phone, email, ID card, secondary doc, additional info, AML)
// @author       Vojtěch Urban (enhanced)
// @match        https://ppe-aplikace.moneta.cz/smeonboarding/*
// @match        https://test1-aplikace.moneta.cz/smeonboarding/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_KEY = '__IBAF_NTB_AUTOFILL_RUNTIME__';
    const previousRuntime = window[SCRIPT_KEY];
    if (previousRuntime && typeof previousRuntime.destroy === 'function') {
        try {
            previousRuntime.destroy({ silent: true, reason: 'reinit' });
        } catch (e) {
            console.warn('[IBAF] Nepodařilo se odinstalovat předchozí AutoFill runtime.', e);
        }
    }

    const cleanupFns = [];
    function registerCleanup(fn) {
        if (typeof fn === 'function') cleanupFns.push(fn);
        return fn;
    }
    function runCleanups() {
        while (cleanupFns.length) {
            const fn = cleanupFns.pop();
            try { fn(); } catch (e) { console.warn('[IBAF] Cleanup chyba:', e); }
        }
    }
    function removeElementById(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    }

    const DEBUG = false;

    const DEFAULT_PHONE_NUMBER = '720867165';
    const DEFAULT_EMAIL_ADDRESS = '212628467@moneta.cz';

    const DEFAULT_ID_CARD_DATA = {
        firstName: '', lastName: '', birthDate: '', birthNumber: '',
        street: 'Čajkovského', descriptiveNumber: '86', orientationNumber: '3',
        town: 'Olomouc', zip: '77900', birthPlace: 'Olomouc',
        documentNumber: '208243633', documentValidTo: '09.06.2027'
    };

    const DEFAULT_SECONDARY_DOC_DATA = {
        firstName: '', lastName: '', birthDate: '', birthNumber: '',
        birthPlace: 'Olomouc', documentValidTo: '31.08.2026', documentNumber: 'EK608907'
    };

    const DEFAULT_ADDITIONAL_INFO_DATA = {
        turnoverLastYear: '900000',
        netAnnuallyBusinessProfit: '800000',
        netMonthlyHouseholdIncome: '90000',
        employeeCount: '0',
        educationLabel: 'Vysokoškolské',
        maritalStatusLabel: 'svobodný/svobodná',
        czeTaxDomicileOnly: true,
        foreignEstablishments: false,
        hasAnonymousPartner: false,
        pepFlag: false
    };

    const DEFAULT_AML_DATA = {
        incomeSourceText: 'Příjmy z podnikání',
        transactionTypeId: 'transactionType_value-CASH',
        companyTurnoverId: 'companyTurnover_value-DO_500_000',
        mainAccountFlagId: 'mainAccountFlag_value-true'
    };

    const POS_KEY = 'ibaf.ntb.pos';
    const THEME_KEY = 'ibaf.ntb.theme';
    const PERSON_DATA_KEY = 'ibaf.ntb.personData';
    const SETTINGS_KEY = 'ibaf.ntb.settings';
    const STATS_KEY = 'ibaf.ntb.stats';

    const CLAMP_MARGIN = 4, DEFAULT_OFFSET = 24;
    const THEMES = ['teal', 'indigo', 'violet', 'amber', 'tomato', 'emerald', 'slate'];

    const MICRO_CACHE_TTL = 350;
    const DEBUG_BUFFER_LIMIT = 40;

    const UI_IDS = Object.freeze({
        button: 'ibaf-btn',
        buttonBadge: 'ibaf-btn-badge',
        personPanel: 'ibaf-person-panel',
        dataPanel: 'ibaf-data-panel',
        reportPanel: 'ibaf-report-panel',
        menu: 'ibaf-menu'
    });

    const SELECTOR_REGISTRY = Object.freeze({
        panels: {
            person: `#${UI_IDS.personPanel}`,
            data: `#${UI_IDS.dataPanel}`,
            report: `#${UI_IDS.reportPanel}`,
            menu: `#${UI_IDS.menu}`
        },
        fieldLabels: {
            phoneNumber: ['Telefon', 'Telefonní číslo', 'Číslo telefonu'],
            email: ['E-mail', 'Email'],
            street: ['Ulice'],
            descriptiveNumber: ['Číslo popisné', 'Č.p.', 'CP'],
            orientationNumber: ['Číslo orientační', 'Č.o.', 'CO'],
            town: ['Obec', 'Město', 'Obec / Město'],
            zip: ['PSČ', 'PSC'],
            birthPlace: ['Místo narození'],
            documentNumber: ['Číslo dokladu', 'Číslo průkazu'],
            documentValidTo: ['Platnost do', 'Platnost dokladu do', 'Datum platnosti do'],
            turnoverLastYear: ['Obrat', 'Obrat za minulý rok'],
            netAnnuallyBusinessProfit: ['Čistý roční zisk', 'Čistý roční zisk z podnikání'],
            netMonthlyHouseholdIncome: ['Čistý měsíční příjem domácnosti', 'Příjem domácnosti'],
            employeeCount: ['Počet zaměstnanců']
        }
    });

    const ACTION_FIELD_MAPS = Object.freeze({
        phone: [
            { id: 'phoneNumber', selectorKey: 'phoneNumber', uiLabel: 'Telefon', validateKey: 'phone', dataKey: 'phone' },
            { id: 'email', selectorKey: 'email', uiLabel: 'E-mail', validateKey: 'email', dataKey: 'email' }
        ],
        idc: [
            { id: 'firstName', labels: ['Jméno'], uiLabel: 'Jméno', dataKey: 'firstName' },
            { id: 'lastName', labels: ['Příjmení'], uiLabel: 'Příjmení', dataKey: 'lastName' },
            { id: 'birthDate', labels: ['Datum narození'], uiLabel: 'Datum narození', validateKey: 'date', dataKey: 'birthDate' },
            { id: 'birthNumber', labels: ['Rodné číslo'], uiLabel: 'Rodné číslo', validateKey: 'birthNumber', dataKey: 'birthNumber' },
            { id: 'street', selectorKey: 'street', uiLabel: 'Ulice', dataKey: 'street' },
            { id: 'descriptiveNumber', selectorKey: 'descriptiveNumber', uiLabel: 'Číslo popisné', dataKey: 'descriptiveNumber' },
            { id: 'orientationNumber', selectorKey: 'orientationNumber', uiLabel: 'Číslo orientační', dataKey: 'orientationNumber' },
            { id: 'town', selectorKey: 'town', uiLabel: 'Obec / Město', dataKey: 'town' },
            { id: 'zip', selectorKey: 'zip', uiLabel: 'PSČ', validateKey: 'zip', dataKey: 'zip' },
            { id: 'birthPlace', selectorKey: 'birthPlace', uiLabel: 'Místo narození', dataKey: 'birthPlace' },
            { id: 'documentNumber', selectorKey: 'documentNumber', uiLabel: 'Číslo dokladu', dataKey: 'documentNumber' },
            { id: 'documentValidTo', selectorKey: 'documentValidTo', uiLabel: 'Platnost dokladu do', validateKey: 'date', dataKey: 'documentValidTo' }
        ],
        sec: [
            { id: 'firstName', labels: ['Jméno'], uiLabel: 'Jméno', dataKey: 'firstName' },
            { id: 'lastName', labels: ['Příjmení'], uiLabel: 'Příjmení', dataKey: 'lastName' },
            { id: 'birthDate', labels: ['Datum narození'], uiLabel: 'Datum narození', validateKey: 'date', dataKey: 'birthDate' },
            { id: 'birthNumber', labels: ['Rodné číslo'], uiLabel: 'Rodné číslo', validateKey: 'birthNumber', dataKey: 'birthNumber' },
            { id: 'birthPlace', selectorKey: 'birthPlace', uiLabel: 'Místo narození', dataKey: 'birthPlace' },
            { id: 'documentNumber', selectorKey: 'documentNumber', uiLabel: 'Číslo dokladu', dataKey: 'documentNumber' },
            { id: 'documentValidTo', selectorKey: 'documentValidTo', uiLabel: 'Platnost dokladu do', validateKey: 'date', dataKey: 'documentValidTo' }
        ],
        add: [
            { id: 'turnoverLastYear', selectorKey: 'turnoverLastYear', uiLabel: 'Obrat za minulý rok', validateKey: 'money', dataKey: 'turnoverLastYear' },
            { id: 'netAnnuallyBusinessProfit', selectorKey: 'netAnnuallyBusinessProfit', uiLabel: 'Čistý roční zisk z podnikání', validateKey: 'money', dataKey: 'netAnnuallyBusinessProfit' },
            { id: 'netMonthlyHouseholdIncome', selectorKey: 'netMonthlyHouseholdIncome', uiLabel: 'Čistý měsíční příjem domácnosti', validateKey: 'money', dataKey: 'netMonthlyHouseholdIncome' },
            { id: 'employeeCount', selectorKey: 'employeeCount', uiLabel: 'Počet zaměstnanců', validateKey: 'money', dataKey: 'employeeCount' }
        ]
    });

    const log = {
        info: (...a) => DEBUG && console.info('[IBAF]', ...a),
        warn: (...a) => DEBUG && console.warn('[IBAF]', ...a),
        error: (...a) => console.error('[IBAF]', ...a)
    };

    const debugBuffer = [];

    function debugTrace(kind, msg, meta = null) {
        const entry = {
            at: nowIso(),
            kind: String(kind || 'info'),
            msg: String(msg || ''),
            meta: meta || null
        };
        debugBuffer.unshift(entry);
        if (debugBuffer.length > DEBUG_BUFFER_LIMIT) debugBuffer.length = DEBUG_BUFFER_LIMIT;
        if (DEBUG) console.debug('[IBAF][TRACE]', entry);
    }

    function getDebugText() {
        if (!debugBuffer.length) return 'Zatím žádné debug záznamy v aktuální session.';
        return debugBuffer.map(item => {
            const suffix = item.meta ? ` ${JSON.stringify(item.meta)}` : '';
            return `[${item.at}] ${item.kind.toUpperCase()} ${item.msg}${suffix}`;
        }).join('\n');
    }

    function cssEscape(s) {
        const str = String(s);

        if (window.CSS && typeof CSS.escape === 'function') {
            return CSS.escape(str);
        }

        const length = str.length;
        let index = -1;
        let output = '';
        const firstCodeUnit = str.charCodeAt(0);

        while (++index < length) {
            const codeUnit = str.charCodeAt(index);

            if (codeUnit === 0x0000) {
                output += '\uFFFD';
                continue;
            }

            if (
                (codeUnit >= 0x0001 && codeUnit <= 0x001F) ||
                codeUnit === 0x007F ||
                (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
                (index === 1 &&
                 codeUnit >= 0x0030 && codeUnit <= 0x0039 &&
                 firstCodeUnit === 0x002D)
            ) {
                output += '\\' + codeUnit.toString(16) + ' ';
                continue;
            }

            if (index === 0 && codeUnit === 0x002D && length === 1) {
                output += '\\-';
                continue;
            }
            if (
                codeUnit >= 0x0080 ||
                codeUnit === 0x002D ||
                codeUnit === 0x005F ||
                (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
                (codeUnit >= 0x0041 && codeUnit <= 0x005A) ||
                (codeUnit >= 0x0061 && codeUnit <= 0x007A)
            ) {
                output += str.charAt(index);
                continue;
            }

            output += '\\' + str.charAt(index);
        }

        return output;
    }

    function nowIso() {
        try { return new Date().toISOString(); } catch { return String(Date.now()); }
    }

    function safeJsonParse(raw, fallback) {
        try { return JSON.parse(raw); } catch { return fallback; }
    }

    function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

    function deepMerge(target, source) {
        if (!isObj(target) || !isObj(source)) return source;
        const out = { ...target };
        for (const [k, v] of Object.entries(source)) {
            if (isObj(v) && isObj(out[k])) out[k] = deepMerge(out[k], v);
            else out[k] = v;
        }
        return out;
    }

    function clampNum(n, min, max) {
        n = Number(n);
        if (Number.isNaN(n)) return min;
        return Math.max(min, Math.min(max, n));
    }

    function loadStats() {
        const def = { actions: {}, lastErrors: [], updatedAt: null };
        try {
            const raw = localStorage.getItem(STATS_KEY);
            if (!raw) return def;
            const parsed = safeJsonParse(raw, def);
            if (!isObj(parsed)) return def;
            parsed.actions = isObj(parsed.actions) ? parsed.actions : {};
            parsed.lastErrors = Array.isArray(parsed.lastErrors) ? parsed.lastErrors : [];
            return deepMerge(def, parsed);
        } catch {
            return def;
        }
    }

    function saveStats(s) {
        try {
            s.updatedAt = nowIso();
            localStorage.setItem(STATS_KEY, JSON.stringify(s));
        } catch { }
    }

    function bumpActionStat(actionKey) {
        const s = loadStats();
        const a = s.actions[actionKey] || { count: 0, lastUsed: null };
        a.count = (a.count || 0) + 1;
        a.lastUsed = nowIso();
        s.actions[actionKey] = a;
        saveStats(s);
    }

    function pushErrorStat(msg) {
        const s = loadStats();
        s.lastErrors = Array.isArray(s.lastErrors) ? s.lastErrors : [];
        s.lastErrors.unshift({ at: nowIso(), msg: String(msg || '') });
        s.lastErrors = s.lastErrors.slice(0, 15);
        saveStats(s);
    }

    function defaultVariantData() {
        return {
            idCard: { ...DEFAULT_ID_CARD_DATA },
            secondaryDoc: { ...DEFAULT_SECONDARY_DOC_DATA },
            additionalInfo: { ...DEFAULT_ADDITIONAL_INFO_DATA },
            aml: { ...DEFAULT_AML_DATA }
        };
    }

    function defaultSettings() {
        return {
            phone: DEFAULT_PHONE_NUMBER,
            email: DEFAULT_EMAIL_ADDRESS,
            variants: {
                default: defaultVariantData(),
                SME_STANDALONE: {},
                SME_BUNDLE: {}
            },
            activeVariant: 'default',
            autoDetectVariant: true
        };
    }

    function cloneSettingsData(data, fallback = null) {
        try {
            return JSON.parse(JSON.stringify(data));
        } catch {
            return fallback;
        }
    }

    let settingsCache = null;

    function invalidateSettingsCache() {
        settingsCache = null;
    }

    function normalizeSettings(parsed) {
        const def = defaultSettings();
        let s = isObj(parsed) ? parsed : {};
        s = deepMerge(def, s);

        if (!isObj(s.variants)) s.variants = { default: defaultVariantData() };
        if (!isObj(s.variants.default)) s.variants.default = defaultVariantData();
        if (!isObj(s.variants.SME_STANDALONE)) s.variants.SME_STANDALONE = {};
        if (!isObj(s.variants.SME_BUNDLE)) s.variants.SME_BUNDLE = {};

        if (typeof s.activeVariant !== 'string') s.activeVariant = 'default';
        if (!s.variants[s.activeVariant]) s.activeVariant = 'default';
        return s;
    }

    function loadSettings() {
        const def = defaultSettings();
        if (settingsCache) {
            return cloneSettingsData(settingsCache, def) || def;
        }
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (!raw) {
                settingsCache = def;
                return cloneSettingsData(settingsCache, def) || def;
            }
            settingsCache = normalizeSettings(safeJsonParse(raw, def));
            return cloneSettingsData(settingsCache, def) || def;
        } catch (e) {
            log.error('loadSettings error', e);
            return def;
        }
    }

    function saveSettings(settings) {
        try {
            settingsCache = normalizeSettings(settings);
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsCache));
            return true;
        } catch (e) {
            invalidateSettingsCache();
            log.error('saveSettings error', e);
            return false;
        }
    }

    function getActiveProfileName() { return 'Default'; }
    function getActiveProfile() { return loadSettings(); }
    function resetProfileToDefaults() { return saveSettings(defaultSettings()); }

    function base64UrlToBase64(s) {
        s = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
        const pad = s.length % 4;
        if (pad) s += '='.repeat(4 - pad);
        return s;
    }

    function parseSNRFromUrl() {
        try {
            const u = new URL(location.href);
            const snr = u.searchParams.get('snr');
            if (!snr) return null;

            const decoded = atob(base64UrlToBase64(snr));
            const obj = safeJsonParse(decoded, null);
            return (obj && isObj(obj)) ? obj : null;
        } catch {
            return null;
        }
    }

    function detectVariantKeyFromContext() {
        const snrObj = parseSNRFromUrl();
        const pt = (snrObj && typeof snrObj.productType === 'string') ? snrObj.productType : '';
        const ptUp = pt.toUpperCase();

        if (ptUp.includes('STANDALONE')) return 'SME_STANDALONE';
        if (ptUp.includes('BUNDLE')) return 'SME_BUNDLE';

        const url = location.href.toLowerCase();
        if (url.includes('standalone')) return 'SME_STANDALONE';
        if (url.includes('bundle')) return 'SME_BUNDLE';

        return 'default';
    }

    function getEffectiveVariant(profile) {
        const p = profile || getActiveProfile();
        let vKey = String(p.activeVariant || 'default');

        if (p.autoDetectVariant) {
            const detected = detectVariantKeyFromContext();
            if (p.variants && p.variants[detected]) vKey = detected;
            else vKey = 'default';
        }

        if (!p.variants || !p.variants[vKey]) vKey = 'default';
        return vKey;
    }

    function getEffectiveDatasets(profile) {
        const p = profile || getActiveProfile();
        const vKey = getEffectiveVariant(p);

        const base = deepMerge(defaultVariantData(), (p.variants && p.variants.default) ? p.variants.default : {});
        const override = (p.variants && p.variants[vKey]) ? p.variants[vKey] : {};
        const merged = deepMerge(base, override);

        return { variantKey: vKey, datasets: merged };
    }

    function injectStyles() {
        if (document.getElementById('ibaf-ntb-style')) return;
        const css = `
#ibaf-btn{
  position:fixed;top:${DEFAULT_OFFSET}px;left:${DEFAULT_OFFSET}px;z-index:2147483647;
  width:32px;height:32px;border:none;border-radius:8px;display:flex;align-items:center;justify-content:center;
  font:16px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#fff;
  box-shadow:0 3px 10px rgba(0,0,0,.22);cursor:pointer;user-select:none;background-clip:padding-box;will-change:transform;
  transition:transform .12s ease,box-shadow .12s ease,background .2s ease; overflow:visible;
}

#ibaf-btn:hover{transform:translateY(-1px);box-shadow:0 5px 14px rgba(0,0,0,.28)}
#ibaf-btn:active{transform:translateY(0);box-shadow:0 2px 8px rgba(0,0,0,.22)}
#ibaf-btn[data-theme="teal"]   {background:linear-gradient(135deg,#0098a8,#22d4d4)}
#ibaf-btn[data-theme="indigo"] {background:linear-gradient(135deg,#3b5bdb,#748ffc)}
#ibaf-btn[data-theme="violet"] {background:linear-gradient(135deg,#6f42c1,#a78bfa)}
#ibaf-btn[data-theme="amber"]  {background:linear-gradient(135deg,#d97706,#fbbf24)}
#ibaf-btn[data-theme="tomato"] {background:linear-gradient(135deg,#e03131,#ff6b6b)}
#ibaf-btn[data-theme="emerald"]{background:linear-gradient(135deg,#2f9e44,#69db7c)}
#ibaf-btn[data-theme="slate"]  {background:linear-gradient(135deg,#334155,#64748b)}

#ibaf-btn .ibaf-btn-icon{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:100%;
  height:100%;
  font-size:16px;
}

#ibaf-btn .ibaf-btn-badge{
  position:absolute;
  top:-6px;
  right:-6px;
  min-width:18px;
  height:18px;
  padding:0 6px;
  border-radius:999px;
  background:rgba(2,6,23,.92);
  border:1px solid rgba(148,163,184,.45);
  color:#e2e8f0;
  font-size:10px;
  line-height:18px;
  font-weight:650;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  pointer-events:none;
  box-shadow:0 6px 14px rgba(0,0,0,.35);
}

#ibaf-menu{
  position:fixed;z-index:2147483647;min-width:290px;background:#0f172a;color:#e2e8f0;
  border:1px solid rgba(148,163,184,.25);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.4);
  font:13px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  max-height:70vh; overflow:auto;
  padding-right: 4px;
  opacity:0;transform:translateY(-4px);pointer-events:none;
  transition:opacity .12s ease,transform .12s ease;
}
#ibaf-menu.show{opacity:1;transform:translateY(0);pointer-events:auto}
#ibaf-menu .item{padding:9px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;white-space:nowrap}
#ibaf-menu .item:hover{background:rgba(148,163,184,.12)}
#ibaf-menu .item.disabled{opacity:.45;cursor:not-allowed}
#ibaf-menu .sep{height:1px;background:rgba(148,163,184,.18);margin:4px 0}
#ibaf-menu .hint{padding:7px 12px;color:#94a3b8;font-size:11px;white-space:normal}

#ibaf-person-panel,
#ibaf-data-panel,
#ibaf-report-panel{
  position:fixed;z-index:2147483647;min-width:360px;max-width:640px;
  background:#0b1220;color:#e2e8f0;border:1px solid rgba(148,163,184,.35);
  border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.55);
  font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  padding:10px 12px 10px 12px;opacity:0;transform:translateY(-4px);pointer-events:none;
  transition:opacity .12s ease,transform .12s ease;
}
#ibaf-person-panel.show,
#ibaf-data-panel.show,
#ibaf-report-panel.show{opacity:1;transform:translateY(0);pointer-events:auto}

.ibaf-panel-header{
  display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;font-weight:650;
}
.ibaf-panel-header .title{display:flex;align-items:center;gap:8px}
.ibaf-panel-header button{
  border:none;background:transparent;color:#94a3b8;cursor:pointer;font-size:14px;line-height:1;
  padding:2px 4px;border-radius:4px;
}
.ibaf-panel-header button:hover{background:rgba(148,163,184,.18);color:#e2e8f0}

.ibaf-panel-body{
  max-height: calc(100vh - 140px);
  overflow:auto;
  padding-right: 6px;
}

.ibaf-row{display:flex;gap:8px;margin-bottom:6px;}
.ibaf-row.single{flex-direction:column;}
.ibaf-field{flex:1;display:flex;flex-direction:column;gap:2px;min-width:0;}
.ibaf-field label{font-size:11px;color:#9ca3af;}
.ibaf-field input,
.ibaf-field select,
.ibaf-field textarea{
  background:#020617;border:1px solid rgba(148,163,184,.45);border-radius:6px;
  padding:6px 7px;color:#e5e7eb;font-size:13px;outline:none;
}
.ibaf-field textarea{min-height:120px;resize:vertical}
.ibaf-field input:focus,
.ibaf-field select:focus,
.ibaf-field textarea:focus{border-color:#38bdf8;box-shadow:0 0 0 1px rgba(56,189,248,.6);}

.ibaf-panel-footer{
  display:flex;justify-content:flex-end;gap:6px;margin-top:10px;flex-wrap:wrap;
}
.ibaf-panel-footer button{
  border-radius:6px;border:1px solid rgba(148,163,184,.6);padding:6px 10px;font-size:12px;
  background:#020617;color:#e5e7eb;cursor:pointer;
}
.ibaf-panel-footer button:hover{background:#111827;}
.ibaf-panel-footer button[data-action="save"]{
  border-color:#22c55e;background:#16a34a;
}
.ibaf-panel-footer button[data-action="save"]:hover{background:#15803d;}

.ibaf-status{margin-top:6px;font-size:11px;color:#a5b4fc;min-height:14px;}
.ibaf-hint{font-size:11px;color:#94a3b8;margin:6px 0 2px 0}

.ibaf-details{
  border:1px solid rgba(148,163,184,.20);
  border-radius:10px;
  padding:8px 10px;
  margin:8px 0;
  background:rgba(2,6,23,.35);
}
.ibaf-details > summary{
  cursor:pointer;
  user-select:none;
  font-weight:650;
  color:#e2e8f0;
  list-style:none;
}
.ibaf-details > summary::-webkit-details-marker{display:none}

.ibaf-badge{
  font-size:11px;color:#e2e8f0;background:rgba(148,163,184,.18);
  border:1px solid rgba(148,163,184,.24);
  padding:1px 6px;border-radius:999px;
}

#ibaf-toast{
  position:fixed;z-index:2147483647;
  background:rgba(2,6,23,.92);color:#e2e8f0;
  border:1px solid rgba(148,163,184,.25);border-radius:10px;
  padding:8px 10px;font:12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  box-shadow:0 10px 30px rgba(0,0,0,.4);
  opacity:0;transform:translateY(6px);pointer-events:none;
  transition:opacity .14s ease,transform .14s ease;
  max-width:360px;
}
#ibaf-toast.show{opacity:1;transform:translateY(0)}

.ibaf-highlight{
  outline: 2px solid rgba(56,189,248,.9) !important;
  box-shadow: 0 0 0 3px rgba(56,189,248,.25) !important;
  border-radius: 6px !important;
}
.ibaf-highlight-warn{
  outline: 2px solid rgba(251,191,36,.95) !important;
  box-shadow: 0 0 0 3px rgba(251,191,36,.25) !important;
  border-radius: 6px !important;
}
.ibaf-highlight-bad{
  outline: 2px solid rgba(248,113,113,.95) !important;
  box-shadow: 0 0 0 3px rgba(248,113,113,.25) !important;
  border-radius: 6px !important;
}

.ibaf-report-list{
  max-height: 320px;
  overflow:auto;
  padding-right: 6px;
}
.ibaf-report-item{
  padding:6px 8px;
  border:1px solid rgba(148,163,184,.18);
  border-radius:8px;
  background:rgba(2,6,23,.25);
  margin:6px 0;
}
.ibaf-report-item .k{color:#94a3b8;font-size:11px;margin-bottom:2px}
.ibaf-report-item .v{color:#e2e8f0;font-size:12px;word-break:break-word}
.ibaf-report-grid{
  display:grid;
  grid-template-columns: 1fr 1fr;
  gap:8px;
}
@media (max-width: 680px){
  .ibaf-report-grid{grid-template-columns: 1fr;}
}
`;
        const s = document.createElement('style');
        s.id = 'ibaf-ntb-style';
        s.textContent = css;
        document.head.appendChild(s);
    }

    function toast(msg, btn, ms = 1700) {
        try {
            let t = document.getElementById('ibaf-toast');
            if (!t) {
                t = document.createElement('div');
                t.id = 'ibaf-toast';
                document.body.appendChild(t);
            }
            t.textContent = msg;

            const rect = btn?.getBoundingClientRect?.();
            const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
            const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);

            let left = rect ? rect.left : Math.min(24, vw - 280);
            let top = rect ? (rect.bottom + 10) : Math.min(24, vh - 60);

            left = Math.max(8, Math.min(left, vw - 300));
            top = Math.max(8, Math.min(top, vh - 70));

            t.style.left = left + 'px';
            t.style.top = top + 'px';

            t.classList.add('show');
            clearTimeout(t._hideT);
            t._hideT = setTimeout(() => t.classList.remove('show'), ms);
        } catch { }
    }

    function highlight(el, kind = 'ok', ms = 900) {
        if (!el || !el.classList) return;
        const cls = (kind === 'bad')
        ? 'ibaf-highlight-bad'
        : (kind === 'warn' ? 'ibaf-highlight-warn' : 'ibaf-highlight');

        el.classList.add(cls);
        setTimeout(() => { try { el.classList.remove(cls); } catch { } }, ms);
    }

    const microCache = new Map();
    let microCacheRootId = 0;
    const microCacheRootMap = new WeakMap();

    function getRootCacheId(root) {
        if (!root || typeof root !== 'object') return 'no-root';
        if (root === document) return 'doc';
        if (root === document.body) return 'body';
        if (microCacheRootMap.has(root)) return microCacheRootMap.get(root);
        microCacheRootId += 1;
        microCacheRootMap.set(root, 'r' + microCacheRootId);
        return microCacheRootMap.get(root);
    }

    function mcGet(key) {
        const it = microCache.get(key);
        if (!it) return null;
        if ((Date.now() - it.t) > MICRO_CACHE_TTL) {
            microCache.delete(key);
            return null;
        }
        return it.val;
    }

    function mcSet(key, val) {
        microCache.set(key, { t: Date.now(), val });
    }

    function collectDeepRoots(startRoot) {
        const roots = [];
        const stack = [startRoot];
        const visited = new Set();

        while (stack.length) {
            const r = stack.pop();
            if (!r || visited.has(r)) continue;
            visited.add(r);

            roots.push(r);

            try {
                const doc = r.ownerDocument || (r.nodeType === 9 ? r : document);
                const walker = doc.createTreeWalker(r, NodeFilter.SHOW_ELEMENT);
                let cur = walker.currentNode;

                while (cur) {
                    if (cur.shadowRoot) stack.push(cur.shadowRoot);

                    if (cur.tagName === 'IFRAME') {
                        try {
                            if (cur.contentDocument) stack.push(cur.contentDocument);
                        } catch {
                        }
                    }

                    cur = walker.nextNode();
                }
            } catch {
            }
        }

        return roots;
    }

    function queryDeepAll(selector, root = document) {
        const rootId = getRootCacheId(root);
        const cacheKey = `all|${rootId}|${selector}`;
        const cached = mcGet(cacheKey);
        if (cached) return cached;

        const out = new Set();
        const roots = collectDeepRoots(root);

        for (const r of roots) {
            try {
                r.querySelectorAll?.(selector)?.forEach(el => out.add(el));
            } catch {
            }
        }

        const arr = [...out];
        mcSet(cacheKey, arr);
        return arr;
    }

    function queryDeepOne(selector, root = document) {
        const rootId = getRootCacheId(root);
        const cacheKey = `one|${rootId}|${selector}`;
        const cached = mcGet(cacheKey);
        if (cached) return cached;

        const roots = collectDeepRoots(root);
        for (const r of roots) {
            try {
                const hit = r.querySelector?.(selector);
                if (hit) {
                    mcSet(cacheKey, hit);
                    return hit;
                }
            } catch { }
        }

        return null;
    }

    function fastQueryOne(selector) {
        try {
            const hit = document.querySelector(selector);
            if (hit) return hit;
        } catch { }
        return queryDeepOne(selector, document);
    }

    function normalizeText(s) {
        return String(s || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function isFillableElement(el) {
        if (!el) return false;

        try {
            if (el.disabled) return false;
            if (el.readOnly) return false;
        } catch { }

        try {
            const style = window.getComputedStyle(el);
            if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;

            if (el instanceof HTMLElement && el.offsetParent === null && style.position !== 'fixed') return false;
        } catch { }

        return true;
    }

    function findByLabelTexts(labelTexts) {
        const wanted = (labelTexts || []).map(normalizeText).filter(Boolean);
        if (!wanted.length) return null;

        const candidates = [];
        const labels = queryDeepAll('label');

        for (const lb of labels) {
            const labelText = normalizeText(lb.textContent);
            if (!labelText) continue;

            let matchScore = 0;
            for (const w of wanted) {
                if (labelText === w) matchScore = Math.max(matchScore, 100);
                else if (labelText.includes(w)) matchScore = Math.max(matchScore, 60);
            }
            if (matchScore === 0) continue;

            const f = lb.getAttribute('for');
            if (f) {
                const el = document.getElementById(f) || queryDeepOne('#' + cssEscape(f));
                if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
                    if (isFillableElement(el)) candidates.push({ el, score: matchScore + 40, how: 'label-for' });
                }
            }

            try {
                const inside = lb.querySelector('input,textarea,select');
                if (inside && isFillableElement(inside)) candidates.push({ el: inside, score: matchScore + 30, how: 'label-inside' });
            } catch { }

            const wrap = lb.closest('div,section,fieldset,article') || lb.parentElement;
            if (wrap) {
                try {
                    const near = wrap.querySelector('input,textarea,select');
                    if (near && isFillableElement(near)) candidates.push({ el: near, score: matchScore + 10, how: 'label-near' });
                } catch { }
            }
        }

        const inputs = queryDeepAll('input,textarea,select');
        for (const el of inputs) {
            if (!isFillableElement(el)) continue;

            const aria = normalizeText(el.getAttribute('aria-label'));
            const ph = normalizeText(el.getAttribute('placeholder'));

            let matchScore = 0;
            for (const w of wanted) {
                if (aria === w || ph === w) matchScore = Math.max(matchScore, 45);
                else if (aria.includes(w) || ph.includes(w)) matchScore = Math.max(matchScore, 25);
            }
            if (matchScore > 0) candidates.push({ el, score: matchScore, how: 'aria/placeholder' });
        }

        if (!candidates.length) return null;
        candidates.sort((a, b) => b.score - a.score);
        return candidates[0].el || null;
    }

    function getFieldElement(fieldId, labelFallbacks) {
        if (fieldId) {
            const byId = document.getElementById(fieldId) || queryDeepOne('#' + cssEscape(fieldId));
            if (byId) return byId;
        }
        return findByLabelTexts(labelFallbacks);
    }

    function simulateReactInput(input, value, opts = {}) {
        const { silent = false } = opts;

        const isTextArea = input instanceof HTMLTextAreaElement;
        const proto = isTextArea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        const setter = desc && desc.set;

        if (!silent) {
            try { input.focus(); } catch { }
        }

        if (setter) setter.call(input, '');
        else input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));

        if (setter) setter.call(input, value);
        else input.value = value;

        try { input.setSelectionRange(String(value ?? '').length, String(value ?? '').length); } catch { }

        input.dispatchEvent(new Event('input', { bubbles: true }));
        if (!silent) input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function validateValueByField(fieldKey, value) {
        const v = String(value ?? '').trim();

        if (v === '') return { ok: true, level: 'ok', msg: '' };

        if (fieldKey === 'phone') {
            const digits = v.replace(/\D/g, '');
            if (digits.length < 9) return { ok: false, level: 'warn', msg: 'Phone number has suspiciously few digits.' };
            return { ok: true, level: 'ok', msg: '' };
        }

        if (fieldKey === 'email') {
            if (!v.includes('@') || !v.includes('.')) return { ok: false, level: 'warn', msg: 'Email does not look valid.' };
            return { ok: true, level: 'ok', msg: '' };
        }

        if (fieldKey === 'zip') {
            const digits = v.replace(/\D/g, '');
            if (digits.length !== 5) return { ok: false, level: 'warn', msg: 'ZIP code usually has 5 digits.' };
            return { ok: true, level: 'ok', msg: '' };
        }

        if (fieldKey === 'date') {
            if (!/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(v)) return { ok: false, level: 'warn', msg: 'Date expected format dd.mm.yyyy.' };
            return { ok: true, level: 'ok', msg: '' };
        }

        if (fieldKey === 'birthNumber') {
            const digits = v.replace(/\D/g, '');
            if (!(digits.length === 9 || digits.length === 10)) return { ok: false, level: 'warn', msg: 'Birth number usually has 9 or 10 digits.' };
            return { ok: true, level: 'ok', msg: '' };
        }

        if (fieldKey === 'money') {
            const digits = v.replace(/[^\d]/g, '');
            if (digits.length === 0) return { ok: false, level: 'warn', msg: 'Amount should contain digits.' };
            return { ok: true, level: 'ok', msg: '' };
        }

        return { ok: true, level: 'ok', msg: '' };
    }

    const undoStack = [];
    const UNDO_LIMIT = 60;

    function pushUndo(entry) {
        try {
            undoStack.push(entry);
            if (undoStack.length > UNDO_LIMIT) undoStack.shift();
        } catch { }
    }

    function undoLastChange(btn) {
        const item = undoStack.pop();
        if (!item) {
            if (btn) toast('↩️ Není co vrátit. Historie změn je prázdná.', btn);
            return false;
        }

        const { type, id, oldValue, oldChecked } = item;

        if (type === 'dropdown') {
            const label = String(oldValue || '');
            if (!label) {
                if (btn) toast('↩️ Vrácení se nepovedlo. Chybí původní hodnota dropdownu.', btn);
                return false;
            }

            selectDropdownValueByText(id, label).then(okSel => {
                if (btn) toast(okSel ? '↩️ Poslední změna byla vrácena.' : '↩️ Vrácení se nepovedlo.', btn);
            });

            return true;
        }

        let ok = false;

        if (type === 'input') {
            const el = getFieldElement(id, null);
            if (el) {
                simulateReactInput(el, String(oldValue ?? ''), { silent: false });
                highlight(el, 'warn');
                ok = true;
            }
        } else if (type === 'checkbox') {
            const el = getFieldElement(id, null);
            if (el && el.type === 'checkbox') {
                if (el.checked !== !!oldChecked) {
                    try { el.click(); } catch {}
                }
                highlight(el, 'warn');
                ok = true;
            }
        } else if (type === 'radio') {
            const prevId = String(oldValue || '');
            const el = prevId ? getFieldElement(prevId, null) : null;
            if (el) {
                try { el.click(); } catch {}
                highlight(el, 'warn');
                ok = true;
            }
        } else if (type === 'select') {
            const el = getFieldElement(id, null);
            if (el && el.tagName === 'SELECT') {
                el.value = String(oldValue ?? '');
                el.dispatchEvent(new Event('change', { bubbles: true }));
                highlight(el, 'warn');
                ok = true;
            }
        }

        if (btn) toast(ok ? '↩️ Poslední změna byla vrácena.' : '↩️ Vrácení se nepovedlo.', btn);
        return ok;
    }

    class Reporter {
        constructor(actionName) {
            this.actionName = actionName;
            this.at = nowIso();
            this.filled = [];
            this.skipped = [];
            this.missing = [];
            this.invalid = [];
            this.notes = [];
            this.variant = null;
        }
        addFilled(label) { this.filled.push(label); }
        addSkipped(label) { this.skipped.push(label); }
        addMissing(label) { this.missing.push(label); }
        addInvalid(label, msg) { this.invalid.push({ label, msg }); }
        addNote(msg) { this.notes.push(String(msg || '')); }
        summary() { return `✅ ${this.filled.length} | ⏭ ${this.skipped.length} | ❌ ${this.missing.length} | ⚠️ ${this.invalid.length}`; }
    }

    let lastReport = null;

    function clickLikeUser(el) {
        if (!el) return false;
        try {
            const events = [
                ['mousedown', MouseEvent],
                ['mouseup', MouseEvent],
                ['click', MouseEvent],
            ];
            for (const [t, Ctor] of events) {
                el.dispatchEvent(new Ctor(t, { bubbles: true, cancelable: true, view: window }));
            }
            return true;
        } catch {
            try { el.click(); return true; } catch { }
        }
        return false;
    }

    function tryNativeSelectById(id, valueText) {
        const sel = getFieldElement(id, null);
        if (sel && sel.tagName === 'SELECT') {
            const prevValue = sel.value;

            const opt = [...sel.options].find(o =>
                                              (o.text || '').trim() === valueText || o.value === valueText
                                             );

            if (opt) {
                pushUndo({ type: 'select', id: id, oldValue: prevValue });
                sel.value = opt.value;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
        }
        return false;
    }

    async function selectDropdownValueByText(id, labelText, timeoutMs = 2000) {
        if (!labelText) return false;

        if (tryNativeSelectById(id, labelText)) return true;

        const btn = document.getElementById(`${id}_button`) || queryDeepOne(`#${cssEscape(id)}_button`);
        if (!btn) return false;

        let prevLabel = '';
        try { prevLabel = (btn.textContent || '').trim(); } catch {}
        const deepAllFresh = (selector, root = document) => {
            const out = new Set();
            const roots = collectDeepRoots(root);
            for (const r of roots) {
                try { r.querySelectorAll?.(selector)?.forEach(el => out.add(el)); } catch {}
            }
            return [...out];
        };
        try { btn.click(); } catch { return false; }

        const pickNow = () => {
            const items = deepAllFresh('.c-dropdown__itemContent');
            for (const item of items) {
                if (((item.textContent || '').trim()) === labelText) {
                    if (prevLabel) pushUndo({ type: 'dropdown', id, oldValue: prevLabel });
                    clickLikeUser(item);
                    return true;
                }
            }
            return false;
        };

        if (pickNow()) return true;

        const ok = await new Promise((resolve) => {
            const start = Date.now();
            const mo = new MutationObserver(() => {
                if (pickNow()) { mo.disconnect(); return resolve(true); }
                if (Date.now() - start > timeoutMs) { mo.disconnect(); return resolve(false); }
            });

            try {
                mo.observe(document.body, { childList: true, subtree: true });
            } catch {
                try { mo.disconnect(); } catch {}
                return resolve(false);
            }

            setTimeout(() => {
                try { mo.disconnect(); } catch {}
                resolve(false);
            }, timeoutMs + 80);
        });

        if (!ok) {
            try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch {}
        }

        return ok;
    }

    function setRadioByIdLike(baseKey, boolVal) {
        const suffix = boolVal ? 'true' : 'false';
        const candidates = [
            `#${cssEscape(baseKey)}-${suffix}`,
            `input[name="${baseKey}"][value="${suffix}"]`,
            `input[id*="${baseKey}"][value="${suffix}"]`,
            `input[name*="${baseKey}"][value="${suffix}"]`
        ];

        let el = null;
        for (const q of candidates) {
            el = fastQueryOne(q);
            if (el) break;
        }

        let prevCheckedId = '';
        try {
            if (el && el.name) {
                const prev = document.querySelector(`input[name="${cssEscape(el.name)}"]:checked`);
                if (prev && prev.id) prevCheckedId = prev.id;
            }
        } catch { }

        if (!el) {
            const aria = queryDeepAll(`[role="radio"][aria-checked]`).find(node => {
                const name = (node.getAttribute('name') || node.getAttribute('data-name') || '').toLowerCase();
                const txt = (node.textContent || '').toLowerCase();
                const key = baseKey.toLowerCase();
                return (name.includes(key) || txt.includes(key)) && txt.includes(suffix);
            });
            if (aria) {
                aria.click();
                return true;
            }
            return false;
        }

        const label = el.closest('label') || (el.id ? document.querySelector(`label[for="${el.id}"]`) : null);
        (label || el).click();

        if (!el.checked) {
            el.click();
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }

        if (prevCheckedId && prevCheckedId !== el.id) {
            pushUndo({ type: 'radio', id: baseKey, oldValue: prevCheckedId });
        }
        return true;
    }

    function setBooleanRadioPair(baseKey, boolVal) {
        return setRadioByIdLike(baseKey, boolVal);
    }

    function setCheckboxByLabelText(labelText) {
        if (!labelText) return false;
        const labels = queryDeepAll('label.f-checkbox');
        for (const label of labels) {
            const span = label.querySelector('.f-checkbox__text');
            if (span && span.textContent.includes(labelText)) {
                const chk = label.querySelector('input[type="checkbox"]');
                if (chk) {
                    const prev = chk.checked;
                    if (!chk.checked) {
                        pushUndo({ type: 'checkbox', id: chk.id || '', oldChecked: prev });
                        chk.click();
                    }
                    return true;
                }
            }
        }
        return false;
    }

    function setInputValueWithPolicy(input, value, policy) {
        const { silent } = policy;

        if (!isFillableElement(input)) {
            return { applied: false, reason: 'skipped' };
        }

        const id = input.id || '';
        if (id) pushUndo({ type: 'input', id, oldValue: input.value });

        simulateReactInput(input, String(value ?? ''), { silent: !!silent });
        debugTrace('fill', 'Pole přepsáno', { id: id || '(bez-id)', value: String(value ?? '') });
        return { applied: true, reason: 'filled' };
    }

    function isInvalidDomState(input) {
        try {
            const aria = input.getAttribute('aria-invalid');
            if (aria && aria.toLowerCase() === 'true') return true;
            const cls = (input.className || '').toLowerCase();
            if (cls.includes('error') || cls.includes('invalid')) return true;
        } catch { }
        return false;
    }

    function fillFields(fields, policy, report) {
        let changed = 0;

        for (const f of fields) {
            const el = getFieldElement(f.id, f.labels || []);
            const label = f.uiLabel || f.id || (f.labels && f.labels[0]) || 'Field';

            if (!el) {
                report.addMissing(label);
                pushErrorStat(`Field not found: ${label}`);
                debugTrace('missing', 'Pole nenalezeno', { label, id: f.id || '' });
                continue;
            }

            if (!isFillableElement(el)) {
                report.addSkipped(`${label} (není editovatelné nebo viditelné)`);
                debugTrace('skip', 'Pole není editovatelné nebo viditelné', { label, id: f.id || '' });
                continue;
            }

            const val = f.val;
            const res = setInputValueWithPolicy(el, val, policy);

            if (res.reason === 'skipped') {
                report.addSkipped(label);
                continue;
            }

            const v = validateValueByField(f.validateKey || '', val);
            if (!v.ok) {
                report.addInvalid(label, v.msg);
                highlight(el, v.level === 'warn' ? 'warn' : 'bad');
            } else {
                highlight(el, 'ok');
            }

            if (isInvalidDomState(el)) {
                report.addInvalid(label, 'Pole je po vyplnění označené jako nevalidní v UI (aria-invalid / error class).');
                highlight(el, 'bad');
            }

            report.addFilled(label);
            changed++;
        }

        return changed;
    }

    function loadPersonData() {
        try {
            const raw = localStorage.getItem(PERSON_DATA_KEY);
            if (!raw) return { firstName: '', lastName: '', birthNumber: '', birthDate: '' };

            const parsed = safeJsonParse(raw, null);
            if (!parsed) return { firstName: '', lastName: '', birthNumber: '', birthDate: '' };

            let firstName = parsed.firstName || '';
            let lastName = parsed.lastName || '';

            const repaired = maybeRepairStoredName(firstName, lastName);
            if (repaired) {
                firstName = repaired.firstName;
                lastName = repaired.lastName;
            }

            return {
                firstName,
                lastName,
                birthNumber: parsed.birthNumber || '',
                birthDate: parsed.birthDate || ''
            };
        } catch (e) {
            log.error('loadPersonData error', e);
            return { firstName: '', lastName: '', birthNumber: '', birthDate: '' };
        }
    }

    function savePersonData(data) {
        const sanitizedFirstName = sanitizeStoredNameField(data.firstName || '');
        const sanitizedLastName = sanitizeStoredNameField(data.lastName || '');
        const repaired = maybeRepairStoredName(sanitizedFirstName, sanitizedLastName);
        const clean = {
            firstName: (repaired?.firstName || sanitizedFirstName || '').trim(),
            lastName: (repaired?.lastName || sanitizedLastName || '').trim(),
            birthNumber: (data.birthNumber || '').trim(),
            birthDate: (data.birthDate || '').trim()
        };

        try {
            localStorage.setItem(PERSON_DATA_KEY, JSON.stringify(clean));
        } catch (e) {
            log.error('savePersonData error', e);
        }

        return clean;
    }

    function clearPersonData() {
        try { localStorage.removeItem(PERSON_DATA_KEY); } catch (e) { log.error('clearPersonData error', e); }
    }

    function formatBirthNumber(raw) {
        const digits = (raw || '').replace(/\D/g, '');
        if (digits.length <= 6) return digits;
        return digits.slice(0, 6) + '/' + digits.slice(6);
    }

    const TITLE_TOKENS = new Set([
        'ing', 'mgr', 'bc', 'bca', 'bca', 'phdr', 'mudr', 'rndr', 'judr', 'mvdr', 'pharmdr',
        'doc', 'prof', 'thdr', 'thlic', 'thmgr', 'dr', 'drcs', 'drsc',
        'arch', 'ingarch',
        'phd', 'mba', 'llm', 'csc', 'dis', 'msc', 'bba', 'cfa'
    ]);

    const CORPORATE_MARKERS = new Set([
        'sro', 's.r.o', 'as', 'a.s', 'vos', 'v.o.s', 'ks', 'k.s', 'ops', 'o.p.s', 'zs', 'z.s'
    ]);

    function normalizeTitleToken(tok) {
        return String(tok || '')
            .trim()
            .toLowerCase()
            .replace(/[.,]/g, '')
            .replace(/\u00A0/g, '');
    }

    function isTitleToken(tok) {
        const t = normalizeTitleToken(tok);
        return TITLE_TOKENS.has(t);
    }

    function cleanNameText(text) {
        return String(text || '')
            .replace(/,/g, ' ')
            .replace(/\u00A0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function tokenizeName(text) {
        const cleaned = cleanNameText(text);
        return cleaned ? cleaned.split(' ').filter(Boolean) : [];
    }

    function stripTitleTokensAnywhere(tokens) {
        return tokens.filter(tok => !isTitleToken(tok));
    }

    function sanitizeStoredNameField(text) {
        return stripTitleTokensAnywhere(tokenizeName(text)).join(' ');
    }

    function hasCorporateMarker(tokens) {
        for (const raw of tokens) {
            const t = normalizeTitleToken(raw);
            if (CORPORATE_MARKERS.has(t)) return true;
        }
        return false;
    }

    function parsePersonName(text) {
        // Běžné vstupy, které má parser zvládnout:
        // "Ing. Jan Novák", "Jan Novák, MBA", "NOVÁK JAN", "Jan Novák ml.", "Bc. Jan Novák DiS."
        const tokens0 = tokenizeName(text);
        if (tokens0.length < 2) return null;

        if (hasCorporateMarker(tokens0)) return null;

        const tokens = stripTitleTokensAnywhere(tokens0);
        if (tokens.length < 2) return null;

        return {
            firstName: tokens[0],
            lastName: tokens.slice(1).join(' ')
        };
    }

    function maybeRepairStoredName(firstName, lastName) {
        const sanitizedFirstName = sanitizeStoredNameField(firstName || '');
        const sanitizedLastName = sanitizeStoredNameField(lastName || '');
        const combined = cleanNameText(`${sanitizedFirstName} ${sanitizedLastName}`);
        if (!combined) return null;

        if ((combined !== cleanNameText(`${firstName || ''} ${lastName || ''}`)) || !sanitizedFirstName || !sanitizedLastName) {
            const parsed = parsePersonName(combined);
            if (parsed) return parsed;
        }

        return {
            firstName: sanitizedFirstName,
            lastName: sanitizedLastName
        };
    }

    function extractNameFromPage() {
        if (!location.href.includes('/business-detail')) return null;

        const items = queryDeepAll('li.c-list__item');
        for (const li of items) {
            const labelSpan = li.querySelector('.c-list__label span');
            const contentEl = li.querySelector('.c-list__content');
            if (!labelSpan || !contentEl) continue;

            if (labelSpan.textContent.trim() !== 'Obchodní jméno') continue;

            const textRaw = (contentEl.textContent || '').trim();
            if (!textRaw) return null;

            if (/\d/.test(textRaw)) return null;

            const parsed = parsePersonName(textRaw);
            if (parsed && parsed.firstName && parsed.lastName) return parsed;

            return null;
        }

        return null;
    }

    function ensurePersonPanel() {
        let panel = document.getElementById('ibaf-person-panel');
        if (panel) return panel;

        panel = document.createElement('div');
        panel.id = 'ibaf-person-panel';
        panel.innerHTML = `
  <div class="ibaf-panel-header">
    <div class="title">
      <span>👤 Údaje klienta</span>
      <span class="ibaf-badge">Jméno • Příjmení • Rodné číslo • Datum narození</span>
    </div>
    <button type="button" data-action="close" aria-label="Close">✕</button>
  </div>

  <div class="ibaf-panel-body">
    <div class="ibaf-hint">Tyto údaje mají prioritu před datasety profilu (Občanka a Sekundární doklad).</div>

    <div class="ibaf-row">
      <div class="ibaf-field">
        <label for="ibaf-person-firstName">Jméno</label>
        <input id="ibaf-person-firstName" type="text" autocomplete="off">
      </div>
      <div class="ibaf-field">
        <label for="ibaf-person-lastName">Příjmení</label>
        <input id="ibaf-person-lastName" type="text" autocomplete="off">
      </div>
    </div>

    <div class="ibaf-row">
      <div class="ibaf-field">
        <label for="ibaf-person-birthNumber">Rodné číslo</label>
        <input id="ibaf-person-birthNumber" type="text" autocomplete="off" placeholder="např. 900101/1234">
      </div>
      <div class="ibaf-field">
        <label for="ibaf-person-birthDate">Datum narození</label>
        <input id="ibaf-person-birthDate" type="text" placeholder="dd.mm.rrrr" autocomplete="off">
      </div>
    </div>
  </div>

  <div class="ibaf-panel-footer">
    <button type="button" data-action="clear">Vymazat</button>
    <button type="button" data-action="save">Uložit</button>
  </div>

  <div class="ibaf-status" aria-live="polite"></div>
`;

        document.body.appendChild(panel);

        const firstNameInput = panel.querySelector('#ibaf-person-firstName');
        const lastNameInput = panel.querySelector('#ibaf-person-lastName');
        const birthNumberInput = panel.querySelector('#ibaf-person-birthNumber');
        const birthDateInput = panel.querySelector('#ibaf-person-birthDate');
        const statusEl = panel.querySelector('.ibaf-status');

        const hydrate = () => {
            const stored = loadPersonData();
            let { firstName, lastName, birthNumber, birthDate } = stored;

            if (!firstName && !lastName) {
                const fromPage = extractNameFromPage();
                if (fromPage) {
                    firstName = fromPage.firstName;
                    lastName = fromPage.lastName;
                }
            }

            firstNameInput.value = firstName || '';
            lastNameInput.value = lastName || '';
            birthNumberInput.value = birthNumber || '';
            birthDateInput.value = birthDate || '';

            if (stored.firstName || stored.lastName || stored.birthNumber || stored.birthDate) {
                statusEl.textContent = 'Uloženo. Použije se na Občance a Sekundárním dokladu.';
            } else if (firstName || lastName) {
                statusEl.textContent = 'Jméno a příjmení je načtené z Business detail. Ulož, pokud to chceš používat dál.';
            } else {
                statusEl.textContent = '';
            }
        };

        const setStatus = (msg) => { statusEl.textContent = msg || ''; };

        hydrate();

        panel.addEventListener('click', (e) => {
            const action = e.target?.dataset?.action;
            if (!action) return;

            if (action === 'close') {
                panel.classList.remove('show');
                return;
            }

            if (action === 'save') {
                const saved = savePersonData({
                    firstName: firstNameInput.value,
                    lastName: lastNameInput.value,
                    birthNumber: birthNumberInput.value,
                    birthDate: birthDateInput.value
                });

                if (saved.firstName || saved.lastName || saved.birthNumber || saved.birthDate) {
                    setStatus('Uloženo. Údaje se budou doplňovat, pokud formulář obsahuje odpovídající pole.');
                } else {
                    setStatus('Údaje byly vymazány.');
                }
                return;
            }

            if (action === 'clear') {
                firstNameInput.value = '';
                lastNameInput.value = '';
                birthNumberInput.value = '';
                birthDateInput.value = '';
                clearPersonData();
                setStatus('Údaje byly vymazány.');
                return;
            }
        });

        window.addEventListener('mousedown', (e) => {
            if (!panel.classList.contains('show')) return;
            if (e.target.closest && e.target.closest('#ibaf-person-panel')) return;
            panel.classList.remove('show');
        }, true);

        return panel;
    }

    function reportToText(r) {
        if (!r) return 'Žádný report.';

        const lines = [];
        lines.push(`AutoFill report: ${r.actionName}`);
        lines.push(`Čas: ${r.at}`);
        if (r.variant) lines.push(`Varianta: ${r.variant}`);
        lines.push(`Shrnutí: ${r.summary()}`);
        lines.push('');

        lines.push(`✅ Vyplněno (${r.filled.length}): ${r.filled.join(', ')}`);
        lines.push(`⏭ Přeskočeno (${r.skipped.length}): ${r.skipped.join(', ')}`);
        lines.push(`❌ Nenalezeno (${r.missing.length}): ${r.missing.join(', ')}`);
        lines.push(`⚠️ Varování (${r.invalid.length}): ${r.invalid.map(x => `${x.label}${x.msg ? ` (${x.msg})` : ''}`).join(', ')}`);

        if (r.notes && r.notes.length) {
            lines.push('');
            lines.push('Poznámky:');
            for (const n of r.notes) lines.push(`- ${n}`);
        }

        return lines.join('\n');
    }

    async function copyToClipboard(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch { }

        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
            return true;
        } catch { }

        return false;
    }

    function renderList(container, items, formatter) {
        container.innerHTML = '';
        const arr = Array.isArray(items) ? items : [];

        if (arr.length === 0) {
            const div = document.createElement('div');
            div.className = 'ibaf-report-item';
            const key = document.createElement('div');
            key.className = 'k';
            key.textContent = '—';
            const value = document.createElement('div');
            value.className = 'v';
            value.textContent = 'Nic';
            div.append(key, value);
            container.appendChild(div);
            return;
        }

        for (const it of arr) {
            const { k, v } = formatter(it);
            const div = document.createElement('div');
            div.className = 'ibaf-report-item';
            const key = document.createElement('div');
            key.className = 'k';
            key.textContent = String(k ?? '');
            const value = document.createElement('div');
            value.className = 'v';
            value.textContent = String(v ?? '');
            div.append(key, value);
            container.appendChild(div);
        }
    }

    function renderReportIntoPanel(panel, r) {
        const summaryEl = panel.querySelector('#ibaf-report-summary');
        const metaEl = panel.querySelector('#ibaf-report-meta');

        const filledEl = panel.querySelector('#ibaf-report-filled');
        const skippedEl = panel.querySelector('#ibaf-report-skipped');
        const missingEl = panel.querySelector('#ibaf-report-missing');
        const invalidEl = panel.querySelector('#ibaf-report-invalid');
        const notesEl = panel.querySelector('#ibaf-report-notes');

        if (!r) {
            summaryEl.textContent = '—';
            metaEl.textContent = 'Zatím tu nic není. Spusť nějakou akci a vrať se sem.';
            renderList(filledEl, [], it => ({ k: '', v: String(it) }));
            renderList(skippedEl, [], it => ({ k: '', v: String(it) }));
            renderList(missingEl, [], it => ({ k: '', v: String(it) }));
            renderList(invalidEl, [], it => ({ k: '', v: String(it) }));
            renderList(notesEl, [], it => ({ k: '', v: String(it) }));
            return;
        }

        summaryEl.textContent = r.summary();

        const metaParts = [];
        metaParts.push(`Akce: ${r.actionName}`);
        metaParts.push(`Čas: ${r.at}`);
        if (r.variant) metaParts.push(`Varianta: ${r.variant}`);

        metaEl.textContent = metaParts.join(' • ');

        renderList(filledEl, r.filled, it => ({ k: 'Vyplněno', v: String(it) }));
        renderList(skippedEl, r.skipped, it => ({ k: 'Přeskočeno', v: String(it) }));
        renderList(missingEl, r.missing, it => ({ k: 'Nenalezeno', v: String(it) }));
        renderList(invalidEl, r.invalid, it => ({ k: String(it.label), v: String(it.msg || 'Varování') }));
        renderList(notesEl, r.notes || [], it => ({ k: 'Poznámka', v: String(it) }));
    }

    function ensureReportPanel() {
        let panel = document.getElementById('ibaf-report-panel');
        if (panel) return panel;

        panel = document.createElement('div');
        panel.id = 'ibaf-report-panel';
        panel.innerHTML = `
  <div class="ibaf-panel-header">
    <div class="title">
      <span>📋 Poslední report</span>
      <span class="ibaf-badge" id="ibaf-report-summary">—</span>
    </div>
    <button type="button" data-action="close" aria-label="Close">✕</button>
  </div>

  <div class="ibaf-panel-body">
    <div class="ibaf-hint" id="ibaf-report-meta"></div>

    <div class="ibaf-report-grid">
      <div>
        <div class="ibaf-hint">✅ Vyplněno</div>
        <div class="ibaf-report-list" id="ibaf-report-filled"></div>
      </div>
      <div>
        <div class="ibaf-hint">⏭ Přeskočeno</div>
        <div class="ibaf-report-list" id="ibaf-report-skipped"></div>
      </div>
      <div>
        <div class="ibaf-hint">❌ Nenalezeno</div>
        <div class="ibaf-report-list" id="ibaf-report-missing"></div>
      </div>
      <div>
        <div class="ibaf-hint">⚠️ Varování / validace</div>
        <div class="ibaf-report-list" id="ibaf-report-invalid"></div>
      </div>
    </div>

    <div class="ibaf-hint" style="margin-top:8px">Poznámky</div>
    <div class="ibaf-report-list" id="ibaf-report-notes"></div>
  </div>

  <div class="ibaf-panel-footer">
    <button type="button" data-action="clear">Smazat report</button>
    <button type="button" data-action="copy">Kopírovat shrnutí</button>
  </div>

  <div class="ibaf-status" aria-live="polite"></div>
`;

        document.body.appendChild(panel);

        panel.addEventListener('click', (e) => {
            const action = e.target?.dataset?.action;
            if (!action) return;

            const status = panel.querySelector('.ibaf-status');
            const setStatus = (m) => { status.textContent = m || ''; };

            if (action === 'close') {
                panel.classList.remove('show');
                return;
            }

            if (action === 'clear') {
                lastReport = null;
                renderReportIntoPanel(panel, null);
                setStatus('Report byl smazán.');
                return;
            }

            if (action === 'copy') {
                const txt = reportToText(lastReport);
                copyToClipboard(txt).then(ok => {
                    setStatus(ok ? 'Zkopírováno do schránky.' : 'Kopírování selhalo. Označ text a Ctrl+C.');
                });
                return;
            }
        });

        window.addEventListener('mousedown', (e) => {
            if (!panel.classList.contains('show')) return;
            if (e.target.closest && e.target.closest('#ibaf-report-panel')) return;
            panel.classList.remove('show');
        }, true);

        return panel;
    }

    function openReportPanelNear(btn) {
        const panel = ensureReportPanel();
        renderReportIntoPanel(panel, lastReport);
        openPanelNear(btn, panel, 640, 560);
    }

    function ensureDataPanel() {
        let panel = document.getElementById('ibaf-data-panel');
        if (panel) return panel;

        panel = document.createElement('div');
        panel.id = 'ibaf-data-panel';
        panel.innerHTML = `
  <div class="ibaf-panel-header">
    <div class="title">
      <span>🧩 Data AutoFill</span>
      <span class="ibaf-badge" id="ibaf-set-badge">Agresivní režim</span>
    </div>
    <button type="button" data-action="close" aria-label="Close">✕</button>
  </div>

  <div class="ibaf-panel-body">
    <details class="ibaf-details" open>
      <summary>🧩 Varianta datasetu (default / STANDALONE / BUNDLE)</summary>
      <div class="ibaf-hint">Vyplňování je napevno agresivní. Tady upravuješ jen data a varianty.</div>

      <div class="ibaf-row">
        <div class="ibaf-field">
          <label for="ibaf-set-autoDetectVariant">Auto-detekce varianty (snr/productType)</label>
          <select id="ibaf-set-autoDetectVariant">
            <option value="true">Ano</option>
            <option value="false">Ne</option>
          </select>
        </div>
        <div class="ibaf-field">
          <label for="ibaf-set-activeVariant">Vybraná varianta (pokud je auto-detekce vypnutá)</label>
          <select id="ibaf-set-activeVariant">
            <option value="default">default</option>
            <option value="SME_STANDALONE">SME_STANDALONE</option>
            <option value="SME_BUNDLE">SME_BUNDLE</option>
          </select>
        </div>
      </div>

      <div class="ibaf-hint">Každá varianta může přepsat část datasetů. Pokud nic nenastavíš, použije se "default".</div>
    </details>

    <details class="ibaf-details" open>
      <summary>📱 Telefon + Email</summary>
      <div class="ibaf-hint">Použije se při akci „Vyplnit Telefon + Email“.</div>
      <div class="ibaf-row">
        <div class="ibaf-field">
          <label for="ibaf-set-phone">Telefon</label>
          <input id="ibaf-set-phone" type="text" autocomplete="off" placeholder="např. 720123456">
        </div>
        <div class="ibaf-field">
          <label for="ibaf-set-email">Email</label>
          <input id="ibaf-set-email" type="text" autocomplete="off" placeholder="např. jmeno@moneta.cz">
        </div>
      </div>
    </details>

    <details class="ibaf-details">
      <summary>🪪 Dataset: Občanka</summary>
      <div class="ibaf-hint">Pozn.: Jméno/Příjmení/RČ/Datum narození se bere primárně z panelu 👤 Údaje klienta.</div>

      <div class="ibaf-row">
        <div class="ibaf-field">
          <label for="ibaf-id-street">Ulice</label>
          <input id="ibaf-id-street" type="text">
        </div>
        <div class="ibaf-field">
          <label for="ibaf-id-descriptiveNumber">Číslo popisné</label>
          <input id="ibaf-id-descriptiveNumber" type="text">
        </div>
        <div class="ibaf-field">
          <label for="ibaf-id-orientationNumber">Číslo orientační</label>
          <input id="ibaf-id-orientationNumber" type="text">
        </div>
      </div>

      <div class="ibaf-row">
        <div class="ibaf-field">
          <label for="ibaf-id-town">Obec / Město</label>
          <input id="ibaf-id-town" type="text">
        </div>
        <div class="ibaf-field">
          <label for="ibaf-id-zip">PSČ</label>
          <input id="ibaf-id-zip" type="text">
        </div>
        <div class="ibaf-field">
          <label for="ibaf-id-birthPlace">Místo narození</label>
          <input id="ibaf-id-birthPlace" type="text">
        </div>
      </div>

      <div class="ibaf-row">
        <div class="ibaf-field">
          <label for="ibaf-id-documentNumber">Číslo dokladu</label>
          <input id="ibaf-id-documentNumber" type="text">
        </div>
        <div class="ibaf-field">
          <label for="ibaf-id-documentValidTo">Platnost dokladu do</label>
          <input id="ibaf-id-documentValidTo" type="text" placeholder="dd.mm.rrrr">
        </div>
      </div>

      <div class="ibaf-hint">Edituješ vždy dataset pro aktuálně vybranou variantu.</div>
    </details>

    <details class="ibaf-details">
      <summary>🪪 Dataset: Sekundární doklad</summary>
      <div class="ibaf-hint">Pozn.: Jméno/Příjmení/RČ/Datum narození se bere primárně z panelu 👤 Údaje klienta.</div>

      <div class="ibaf-row">
        <div class="ibaf-field">
          <label for="ibaf-sec-birthPlace">Místo narození</label>
          <input id="ibaf-sec-birthPlace" type="text">
        </div>
        <div class="ibaf-field">
          <label for="ibaf-sec-documentNumber">Číslo dokladu</label>
          <input id="ibaf-sec-documentNumber" type="text">
        </div>
        <div class="ibaf-field">
          <label for="ibaf-sec-documentValidTo">Platnost dokladu do</label>
          <input id="ibaf-sec-documentValidTo" type="text" placeholder="dd.mm.rrrr">
        </div>
      </div>

      <div class="ibaf-hint">Edituješ vždy dataset pro aktuálně vybranou variantu.</div>
    </details>

    <details class="ibaf-details">
      <summary>📄 Dataset: Doplňující údaje</summary>
      <div class="ibaf-hint">Dropdowny se vybírají podle přesného textu položky (label).</div>

      <div class="ibaf-row">
        <div class="ibaf-field">
          <label for="ibaf-add-turnoverLastYear">Obrat za minulý rok</label>
          <input id="ibaf-add-turnoverLastYear" type="text">
        </div>
        <div class="ibaf-field">
          <label for="ibaf-add-netAnnuallyBusinessProfit">Čistý roční zisk z podnikání</label>
          <input id="ibaf-add-netAnnuallyBusinessProfit" type="text">
        </div>
        <div class="ibaf-field">
          <label for="ibaf-add-netMonthlyHouseholdIncome">Čistý měsíční příjem domácnosti</label>
          <input id="ibaf-add-netMonthlyHouseholdIncome" type="text">
        </div>
      </div>

      <div class="ibaf-row">
        <div class="ibaf-field">
          <label for="ibaf-add-employeeCount">Počet zaměstnanců</label>
          <input id="ibaf-add-employeeCount" type="text">
        </div>
        <div class="ibaf-field">
          <label for="ibaf-add-educationLabel">Vzdělání (label)</label>
          <input id="ibaf-add-educationLabel" type="text" placeholder="např. Vysokoškolské">
        </div>
        <div class="ibaf-field">
          <label for="ibaf-add-maritalStatusLabel">Rodinný stav (label)</label>
          <input id="ibaf-add-maritalStatusLabel" type="text" placeholder="např. svobodný/svobodná">
        </div>
      </div>

      <div class="ibaf-row">
        <div class="ibaf-field">
          <label for="ibaf-add-czeTaxDomicileOnly">Daňový domicil pouze ČR</label>
          <select id="ibaf-add-czeTaxDomicileOnly">
            <option value="true">Ano</option>
            <option value="false">Ne</option>
          </select>
        </div>
        <div class="ibaf-field">
          <label for="ibaf-add-foreignEstablishments">Zahraniční provozovny</label>
          <select id="ibaf-add-foreignEstablishments">
            <option value="false">Ne</option>
            <option value="true">Ano</option>
          </select>
        </div>
        <div class="ibaf-field">
          <label for="ibaf-add-hasAnonymousPartner">Anonymní partner</label>
          <select id="ibaf-add-hasAnonymousPartner">
            <option value="false">Ne</option>
            <option value="true">Ano</option>
          </select>
        </div>
        <div class="ibaf-field">
          <label for="ibaf-add-pepFlag">PEP</label>
          <select id="ibaf-add-pepFlag">
            <option value="false">Ne</option>
            <option value="true">Ano</option>
          </select>
        </div>
      </div>

      <div class="ibaf-hint">Edituješ vždy dataset pro aktuálně vybranou variantu.</div>
    </details>

    <details class="ibaf-details">
      <summary>✅ Dataset: AML</summary>
      <div class="ibaf-hint">Preferuje se klik podle ID. Pokud ID necháš prázdné, použije se zpřesněná heuristika.</div>

      <div class="ibaf-row single">
        <div class="ibaf-field">
          <label for="ibaf-aml-incomeSourceText">Zdroj příjmů (text checkboxu)</label>
          <input id="ibaf-aml-incomeSourceText" type="text" placeholder="např. Příjmy z podnikání">
        </div>
      </div>

      <div class="ibaf-row">
        <div class="ibaf-field">
          <label for="ibaf-aml-transactionTypeId">Typ transakcí (ID)</label>
          <input id="ibaf-aml-transactionTypeId" type="text" placeholder="např. transactionType_value-CASH">
        </div>
        <div class="ibaf-field">
          <label for="ibaf-aml-companyTurnoverId">Obrat společnosti (ID)</label>
          <input id="ibaf-aml-companyTurnoverId" type="text" placeholder="např. companyTurnover_value-DO_500_000">
        </div>
      </div>

      <div class="ibaf-row single">
        <div class="ibaf-field">
          <label for="ibaf-aml-mainAccountFlagId">Hlavní účet (ID)</label>
          <input id="ibaf-aml-mainAccountFlagId" type="text" placeholder="např. mainAccountFlag_value-true">
        </div>
      </div>

      <div class="ibaf-hint">Edituješ vždy dataset pro aktuálně vybranou variantu.</div>
    </details>

    <details class="ibaf-details">
      <summary>📦 Export / Import</summary>
      <div class="ibaf-hint">Exportuj dle potřeby. Import umí sloučení nebo úplné přepsání.</div>

      <div class="ibaf-row">
        <div class="ibaf-field">
          <label for="ibaf-exp-scope">Export rozsah</label>
          <select id="ibaf-exp-scope">
            <option value="settings">Celá data skriptu</option>
            <option value="datasetsOnly">Jen datasety</option>
          </select>
        </div>
        <div class="ibaf-field">
          <label for="ibaf-imp-mode">Import režim</label>
          <select id="ibaf-imp-mode">
            <option value="merge">Sloučit data (doplnit / přepsat jen to, co je v JSON)</option>
            <option value="overwrite">Přepsat vše (nahradit celý datový objekt)</option>
          </select>
        </div>
      </div>

      <div class="ibaf-row single">
        <div class="ibaf-field">
          <label for="ibaf-json-area">JSON</label>
          <textarea id="ibaf-json-area" spellcheck="false" placeholder="Export vygeneruje JSON sem. Import očekává JSON zde."></textarea>
        </div>
      </div>

      <div class="ibaf-panel-footer" style="justify-content:flex-start">
        <button type="button" data-action="export">Export</button>
        <button type="button" data-action="copy">Kopírovat</button>
        <button type="button" data-action="import">Import</button>
      </div>
    </details>

    <details class="ibaf-details">
      <summary>📈 Statistiky (lokální)</summary>
      <div class="ibaf-hint">Počty použití akcí a poslední chyby (nenalezená pole). Nikam se to neposílá.</div>
      <div class="ibaf-row single">
        <div class="ibaf-field">
          <label for="ibaf-stats-area">Statistiky</label>
          <textarea id="ibaf-stats-area" spellcheck="false" readonly></textarea>
        </div>
      </div>
      <div class="ibaf-panel-footer" style="justify-content:flex-start">
        <button type="button" data-action="refreshStats">Obnovit</button>
        <button type="button" data-action="clearStats">Smazat</button>
      </div>
    </details>

    <details class="ibaf-details">
      <summary>🪲 Debug</summary>
      <div class="ibaf-hint">Krátký debug buffer pro aktuální session. Pomůže při rozbití po změně UI.</div>
      <div class="ibaf-row single">
        <div class="ibaf-field">
          <label for="ibaf-debug-area">Debug záznamy</label>
          <textarea id="ibaf-debug-area" spellcheck="false" readonly></textarea>
        </div>
      </div>
      <div class="ibaf-panel-footer" style="justify-content:flex-start">
        <button type="button" data-action="refreshDebug">Obnovit</button>
        <button type="button" data-action="clearDebug">Smazat</button>
      </div>
    </details>

  </div>

  <div class="ibaf-panel-footer">
    <button type="button" data-action="defaultsProfile">Defaulty profilu</button>
    <button type="button" data-action="save" data-primary="1">Uložit</button>
  </div>

  <div class="ibaf-status" aria-live="polite"></div>
`;

        document.body.appendChild(panel);

        const ui = {
            badge: panel.querySelector('#ibaf-set-badge'),
            autoDetectVariant: panel.querySelector('#ibaf-set-autoDetectVariant'),
            activeVariant: panel.querySelector('#ibaf-set-activeVariant'),

            phone: panel.querySelector('#ibaf-set-phone'),
            email: panel.querySelector('#ibaf-set-email'),

            id_street: panel.querySelector('#ibaf-id-street'),
            id_desc: panel.querySelector('#ibaf-id-descriptiveNumber'),
            id_orient: panel.querySelector('#ibaf-id-orientationNumber'),
            id_town: panel.querySelector('#ibaf-id-town'),
            id_zip: panel.querySelector('#ibaf-id-zip'),
            id_birthPlace: panel.querySelector('#ibaf-id-birthPlace'),
            id_docNum: panel.querySelector('#ibaf-id-documentNumber'),
            id_docValid: panel.querySelector('#ibaf-id-documentValidTo'),

            sec_birthPlace: panel.querySelector('#ibaf-sec-birthPlace'),
            sec_docNum: panel.querySelector('#ibaf-sec-documentNumber'),
            sec_docValid: panel.querySelector('#ibaf-sec-documentValidTo'),

            add_turnover: panel.querySelector('#ibaf-add-turnoverLastYear'),
            add_profit: panel.querySelector('#ibaf-add-netAnnuallyBusinessProfit'),
            add_income: panel.querySelector('#ibaf-add-netMonthlyHouseholdIncome'),
            add_emp: panel.querySelector('#ibaf-add-employeeCount'),
            add_edu: panel.querySelector('#ibaf-add-educationLabel'),
            add_mar: panel.querySelector('#ibaf-add-maritalStatusLabel'),
            add_cze: panel.querySelector('#ibaf-add-czeTaxDomicileOnly'),
            add_foreign: panel.querySelector('#ibaf-add-foreignEstablishments'),
            add_anon: panel.querySelector('#ibaf-add-hasAnonymousPartner'),
            add_pep: panel.querySelector('#ibaf-add-pepFlag'),

            aml_incomeSource: panel.querySelector('#ibaf-aml-incomeSourceText'),
            aml_tx: panel.querySelector('#ibaf-aml-transactionTypeId'),
            aml_turn: panel.querySelector('#ibaf-aml-companyTurnoverId'),
            aml_main: panel.querySelector('#ibaf-aml-mainAccountFlagId'),

            exp_scope: panel.querySelector('#ibaf-exp-scope'),
            imp_mode: panel.querySelector('#ibaf-imp-mode'),
            json_area: panel.querySelector('#ibaf-json-area'),

            stats_area: panel.querySelector('#ibaf-stats-area'),
            debug_area: panel.querySelector('#ibaf-debug-area'),
            status: panel.querySelector('.ibaf-status')
        };

        const setStatus = (m) => { ui.status.textContent = m || ''; };

        function getSelectedVariantKey(p) {
            if (p.autoDetectVariant) return 'default';
            const v = String(p.activeVariant || 'default');
            return (p.variants && p.variants[v]) ? v : 'default';
        }

        function hydrate() {
            const p = getActiveProfile();

            const runtimeVariant = getEffectiveVariant(p);
            ui.badge.textContent = `Runtime varianta: ${runtimeVariant}`;

            ui.autoDetectVariant.value = String(!!p.autoDetectVariant);
            ui.activeVariant.value = p.activeVariant || 'default';

            ui.phone.value = p.phone || '';
            ui.email.value = p.email || '';

            const vKey = getSelectedVariantKey(p);
            const vData = deepMerge(defaultVariantData(), p.variants[vKey] || {});

            ui.id_street.value = vData.idCard.street || '';
            ui.id_desc.value = vData.idCard.descriptiveNumber || '';
            ui.id_orient.value = vData.idCard.orientationNumber || '';
            ui.id_town.value = vData.idCard.town || '';
            ui.id_zip.value = vData.idCard.zip || '';
            ui.id_birthPlace.value = vData.idCard.birthPlace || '';
            ui.id_docNum.value = vData.idCard.documentNumber || '';
            ui.id_docValid.value = vData.idCard.documentValidTo || '';

            ui.sec_birthPlace.value = vData.secondaryDoc.birthPlace || '';
            ui.sec_docNum.value = vData.secondaryDoc.documentNumber || '';
            ui.sec_docValid.value = vData.secondaryDoc.documentValidTo || '';

            ui.add_turnover.value = vData.additionalInfo.turnoverLastYear || '';
            ui.add_profit.value = vData.additionalInfo.netAnnuallyBusinessProfit || '';
            ui.add_income.value = vData.additionalInfo.netMonthlyHouseholdIncome || '';
            ui.add_emp.value = vData.additionalInfo.employeeCount || '';
            ui.add_edu.value = vData.additionalInfo.educationLabel || '';
            ui.add_mar.value = vData.additionalInfo.maritalStatusLabel || '';
            ui.add_cze.value = String(!!vData.additionalInfo.czeTaxDomicileOnly);
            ui.add_foreign.value = String(!!vData.additionalInfo.foreignEstablishments);
            ui.add_anon.value = String(!!vData.additionalInfo.hasAnonymousPartner);
            ui.add_pep.value = String(!!vData.additionalInfo.pepFlag);

            ui.aml_incomeSource.value = vData.aml.incomeSourceText || '';
            ui.aml_tx.value = vData.aml.transactionTypeId || '';
            ui.aml_turn.value = vData.aml.companyTurnoverId || '';
            ui.aml_main.value = vData.aml.mainAccountFlagId || '';

            refreshStatsText();
            setStatus(`Edituješ data pro variantu: ${vKey}`);
        }

        function collect() {
            const s = loadSettings();
            const p = s;

            p.autoDetectVariant = ui.autoDetectVariant.value === 'true';
            p.activeVariant = ui.activeVariant.value || 'default';

            p.phone = (ui.phone.value || '').trim();
            p.email = (ui.email.value || '').trim();

            const vKey = getSelectedVariantKey(p);

            if (!p.variants) p.variants = { default: defaultVariantData() };
            if (!p.variants[vKey]) p.variants[vKey] = {};

            const vOverride = {
                idCard: deepMerge(DEFAULT_ID_CARD_DATA, {
                    street: (ui.id_street.value || '').trim(),
                    descriptiveNumber: (ui.id_desc.value || '').trim(),
                    orientationNumber: (ui.id_orient.value || '').trim(),
                    town: (ui.id_town.value || '').trim(),
                    zip: (ui.id_zip.value || '').trim(),
                    birthPlace: (ui.id_birthPlace.value || '').trim(),
                    documentNumber: (ui.id_docNum.value || '').trim(),
                    documentValidTo: (ui.id_docValid.value || '').trim()
                }),
                secondaryDoc: deepMerge(DEFAULT_SECONDARY_DOC_DATA, {
                    birthPlace: (ui.sec_birthPlace.value || '').trim(),
                    documentNumber: (ui.sec_docNum.value || '').trim(),
                    documentValidTo: (ui.sec_docValid.value || '').trim()
                }),
                additionalInfo: deepMerge(DEFAULT_ADDITIONAL_INFO_DATA, {
                    turnoverLastYear: (ui.add_turnover.value || '').trim(),
                    netAnnuallyBusinessProfit: (ui.add_profit.value || '').trim(),
                    netMonthlyHouseholdIncome: (ui.add_income.value || '').trim(),
                    employeeCount: (ui.add_emp.value || '').trim(),
                    educationLabel: (ui.add_edu.value || '').trim(),
                    maritalStatusLabel: (ui.add_mar.value || '').trim(),
                    czeTaxDomicileOnly: ui.add_cze.value === 'true',
                    foreignEstablishments: ui.add_foreign.value === 'true',
                    hasAnonymousPartner: ui.add_anon.value === 'true',
                    pepFlag: ui.add_pep.value === 'true'
                }),
                aml: deepMerge(DEFAULT_AML_DATA, {
                    incomeSourceText: (ui.aml_incomeSource.value || '').trim(),
                    transactionTypeId: (ui.aml_tx.value || '').trim(),
                    companyTurnoverId: (ui.aml_turn.value || '').trim(),
                    mainAccountFlagId: (ui.aml_main.value || '').trim()
                })
            };

            p.variants[vKey] = vOverride;

            return s;
        }

        function refreshStatsText() {
            const st = loadStats();
            ui.stats_area.value = JSON.stringify(st, null, 2);
        }

        function refreshDebugText() {
            ui.debug_area.value = getDebugText();
        }

        function doExport() {
            const s = loadSettings();
            const scope = ui.exp_scope.value;

            let payload = null;

            if (scope === 'settings') {
                payload = s;
            } else if (scope === 'datasetsOnly') {
                payload = { variants: s.variants, activeVariant: s.activeVariant, autoDetectVariant: s.autoDetectVariant };
            } else {
                payload = s;
            }

            ui.json_area.value = JSON.stringify(payload, null, 2);
            setStatus('Export hotový.');
            debugTrace('export', 'Export dat připraven', { scope });
        }

        function doImport() {
            const raw = (ui.json_area.value || '').trim();
            if (!raw) { setStatus('JSON je prázdný.'); return; }

            const mode = ui.imp_mode.value;
            const incoming = safeJsonParse(raw, null);
            if (!incoming) { setStatus('Nevalidní JSON.'); return; }

            if (mode === 'overwrite') {
                saveSettings(normalizeSettings(incoming));
                setStatus('Import hotový: přepsaná celá data.');
                debugTrace('import', 'Import dat přepsal celý objekt');
                hydrate();
                refreshBtn();
                return;
            }

            const current = loadSettings();
            let merged = null;

            if (isObj(incoming)) {
                merged = deepMerge(current, incoming);
                saveSettings(normalizeSettings(merged));
                setStatus('Import hotový: sloučení dat.');
                debugTrace('import', 'Import dat provedl merge');
            } else {
                setStatus('Neznamy format JSON pro import.');
            }

            hydrate();
            refreshBtn();
        }

        panel.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            if (!action) return;

            if (action === 'close') {
                panel.classList.remove('show');
                return;
            }

            if (action === 'defaultsProfile') {
                resetProfileToDefaults();
                hydrate();
                refreshBtn();
                setStatus('Nactena defaultni data.');
                debugTrace('reset', 'Načtena výchozí data skriptu');
                return;
            }

            if (action === 'save') {
                const s = collect();
                if (saveSettings(s)) {
                    hydrate();
                    refreshBtn();
                    setStatus('Uloženo.');
                    debugTrace('save', 'Data panel uložen');
                } else {
                    setStatus('Uložení selhalo (localStorage).');
                }
                return;
            }

            if (action === 'export') {
                doExport();
                return;
            }

            if (action === 'copy') {
                const txt = (ui.json_area.value || '').trim();
                if (!txt) { setStatus('Nemám co kopírovat.'); return; }
                copyToClipboard(txt).then(ok => {
                    setStatus(ok ? 'Zkopírováno do schránky.' : 'Kopírování selhalo. Označ text a Ctrl+C.');
                });
                return;
            }

            if (action === 'import') {
                doImport();
                return;
            }

            if (action === 'refreshStats') {
                refreshStatsText();
                setStatus('Statistiky obnoveny.');
                return;
            }

            if (action === 'clearStats') {
                try { localStorage.removeItem(STATS_KEY); } catch {}
                refreshStatsText();
                setStatus('Statistiky smazány.');
                return;
            }

            if (action === 'refreshDebug') {
                refreshDebugText();
                setStatus('Debug obnoven.');
                return;
            }

            if (action === 'clearDebug') {
                debugBuffer.length = 0;
                refreshDebugText();
                setStatus('Debug smazán.');
                return;
            }
        });

        window.addEventListener('mousedown', e => {
            if (!panel.classList.contains('show')) return;
            if (e.target.closest && e.target.closest('#ibaf-data-panel')) return;
            panel.classList.remove('show');
        }, true);

        hydrate();
        refreshDebugText();
        return panel;
    }

    function openPanelNear(btn, panel, panelWidth = 520, panelHeight = 520) {
        const rect = btn.getBoundingClientRect();
        const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
        const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);

        let left = rect.right + 12;
        let top = rect.top;

        if (left + panelWidth > vw - CLAMP_MARGIN) {
            left = Math.max(CLAMP_MARGIN, vw - panelWidth - CLAMP_MARGIN);
        }
        if (top + panelHeight > vh - CLAMP_MARGIN) {
            top = Math.max(CLAMP_MARGIN, vh - panelHeight - CLAMP_MARGIN);
        }

        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.classList.add('show');
    }

    function openPersonPanelNear(btn) {
        openPanelNear(btn, ensurePersonPanel(), 600, 260);
    }

    function openDataPanelNear(btn) {
        openPanelNear(btn, ensureDataPanel(), 640, 640);
    }

    function selectorLabels(key) {
        return SELECTOR_REGISTRY.fieldLabels[key] || [];
    }

    function buildFieldsFromMap(map, data) {
        return map.map(field => ({
            id: field.id,
            labels: field.labels || selectorLabels(field.selectorKey),
            uiLabel: field.uiLabel,
            validateKey: field.validateKey || '',
            val: data[field.dataKey]
        }));
    }

    function createReport(actionName) {
        const p = getActiveProfile();
        const { variantKey } = getEffectiveDatasets(p);

        const r = new Reporter(actionName);
        r.variant = variantKey;
        return r;
    }

    function fillPhoneAndEmail(btn) {
        bumpActionStat('phone');
        const p = getActiveProfile();
        const r = createReport('Telefon + Email');

        const fields = buildFieldsFromMap(ACTION_FIELD_MAPS.phone, p);

        const policy = { profile: p, silent: true };
        const changed = fillFields(fields, policy, r);

        r.addNote('Režim: agresivní přepis');
        lastReport = r;

        if (btn) toast(`📱 Telefon+Email: ${r.summary()}`, btn);
        return changed;
    }

    function fillIdentityCard(btn) {
        bumpActionStat('idc');
        const p = getActiveProfile();
        const { datasets } = getEffectiveDatasets(p);
        const r = createReport('Občanka');

        const person = loadPersonData();
        const base = deepMerge(DEFAULT_ID_CARD_DATA, datasets.idCard || {});

        if (person) {
            if (person.firstName) base.firstName = person.firstName;
            if (person.lastName) base.lastName = person.lastName;
            if (person.birthDate) base.birthDate = person.birthDate;
            if (person.birthNumber) base.birthNumber = formatBirthNumber(person.birthNumber);
        }

        const fields = buildFieldsFromMap(ACTION_FIELD_MAPS.idc, base);

        const policy = { profile: p, silent: false };
        const changed = fillFields(fields, policy, r);

        r.addNote('Režim: agresivní přepis');
        lastReport = r;

        if (btn) toast(`🪪 Občanka: ${r.summary()}`, btn);
        return changed;
    }

    function fillSecondaryDoc(btn) {
        bumpActionStat('sec');
        const p = getActiveProfile();
        const { datasets } = getEffectiveDatasets(p);
        const r = createReport('Sekundární doklad');

        const person = loadPersonData();
        const base = deepMerge(DEFAULT_SECONDARY_DOC_DATA, datasets.secondaryDoc || {});

        if (person) {
            if (person.firstName) base.firstName = person.firstName;
            if (person.lastName) base.lastName = person.lastName;
            if (person.birthDate) base.birthDate = person.birthDate;
            if (person.birthNumber) base.birthNumber = formatBirthNumber(person.birthNumber);
        }

        const fields = buildFieldsFromMap(ACTION_FIELD_MAPS.sec, base);

        const policy = { profile: p, silent: false };
        const changed = fillFields(fields, policy, r);

        r.addNote('Režim: agresivní přepis');
        lastReport = r;

        if (btn) toast(`🪪 Sek. doklad: ${r.summary()}`, btn);
        return changed;
    }

    async function fillAdditionalInfo(btn) {
        bumpActionStat('add');
        const p = getActiveProfile();
        const { datasets } = getEffectiveDatasets(p);
        const r = createReport('Doplňující údaje');

        const ai = deepMerge(DEFAULT_ADDITIONAL_INFO_DATA, datasets.additionalInfo || {});

        const fields = buildFieldsFromMap(ACTION_FIELD_MAPS.add, ai);

        const policy = { profile: p, silent: false };
        const changed = fillFields(fields, policy, r);

        const okEdu = await selectDropdownValueByText('education', ai.educationLabel);
        okEdu ? r.addFilled(`Vzdělání = ${ai.educationLabel}`) : r.addMissing('Vzdělání (dropdown)');

        const okMar = await selectDropdownValueByText('maritalStatus', ai.maritalStatusLabel);
        okMar ? r.addFilled(`Rodinný stav = ${ai.maritalStatusLabel}`) : r.addMissing('Rodinný stav (dropdown)');

        const b1 = setBooleanRadioPair('czeTaxDomicileOnly', !!ai.czeTaxDomicileOnly);
        b1 ? r.addFilled(`Daňový domicil pouze ČR = ${ai.czeTaxDomicileOnly ? 'Ano' : 'Ne'}`) : r.addMissing('Daňový domicil pouze ČR (radio)');

        const b2 = setBooleanRadioPair('foreignEstablishments', !!ai.foreignEstablishments);
        b2 ? r.addFilled(`Zahraniční provozovny = ${ai.foreignEstablishments ? 'Ano' : 'Ne'}`) : r.addMissing('Zahraniční provozovny (radio)');

        const b3 = setBooleanRadioPair('hasAnonymousPartner', !!ai.hasAnonymousPartner);
        b3 ? r.addFilled(`Anonymní partner = ${ai.hasAnonymousPartner ? 'Ano' : 'Ne'}`) : r.addMissing('Anonymní partner (radio)');

        const b4 = setBooleanRadioPair('pepFlag', !!ai.pepFlag);
        b4 ? r.addFilled(`PEP = ${ai.pepFlag ? 'Ano' : 'Ne'}`) : r.addMissing('PEP (radio)');

        r.addNote('Režim: agresivní přepis');
        lastReport = r;

        if (btn) toast(`📄 Doplňující údaje: ${r.summary()}`, btn);

        return changed;
    }

    function clickByIdDeep(id) {
        if (!id) return false;
        const el = document.getElementById(id) || queryDeepOne('#' + cssEscape(id));
        if (!el) return false;
        return clickLikeUser(el.closest('label') || el);
    }

    function matchesAnyHint(haystack, hints) {
        const low = String(haystack || '').toLowerCase();
        return hints.some(hint => low.includes(String(hint || '').toLowerCase()));
    }

    function clickRadioLikeByHints({ groupHints = [], optionHints = [] } = {}) {
        if (!groupHints.length || !optionHints.length) return false;

        const containerSelectors = [
            'fieldset',
            '[role="radiogroup"]',
            '.f-form-group',
            '.f-radio-group',
            '.c-form-group',
            '.form-group',
            '.o-form-field'
        ];

        const optionSelectors = [
            '[role="radio"]',
            'input[type="radio"]',
            'label',
            'button'
        ].join(',');

        const containers = queryDeepAll(containerSelectors.join(','));
        for (const container of containers) {
            const containerText = String(container.textContent || '');
            if (!matchesAnyHint(containerText, groupHints)) continue;

            const options = [];
            try {
                container.querySelectorAll(optionSelectors).forEach(el => options.push(el));
            } catch {}

            for (const option of options) {
                const optionText = [
                    option.id || '',
                    option.getAttribute?.('for') || '',
                    option.getAttribute?.('name') || '',
                    option.getAttribute?.('value') || '',
                    option.textContent || ''
                ].join(' ');

                if (!matchesAnyHint(optionText, optionHints)) continue;
                return clickLikeUser(option.closest('label') || option);
            }
        }

        return false;
    }

    function fillAML(btn) {
        bumpActionStat('aml');
        const p = getActiveProfile();
        const { datasets } = getEffectiveDatasets(p);
        const r = createReport('AML');

        const aml = deepMerge(DEFAULT_AML_DATA, datasets.aml || {});

        const c1 = setCheckboxByLabelText(aml.incomeSourceText);
        c1 ? r.addFilled(`Zdroj příjmů = ${aml.incomeSourceText}`) : r.addMissing('Zdroj příjmů (checkbox)');

        const ok1 = clickByIdDeep(aml.transactionTypeId) || clickRadioLikeByHints({
            groupHints: ['typ transakc', 'transakc'],
            optionHints: ['cash', 'hotovost']
        });
        ok1 ? r.addFilled('Typ transakcí (radio)') : r.addMissing('Typ transakcí (radio)');
        if (!ok1) debugTrace('aml', 'Nepodařilo se zvolit typ transakcí', { transactionTypeId: aml.transactionTypeId || '' });

        const ok2 = clickByIdDeep(aml.companyTurnoverId) || clickRadioLikeByHints({
            groupHints: ['obrat společnosti', 'obrat'],
            optionHints: ['do 500 000', '500 000', '500000']
        });
        ok2 ? r.addFilled('Obrat společnosti (radio)') : r.addMissing('Obrat společnosti (radio)');
        if (!ok2) debugTrace('aml', 'Nepodařilo se zvolit obrat společnosti', { companyTurnoverId: aml.companyTurnoverId || '' });

        const ok3 = clickByIdDeep(aml.mainAccountFlagId) || setBooleanRadioPair('mainAccountFlag', true);
        ok3 ? r.addFilled('Hlavní účet (radio)') : r.addMissing('Hlavní účet (radio)');
        if (!ok3) debugTrace('aml', 'Nepodařilo se zvolit hlavní účet', { mainAccountFlagId: aml.mainAccountFlagId || '' });

        r.addNote('Režim: agresivní přepis');
        r.addNote('AML používá hlavně klikání a výběry, ne běžné přepisování inputů.');
        lastReport = r;

        if (btn) toast(`✅ AML: ${r.summary()}`, btn);
    }

    function getContextAction() {
        const url = location.href;
        if (url.includes('/aml')) return 'aml';
        if (url.includes('/identity-card-verification')) return 'idc';
        if (url.includes('/secondary-document-verification')) return 'sec';
        if (url.includes('/additional-info')) return 'add';

        const hasPhone = !!getFieldElement('phoneNumber', selectorLabels('phoneNumber'));
        const hasEmail = !!getFieldElement('email', selectorLabels('email'));
        if (hasPhone && hasEmail) return 'phone';

        return null;
    }

    function performAction(cmd, btn) {
        if (cmd === 'phone') return fillPhoneAndEmail(btn);
        if (cmd === 'idc') return fillIdentityCard(btn);
        if (cmd === 'sec') return fillSecondaryDoc(btn);
        if (cmd === 'add') return fillAdditionalInfo(btn);
        if (cmd === 'aml') return fillAML(btn);
    }

    function buildMenu() {
        let m = document.getElementById('ibaf-menu');
        if (m) return m;

        m = document.createElement('div');
        m.id = 'ibaf-menu';
        m.innerHTML = `
  <div class="hint">Vyplňování je vždy agresivní. Menu slouží pro akce, data a report.</div>
  <div class="sep"></div>

  <div class="item" data-cmd="person">👤 Údaje klienta</div>
  <div class="item" data-cmd="data">🧩 Data</div>
  <div class="item" data-cmd="report">📋 Poslední report</div>
  <div class="item" data-cmd="undo">↩️ Vrátit poslední změnu</div>

  <div class="sep"></div>

  <div class="item" data-cmd="phone">📱 Vyplnit Telefon + Email</div>
  <div class="item" data-cmd="idc">🪪 Vyplnit Občanku</div>
  <div class="item" data-cmd="sec">🪪 Vyplnit Sekundární doklad</div>
  <div class="item" data-cmd="add">📄 Vyplnit Doplňující údaje</div>
  <div class="item" data-cmd="aml">✅ Vyplnit AML</div>

  <div class="sep"></div>

  <div class="item" data-cmd="theme">🎨 Změnit barvu tlačítka</div>
  <div class="item" data-cmd="reset">↩️ Reset pozice (levý horní roh)</div>
`;
        document.body.appendChild(m);
        return m;
    }

    function showMenuAt(x, y, btn) {
        const m = buildMenu();
        const url = location.href;

        const setEnabled = (cmd, enabled) => {
            const el = m.querySelector(`.item[data-cmd="${cmd}"]`);
            if (!el) return;
            el.classList.toggle('disabled', !enabled);
        };

        setEnabled('idc', url.includes('/identity-card-verification'));
        setEnabled('sec', url.includes('/secondary-document-verification'));
        setEnabled('add', url.includes('/additional-info'));
        setEnabled('aml', url.includes('/aml'));

        const hasPhone = !!getFieldElement('phoneNumber', selectorLabels('phoneNumber'));
        const hasEmail = !!getFieldElement('email', selectorLabels('email'));
        setEnabled('phone', !!(hasPhone && hasEmail));

        setEnabled('person', url.includes('/business-detail'));
        setEnabled('undo', undoStack.length > 0);
        setEnabled('report', !!lastReport);

        m.style.left = x + 'px';
        m.style.top = y + 'px';
        requestAnimationFrame(() => m.classList.add('show'));

        const onClick = (ev) => {
            const it = ev.target.closest('.item');
            if (!it) return;

            if (it.classList.contains('disabled')) { close(); return; }

            const cmd = it.getAttribute('data-cmd');

            if (cmd === 'theme') {
                toggleTheme(btn);
            } else if (cmd === 'reset') {
                resetTopLeft(btn);
            } else if (cmd === 'person') {
                openPersonPanelNear(btn);
            } else if (cmd === 'data') {
                openDataPanelNear(btn);
            } else if (cmd === 'undo') {
                undoLastChange(btn);
            } else if (cmd === 'report') {
                openReportPanelNear(btn);
            } else {
                performAction(cmd, btn);
            }

            close();
        };

        const close = () => {
            m.classList.remove('show');
            setTimeout(() => {
                m.style.left = '-9999px';
                m.style.top = '-9999px';
            }, 120);

            m.removeEventListener('click', onClick);
            window.removeEventListener('mousedown', outside, true);
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('scroll', close, true);
            window.removeEventListener('resize', close, true);
        };

        const outside = (e) => {
            if (e.target.closest && e.target.closest('#ibaf-menu')) return;
            close();
        };

        const onKey = (e) => { if (e.key === 'Escape') close(); };

        m.addEventListener('click', onClick);
        window.addEventListener('mousedown', outside, true);
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('scroll', close, true);
        window.addEventListener('resize', close, true);

        return m;
    }

    function performDefaultActionOrMenu(btn) {
        const cmd = getContextAction();
        if (cmd) {
            performAction(cmd, btn);
        } else {
            const rect = btn.getBoundingClientRect();
            showMenuAt(rect.right + 8, rect.top, btn);
        }
    }

    function clampBtn(btn) {
        const rect = btn.getBoundingClientRect();
        const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
        const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);

        let top = parseInt(getComputedStyle(btn).top, 10);
        if (isNaN(top)) top = DEFAULT_OFFSET;

        let left = parseInt(getComputedStyle(btn).left, 10);
        if (isNaN(left)) left = DEFAULT_OFFSET;

        const maxLeft = Math.max(CLAMP_MARGIN, vw - rect.width - CLAMP_MARGIN);
        const maxTop = Math.max(CLAMP_MARGIN, vh - rect.height - CLAMP_MARGIN);

        left = Math.min(Math.max(left, CLAMP_MARGIN), maxLeft);
        top = Math.min(Math.max(top, CLAMP_MARGIN), maxTop);

        btn.style.left = left + 'px';
        btn.style.top = top + 'px';
    }

    function resetTopLeft(btn) {
        btn.style.top = DEFAULT_OFFSET + 'px';
        btn.style.left = DEFAULT_OFFSET + 'px';
        clampBtn(btn);
        try {
            localStorage.setItem(POS_KEY, JSON.stringify({ top: btn.style.top, left: btn.style.left }));
        } catch {}
    }

    function loadAndClamp(btn) {
        try {
            const s = safeJsonParse(localStorage.getItem(POS_KEY) || 'null', null);
            if (s && s.top && s.left) { btn.style.top = s.top; btn.style.left = s.left; }
        } catch {}

        document.body.appendChild(btn);
        clampBtn(btn);

        try {
            localStorage.setItem(POS_KEY, JSON.stringify({ top: btn.style.top, left: btn.style.left }));
        } catch {}
    }

    function toggleTheme(btn) {
        const cur = btn.getAttribute('data-theme') || 'teal';
        const idx = Math.max(0, THEMES.indexOf(cur));
        const next = THEMES[(idx + 1) % THEMES.length];
        btn.setAttribute('data-theme', next);
        try { localStorage.setItem(THEME_KEY, next); } catch {}
    }

    function ensureButtonMarkup(btn) {
        if (!btn) return;
        if (btn.querySelector('#ibaf-btn-badge')) return;

        btn.innerHTML =
            '<span class="ibaf-btn-icon" aria-hidden="true">🔧</span>' +
            '<span class="ibaf-btn-badge" id="ibaf-btn-badge" aria-hidden="true">—</span>';
    }

    function ensureButton() {
        let btn = document.getElementById('ibaf-btn');

        if (btn) {
            ensureButtonMarkup(btn);
            return btn;
        }

        injectStyles();

        btn = document.createElement('button');
        btn.id = 'ibaf-btn';
        btn.type = 'button';

        ensureButtonMarkup(btn);

        let theme = 'teal';
        try { theme = localStorage.getItem(THEME_KEY) || 'teal'; } catch {}
        btn.setAttribute('data-theme', THEMES.includes(theme) ? theme : 'teal');

        btn.addEventListener('click', e => {
            if (btn._dragging) return;
            performDefaultActionOrMenu(btn);
        });

        btn.addEventListener('contextmenu', e => {
            e.preventDefault();
            if (btn._dragging) return;
            showMenuAt(e.clientX, e.clientY, btn);
        });

        loadAndClamp(btn);

        btn.style.touchAction = 'none';
        btn.style.transform = 'translate(0,0)';

        let sx = 0, sy = 0, drag = false, start = false, captured = false;
        let curDx = 0, curDy = 0, startTop = 0, startLeft = 0;

        const THRESHOLD = 5;

        btn.addEventListener('pointerdown', e => {
            const cs = getComputedStyle(btn);
            startTop = parseInt(cs.top, 10) || DEFAULT_OFFSET;
            startLeft = parseInt(cs.left, 10) || DEFAULT_OFFSET;
            sx = e.clientX;
            sy = e.clientY;
            curDx = 0;
            curDy = 0;
            drag = false;
            start = true;
            captured = false;
        });

        btn.addEventListener('pointermove', e => {
            if (!start) return;

            const dx = e.clientX - sx;
            const dy = e.clientY - sy;

            if (!drag && (Math.abs(dx) > THRESHOLD || Math.abs(dy) > THRESHOLD)) {
                drag = true;
                btn._dragging = true;
                if (btn.setPointerCapture) { btn.setPointerCapture(e.pointerId); captured = true; }
            }

            if (drag) {
                curDx = dx;
                curDy = dy;
                btn.style.transform = `translate(${dx}px, ${dy}px)`;
                if (e.cancelable) e.preventDefault();
            }
        });

        const finish = e => {
            if (captured && btn.releasePointerCapture) btn.releasePointerCapture(e.pointerId);

            if (drag) {
                const prev = btn.style.transition;
                btn.style.transition = 'none';

                btn.style.top = (startTop + curDy) + 'px';
                btn.style.left = (startLeft + curDx) + 'px';
                btn.style.transform = 'translate(0,0)';

                void btn.offsetHeight;
                clampBtn(btn);

                btn.style.transition = prev;

                try {
                    localStorage.setItem(POS_KEY, JSON.stringify({ top: btn.style.top, left: btn.style.left }));
                } catch {}

                if (e.cancelable) e.preventDefault();
                e.stopPropagation();

                setTimeout(() => { btn._dragging = false; }, 0);
            } else {
                btn._dragging = false;
            }

            drag = false;
            start = false;
            captured = false;
        };

        btn.addEventListener('pointerup', finish);
        btn.addEventListener('pointercancel', finish);
        btn.addEventListener('pointerleave', e => { if (start) finish(e); });

        return btn;
    }

    function shouldShowBtn() {
        const url = location.href;

        if (url.includes('/basic-info')) return false;

        return (
            url.includes('/aml') ||
            url.includes('/identity-card-verification') ||
            url.includes('/secondary-document-verification') ||
            url.includes('/additional-info') ||
            url.includes('/business-detail') ||
            !!getContextAction()
        );
    }

    function refreshBtn() {
        const btn = ensureButton();
        btn.style.display = shouldShowBtn() ? 'flex' : 'none';

        const p = getActiveProfile();
        const runtimeVariant = getEffectiveVariant(p);

        const badgeEl = btn.querySelector(`#${UI_IDS.buttonBadge}`);
        if (badgeEl) {
            badgeEl.textContent = runtimeVariant;
        }

        btn.title =
`AutoFill
Prostředí: ${runtimeVariant}
Klik: akce dle stránky, jinak menu
Pravé tlačítko / Ctrl+Alt+A: menu
Alt+S: Údaje klienta (jen /business-detail)
Alt+E: Data
Alt+R: Poslední report
Alt+Z: Vrátit poslední změnu

Runtime varianta: ${runtimeVariant}
Režim: agresivní`;
    }

    function onSpaUrlChange(cb) {
        let last = location.href;

        const fire = () => {
            const cur = location.href;
            if (cur !== last) {
                last = cur;
                cb(cur);
            }
        };

        const push = history.pushState;
        const wrappedPushState = function () {
            const r = push.apply(this, arguments);
            fire();
            return r;
        };
        history.pushState = wrappedPushState;

        const rep = history.replaceState;
        const wrappedReplaceState = function () {
            const r = rep.apply(this, arguments);
            fire();
            return r;
        };
        history.replaceState = wrappedReplaceState;

        window.addEventListener('popstate', fire);

        const mo = new MutationObserver(() => fire());
        mo.observe(document.body, { childList: true, subtree: true });

        return () => {
            if (history.pushState === wrappedPushState) history.pushState = push;
            if (history.replaceState === wrappedReplaceState) history.replaceState = rep;
            window.removeEventListener('popstate', fire);
            mo.disconnect();
        };
    }

    function handleUrlChange(url) {
        refreshBtn();
    }

    let debounceT = null;
    const mo = new MutationObserver(() => {
        clearTimeout(debounceT);
        debounceT = setTimeout(refreshBtn, 120);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    registerCleanup(() => {
        clearTimeout(debounceT);
        mo.disconnect();
    });

    registerCleanup(onSpaUrlChange(handleUrlChange));

    const onKeydown = e => {
        if (e.altKey && (e.key === 'a' || e.key === 'A') && !e.ctrlKey) {
            e.preventDefault();
            const btn = ensureButton();
            performDefaultActionOrMenu(btn);
            return;
        }

        if (e.altKey && e.ctrlKey && (e.key === 'a' || e.key === 'A')) {
            e.preventDefault();
            const btn = ensureButton();
            const rect = btn.getBoundingClientRect();
            showMenuAt(rect.right + 8, rect.top, btn);
            return;
        }

        if (e.altKey && !e.ctrlKey && (e.key === 's' || e.key === 'S')) {
            if (location.href.includes('/business-detail')) {
                e.preventDefault();
                const btn = ensureButton();
                openPersonPanelNear(btn);
            }
            return;
        }

        if (e.altKey && !e.ctrlKey && (e.key === 'e' || e.key === 'E')) {
            e.preventDefault();
            const btn = ensureButton();
            openDataPanelNear(btn);
            return;
        }

        if (e.altKey && !e.ctrlKey && (e.key === 'r' || e.key === 'R')) {
            e.preventDefault();
            const btn = ensureButton();
            openReportPanelNear(btn);
            return;
        }

        if (e.altKey && !e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault();
            const btn = ensureButton();
            undoLastChange(btn);
            return;
        }
    };
    window.addEventListener('keydown', onKeydown, { passive: false });
    registerCleanup(() => window.removeEventListener('keydown', onKeydown, false));

    function destroyRuntime({ silent = false } = {}) {
        runCleanups();
        removeElementById('ibaf-ntb-style');
        Object.values(UI_IDS).forEach(removeElementById);
        delete window[SCRIPT_KEY];
        if (!silent) console.info('[IBAF] AutoFill snippet odinstalován.');
    }

    handleUrlChange(location.href);
    refreshBtn();

    window[SCRIPT_KEY] = {
        destroy: destroyRuntime,
        refresh: () => refreshBtn(),
        openData: () => openDataPanelNear(ensureButton()),
        openPerson: () => openPersonPanelNear(ensureButton()),
        openReport: () => openReportPanelNear(ensureButton())
    };
    console.info('[IBAF] AutoFill snippet aktivní. API: window.__IBAF_NTB_AUTOFILL_RUNTIME__');

})();
