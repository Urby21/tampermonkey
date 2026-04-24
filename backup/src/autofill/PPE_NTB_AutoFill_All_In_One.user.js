// ==UserScript==
// @name         PPE_NTB_AutoFill_All_In_One
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  AutoFill (phone, email, ID card, secondary doc, additional info, AML)
// @author       Vojtěch Urban (enhanced)
// @match        https://ppe-aplikace.moneta.cz/smeonboarding/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

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

    const AUTO_RUN_SESSION_KEY = 'ibaf.ntb.autoRun.seen';
    const MICRO_CACHE_TTL = 350;

    const log = {
        info: (...a) => DEBUG && console.info('[IBAF]', ...a),
        warn: (...a) => DEBUG && console.warn('[IBAF]', ...a),
        error: (...a) => console.error('[IBAF]', ...a)
    };

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

    const FillMode = Object.freeze({
        SAFE: 'safe',
        NORMAL: 'normal',
        AGGRESSIVE: 'aggressive'
    });

    function defaultVariantData() {
        return {
            idCard: { ...DEFAULT_ID_CARD_DATA },
            secondaryDoc: { ...DEFAULT_SECONDARY_DOC_DATA },
            additionalInfo: { ...DEFAULT_ADDITIONAL_INFO_DATA },
            aml: { ...DEFAULT_AML_DATA }
        };
    }

    function defaultProfileData() {
        return {
            phone: DEFAULT_PHONE_NUMBER,
            email: DEFAULT_EMAIL_ADDRESS,

            variants: {
                default: defaultVariantData(),
                SME_STANDALONE: {},
                SME_BUNDLE: {}
            },

            activeVariant: 'default',
            autoDetectVariant: true,

            autoRunEnabled: false,
            autoRunScope: { phone: true, idc: true, sec: true, add: true, aml: true },

            fillMode: FillMode.NORMAL,
            smartOverwrite: true
        };
    }

    function defaultSettings() {
        return {
            activeProfile: 'Test1',
            profiles: {
                Test1: defaultProfileData(),
                Test2: deepMerge(defaultProfileData(), {
                    phone: '',
                    email: '',
                    variants: {
                        default: {
                            idCard: deepMerge(DEFAULT_ID_CARD_DATA, {
                                street: '', descriptiveNumber: '', orientationNumber: '',
                                town: '', zip: '', birthPlace: '', documentNumber: '', documentValidTo: ''
                            }),
                            secondaryDoc: deepMerge(DEFAULT_SECONDARY_DOC_DATA, {
                                birthPlace: '', documentValidTo: '', documentNumber: ''
                            }),
                            additionalInfo: deepMerge(DEFAULT_ADDITIONAL_INFO_DATA, {
                                turnoverLastYear: '', netAnnuallyBusinessProfit: '',
                                netMonthlyHouseholdIncome: '', employeeCount: '',
                                educationLabel: '', maritalStatusLabel: ''
                            }),
                            aml: deepMerge(DEFAULT_AML_DATA, {
                                incomeSourceText: '', transactionTypeId: '',
                                companyTurnoverId: '', mainAccountFlagId: ''
                            })
                        }
                    }
                })
            }
        };
    }

    function normalizeSettings(parsed) {
        const def = defaultSettings();
        let s = isObj(parsed) ? parsed : {};
        s = deepMerge(def, s);

        if (!isObj(s.profiles)) s.profiles = { ...def.profiles };

        if (!s.profiles.Test1) s.profiles.Test1 = defaultProfileData();
        if (!s.profiles.Test2) s.profiles.Test2 = deepMerge(defaultProfileData(), def.profiles.Test2);

        for (const [name, pRaw] of Object.entries(s.profiles)) {
            const p = deepMerge(defaultProfileData(), isObj(pRaw) ? pRaw : {});

            if (!isObj(p.variants)) p.variants = { default: defaultVariantData() };
            if (!isObj(p.variants.default)) p.variants.default = defaultVariantData();

            if (!p.variants.SME_STANDALONE) p.variants.SME_STANDALONE = {};
            if (!p.variants.SME_BUNDLE) p.variants.SME_BUNDLE = {};

            if (!Object.values(FillMode).includes(p.fillMode)) p.fillMode = FillMode.NORMAL;

            if (!isObj(p.autoRunScope)) p.autoRunScope = { phone: true, idc: true, sec: true, add: true, aml: true };

            if (typeof p.activeVariant !== 'string') p.activeVariant = 'default';
            if (!p.variants[p.activeVariant]) p.activeVariant = 'default';

            s.profiles[name] = p;
        }

        if (!s.profiles[s.activeProfile]) s.activeProfile = 'Test1';
        return s;
    }

    function loadSettings() {
        const def = defaultSettings();
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (!raw) return def;
            return normalizeSettings(safeJsonParse(raw, def));
        } catch (e) {
            log.error('loadSettings error', e);
            return def;
        }
    }

    function saveSettings(settings) {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
            return true;
        } catch (e) {
            log.error('saveSettings error', e);
            return false;
        }
    }

    function getActiveProfileName() {
        return loadSettings().activeProfile || 'Test1';
    }

    function getActiveProfile() {
        const s = loadSettings();
        return s.profiles[s.activeProfile] || s.profiles.Test1;
    }

    function setActiveProfile(name) {
        const s = loadSettings();
        if (!s.profiles[name]) return false;
        s.activeProfile = name;
        saveSettings(s);
        return true;
    }

    function toggleProfile() {
        const s = loadSettings();
        const keys = Object.keys(s.profiles || {});
        if (keys.length <= 1) return s.activeProfile || 'Test1';

        if (s.profiles.Test1 && s.profiles.Test2) {
            s.activeProfile = (s.activeProfile === 'Test1') ? 'Test2' : 'Test1';
            saveSettings(s);
            return s.activeProfile;
        }

        const idx = Math.max(0, keys.indexOf(s.activeProfile));
        const next = keys[(idx + 1) % keys.length];
        s.activeProfile = next;
        saveSettings(s);
        return next;
    }

    function resetProfileToDefaults(profileName) {
        const s = loadSettings();
        if (!s.profiles[profileName]) return false;

        const fresh = defaultProfileData();
        if (profileName === 'Test2') {
            s.profiles[profileName] = deepMerge(fresh, {
                phone: '',
                email: '',
                variants: {
                    default: {
                        idCard: deepMerge(DEFAULT_ID_CARD_DATA, {
                            street: '', descriptiveNumber: '', orientationNumber: '',
                            town: '', zip: '', birthPlace: '', documentNumber: '', documentValidTo: ''
                        }),
                        secondaryDoc: deepMerge(DEFAULT_SECONDARY_DOC_DATA, {
                            birthPlace: '', documentValidTo: '', documentNumber: ''
                        }),
                        additionalInfo: deepMerge(DEFAULT_ADDITIONAL_INFO_DATA, {
                            turnoverLastYear: '', netAnnuallyBusinessProfit: '',
                            netMonthlyHouseholdIncome: '', employeeCount: '',
                            educationLabel: '', maritalStatusLabel: ''
                        }),
                        aml: deepMerge(DEFAULT_AML_DATA, {
                            incomeSourceText: '', transactionTypeId: '',
                            companyTurnoverId: '', mainAccountFlagId: ''
                        })
                    }
                }
            });
        } else {
            s.profiles[profileName] = fresh;
        }

        saveSettings(s);
        return true;
    }

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
#ibaf-settings-panel,
#ibaf-report-panel{
  position:fixed;z-index:2147483647;min-width:360px;max-width:640px;
  background:#0b1220;color:#e2e8f0;border:1px solid rgba(148,163,184,.35);
  border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.55);
  font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  padding:10px 12px 10px 12px;opacity:0;transform:translateY(-4px);pointer-events:none;
  transition:opacity .12s ease,transform .12s ease;
}
#ibaf-person-panel.show,
#ibaf-settings-panel.show,
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

    function isBlank(v) {
        return v == null || String(v).trim() === '';
    }

    function looksLikePlaceholderOrDefault(currentVal) {
        const v = String(currentVal ?? '').trim().toLowerCase();
        if (v === '') return true;
        if (v === '-' || v === '–' || v === 'n/a' || v === 'na') return true;
        if (v === '0' || v === '0,0' || v === '0.0') return true;
        return false;
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
            if (btn) toast('↩️ Nothing to undo (undo history is empty).', btn);
            return false;
        }

        const { type, id, oldValue, oldChecked } = item;

        if (type === 'dropdown') {
            const label = String(oldValue || '');
            if (!label) {
                if (btn) toast('↩️ Undo failed (missing previous dropdown label).', btn);
                return false;
            }

            selectDropdownValueByText(id, label).then(okSel => {
                if (btn) toast(okSel ? '↩️ Last change reverted.' : '↩️ Undo failed (best effort).', btn);
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

        if (btn) toast(ok ? '↩️ Last change reverted.' : '↩️ Undo failed (best effort).', btn);
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
            this.profile = null;
            this.fillMode = null;
            this.smartOverwrite = null;
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

    function shouldOverwriteInput(input, overwrite, profile) {
        const mode = profile.fillMode;
        if (mode === FillMode.SAFE) return false;
        if (mode === FillMode.AGGRESSIVE) return true;

        if (overwrite) return true;

        if (profile.smartOverwrite) {
            return looksLikePlaceholderOrDefault(input.value);
        }
        return false;
    }

    function setInputValueWithPolicy(input, value, policy) {
        const { overwrite, profile, silent } = policy;

        if (!isFillableElement(input)) {
            return { applied: false, reason: 'skipped' };
        }

        if (profile.fillMode === FillMode.SAFE) {
            if (!isBlank(input.value)) return { applied: false, reason: 'skipped' };
            simulateReactInput(input, String(value ?? ''), { silent: !!silent });
            return { applied: true, reason: 'filled' };
        }

        const canOverwrite = shouldOverwriteInput(input, overwrite, profile);
        if (!canOverwrite && !isBlank(input.value)) return { applied: false, reason: 'skipped' };

        const id = input.id || '';
        if (id) pushUndo({ type: 'input', id, oldValue: input.value });

        simulateReactInput(input, String(value ?? ''), { silent: !!silent });
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
                continue;
            }

            if (!isFillableElement(el)) {
                report.addSkipped(`${label} (not editable/visible)`);
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
                report.addInvalid(label, 'Field is marked invalid by UI after fill (aria-invalid / error class).');
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
        if (!r) return 'No report.';

        const lines = [];
        lines.push(`AutoFill report: ${r.actionName}`);
        lines.push(`Time: ${r.at}`);
        if (r.profile) lines.push(`Profile: ${r.profile}`);
        if (r.variant) lines.push(`Variant: ${r.variant}`);
        if (r.fillMode) lines.push(`Fill mode: ${r.fillMode}`);
        if (r.smartOverwrite != null) lines.push(`Smart overwrite: ${r.smartOverwrite ? 'Yes' : 'No'}`);
        lines.push(`Summary: ${r.summary()}`);
        lines.push('');

        lines.push(`✅ Filled (${r.filled.length}): ${r.filled.join(', ')}`);
        lines.push(`⏭ Skipped (${r.skipped.length}): ${r.skipped.join(', ')}`);
        lines.push(`❌ Missing (${r.missing.length}): ${r.missing.join(', ')}`);
        lines.push(`⚠️ Warnings (${r.invalid.length}): ${r.invalid.map(x => `${x.label}${x.msg ? ` (${x.msg})` : ''}`).join(', ')}`);

        if (r.notes && r.notes.length) {
            lines.push('');
            lines.push('Notes:');
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
            container.innerHTML = `<div class="ibaf-report-item"><div class="k">—</div><div class="v">Nic</div></div>`;
            return;
        }

        for (const it of arr) {
            const { k, v } = formatter(it);
            const div = document.createElement('div');
            div.className = 'ibaf-report-item';
            div.innerHTML = `<div class="k">${k}</div><div class="v">${v}</div>`;
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
        if (r.profile) metaParts.push(`Profil: ${r.profile}`);
        if (r.variant) metaParts.push(`Varianta: ${r.variant}`);
        metaParts.push(`Režim: ${r.fillMode || '-'}`);
        metaParts.push(`Smart overwrite: ${r.smartOverwrite ? 'Ano' : 'Ne'}`);

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

    function ensureSettingsPanel() {
        let panel = document.getElementById('ibaf-settings-panel');
        if (panel) return panel;

        panel = document.createElement('div');
        panel.id = 'ibaf-settings-panel';
        panel.innerHTML = `
  <div class="ibaf-panel-header">
    <div class="title">
      <span>⚙️ Nastavení AutoFill</span>
      <span class="ibaf-badge" id="ibaf-set-badge">—</span>
    </div>
    <button type="button" data-action="close" aria-label="Close">✕</button>
  </div>

  <div class="ibaf-panel-body">
    <div class="ibaf-row">
      <div class="ibaf-field">
        <label for="ibaf-set-profile">Aktivní profil</label>
        <select id="ibaf-set-profile"></select>
      </div>
      <div class="ibaf-field">
        <label for="ibaf-set-profileNew">Přidat profil</label>
        <div class="ibaf-row" style="margin:0">
          <input id="ibaf-set-profileNew" type="text" placeholder="např. Test3">
          <button type="button" style="width:120px" data-action="addProfile">Přidat</button>
        </div>
      </div>
    </div>

    <details class="ibaf-details" open>
      <summary>🧠 Režim vyplňování a Auto-run</summary>

      <div class="ibaf-row">
        <div class="ibaf-field">
          <label for="ibaf-set-fillMode">Režim vyplňování</label>
          <select id="ibaf-set-fillMode">
            <option value="safe">Safe: nepřepisovat existující hodnoty</option>
            <option value="normal">Normal: přepis pouze se Shift</option>
            <option value="aggressive">Aggressive: přepisovat vždy</option>
          </select>
        </div>
        <div class="ibaf-field">
          <label for="ibaf-set-smartOverwrite">Smart overwrite (jen "placeholder" hodnoty)</label>
          <select id="ibaf-set-smartOverwrite">
            <option value="true">Ano</option>
            <option value="false">Ne</option>
          </select>
        </div>
      </div>

      <div class="ibaf-row">
        <div class="ibaf-field">
          <label for="ibaf-set-autoRun">Auto-run (spustit akci automaticky po příchodu na stránku)</label>
          <select id="ibaf-set-autoRun">
            <option value="false">Vypnuto</option>
            <option value="true">Zapnuto</option>
          </select>
        </div>
        <div class="ibaf-field">
          <label for="ibaf-set-autoRunHint">Poznámka</label>
          <input id="ibaf-set-autoRunHint" type="text" value="Auto-run se spustí max 1× na konkrétní URL (v rámci session)." readonly>
        </div>
      </div>

      <div class="ibaf-row">
        <div class="ibaf-field">
          <label>Auto-run rozsah</label>
          <div class="ibaf-hint">Vyber, které stránky může Auto-run vyplňovat.</div>
          <div class="ibaf-row" style="margin:0;flex-wrap:wrap">
            <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="ibaf-ar-phone"> Telefon+Email</label>
            <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="ibaf-ar-idc"> Občanka</label>
            <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="ibaf-ar-sec"> Sek. doklad</label>
            <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="ibaf-ar-add"> Additional info</label>
            <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="ibaf-ar-aml"> AML</label>
          </div>
        </div>
      </div>
    </details>

    <details class="ibaf-details" open>
      <summary>🧩 Varianta datasetu (default / STANDALONE / BUNDLE)</summary>

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
      <summary>📄 Dataset: Additional info</summary>
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
      <div class="ibaf-hint">Preferuje se klik podle ID. Pokud ID necháš prázdné, použije se heuristika (best effort).</div>

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
      <div class="ibaf-hint">Exportuj dle potřeby. Import umí merge nebo overwrite.</div>

      <div class="ibaf-row">
        <div class="ibaf-field">
          <label for="ibaf-exp-scope">Export rozsah</label>
          <select id="ibaf-exp-scope">
            <option value="settings">Celé nastavení (settings)</option>
            <option value="profiles">Jen profily (profiles)</option>
            <option value="activeProfile">Jen aktivní profil</option>
            <option value="activeProfileDatasets">Jen datasety aktivního profilu</option>
          </select>
        </div>
        <div class="ibaf-field">
          <label for="ibaf-imp-mode">Import režim</label>
          <select id="ibaf-imp-mode">
            <option value="merge">Merge (doplnit / přepsat jen co je v JSON)</option>
            <option value="overwrite">Overwrite (přepsat celé settings)</option>
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
            profileSel: panel.querySelector('#ibaf-set-profile'),
            profileNew: panel.querySelector('#ibaf-set-profileNew'),

            fillMode: panel.querySelector('#ibaf-set-fillMode'),
            smartOverwrite: panel.querySelector('#ibaf-set-smartOverwrite'),
            autoRun: panel.querySelector('#ibaf-set-autoRun'),

            ar_phone: panel.querySelector('#ibaf-ar-phone'),
            ar_idc: panel.querySelector('#ibaf-ar-idc'),
            ar_sec: panel.querySelector('#ibaf-ar-sec'),
            ar_add: panel.querySelector('#ibaf-ar-add'),
            ar_aml: panel.querySelector('#ibaf-ar-aml'),

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
            status: panel.querySelector('.ibaf-status')
        };

        const setStatus = (m) => { ui.status.textContent = m || ''; };

        function profileNames(settings) {
            return Object.keys(settings.profiles || {}).sort((a, b) => a.localeCompare(b, 'cs'));
        }

        function renderProfileOptions() {
            const s = loadSettings();
            const names = profileNames(s);

            ui.profileSel.innerHTML = '';
            for (const n of names) {
                const opt = document.createElement('option');
                opt.value = n;
                opt.textContent = n;
                ui.profileSel.appendChild(opt);
            }

            ui.profileSel.value = s.activeProfile;
        }

        function getSelectedVariantKey(p) {
            if (p.autoDetectVariant) return 'default';
            const v = String(p.activeVariant || 'default');
            return (p.variants && p.variants[v]) ? v : 'default';
        }

        function hydrate() {
            const s = loadSettings();
            renderProfileOptions();

            const p = s.profiles[s.activeProfile] || s.profiles.Test1;

            const runtimeVariant = getEffectiveVariant(p);
            ui.badge.textContent = `${s.activeProfile} • runtime varianta: ${runtimeVariant}`;

            ui.fillMode.value = p.fillMode;
            ui.smartOverwrite.value = String(!!p.smartOverwrite);
            ui.autoRun.value = String(!!p.autoRunEnabled);

            ui.ar_phone.checked = !!p.autoRunScope.phone;
            ui.ar_idc.checked = !!p.autoRunScope.idc;
            ui.ar_sec.checked = !!p.autoRunScope.sec;
            ui.ar_add.checked = !!p.autoRunScope.add;
            ui.ar_aml.checked = !!p.autoRunScope.aml;

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
            setStatus(`Upravuješ: profil ${s.activeProfile} • dataset varianta v editoru: ${vKey}`);
        }

        function collect() {
            const s = loadSettings();
            const profileName = ui.profileSel.value || s.activeProfile;

            if (!s.profiles[profileName]) s.profiles[profileName] = defaultProfileData();
            const p = s.profiles[profileName];

            p.fillMode = ui.fillMode.value;
            p.smartOverwrite = ui.smartOverwrite.value === 'true';
            p.autoRunEnabled = ui.autoRun.value === 'true';

            p.autoRunScope = {
                phone: !!ui.ar_phone.checked,
                idc: !!ui.ar_idc.checked,
                sec: !!ui.ar_sec.checked,
                add: !!ui.ar_add.checked,
                aml: !!ui.ar_aml.checked
            };

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

            s.profiles[profileName] = p;
            s.activeProfile = profileName;

            return s;
        }

        function refreshStatsText() {
            const st = loadStats();
            ui.stats_area.value = JSON.stringify(st, null, 2);
        }

        function doExport() {
            const s = loadSettings();
            const scope = ui.exp_scope.value;

            let payload = null;

            if (scope === 'settings') {
                payload = s;
            } else if (scope === 'profiles') {
                payload = { profiles: s.profiles };
            } else if (scope === 'activeProfile') {
                payload = { profileName: s.activeProfile, profile: s.profiles[s.activeProfile] };
            } else if (scope === 'activeProfileDatasets') {
                const p = s.profiles[s.activeProfile];
                payload = { profileName: s.activeProfile, variants: p.variants, activeVariant: p.activeVariant, autoDetectVariant: p.autoDetectVariant };
            } else {
                payload = s;
            }

            ui.json_area.value = JSON.stringify(payload, null, 2);
            setStatus('Export hotový.');
        }

        function doImport() {
            const raw = (ui.json_area.value || '').trim();
            if (!raw) { setStatus('JSON je prázdný.'); return; }

            const mode = ui.imp_mode.value;
            const incoming = safeJsonParse(raw, null);
            if (!incoming) { setStatus('Nevalidní JSON.'); return; }

            if (mode === 'overwrite') {
                saveSettings(normalizeSettings(incoming));
                setStatus('Import hotový: overwrite celé settings.');
                hydrate();
                refreshBtn();
                return;
            }

            const current = loadSettings();
            let merged = null;

            if (isObj(incoming) && isObj(incoming.profiles)) {
                merged = deepMerge(current, incoming);
                saveSettings(normalizeSettings(merged));
                setStatus('Import hotový: merge settings.');
            }

            else if (isObj(incoming) && isObj(incoming.profiles) === false && (isObj(incoming.Test1) || isObj(incoming.Test2))) {
                merged = deepMerge(current, { profiles: incoming });
                saveSettings(normalizeSettings(merged));
                setStatus('Import hotový: merge profiles.');
            }

            else if (isObj(incoming) && typeof incoming.profileName === 'string' && isObj(incoming.profile)) {
                const name = incoming.profileName.trim();
                const patch = { profiles: { [name]: incoming.profile } };
                merged = deepMerge(current, patch);
                saveSettings(normalizeSettings(merged));
                setStatus(`Import hotový: merge profil "${name}".`);
            }

            else if (isObj(incoming) && typeof incoming.profileName === 'string' && isObj(incoming.variants)) {
                const name = incoming.profileName.trim();
                const patch = {
                    profiles: {
                        [name]: deepMerge(defaultProfileData(), {
                            variants: incoming.variants,
                            activeVariant: incoming.activeVariant,
                            autoDetectVariant: incoming.autoDetectVariant
                        })
                    }
                };
                merged = deepMerge(current, patch);
                saveSettings(normalizeSettings(merged));
                setStatus(`Import hotový: merge datasety profilu "${name}".`);
            }

            else if (isObj(incoming)) {
                const name = (incoming.profileName && typeof incoming.profileName === 'string')
                ? incoming.profileName.trim()
                : current.activeProfile;

                const patch = { profiles: { [name]: incoming.profile ? incoming.profile : incoming } };
                merged = deepMerge(current, patch);
                saveSettings(normalizeSettings(merged));
                setStatus(`Import hotový: merge (odhad) profil "${name}".`);
            } else {
                setStatus('Neznámý formát JSON pro import.');
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

            if (action === 'addProfile') {
                const name = (ui.profileNew.value || '').trim();
                if (!name) {
                    setStatus('Zadej název profilu (např. Test3).');
                    return;
                }
                const s = loadSettings();
                if (s.profiles[name]) {
                    setStatus('Profil s tímto názvem už existuje.');
                    return;
                }
                s.profiles[name] = defaultProfileData();
                s.activeProfile = name;
                saveSettings(s);

                ui.profileNew.value = '';
                hydrate();
                refreshBtn();
                setStatus(`Profil "${name}" byl vytvořen.`);
                return;
            }

            if (action === 'defaultsProfile') {
                const name = ui.profileSel.value || getActiveProfileName();
                resetProfileToDefaults(name);
                hydrate();
                refreshBtn();
                setStatus(`Defaulty načtené pro profil ${name}.`);
                return;
            }

            if (action === 'save') {
                const s = collect();
                if (saveSettings(s)) {
                    hydrate();
                    refreshBtn();
                    setStatus('Uloženo.');
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
        });

        ui.profileSel.addEventListener('change', () => {
            setActiveProfile(ui.profileSel.value);
            hydrate();
            refreshBtn();
        });

        window.addEventListener('mousedown', e => {
            if (!panel.classList.contains('show')) return;
            if (e.target.closest && e.target.closest('#ibaf-settings-panel')) return;
            panel.classList.remove('show');
        }, true);

        hydrate();
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

    function openSettingsPanelNear(btn) {
        openPanelNear(btn, ensureSettingsPanel(), 640, 640);
    }

    const FIELD_FALLBACKS = {
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
    };

    function createReport(actionName) {
        const pName = getActiveProfileName();
        const p = getActiveProfile();
        const { variantKey } = getEffectiveDatasets(p);

        const r = new Reporter(actionName);
        r.profile = pName;
        r.variant = variantKey;
        r.fillMode = p.fillMode;
        r.smartOverwrite = !!p.smartOverwrite;
        return r;
    }

    function fillPhoneAndEmail({ overwrite = false } = {}, btn) {
        bumpActionStat('phone');
        const p = getActiveProfile();
        const r = createReport('Telefon + Email');

        const fields = [
            {
                id: 'phoneNumber',
                labels: FIELD_FALLBACKS.phoneNumber,
                val: p.phone || '',
                uiLabel: 'Telefon',
                validateKey: 'phone'
            },
            {
                id: 'email',
                labels: FIELD_FALLBACKS.email,
                val: p.email || '',
                uiLabel: 'Email',
                validateKey: 'email'
            }
        ];

        const policy = { overwrite, profile: p, silent: true };
        const changed = fillFields(fields, policy, r);

        r.addNote(`Overwrite: ${overwrite ? 'Ano' : 'Ne'}`);
        lastReport = r;

        if (btn) toast(`📱 Telefon+Email: ${r.summary()}`, btn);
        return changed;
    }

    function fillIdentityCard({ overwrite = false } = {}, btn) {
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

        const fields = [
            { id: 'firstName', labels: ['Jméno'], val: base.firstName, uiLabel: 'Jméno' },
            { id: 'lastName', labels: ['Příjmení'], val: base.lastName, uiLabel: 'Příjmení' },
            { id: 'birthDate', labels: ['Datum narození'], val: base.birthDate, uiLabel: 'Datum narození', validateKey: 'date' },
            { id: 'birthNumber', labels: ['Rodné číslo'], val: base.birthNumber, uiLabel: 'Rodné číslo', validateKey: 'birthNumber' },

            { id: 'street', labels: FIELD_FALLBACKS.street, val: base.street, uiLabel: 'Ulice' },
            { id: 'descriptiveNumber', labels: FIELD_FALLBACKS.descriptiveNumber, val: base.descriptiveNumber, uiLabel: 'Číslo popisné' },
            { id: 'orientationNumber', labels: FIELD_FALLBACKS.orientationNumber, val: base.orientationNumber, uiLabel: 'Číslo orientační' },

            { id: 'town', labels: FIELD_FALLBACKS.town, val: base.town, uiLabel: 'Obec / Město' },
            { id: 'zip', labels: FIELD_FALLBACKS.zip, val: base.zip, uiLabel: 'PSČ', validateKey: 'zip' },
            { id: 'birthPlace', labels: FIELD_FALLBACKS.birthPlace, val: base.birthPlace, uiLabel: 'Místo narození' },

            { id: 'documentNumber', labels: FIELD_FALLBACKS.documentNumber, val: base.documentNumber, uiLabel: 'Číslo dokladu' },
            { id: 'documentValidTo', labels: FIELD_FALLBACKS.documentValidTo, val: base.documentValidTo, uiLabel: 'Platnost dokladu do', validateKey: 'date' }
        ];

        const policy = { overwrite, profile: p, silent: false };
        const changed = fillFields(fields, policy, r);

        r.addNote(`Overwrite: ${overwrite ? 'Ano' : 'Ne'}`);
        lastReport = r;

        if (btn) toast(`🪪 Občanka: ${r.summary()}`, btn);
        return changed;
    }

    function fillSecondaryDoc({ overwrite = false } = {}, btn) {
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

        const fields = [
            { id: 'firstName', labels: ['Jméno'], val: base.firstName, uiLabel: 'Jméno' },
            { id: 'lastName', labels: ['Příjmení'], val: base.lastName, uiLabel: 'Příjmení' },
            { id: 'birthDate', labels: ['Datum narození'], val: base.birthDate, uiLabel: 'Datum narození', validateKey: 'date' },
            { id: 'birthNumber', labels: ['Rodné číslo'], val: base.birthNumber, uiLabel: 'Rodné číslo', validateKey: 'birthNumber' },

            { id: 'birthPlace', labels: FIELD_FALLBACKS.birthPlace, val: base.birthPlace, uiLabel: 'Místo narození' },
            { id: 'documentNumber', labels: FIELD_FALLBACKS.documentNumber, val: base.documentNumber, uiLabel: 'Číslo dokladu' },
            { id: 'documentValidTo', labels: FIELD_FALLBACKS.documentValidTo, val: base.documentValidTo, uiLabel: 'Platnost dokladu do', validateKey: 'date' }
        ];

        const policy = { overwrite, profile: p, silent: false };
        const changed = fillFields(fields, policy, r);

        r.addNote(`Overwrite: ${overwrite ? 'Ano' : 'Ne'}`);
        lastReport = r;

        if (btn) toast(`🪪 Sek. doklad: ${r.summary()}`, btn);
        return changed;
    }

    async function fillAdditionalInfo({ overwrite = false } = {}, btn) {
        bumpActionStat('add');
        const p = getActiveProfile();
        const { datasets } = getEffectiveDatasets(p);
        const r = createReport('Additional info');

        const ai = deepMerge(DEFAULT_ADDITIONAL_INFO_DATA, datasets.additionalInfo || {});

        const fields = [
            { id: 'turnoverLastYear', labels: FIELD_FALLBACKS.turnoverLastYear, val: ai.turnoverLastYear, uiLabel: 'Obrat za minulý rok', validateKey: 'money' },
            { id: 'netAnnuallyBusinessProfit', labels: FIELD_FALLBACKS.netAnnuallyBusinessProfit, val: ai.netAnnuallyBusinessProfit, uiLabel: 'Čistý roční zisk z podnikání', validateKey: 'money' },
            { id: 'netMonthlyHouseholdIncome', labels: FIELD_FALLBACKS.netMonthlyHouseholdIncome, val: ai.netMonthlyHouseholdIncome, uiLabel: 'Čistý měsíční příjem domácnosti', validateKey: 'money' },
            { id: 'employeeCount', labels: FIELD_FALLBACKS.employeeCount, val: ai.employeeCount, uiLabel: 'Počet zaměstnanců', validateKey: 'money' }
        ];

        const policy = { overwrite, profile: p, silent: false };
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

        r.addNote(`Overwrite: ${overwrite ? 'Ano' : 'Ne'}`);
        lastReport = r;

        if (btn) toast(`📄 Additional info: ${r.summary()}`, btn);

        return changed;
    }

    function clickByIdDeep(id) {
        if (!id) return false;
        const el = document.getElementById(id) || queryDeepOne('#' + cssEscape(id));
        if (!el) return false;
        return clickLikeUser(el.closest('label') || el);
    }

    function clickByContainsDeep(needle) {
        if (!needle) return false;
        const low = String(needle || '').toLowerCase();
        const els = queryDeepAll('[role="radio"], input[type="radio"], label, button, div, span')
        .filter(el => {
            const s = ((el.id || '') + ' ' + (el.getAttribute?.('for') || '') + ' ' + (el.textContent || '')).toLowerCase();
            return s.includes(low);
        });
        if (els[0]) return clickLikeUser(els[0]);
        return false;
    }

    function fillAML({ overwrite = false } = {}, btn) {
        bumpActionStat('aml');
        const p = getActiveProfile();
        const { datasets } = getEffectiveDatasets(p);
        const r = createReport('AML');

        const aml = deepMerge(DEFAULT_AML_DATA, datasets.aml || {});

        const c1 = setCheckboxByLabelText(aml.incomeSourceText);
        c1 ? r.addFilled(`Zdroj příjmů = ${aml.incomeSourceText}`) : r.addMissing('Zdroj příjmů (checkbox)');

        const ok1 = clickByIdDeep(aml.transactionTypeId) || clickByContainsDeep('cash');
        ok1 ? r.addFilled('Typ transakcí (radio)') : r.addMissing('Typ transakcí (radio)');

        const ok2 = clickByIdDeep(aml.companyTurnoverId) || clickByContainsDeep('500');
        ok2 ? r.addFilled('Obrat společnosti (radio)') : r.addMissing('Obrat společnosti (radio)');

        const ok3 = clickByIdDeep(aml.mainAccountFlagId) || setBooleanRadioPair('mainAccountFlag', true);
        ok3 ? r.addFilled('Hlavní účet (radio)') : r.addMissing('Hlavní účet (radio)');

        r.addNote(`Overwrite: ${overwrite ? 'Ano' : 'Ne'} (AML typicky používá kliky, overwrite se týká jen inputů)`);
        lastReport = r;

        if (btn) toast(`✅ AML: ${r.summary()}`, btn);
    }

    function getContextAction() {
        const url = location.href;
        if (url.includes('/aml')) return 'aml';
        if (url.includes('/identity-card-verification')) return 'idc';
        if (url.includes('/secondary-document-verification')) return 'sec';
        if (url.includes('/additional-info')) return 'add';

        const hasPhone = !!getFieldElement('phoneNumber', FIELD_FALLBACKS.phoneNumber);
        const hasEmail = !!getFieldElement('email', FIELD_FALLBACKS.email);
        if (hasPhone && hasEmail) return 'phone';

        return null;
    }

    function performAction(cmd, { overwrite = false } = {}, btn) {
        if (cmd === 'phone') return fillPhoneAndEmail({ overwrite }, btn);
        if (cmd === 'idc') return fillIdentityCard({ overwrite }, btn);
        if (cmd === 'sec') return fillSecondaryDoc({ overwrite }, btn);
        if (cmd === 'add') return fillAdditionalInfo({ overwrite }, btn);
        if (cmd === 'aml') return fillAML({ overwrite }, btn);
    }

    function loadAutoRunSeen() {
        try {
            const raw = sessionStorage.getItem(AUTO_RUN_SESSION_KEY);
            return raw ? safeJsonParse(raw, {}) : {};
        } catch {
            return {};
        }
    }

    function saveAutoRunSeen(map) {
        try {
            sessionStorage.setItem(AUTO_RUN_SESSION_KEY, JSON.stringify(map || {}));
        } catch {}
    }

    function maybeAutoRun(btn) {
        const p = getActiveProfile();
        if (!p.autoRunEnabled) return false;

        const cmd = getContextAction();
        if (!cmd) return false;

        if (!p.autoRunScope || !p.autoRunScope[cmd]) return false;

        const seen = loadAutoRunSeen();
        const key = location.href;
        if (seen[key]) return false;

        seen[key] = true;
        saveAutoRunSeen(seen);

        performAction(cmd, { overwrite: false }, btn);
        toast(`🧭 Auto-run: spuštěno (${cmd}).`, btn, 1400);
        return true;
    }

    function buildMenu() {
        let m = document.getElementById('ibaf-menu');
        if (m) return m;

        m = document.createElement('div');
        m.id = 'ibaf-menu';
        m.innerHTML = `
  <div class="hint">Tip: Shift + klik na akci = přepsat pole (pokud režim není Safe).</div>
  <div class="sep"></div>

  <div class="item" data-cmd="person">👤 Údaje klienta</div>
  <div class="item" data-cmd="report">📋 Poslední report</div>
  <div class="item" data-cmd="undo">↩️ Vrátit poslední změnu</div>

  <div class="sep"></div>

  <div class="item" data-cmd="phone">📱 Vyplnit Telefon + Email</div>
  <div class="item" data-cmd="idc">🪪 Vyplnit Občanku</div>
  <div class="item" data-cmd="sec">🪪 Vyplnit Sekundární doklad</div>
  <div class="item" data-cmd="add">📄 Vyplnit Additional info</div>
  <div class="item" data-cmd="aml">✅ Vyplnit AML</div>

  <div class="sep"></div>

  <div class="item" data-cmd="settings">⚙️ Nastavení (Alt+E)</div>
  <div class="item" data-cmd="profile">🔁 Přepnout profil (Alt+P)</div>
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

        const hasPhone = !!getFieldElement('phoneNumber', FIELD_FALLBACKS.phoneNumber);
        const hasEmail = !!getFieldElement('email', FIELD_FALLBACKS.email);
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
            } else if (cmd === 'settings') {
                openSettingsPanelNear(btn);
            } else if (cmd === 'profile') {
                const next = toggleProfile();
                refreshBtn();
                toast(`🔁 Profil: ${next}`, btn);
            } else if (cmd === 'undo') {
                undoLastChange(btn);
            } else if (cmd === 'report') {
                openReportPanelNear(btn);
            } else {
                performAction(cmd, { overwrite: ev.shiftKey }, btn);
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

    function performDefaultActionOrMenu(btn, evt) {
        const cmd = getContextAction();
        if (cmd) {
            performAction(cmd, { overwrite: !!evt?.shiftKey }, btn);
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
            performDefaultActionOrMenu(btn, e);
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

        const pName = getActiveProfileName();
        const p = getActiveProfile();
        const runtimeVariant = getEffectiveVariant(p);

        const badgeEl = btn.querySelector('#ibaf-btn-badge');
        if (badgeEl) {
            const modeLetter = (p.fillMode === 'safe') ? 'S' : (p.fillMode === 'aggressive') ? 'A' : 'N';
            const autoLetter = p.autoRunEnabled ? '▶' : '⏸';

            let profTag = String(pName || '').trim();
            const m = profTag.match(/^test\s*(\d+)$/i);
            if (m) profTag = 'T' + m[1];
            else profTag = profTag.slice(0, 2).toUpperCase();

            badgeEl.textContent = `${profTag}${modeLetter}${autoLetter}`;
        }

        btn.title =
`AutoFill
Klik: akce dle stránky, jinak menu (Shift = přepsat v Normal režimu)
Pravé tlačítko / Ctrl+Alt+A: menu
Alt+S: Údaje klienta (jen /business-detail)
Alt+E: Nastavení
Alt+P: Přepnout profil

Profil: ${pName}
Runtime varianta: ${runtimeVariant}
Režim: ${p.fillMode}
Auto-run: ${p.autoRunEnabled ? 'Zapnuto' : 'Vypnuto'}`;

        if (btn.style.display !== 'none') {
            maybeAutoRun(btn);
        }
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
        history.pushState = function () {
            const r = push.apply(this, arguments);
            fire();
            return r;
        };

        const rep = history.replaceState;
        history.replaceState = function () {
            const r = rep.apply(this, arguments);
            fire();
            return r;
        };

        window.addEventListener('popstate', fire);

        const mo = new MutationObserver(() => fire());
        mo.observe(document.body, { childList: true, subtree: true });
    }

    function handleUrlChange(url) {
        if (url.includes('/basic-info') || url.includes('/identification')) {
            clearPersonData();
        }
        refreshBtn();
    }

    let debounceT = null;
    const mo = new MutationObserver(() => {
        clearTimeout(debounceT);
        debounceT = setTimeout(refreshBtn, 120);
    });
    mo.observe(document.body, { childList: true, subtree: true });

    onSpaUrlChange(handleUrlChange);

    window.addEventListener('keydown', e => {
        if (e.altKey && (e.key === 'a' || e.key === 'A') && !e.ctrlKey) {
            e.preventDefault();
            const btn = ensureButton();
            performDefaultActionOrMenu(btn, e);
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
            openSettingsPanelNear(btn);
            return;
        }

        if (e.altKey && !e.ctrlKey && (e.key === 'p' || e.key === 'P')) {
            e.preventDefault();
            const btn = ensureButton();
            const next = toggleProfile();
            refreshBtn();
            toast(`🔁 Profil: ${next}`, btn);
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
    }, { passive: false });

    handleUrlChange(location.href);
    refreshBtn();

})();
