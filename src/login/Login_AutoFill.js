// ==UserScript==
// @name         Login_AutoFill
// @namespace    https://local.test-tools/
// @version      1.0.0
// @description  autofill heslo/SMS
// @author       Vojtěch Urban
// @match        https://tmbs.internetbanka.cz/*
// @match        https://tembs.internetbanka.cz/*
// @match        https://mbczvl6altlsb000003-reactapp.ux.mbid.cz/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_KEY = '__IBAF_LOGIN_RUNTIME__';
    const previousRuntime = window[SCRIPT_KEY];
    if (previousRuntime && typeof previousRuntime.destroy === 'function') {
        try {
            previousRuntime.destroy({ silent: true, reason: 'reinit' });
        } catch (e) {
            console.warn('[IBAF-LOGIN] Nepodařilo se odinstalovat předchozí login runtime.', e);
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
            try { fn(); } catch (e) { console.warn('[IBAF-LOGIN] Cleanup chyba:', e); }
        }
    }
    function removeElementById(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    }

    const CONFIG = Object.freeze({
        debug: false,
        environments: {
            'tmbs.internetbanka.cz': 'PPE',
            'tembs.internetbanka.cz': 'TST1',
            'mbczvl6altlsb000003-reactapp.ux.mbid.cz': 'DEV3'
        }
    });

    const DEBUG = CONFIG.debug;

    const ENVIRONMENTS = Object.freeze(CONFIG.environments);
    const SCRIPT_VERSION = '1.0.0';

    const DEFAULT_PASSWORD = 'Aa123456';
    const DEFAULT_SMS_CODE = '12341234';

    const LOGIN_DIGITS = 9;
    const LOGIN_EXACT_RE = new RegExp(`^\\d{${LOGIN_DIGITS}}$`);

    const STORAGE_SETTINGS_KEY = 'ibaf.settings.v3';
    const BTN_POS_KEY = 'ibaf.btn.pos';
    const LAST_LOGIN_KEY = 'ibaf.last.login';

    const FAVORITES_KEY = 'ibaf.favorites.v1';
    const RECENTS_KEY = 'ibaf.recents.v1';
    const SESSION_LAST_USED_LOGIN_KEY = 'ibaf.session.lastUsedLogin';
    const SESSION_PROMPTED_LOGINS_KEY = 'ibaf.session.promptedLogins.v1';
    const SESSION_PENDING_NAME_KEY = 'ibaf.session.pendingNameByLogin.v1';


    const CLAMP_MARGIN = 4;
    const DEFAULT_OFFSET = 24;

    const THEMES = ['teal', 'indigo', 'violet', 'amber', 'tomato', 'emerald', 'slate'];

    const SUBMIT_BUTTON_SELECTORS = [
        'button[data-testid="submit"]',
        'button[type="submit"]',
        'form button[type="submit"]',
        'button[name="submit"]',
        'button[aria-label*="pokrač" i]',
        'button[aria-label*="pokrac" i]',
        'button[aria-label*="přihl" i]',
        'button[aria-label*="prihl" i]'
    ];

    const LOGIN_INPUT_SELECTORS = [
        '#ibId',
        'input[name="ibId"]',
        'input[id*="ibid" i]',
        'input[autocomplete="username"]'
    ];

    const PASSWORD_INPUT_SELECTORS = [
        '#password',
        'input[type="password"]',
        'input[name*="pass" i]',
        'input[autocomplete="current-password"]'
    ];

    const SMS_INPUT_SELECTORS = [
        '#mobileKey',
        'input[name="mobileKey"]',
        'input[autocomplete="one-time-code"]',
        'input[placeholder*="SMS" i]',
        'input[placeholder*="kód" i]',
        'input[placeholder*="kod" i]',
        'input[data-testid="otp"]',
        'input[data-test="otp"]',
        'input[name*="otp" i]',
        'input[id*="otp" i]',
        'input[name*="mobile" i]',
        'input[id*="mobile" i]',
        'input[type="tel"]'
    ];

    const SMS_SEND_BUTTON_SELECTORS = [
        'button[data-testid="secondFactorSend"]',
        'button[data-test="secondFactorSend"]',
        'button[aria-label*="Podepsat" i]',
        'button[aria-label*="Odeslat" i]',
        'button[name="secondFactorSend"]'
    ];

    const DASHBOARD_NAME_SELECTORS = [
        '.profile_switch_select .m-menu__text',
        '.profile_switch_select [data-testid="TextComponent"] .m-menu__text',
        '.profile_switch_select [data-testid="TextComponent"] span.m-menu__text',
        '[data-testid="MenuItem"].profile_switch_select .m-menu__text'
    ];

    const ICON = {
        INFO: 'ℹ️',
        OK: '✅',
        SAVE: '💾',
        PASS: '🔑',
        SMS: '📩',
        WARN: '⚠️',
        ERR: '💥',
        BLOCK: '⛔',
        BACK: '↩️',
        PAINT: '🎨',
        WAIT: '⏳',
        SHRUG: '🤷',
        GEAR: '⚙️',
        STAR: '⭐',
        PIN: '📌',
        UNPIN: '📍',
        TRASH: '✖',
        EDIT: '✎',
        CHECK: '✔',
        COPY: '📋',
        UP: '⬆️',
        DOWN: '⬇️'
    };

    const log = {
        info: (...a) => DEBUG && console.info('[IBAF]', ...a),
        warn: (...a) => DEBUG && console.warn('[IBAF]', ...a),
        error: (...a) => console.error('[IBAF]', ...a)
    };

    function getEnvironmentName() {
        return ENVIRONMENTS[String(location.hostname || '').toLowerCase()] || 'UNKNOWN';
    }

    const DEFAULT_SETTINGS = Object.freeze({
        password: DEFAULT_PASSWORD,
        smsCode: DEFAULT_SMS_CODE,
        theme: 'teal',
        confirmBeforeUse: false,
        defaultAutoSubmit: true
    });

    function loadSettings() {
        try {
            const raw = localStorage.getItem(STORAGE_SETTINGS_KEY);
            if (!raw) return { ...DEFAULT_SETTINGS };
            const obj = JSON.parse(raw);
            const s = {
                password: String(obj?.password ?? DEFAULT_SETTINGS.password),
                smsCode: String(obj?.smsCode ?? DEFAULT_SETTINGS.smsCode),
                theme: THEMES.includes(obj?.theme) ? obj.theme : DEFAULT_SETTINGS.theme,
                confirmBeforeUse: !!(obj?.confirmBeforeUse ?? DEFAULT_SETTINGS.confirmBeforeUse),
                defaultAutoSubmit: !!(obj?.defaultAutoSubmit ?? DEFAULT_SETTINGS.defaultAutoSubmit)
            };
            return s;
        } catch {
            return { ...DEFAULT_SETTINGS };
        }
    }

    function saveSettings(s) {
        try {
            localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(s));
            return true;
        } catch {
            return false;
        }
    }

    function resetSettingsToDefaults() {
        const s = { ...DEFAULT_SETTINGS };
        saveSettings(s);
        return s;
    }

    function getTheme() {
        const btn = document.getElementById('autofill-login-btn');
        const t = btn?.getAttribute('data-theme') || loadSettings().theme || 'teal';
        return THEMES.includes(t) ? t : 'teal';
    }

    function nowTs() { return Date.now(); }

    function normalizeLogin(v) {
        const s = String(v ?? '').trim();
        const digits = s.replace(/[^\d]/g, '');
        return digits.length === LOGIN_DIGITS ? digits : s;
    }

    function isValidLogin(v) {
        return LOGIN_EXACT_RE.test(String(v ?? '').trim());
    }

    function makeFavId() {
        return `fav_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
    }

    function loadFavorites() {
        try {
            const raw = localStorage.getItem(FAVORITES_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(arr)) return [];
            return arr.map(x => ({
                id: String(x?.id || makeFavId()),
                login: String(x?.login || '').trim(),
                name: String(x?.name || ''),
                note: String(x?.note || ''),
                pinned: !!x?.pinned,
                lastUsedTs: Number(x?.lastUsedTs || 0),
                prefs: {
                    skipPassword: !!x?.prefs?.skipPassword,
                    skipOtp: !!x?.prefs?.skipOtp,
                    autoSubmit: (x?.prefs?.autoSubmit === undefined) ? true : !!x?.prefs?.autoSubmit
                }
            }));
        } catch {
            return [];
        }
    }

    function saveFavorites(list) {
        try {
            localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
            return true;
        } catch {
            return false;
        }
    }

    function findFavByLogin(login) {
        const l = String(login || '').trim();
        const list = loadFavorites();
        return list.find(x => x.login === l) || null;
    }

    function upsertFavorite(partial) {
        const list = loadFavorites();
        const login = String(partial?.login || '').trim();
        const nameClean = partial?.name ? normalizeClientName(partial.name) : undefined;

        if (!login) return { ok: false, reason: 'no-login' };

        const idx = list.findIndex(x => x.login === login || x.id === partial?.id);
        if (idx >= 0) {
            const cur = list[idx];
            list[idx] = {
                ...cur,
                ...partial,
                login,
                prefs: {
                    ...cur.prefs,
                    ...(partial?.prefs || {})
                }
            };
        } else {
            list.push({
                id: partial?.id ? String(partial.id) : makeFavId(),
                login,
                name: String(nameClean ?? partial?.name ?? ''),
                note: String(partial?.note || ''),
                pinned: !!partial?.pinned,
                lastUsedTs: Number(partial?.lastUsedTs || 0),
                prefs: {
                    skipPassword: !!partial?.prefs?.skipPassword,
                    skipOtp: !!partial?.prefs?.skipOtp,
                    autoSubmit: (partial?.prefs?.autoSubmit === undefined) ? true : !!partial?.prefs?.autoSubmit
                }
            });
        }
        saveFavorites(list);
        return { ok: true };
    }

    function deleteFavoriteById(id) {
        const list = loadFavorites().filter(x => x.id !== id);
        saveFavorites(list);
    }

    function markFavoriteUsed(login, name = '') {
        const l = String(login || '').trim();
        if (!l) return;

        const nm = String(name || '').trim();
        const list = loadFavorites();
        const idx = list.findIndex(x => x.login === l);
        if (idx >= 0) {
            list[idx].lastUsedTs = nowTs();
            if (nm) list[idx].name = nm;
            saveFavorites(list);
        }

        try {
            const raw = localStorage.getItem(RECENTS_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            const rec = Array.isArray(arr) ? arr : [];

            const existing = rec.find(x => String(x?.login || '') === l);
            const keepName = nm || String(existing?.name || '').trim() || '';

            const next = [{ login: l, name: keepName, ts: nowTs() }, ...rec.filter(x => String(x?.login || '') !== l)].slice(0, 12);
            localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
        } catch {}
    }

    function loadRecents() {
        try {
            const raw = localStorage.getItem(RECENTS_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(arr)) return [];

            return arr
                .map(x => ({
                login: String(x?.login || ''),
                name: String(x?.name || ''),
                ts: Number(x?.ts || 0)
            }))
                .filter(x => isValidLogin(x.login))
                .slice(0, 12);
        } catch {
            return [];
        }
    }

    function updateRecentName(login, name) {
        const l = String(login || '').trim();
        const n = String(name || '').trim();
        if (!l || !n) return;

        try {
            const raw = localStorage.getItem(RECENTS_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(arr)) return;

            const idx = arr.findIndex(x => String(x?.login || '') === l);
            if (idx >= 0) {
                arr[idx] = { ...arr[idx], login: l, name: n, ts: Number(arr[idx]?.ts || 0) };
                localStorage.setItem(RECENTS_KEY, JSON.stringify(arr));
            }
        } catch {}
    }

    function favoritesQuickList(max = 5) {
        const list = loadFavorites();
        return list
            .filter(x => x.pinned)
            .sort((a, b) => (b.lastUsedTs || 0) - (a.lastUsedTs || 0))
            .slice(0, max);
    }

    function injectStyles() {
        if (document.getElementById('ibaf-style')) return;

        const css = `
#autofill-login-btn{
  position:fixed;top:${DEFAULT_OFFSET}px;left:${DEFAULT_OFFSET}px;z-index:2147483647;
  width:32px;height:32px;border:none;border-radius:8px;
  display:flex;align-items:center;justify-content:center;
  font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1;color:#fff;
  box-shadow:0 3px 10px rgba(0,0,0,.22);
  cursor:pointer;user-select:none;background-clip:padding-box;will-change:transform;
  transition:transform .12s ease,box-shadow .12s ease,background .2s ease,opacity .15s ease;
}
#autofill-login-btn:hover{transform:translateY(-1px);box-shadow:0 5px 14px rgba(0,0,0,.28)}
#autofill-login-btn:active{transform:translateY(0);box-shadow:0 2px 8px rgba(0,0,0,.22)}
#autofill-login-btn,#autofill-login-btn *{-webkit-user-select:none;user-select:none}
#autofill-login-btn::after{
  content:attr(data-env);position:absolute;top:-7px;right:-15px;
  min-width:22px;max-width:34px;padding:1px 3px;border-radius:999px;
  background:rgba(15,23,42,.92);color:#e2e8f0;border:1px solid rgba(255,255,255,.38);
  font-size:7px;font-weight:800;line-height:1.15;text-align:center;letter-spacing:0;
  box-shadow:0 2px 6px rgba(0,0,0,.22);overflow:hidden;text-overflow:ellipsis;
}

#autofill-login-btn[data-theme="teal"]{background:linear-gradient(135deg,#0098a8,#22d4d4)}
#autofill-login-btn[data-theme="indigo"]{background:linear-gradient(135deg,#3b5bdb,#748ffc)}
#autofill-login-btn[data-theme="violet"]{background:linear-gradient(135deg,#6f42c1,#a78bfa)}
#autofill-login-btn[data-theme="amber"]{background:linear-gradient(135deg,#d97706,#fbbf24)}
#autofill-login-btn[data-theme="tomato"]{background:linear-gradient(135deg,#e03131,#ff6b6b)}
#autofill-login-btn[data-theme="emerald"]{background:linear-gradient(135deg,#2f9e44,#69db7c)}
#autofill-login-btn[data-theme="slate"]{background:linear-gradient(135deg,#334155,#64748b)}

#ibaf-ctx{
  position:fixed;z-index:2147483647;min-width:260px;
  background:#0f172a;color:#e2e8f0;border:1px solid rgba(148,163,184,.25);
  border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.4);
  font:13px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  overflow:hidden;opacity:0;transform:translateY(-4px);pointer-events:none;
  transition:opacity .12s ease,transform .12s ease;
}
#ibaf-ctx.show{opacity:1;transform:translateY(0);pointer-events:auto}
#ibaf-ctx .item{
  padding:9px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;
  white-space:nowrap;
}
#ibaf-ctx .item:hover{background:rgba(148,163,184,.12)}
#ibaf-ctx .item.disabled{opacity:.45;cursor:not-allowed}
#ibaf-ctx .item.sep{height:1px;padding:0;background:rgba(148,163,184,.16)}
#ibaf-ctx .item.last{white-space:nowrap;overflow:hidden}
#ibaf-ctx .item.last .label{flex:0 0 auto}
#ibaf-ctx .item.last .last-val{
  flex:1 1 auto;min-width:0;margin-left:auto;
  overflow:hidden;text-overflow:ellipsis;text-align:right;opacity:.85;
}
#ibaf-ctx .item .rhs{
  margin-left:auto;
  opacity:.75;
  font-variant-numeric:tabular-nums;
}
#ibaf-ctx .sec{
  padding:8px 12px;
  font-size:12px;
  opacity:.75;
  border-top:1px solid rgba(148,163,184,.12);
}
#ibaf-ctx .minirow{
  padding:7px 12px;
  display:flex;align-items:center;gap:8px;
  cursor:pointer;
}
#ibaf-ctx .minirow:hover{background:rgba(148,163,184,.10)}
#ibaf-ctx .minirow .meta{margin-left:auto;opacity:.65;font-size:12px}
#ibaf-ctx .minirow .edit{
  margin-left:8px;
  opacity:.75;
  padding:0 6px;
  border-radius:8px;
  border:1px solid rgba(148,163,184,.20);
  background:rgba(148,163,184,.10);
}
#ibaf-ctx .minirow .edit:hover{background:rgba(148,163,184,.16)}
#ibaf-ctx .minirow .login{font-variant-numeric:tabular-nums}

#ibaf-clip{
  position:fixed;z-index:2147483647;min-width:220px;max-width:340px;
  background:#0b1220;color:#e2e8f0;border:1px solid rgba(148,163,184,.22);
  border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.5);
  font:13px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  overflow:hidden;opacity:0;transform:translateY(-6px);pointer-events:none;
  transition:opacity .12s ease,transform .12s ease;
}
#ibaf-clip.show{opacity:1;transform:translateY(0);pointer-events:auto}
#ibaf-clip .hd{
  padding:10px 12px;border-bottom:1px solid rgba(148,163,184,.18);
  display:flex;align-items:center;gap:8px;opacity:.95
}
#ibaf-clip .hd .t{font-weight:600}
#ibaf-clip .opt{
  padding:9px 12px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;
  font-variant-numeric:tabular-nums;
}
#ibaf-clip .opt:hover{background:rgba(148,163,184,.10)}
#ibaf-clip .ft{
  padding:8px 12px;border-top:1px solid rgba(148,163,184,.18);
  opacity:.75;font-size:12px
}

#ibaf-toast{
  position:fixed;z-index:2147483647;
  max-width:300px;
  padding:8px 10px;
  border-radius:12px;
  color:rgba(255,255,255,.92);
  font:13px/1.25 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  box-shadow:0 14px 34px rgba(0,0,0,.45);
  border:1px solid rgba(255,255,255,.14);
  pointer-events:none;
  opacity:0;
  transform:scale(.92);
  transition:opacity .14s ease, transform .14s ease;
  will-change:transform,opacity;
}
#ibaf-toast.show{opacity:1;transform:scale(1)}
#ibaf-toast .row{display:flex;align-items:flex-start;gap:8px}
#ibaf-toast .ic{flex:0 0 auto;line-height:1.1}
#ibaf-toast .txt{flex:1 1 auto;min-width:0;word-wrap:break-word}
#ibaf-toast .sub{margin-top:2px;font-size:12px;opacity:.78}
#ibaf-toast::after{
  content:"";
  position:absolute;
  width:10px;height:10px;
  transform:rotate(45deg);
  border-left:1px solid rgba(255,255,255,.12);
  border-top:1px solid rgba(255,255,255,.12);
  background:inherit;
  filter:drop-shadow(0 6px 10px rgba(0,0,0,.25));
}
#ibaf-toast[data-side="right"]::after{left:-6px;top:50%;margin-top:-5px}
#ibaf-toast[data-side="left"]::after{right:-6px;top:50%;margin-top:-5px}
#ibaf-toast[data-side="top"]::after{left:50%;margin-left:-5px;bottom:-6px}
#ibaf-toast[data-side="bottom"]::after{left:50%;margin-left:-5px;top:-6px}

#ibaf-toast[data-theme="teal"]{background:linear-gradient(135deg,#006b76,#1aa7a7)}
#ibaf-toast[data-theme="indigo"]{background:linear-gradient(135deg,#2f4ab6,#5f78d9)}
#ibaf-toast[data-theme="violet"]{background:linear-gradient(135deg,#54309a,#8963dd)}
#ibaf-toast[data-theme="amber"]{background:linear-gradient(135deg,#9a5a06,#c99312)}
#ibaf-toast[data-theme="tomato"]{background:linear-gradient(135deg,#a11f1f,#d95757)}
#ibaf-toast[data-theme="emerald"]{background:linear-gradient(135deg,#1e6d31,#49a85d)}
#ibaf-toast[data-theme="slate"]{background:linear-gradient(135deg,#2b3646,#526279)}

#ibaf-atoast{
  position:fixed;z-index:2147483647;
  max-width:320px;
  padding:10px 10px;
  border-radius:14px;
  color:rgba(255,255,255,.92);
  font:13px/1.25 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  box-shadow:0 18px 50px rgba(0,0,0,.55);
  border:1px solid rgba(255,255,255,.16);
  pointer-events:none;
  opacity:0;
  transform:translateY(6px);
  transition:opacity .14s ease, transform .14s ease;
  display:none;
}
#ibaf-atoast.show{
  opacity:1;
  transform:translateY(0);
  pointer-events:auto;
  display:block;
}

#ibaf-atoast .t{display:flex;align-items:flex-start;gap:8px}
#ibaf-atoast .t .ic{line-height:1.1}
#ibaf-atoast .t .main{font-weight:650}
#ibaf-atoast .t .sub{opacity:.80;margin-top:2px;font-size:12px}
#ibaf-atoast .acts{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}
#ibaf-atoast .abtn{
  border:none;border-radius:10px;padding:8px 10px;
  cursor:pointer;font-weight:650;
  background:rgba(255,255,255,.14);color:#fff;
}
#ibaf-atoast .abtn:hover{background:rgba(255,255,255,.20)}
#ibaf-atoast .abtn.primary{
  background:rgba(34,211,238,.22);
  border:1px solid rgba(34,211,238,.25);
}
#ibaf-atoast .abtn.primary:hover{background:rgba(34,211,238,.30)}
#ibaf-atoast[data-theme="teal"]{background:linear-gradient(135deg,#006b76,#1aa7a7)}
#ibaf-atoast[data-theme="indigo"]{background:linear-gradient(135deg,#2f4ab6,#5f78d9)}
#ibaf-atoast[data-theme="violet"]{background:linear-gradient(135deg,#54309a,#8963dd)}
#ibaf-atoast[data-theme="amber"]{background:linear-gradient(135deg,#9a5a06,#c99312)}
#ibaf-atoast[data-theme="tomato"]{background:linear-gradient(135deg,#a11f1f,#d95757)}
#ibaf-atoast[data-theme="emerald"]{background:linear-gradient(135deg,#1e6d31,#49a85d)}
#ibaf-atoast[data-theme="slate"]{background:linear-gradient(135deg,#2b3646,#526279)}

#ibaf-modal{
  position:fixed;inset:0;z-index:2147483647;
  display:none;align-items:center;justify-content:center;
  background:rgba(0,0,0,.55);
}
#ibaf-modal.show{display:flex}
#ibaf-modal .panel{
  width:min(600px, calc(100vw - 28px));
  background:#0b1220;color:#e2e8f0;
  border:1px solid rgba(148,163,184,.22);
  border-radius:14px;
  box-shadow:0 18px 60px rgba(0,0,0,.55);
  overflow:hidden;
  font:13px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
}
#ibaf-modal .hdr{
  padding:12px 14px;
  display:flex;align-items:center;justify-content:space-between;
  border-bottom:1px solid rgba(148,163,184,.18);
}
#ibaf-modal .hdr .ttl{font-weight:700;display:flex;align-items:center;gap:8px}
#ibaf-modal .hdr .x{
  width:30px;height:30px;border:none;border-radius:10px;
  background:rgba(148,163,184,.12);color:#e2e8f0;
  cursor:pointer;
}
#ibaf-modal .hdr .x:hover{background:rgba(148,163,184,.18)}
#ibaf-modal .body{
  padding:14px;
  display:grid;
  gap:12px;
  max-height:min(74vh, 720px);
  overflow:auto;
}
#ibaf-modal .row{display:grid;gap:6px}
#ibaf-modal label{opacity:.9}
#ibaf-modal input, #ibaf-modal select{
  width:100%;
  padding:10px 10px;
  border-radius:12px;
  border:1px solid rgba(148,163,184,.22);
  background:#0f172a;color:#e2e8f0;
  outline:none;
}
#ibaf-modal .hint{font-size:12px;opacity:.75}
#ibaf-modal .ftr{
  padding:12px 14px;
  display:flex;gap:10px;justify-content:flex-end;
  border-top:1px solid rgba(148,163,184,.18);
}
#ibaf-modal .btn{
  border:none;border-radius:12px;padding:10px 12px;
  cursor:pointer;font-weight:650;
  background:rgba(148,163,184,.12);color:#e2e8f0;
}
#ibaf-modal .btn:hover{background:rgba(148,163,184,.18)}
#ibaf-modal .btn.primary{
  background:rgba(34,211,238,.18);
  border:1px solid rgba(34,211,238,.25);
}
#ibaf-modal .btn.primary:hover{background:rgba(34,211,238,.25)}
#ibaf-modal .chkline{
  display:flex;align-items:center;gap:10px;
  padding:8px 10px;
  border-radius:12px;
  border:1px solid rgba(148,163,184,.16);
  background:rgba(148,163,184,.08);
}
#ibaf-modal .chkline input{width:auto}
#ibaf-modal .divider{
  height:1px;background:rgba(148,163,184,.14);
  margin:4px 0;
}

#ibaf-fav{
  position:fixed;inset:0;z-index:2147483647;
  display:none;align-items:center;justify-content:center;
  background:rgba(0,0,0,.58);
}
#ibaf-fav.show{display:flex}
#ibaf-fav .panel{
  width:min(960px, calc(100vw - 28px));
  background:#0b1220;color:#e2e8f0;
  border:1px solid rgba(148,163,184,.22);
  border-radius:14px;
  box-shadow:0 18px 70px rgba(0,0,0,.6);
  overflow:hidden;
  font:13px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
}
#ibaf-fav .hdr{
  padding:12px 14px;
  display:flex;align-items:center;justify-content:space-between;
  border-bottom:1px solid rgba(148,163,184,.18);
  gap:10px;
}
#ibaf-fav .hdr .ttl{font-weight:800;display:flex;align-items:center;gap:8px;white-space:nowrap}
#ibaf-fav .hdr .x{
  width:30px;height:30px;border:none;border-radius:10px;
  background:rgba(148,163,184,.12);color:#e2e8f0;
  cursor:pointer;
}
#ibaf-fav .hdr .x:hover{background:rgba(148,163,184,.18)}
#ibaf-fav .tools{
  display:flex;align-items:center;gap:10px;flex:1 1 auto;
  justify-content:flex-end;
}
#ibaf-fav .tools input[type="text"]{
  width:min(360px, 40vw);
  padding:10px 10px;border-radius:12px;
  border:1px solid rgba(148,163,184,.22);
  background:#0f172a;color:#e2e8f0;outline:none;
}
#ibaf-fav .tools select{
  padding:10px 10px;border-radius:12px;
  border:1px solid rgba(148,163,184,.22);
  background:#0f172a;color:#e2e8f0;outline:none;
}
#ibaf-fav .tools .pill{
  display:flex;align-items:center;gap:8px;
  padding:8px 10px;border-radius:999px;
  border:1px solid rgba(148,163,184,.18);
  background:rgba(148,163,184,.08);
}
#ibaf-fav .tools .pill input{width:auto}
#ibaf-fav .body{
  padding:12px 14px;
  max-height:min(72vh, 740px);
  overflow:auto;
}
#ibaf-fav table{
  width:100%;
  border-collapse:separate;
  border-spacing:0;
  font-variant-numeric:tabular-nums;
}
#ibaf-fav th, #ibaf-fav td{
  padding:8px 8px;
  border-bottom:1px solid rgba(148,163,184,.12);
  vertical-align:middle;
}
#ibaf-fav th{
  position:sticky;top:0;
  background:#0b1220;
  z-index:2;
  text-align:left;
  font-weight:700;
  opacity:.9;
}
#ibaf-fav td .cell{
  display:flex;align-items:center;gap:8px;
}
#ibaf-fav td input[type="text"]{
  width:100%;
  padding:9px 10px;
  border-radius:12px;
  border:1px solid rgba(148,163,184,.18);
  background:#0f172a;color:#e2e8f0;outline:none;
}
#ibaf-fav td input.bad{
  border-color:rgba(239,68,68,.60);
  box-shadow:0 0 0 2px rgba(239,68,68,.12);
}
#ibaf-fav .iconbtn{
  border:none;border-radius:10px;
  padding:8px 9px;
  cursor:pointer;
  background:rgba(148,163,184,.10);
  border:1px solid rgba(148,163,184,.18);
  color:#e2e8f0;
}
#ibaf-fav .iconbtn:hover{background:rgba(148,163,184,.16)}
#ibaf-fav .tiny{
  font-size:12px;opacity:.70
}
#ibaf-fav .rowhint{
  opacity:.75;font-size:12px;padding:8px 0 0 0
}
#ibaf-fav .prefs{
  display:flex;align-items:center;gap:10px;flex-wrap:wrap
}
#ibaf-fav .prefs .pp{
  display:flex;align-items:center;gap:8px;
  padding:6px 8px;border-radius:999px;
  border:1px solid rgba(148,163,184,.16);
  background:rgba(148,163,184,.08);
}
#ibaf-fav .prefs input{width:auto}
#ibaf-fav .ftr{
  padding:12px 14px;
  display:flex;gap:10px;justify-content:flex-end;align-items:center;
  border-top:1px solid rgba(148,163,184,.18);
}
#ibaf-fav .ftr .btn{
  border:none;border-radius:12px;padding:10px 12px;
  cursor:pointer;font-weight:650;
  background:rgba(148,163,184,.12);color:#e2e8f0;
}
#ibaf-fav .ftr .btn:hover{background:rgba(148,163,184,.18)}
#ibaf-fav .ftr .btn.primary{
  background:rgba(34,211,238,.18);
  border:1px solid rgba(34,211,238,.25);
}
#ibaf-fav .ftr .btn.primary:hover{background:rgba(34,211,238,.25)}
#ibaf-fav .ftr .left{
  margin-right:auto;
  opacity:.70;
  font-size:12px;
}
#ibaf-fav .muted{
  opacity:.70
}

#ibaf-confirm{
  position:fixed;z-index:2147483647;
  min-width:260px;
  background:#0b1220;color:#e2e8f0;
  border:1px solid rgba(148,163,184,.24);
  border-radius:14px;
  box-shadow:0 18px 70px rgba(0,0,0,.6);
  padding:10px 10px;
  display:none;
}
#ibaf-confirm.show{display:block}
#ibaf-confirm .main{font-weight:800}
#ibaf-confirm .sub{opacity:.78;font-size:12px;margin-top:4px}
#ibaf-confirm .acts{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}
#ibaf-confirm .cbtn{
  border:none;border-radius:10px;padding:8px 10px;
  cursor:pointer;font-weight:700;
  background:rgba(148,163,184,.12);color:#e2e8f0;
}
#ibaf-confirm .cbtn:hover{background:rgba(148,163,184,.18)}
#ibaf-confirm .cbtn.primary{
  background:rgba(34,211,238,.18);
  border:1px solid rgba(34,211,238,.25);
}
#ibaf-confirm .cbtn.primary:hover{background:rgba(34,211,238,.25)}
    `;

        const s = document.createElement('style');
        s.id = 'ibaf-style';
        s.textContent = css;
        document.head.appendChild(s);
    }

    const QUERY_CACHE_TTL_MS = 250;
    const _qcache = new Map();

    function queryDeepAll(selector, root = document) {
        const now = performance.now();
        const cached = _qcache.get(selector);
        if (cached && (now - cached.ts) <= QUERY_CACHE_TTL_MS) return cached.arr;

        const out = [];
        const stack = [root];

        while (stack.length) {
            const node = stack.pop();
            if (!node) continue;

            if (node instanceof Document || node instanceof DocumentFragment || node instanceof Element) {
                try {
                    const found = node.querySelectorAll?.(selector);
                    if (found?.length) out.push(...found);
                } catch {}

                if (node.shadowRoot) stack.push(node.shadowRoot);

                if (node.tagName === 'IFRAME') {
                    try { node.contentDocument && stack.push(node.contentDocument); } catch {}
                }

                node.childNodes?.forEach(ch => {
                    if (ch instanceof Element && ch.shadowRoot) stack.push(ch.shadowRoot);
                });
            }
        }

        _qcache.set(selector, { ts: now, arr: out });
        return out;
    }

    function isVisible(el) {
        if (!el) return false;
        const r = el.getClientRects?.();
        if (!(r && r.length)) return false;
        const br = el.getBoundingClientRect();
        if (br.width <= 0 || br.height <= 0) return false;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
        return true;
    }

    function deepFirstVisible(selector) {
        const all = queryDeepAll(selector);
        for (const el of all) if (isVisible(el)) return el;
        return all[0] || null;
    }

    function deepFirstVisibleFromSelectors(selectors) {
        for (const sel of selectors) {
            const el = deepFirstVisible(sel);
            if (el && isVisible(el)) return el;
        }
        for (const sel of selectors) {
            const el = queryDeepAll(sel)[0];
            if (el) return el;
        }
        return null;
    }

    function queryDeepOne(sel) {
        return deepFirstVisible(sel);
    }

    function getNativeValueSetter(el) {
        let p = el;
        while (p) {
            const proto = Object.getPrototypeOf(p);
            if (!proto) break;
            const desc = Object.getOwnPropertyDescriptor(proto, 'value');
            if (desc && typeof desc.set === 'function') return desc.set;
            p = proto;
        }
        return null;
    }

    function simulateReactInput(input, value) {
        if (!input) return;
        const setter = getNativeValueSetter(input);

        input.focus();

        try { setter ? setter.call(input, '') : (input.value = ''); }
        catch { input.value = ''; }

        input.dispatchEvent(new Event('input', { bubbles: true }));

        try { setter ? setter.call(input, value) : (input.value = value); }
        catch { input.value = value; }

        try { input.setSelectionRange?.(String(value).length, String(value).length); } catch {}

        try { input.dispatchEvent(new InputEvent('input', { bubbles: true })); }
        catch { input.dispatchEvent(new Event('input', { bubbles: true })); }

        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async function waitUntil(fn, { timeout = 8000, interval = 80 } = {}) {
        const t0 = performance.now();
        while (performance.now() - t0 < timeout) {
            try {
                const val = fn();
                if (val) return val;
            } catch {}
            await new Promise(r => setTimeout(r, interval));
        }
        return null;
    }

    function isButtonClickable(btn) {
        if (!btn) return false;
        if (!isVisible(btn)) return false;
        if (btn.disabled) return false;
        const aria = btn.getAttribute('aria-disabled');
        if (aria && aria.toLowerCase() === 'true') return false;
        const cs = getComputedStyle(btn);
        if (cs.pointerEvents === 'none') return false;
        return true;
    }

    async function safeClick(btn, { retries = 10, delay = 120 } = {}) {
        for (let i = 0; i < retries; i++) {
            if (btn && isButtonClickable(btn)) {
                btn.click();
                return true;
            }
            await new Promise(r => setTimeout(r, delay));
        }
        if (btn) btn.click();
        return false;
    }

    function findLoginInput() { return deepFirstVisibleFromSelectors(LOGIN_INPUT_SELECTORS); }
    function findPasswordInput() { return deepFirstVisibleFromSelectors(PASSWORD_INPUT_SELECTORS); }

    function findOtpInputs() {
        const els = queryDeepAll(SMS_INPUT_SELECTORS.join(','));
        const vis = els.filter(isVisible);
        const seg = vis.filter(i => {
            const ml = Number(i.getAttribute('maxlength') || 0);
            const sz = Number(i.getAttribute('size') || 0);
            const type = String(i.getAttribute('type') || '').toLowerCase();
            const im = String(i.getAttribute('inputmode') || '').toLowerCase();
            const isNumeric = type === 'tel' || im === 'numeric';
            return isNumeric && (ml === 1 || sz === 1);
        });

        if (seg.length >= 4) return seg;

        const single = vis.find(i => {
            const name = String(i.getAttribute('name') || '').toLowerCase();
            const id = String(i.getAttribute('id') || '').toLowerCase();
            const ac = String(i.getAttribute('autocomplete') || '').toLowerCase();
            return ac.includes('one-time-code') || name.includes('otp') || id.includes('otp') || name.includes('mobilekey') || id.includes('mobilekey');
        }) || vis[0] || null;

        return single ? [single] : [];
    }

    function findSubmitButton() {
        for (const sel of SUBMIT_BUTTON_SELECTORS) {
            const els = queryDeepAll(sel);
            for (const el of els) if (isButtonClickable(el)) return el;
        }
        for (const sel of SUBMIT_BUTTON_SELECTORS) {
            const el = deepFirstVisible(sel);
            if (el) return el;
        }
        return null;
    }

    function isLoginInputRendered() {
        const i = findLoginInput();
        return !!(i && isVisible(i));
    }

    function looksLikeDashboard() {
        const href = String(location.href || '');
        return href.includes('#/dashboard') || href.includes('/spacex-ib/#/dashboard');
    }

    function getPhase() {
        const otp = findOtpInputs();
        const pw = findPasswordInput();
        const lg = findLoginInput();

        if (otp?.length && otp.some(isVisible)) return 'otp';
        if (pw && isVisible(pw)) return 'password';
        if (lg && isVisible(lg)) return 'login';
        return 'unknown';
    }

    function setLastLogin(v) { try { localStorage.setItem(LAST_LOGIN_KEY, v || ''); } catch {} }
    function getLastLogin() { try { return localStorage.getItem(LAST_LOGIN_KEY) || ''; } catch { return ''; } }

    function setSessionLastUsedLogin(v) { try { sessionStorage.setItem(SESSION_LAST_USED_LOGIN_KEY, v || ''); } catch {} }
    function getSessionLastUsedLogin() { try { return sessionStorage.getItem(SESSION_LAST_USED_LOGIN_KEY) || ''; } catch { return ''; } }
    function clearSessionLastUsedLogin() { try { sessionStorage.removeItem(SESSION_LAST_USED_LOGIN_KEY); } catch {} }

    function captureAndSaveLastLogin() {
        const i = findLoginInput(); if (!i) return;
        const v = (i.value || '').trim();
        if (v) setLastLogin(v);
    }

    const _wiredLoginInputs = new WeakSet();
    function maybeAutoSaveLoginFromInput(input) {
        if (!input) return;
        const v = (input.value || '').trim();
        if (!LOGIN_EXACT_RE.test(v)) return;
        if (v === getLastLogin()) return;
        setLastLogin(v);
    }

    function wireLoginAutosave() {
        const input = findLoginInput();
        if (!input || !isVisible(input) || _wiredLoginInputs.has(input)) return;
        _wiredLoginInputs.add(input);

        const onBlur = () => maybeAutoSaveLoginFromInput(input);
        const onChange = () => maybeAutoSaveLoginFromInput(input);

        input.addEventListener('blur', onBlur, true);
        input.addEventListener('change', onChange, true);
    }

    const BEST_NAME_KEY = (login) => `ibaf.session.bestName.${login}`;
    const LOCK_NAME_KEY = (login) => `ibaf.session.nameLocked.${login}`;

    function sessGet(k) {
        try { return sessionStorage.getItem(k) || ''; } catch { return ''; }
    }
    function sessSet(k, v) {
        try { sessionStorage.setItem(k, v || ''); } catch {}
    }
    function sessDel(k) {
        try { sessionStorage.removeItem(k); } catch {}
    }

    function getBestName(login) { return sessGet(BEST_NAME_KEY(login)); }
    function setBestName(login, name) { sessSet(BEST_NAME_KEY(login), name); }

    function isNameLocked(login) { return sessGet(LOCK_NAME_KEY(login)) === '1'; }
    function lockName(login) { sessSet(LOCK_NAME_KEY(login), '1'); }
    function unlockName(login) { sessDel(LOCK_NAME_KEY(login)); }

    function nameScore(name) {
        const s = String(name || '').trim();
        if (!s) return 0;
        const w = s.split(/\s+/).filter(Boolean);
        if (w.length < 2) return 0;
        if (w.length === 2) return 100;
        return 90;
    }

    function commitBestName(login, candidate, { lock = false } = {}) {
        const clean = normalizeClientName(candidate);
        if (!clean) return { ok: false, reason: 'bad' };

        const cur = getBestName(login);
        const curScore = nameScore(cur);
        const candScore = nameScore(clean);

        if (isNameLocked(login) && candScore <= curScore) {
            return { ok: false, reason: 'locked' };
        }

        if (candScore > curScore) {
            setBestName(login, clean);
        }

        if (lock) lockName(login);

        return { ok: true, name: getBestName(login) || clean };
    }

    function sessionGet(key) {
        try { return sessionStorage.getItem(key) || ''; } catch { return ''; }
    }
    function sessionSet(key, val) {
        try { sessionStorage.setItem(key, val); } catch {}
    }
    function sessionDel(key) {
        try { sessionStorage.removeItem(key); } catch {}
    }

    function getPromptedLogins() {
        try {
            const raw = sessionGet(SESSION_PROMPTED_LOGINS_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr.map(String) : [];
        } catch { return []; }
    }
    function hasPromptedForLogin(login) {
        const l = String(login || '').trim();
        if (!l) return false;
        return getPromptedLogins().includes(l);
    }
    function markPromptedForLogin(login) {
        const l = String(login || '').trim();
        if (!l) return;
        const arr = getPromptedLogins();
        if (!arr.includes(l)) {
            arr.push(l);
            sessionSet(SESSION_PROMPTED_LOGINS_KEY, JSON.stringify(arr));
        }
    }
    function clearPromptedForLogin(login) {
        const l = String(login || '').trim();
        if (!l) return;
        const arr = getPromptedLogins().filter(x => x !== l);
        sessionSet(SESSION_PROMPTED_LOGINS_KEY, JSON.stringify(arr));
    }

    function getPendingNameMap() {
        try {
            const raw = sessionGet(SESSION_PENDING_NAME_KEY);
            const obj = raw ? JSON.parse(raw) : {};
            return (obj && typeof obj === 'object') ? obj : {};
        } catch { return {}; }
    }
    function setPendingName(login, name) {
        const l = String(login || '').trim();
        const n = String(name || '').trim();
        if (!l) return;
        const map = getPendingNameMap();
        map[l] = n;
        sessionSet(SESSION_PENDING_NAME_KEY, JSON.stringify(map));
    }
    function getPendingName(login) {
        const l = String(login || '').trim();
        if (!l) return '';
        const map = getPendingNameMap();
        return String(map?.[l] || '').trim();
    }
    function clearPendingName(login) {
        const l = String(login || '').trim();
        if (!l) return;
        const map = getPendingNameMap();
        delete map[l];
        sessionSet(SESSION_PENDING_NAME_KEY, JSON.stringify(map));
    }

    const TITLE_TOKENS = new Set([
        'ing','mgr','bc','rndr','mudr','judr','phdr','mvdr','pharmdr','paeddr','thdr',
        'dr','doc','prof',
        'phd','ph.d','dis','mba','llm','ll.m','csc','dsc'
    ]);

    const IGNORE_NAME_TOKENS = new Set([
        'přihlášený', 'přihlášená', 'přihlášen', 'přihlášena',
        'prihlaseny', 'prihlasena', 'prihlasen',
        'přihlášení', 'prihlaseni',
        'uživatel', 'uzivatel',
        'uživ.', 'uziv.',
        'uziv',
        'přihlášenýuživatel', 'prihlasenyuzivatel'
    ]);

    function stripDiacritics(s) {
        return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function normToken(t) {
        return stripDiacritics(String(t || '').toLowerCase())
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim();
    }

    function looksLikeCompanyName(raw) {
        const s = stripDiacritics(String(raw || '').toLowerCase());
        return /\b(s\.?r\.?o\.?|a\.?s\.?|v\.?o\.?s\.?|k\.?s\.?|o\.?p\.?s\.?)\b/.test(s);
    }

    function normalizeClientName(raw) {
        let s = String(raw ?? '').trim();
        if (!s) return '';

        s = s.split('\n')[0].trim();
        s = s.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

        if (looksLikeCompanyName(s)) return '';

        const parts = s.split(/\s+/).filter(Boolean);

        const kept = [];
        for (const p of parts) {
            const nt = normToken(p);
            if (!nt) continue;

            if (TITLE_TOKENS.has(nt) || TITLE_TOKENS.has(p.toLowerCase()) || TITLE_TOKENS.has(stripDiacritics(p.toLowerCase()))) continue;

            if (IGNORE_NAME_TOKENS.has(nt) || IGNORE_NAME_TOKENS.has(stripDiacritics(p.toLowerCase()))) continue;

            kept.push(p);
        }

        if (kept.length < 2) return '';

        return `${kept[0]} ${kept[kept.length - 1]}`.replace(/\s+/g, ' ').trim();
    }

    let toastTimer = null;
    let _toastLastKey = '';
    let _toastLastTs = 0;
    const TOAST_DEDUPE_MS = 450;

    function ensureToast() {
        injectStyles();
        let t = document.getElementById('ibaf-toast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'ibaf-toast';
            t.style.left = '-9999px';
            t.style.top = '-9999px';
            t.innerHTML = `<div class="row"><div class="ic"></div><div class="txt"><div class="main"></div><div class="sub"></div></div></div>`;
            document.body.appendChild(t);
        }
        return t;
    }

    function pickToastSide(btnRect, tw, th, gap = 10) {
        const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
        const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);

        const canRight = (btnRect.right + gap + tw) <= (vw - 8);
        const canLeft = (btnRect.left - gap - tw) >= 8;
        const canTop = (btnRect.top - gap - th) >= 8;
        const canBot = (btnRect.bottom + gap + th) <= (vh - 8);

        if (canRight) return 'right';
        if (canLeft) return 'left';
        if (canTop) return 'top';
        if (canBot) return 'bottom';
        return 'right';
    }

    function showToastFromButton({ main, sub = '', icon = ICON.INFO, duration = 1400 }) {
        const btn = document.getElementById('autofill-login-btn');
        if (!btn) return;

        const key = `${icon}|${main || ''}|${sub || ''}`;
        const now = performance.now();
        if (key === _toastLastKey && (now - _toastLastTs) < TOAST_DEDUPE_MS) return;
        _toastLastKey = key;
        _toastLastTs = now;

        const t = ensureToast();
        t.setAttribute('data-theme', getTheme());

        t.querySelector('.ic').textContent = icon;
        t.querySelector('.main').textContent = main || '';
        const subEl = t.querySelector('.sub');
        if (sub) { subEl.textContent = sub; subEl.style.display = 'block'; }
        else { subEl.textContent = ''; subEl.style.display = 'none'; }

        if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
        t.classList.remove('show');

        requestAnimationFrame(() => {
            t.classList.add('show');
            t.style.left = '-9999px'; t.style.top = '-9999px';

            const br = btn.getBoundingClientRect();
            const tr = t.getBoundingClientRect();
            const tw = tr.width, th = tr.height;
            const gap = 10;

            const side = pickToastSide(br, tw, th, gap);
            t.setAttribute('data-side', side);

            const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
            const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);

            let x = 0, y = 0;
            if (side === 'right') { x = br.right + gap; y = br.top + (br.height / 2) - (th / 2); }
            else if (side === 'left') { x = br.left - gap - tw; y = br.top + (br.height / 2) - (th / 2); }
            else if (side === 'top') { x = br.left + (br.width / 2) - (tw / 2); y = br.top - gap - th; }
            else { x = br.left + (br.width / 2) - (tw / 2); y = br.bottom + gap; }

            x = Math.min(Math.max(8, x), vw - tw - 8);
            y = Math.min(Math.max(8, y), vh - th - 8);

            t.style.left = `${Math.round(x)}px`;
            t.style.top = `${Math.round(y)}px`;
        });

        toastTimer = setTimeout(() => {
            const t2 = document.getElementById('ibaf-toast');
            if (!t2) return;
            t2.classList.remove('show');
            setTimeout(() => { t2.style.left = '-9999px'; t2.style.top = '-9999px'; }, 160);
        }, duration);
    }

    let _aToastTimer = null;

    function showActionToast({
        main,
        sub = '',
        icon = ICON.INFO,
        primaryText = 'OK',
        secondaryText = 'Cancel',
        onPrimary = null,
        onSecondary = null,
        duration = 8000
    }) {
        injectStyles();

        let box = document.getElementById('ibaf-atoast');
        if (!box) {
            box = document.createElement('div');
            box.id = 'ibaf-atoast';
            box.style.left = '14px';
            box.style.bottom = '14px';
            document.body.appendChild(box);
        }

        if (box._ibafWinClick) window.removeEventListener('click', box._ibafWinClick, true);
        if (box._ibafWinPointerDown) window.removeEventListener('pointerdown', box._ibafWinPointerDown, true);
        box._ibafWinClick = null;
        box._ibafWinPointerDown = null;

        box.style.display = 'block';

        box.setAttribute('data-theme', getTheme());
        box.innerHTML = `
    <div class="t">
      <div class="ic">${icon}</div>
      <div>
        <div class="main">${escapeHtml(main || '')}</div>
        ${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : `<div class="sub" style="display:none"></div>`}
      </div>
    </div>
    <div class="acts">
      <button class="abtn" type="button" data-act="secondary">${escapeHtml(secondaryText)}</button>
      <button class="abtn primary" type="button" data-act="primary">${escapeHtml(primaryText)}</button>
    </div>
  `;

        const close = () => {
            box.classList.remove('show');

            if (_aToastTimer) {
                clearTimeout(_aToastTimer);
                _aToastTimer = null;
            }

            if (box._ibafWinClick) window.removeEventListener('click', box._ibafWinClick, true);
            if (box._ibafWinPointerDown) window.removeEventListener('pointerdown', box._ibafWinPointerDown, true);
            box._ibafWinClick = null;
            box._ibafWinPointerDown = null;

            setTimeout(() => {
                if (!box.classList.contains('show')) box.style.display = 'none';
            }, 180);
        };

        const onWinPointerDown = (ev) => {
            if (ev.target.closest?.('#ibaf-atoast')) {
                ev.stopPropagation();
            }
        };

        const onWinClick = (ev) => {
            const inside = ev.target.closest?.('#ibaf-atoast');
            if (!inside) return;

            const btn = ev.target.closest?.('button[data-act]');
            if (!btn) {
                ev.preventDefault();
                ev.stopPropagation();
                return;
            }

            ev.preventDefault();
            ev.stopPropagation();

            const act = btn.getAttribute('data-act');

            if (act === 'primary') {
                try { onPrimary?.(); } catch (e) { log.error('ActionToast onPrimary failed:', e); }
                close();
                return;
            }

            if (act === 'secondary') {
                try { onSecondary?.(); } catch (e) { log.error('ActionToast onSecondary failed:', e); }
                close();
                return;
            }
        };

        box._ibafWinClick = onWinClick;
        box._ibafWinPointerDown = onWinPointerDown;

        window.addEventListener('pointerdown', onWinPointerDown, true);
        window.addEventListener('click', onWinClick, true);

        requestAnimationFrame(() => box.classList.add('show'));

        if (_aToastTimer) clearTimeout(_aToastTimer);
        _aToastTimer = setTimeout(() => close(), duration);
    }

    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    async function readClipboardText() {
        try {
            if (!navigator.clipboard?.readText) return '';
            const t = await navigator.clipboard.readText();
            return (t || '');
        } catch (err) {
            log.warn('Clipboard readText blocked:', err);
            showToastFromButton({
                main: 'Clipboard blocked',
                sub: 'Browser denied read access (click the page first)',
                icon: ICON.BLOCK,
                duration: 2400
            });
            return '';
        }
    }

    const CLIP_MAX_CANDIDATES = 12;

    function normalizeClipboardText(text) {
        const t = String(text ?? '');
        return t
            .replace(/[\u200B-\u200D\uFEFF]/g, '')
            .replace(/\u00A0/g, ' ')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .trim();
    }

    function extractLoginCandidatesLimited(text) {
        const t0 = normalizeClipboardText(text);
        if (!t0) return { list: [], total: 0 };

        if (LOGIN_EXACT_RE.test(t0)) return { list: [t0], total: 1 };

        const digitsOnly = t0.replace(/[^\d]/g, '');
        if (digitsOnly.length === LOGIN_DIGITS && LOGIN_EXACT_RE.test(digitsOnly)) {
            return { list: [digitsOnly], total: 1 };
        }

        const relaxed = t0.replace(/[^\d]/g, ' ');
        const matches = relaxed.match(new RegExp(`\\b\\d{${LOGIN_DIGITS}}\\b`, 'g')) || [];

        const seen = new Set();
        const out = [];
        for (const x of matches) {
            if (!seen.has(x)) {
                seen.add(x);
                out.push(x);
            }
        }

        const total = out.length;
        const list = out.slice(0, CLIP_MAX_CANDIDATES);
        return { list, total };
    }

    let pickerOpen = false;
    let clipPickerState = null;

    function closeClipboardPicker() {
        if (clipPickerState?.close) clipPickerState.close({ keepBusy: false });
        clipPickerState = null;
    }

    function setButtonBusy(isBusy) {
        const btn = document.getElementById('autofill-login-btn');
        if (!btn) return;

        if (isBusy) {
            if (btn.dataset.busy === '1') return;
            btn.dataset.busy = '1';
            btn._prevText = btn._prevText ?? btn.textContent;
            btn.textContent = ICON.WAIT;
            btn.title = 'Autofill running… (Alt+A)';
            btn.style.opacity = '0.92';
        } else {
            if (btn.dataset.busy !== '1') return;
            btn.dataset.busy = '0';
            btn.textContent = btn._prevText || '🔐';
            btn.title = 'Autofill — Alt+A (Alt+S menu)';
            btn.style.opacity = '1';
        }
    }

    function openClipboardPicker({ candidates, anchorEl, onPick, keepBusyAfterPick = false }) {
        injectStyles();

        pickerOpen = true;
        setButtonBusy(true);

        let box = document.getElementById('ibaf-clip');
        if (!box) {
            box = document.createElement('div');
            box.id = 'ibaf-clip';
            document.body.appendChild(box);
        }

        const list = candidates
        .map(v => `<div class="opt" data-val="${v}"><span>${ICON.COPY} ${v}</span><span>↵</span></div>`)
        .join('');

        box.innerHTML = `
      <div class="hd"><span class="t">Pick login from clipboard</span></div>
      ${list}
      <div class="ft">Esc closes, click outside closes</div>
    `;

        const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
        const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);

        let x = Math.round(vw / 2 - 160);
        let y = 80;

        const ar = anchorEl?.getBoundingClientRect?.();
        if (ar && ar.width) {
            x = Math.min(Math.max(12, ar.left), vw - 360);
            y = Math.min(Math.max(12, ar.bottom + 8), vh - 260);
        }

        box.style.left = `${x}px`;
        box.style.top = `${y}px`;

        requestAnimationFrame(() => box.classList.add('show'));

        const close = ({ keepBusy = false } = {}) => {
            box.classList.remove('show');
            setTimeout(() => { box.style.left = '-9999px'; box.style.top = '-9999px'; }, 120);

            box.removeEventListener('click', clickHandler);
            window.removeEventListener('mousedown', outside, true);
            window.removeEventListener('keydown', onKey, true);

            pickerOpen = false;
            if (!keepBusy) setButtonBusy(false);
        };

        const clickHandler = (ev) => {
            const opt = ev.target.closest?.('.opt');
            if (!opt) return;

            const val = opt.getAttribute('data-val');
            if (!val) return;

            const keepBusy = !!keepBusyAfterPick;
            Promise.resolve(onPick(val))
                .finally(() => close({ keepBusy }));
        };

        const outside = (ev) => {
            if (ev.target.closest && ev.target.closest('#ibaf-clip')) return;
            close({ keepBusy: false });
        };

        const onKey = (ev) => { if (ev.key === 'Escape') close({ keepBusy: false }); };

        box.addEventListener('click', clickHandler);
        window.addEventListener('mousedown', outside, true);
        window.addEventListener('keydown', onKey, true);

        clipPickerState = { close };
    }

    let confirmState = null;

    function ensureConfirmPopover() {
        injectStyles();
        let box = document.getElementById('ibaf-confirm');
        if (!box) {
            box = document.createElement('div');
            box.id = 'ibaf-confirm';
            box.innerHTML = `
        <div class="main"></div>
        <div class="sub"></div>
        <div class="acts">
          <button class="cbtn" type="button" data-act="cancel">Cancel</button>
          <button class="cbtn primary" type="button" data-act="ok">Confirm</button>
        </div>
      `;
            document.body.appendChild(box);
        }
        return box;
    }

    function closeConfirm() {
        if (!confirmState) return;
        const { box, onOutside, onKey, onClick } = confirmState;
        box.classList.remove('show');
        box.removeEventListener('click', onClick);
        window.removeEventListener('mousedown', onOutside, true);
        window.removeEventListener('keydown', onKey, true);
        confirmState = null;
    }

    function openConfirmNear({ anchorEl = null, x = null, y = null, main = 'Confirm?', sub = '', onOk = null, onCancel = null }) {
        const box = ensureConfirmPopover();
        box.querySelector('.main').textContent = main;
        box.querySelector('.sub').textContent = sub;

        const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
        const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);

        let px = 14, py = 14;
        if (typeof x === 'number' && typeof y === 'number') {
            px = x; py = y;
        } else if (anchorEl?.getBoundingClientRect) {
            const r = anchorEl.getBoundingClientRect();
            px = Math.round(r.left);
            py = Math.round(r.bottom + 8);
        }

        box.style.left = `${Math.min(Math.max(8, px), vw - 280)}px`;
        box.style.top = `${Math.min(Math.max(8, py), vh - 140)}px`;

        const onClick = (ev) => {
            const b = ev.target.closest?.('button[data-act]');
            if (!b) return;
            const act = b.getAttribute('data-act');
            if (act === 'ok') { try { onOk?.(); } catch {} closeConfirm(); }
            if (act === 'cancel') { try { onCancel?.(); } catch {} closeConfirm(); }
        };

        const onOutside = (ev) => {
            if (ev.target.closest && ev.target.closest('#ibaf-confirm')) return;
            try { onCancel?.(); } catch {}
            closeConfirm();
        };

        const onKey = (ev) => {
            if (ev.key === 'Escape') {
                try { onCancel?.(); } catch {}
                closeConfirm();
            }
        };

        closeConfirm();
        confirmState = { box, onOutside, onKey, onClick };
        box.addEventListener('click', onClick);
        window.addEventListener('mousedown', onOutside, true);
        window.addEventListener('keydown', onKey, true);

        requestAnimationFrame(() => box.classList.add('show'));
    }

    function ensureSettingsModal() {
        injectStyles();

        let modal = document.getElementById('ibaf-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'ibaf-modal';
            modal.innerHTML = `
        <div class="panel" role="dialog" aria-modal="true">
          <div class="hdr">
            <div class="ttl">${ICON.GEAR} Settings (TEST)</div>
            <button class="x" type="button" aria-label="Close">✕</button>
          </div>
          <div class="body">

            <div class="chkline">
              <input id="ibaf-set-confirm" type="checkbox"/>
              <label for="ibaf-set-confirm">Confirm before using favorite login</label>
              <span class="hint" style="margin-left:auto">Default: off (fast mode)</span>
            </div>

            <div class="chkline">
              <input id="ibaf-set-autosubmit" type="checkbox"/>
              <label for="ibaf-set-autosubmit">Auto submit where possible</label>
              <span class="hint" style="margin-left:auto">Default: on</span>
            </div>

            <div class="divider"></div>

            <div class="row">
              <label for="ibaf-set-pass">Password</label>
              <input id="ibaf-set-pass" type="text" autocomplete="off" spellcheck="false"/>
              <div class="hint">Visible (test password). Stored in localStorage (plain text).</div>
            </div>

            <div class="row">
              <label for="ibaf-set-sms">SMS / OTP code</label>
              <input id="ibaf-set-sms" type="text" inputmode="numeric" autocomplete="off" spellcheck="false"/>
              <div class="hint">Digits only, 4–8 chars. Stored in localStorage (plain text).</div>
            </div>

            <div class="row">
              <label for="ibaf-set-theme">Color</label>
              <select id="ibaf-set-theme"></select>
              <div class="hint">Changes button + toast theme.</div>
            </div>

            <div class="hint">
              Shortcuts (only on login screen):
              <b>Alt+A</b> run |
              <b>Shift+Click</b> or <b>Shift+Alt+A</b> forces overwrite login |
              <b>Alt+S</b> opens menu |
              <b>Alt+E</b> favorites
            </div>
          </div>
          <div class="ftr">
            <button class="btn" type="button" data-act="reset">Reset to defaults</button>
            <button class="btn primary" type="button" data-act="save">${ICON.SAVE} Save</button>
          </div>
        </div>
      `;
            document.body.appendChild(modal);
        }

        const sel = modal.querySelector('#ibaf-set-theme');
        if (sel && !sel._ibafPopulated) {
            sel._ibafPopulated = true;
            sel.innerHTML = THEMES.map(t => `<option value="${t}">${t}</option>`).join('');
        }

        return modal;
    }

    function openSettings() {
        const modal = ensureSettingsModal();
        const s = loadSettings();

        modal.querySelector('#ibaf-set-pass').value = s.password;
        modal.querySelector('#ibaf-set-sms').value = s.smsCode;
        modal.querySelector('#ibaf-set-theme').value = s.theme;
        modal.querySelector('#ibaf-set-confirm').checked = !!s.confirmBeforeUse;
        modal.querySelector('#ibaf-set-autosubmit').checked = !!s.defaultAutoSubmit;

        const close = () => {
            modal.classList.remove('show');
            window.removeEventListener('keydown', onKey, true);
        };

        const onKey = (ev) => { if (ev.key === 'Escape') close(); };

        if (!modal._ibafWired) {
            modal._ibafWired = true;

            modal.addEventListener('mousedown', (ev) => { if (ev.target === modal) close(); });
            modal.querySelector('.x').addEventListener('click', close);

            modal.querySelector('[data-act="reset"]').addEventListener('click', () => {
                const ns = resetSettingsToDefaults();
                modal.querySelector('#ibaf-set-pass').value = ns.password;
                modal.querySelector('#ibaf-set-sms').value = ns.smsCode;
                modal.querySelector('#ibaf-set-theme').value = ns.theme;
                modal.querySelector('#ibaf-set-confirm').checked = !!ns.confirmBeforeUse;
                modal.querySelector('#ibaf-set-autosubmit').checked = !!ns.defaultAutoSubmit;

                applyThemeToButton(ns.theme);
                showToastFromButton({ main: 'Defaults restored', sub: 'Saved to localStorage', icon: ICON.BACK, duration: 1400 });
            });

            modal.querySelector('[data-act="save"]').addEventListener('click', () => {
                const pass = String(modal.querySelector('#ibaf-set-pass').value || '');
                const sms = String(modal.querySelector('#ibaf-set-sms').value || '');
                const theme = String(modal.querySelector('#ibaf-set-theme').value || 'teal');
                const confirmBeforeUse = !!modal.querySelector('#ibaf-set-confirm').checked;
                const defaultAutoSubmit = !!modal.querySelector('#ibaf-set-autosubmit').checked;

                const smsOk = /^\d{4,8}$/.test(sms.trim());
                if (!smsOk) {
                    showToastFromButton({ main: 'Invalid OTP', sub: 'Use 4–8 digits', icon: ICON.WARN, duration: 1800 });
                    return;
                }

                const ns = {
                    password: pass,
                    smsCode: sms.trim(),
                    theme: THEMES.includes(theme) ? theme : 'teal',
                    confirmBeforeUse,
                    defaultAutoSubmit
                };

                saveSettings(ns);
                applyThemeToButton(ns.theme);

                showToastFromButton({ main: 'Saved', sub: 'Settings updated', icon: ICON.SAVE, duration: 1200 });
                close();
            });

            modal.querySelector('#ibaf-set-theme').addEventListener('change', () => {
                const theme = String(modal.querySelector('#ibaf-set-theme').value || 'teal');
                applyThemeToButton(theme);
            });
        }

        modal.classList.add('show');
        window.addEventListener('keydown', onKey, true);
    }

    function applyThemeToButton(theme) {
        const btn = document.getElementById('autofill-login-btn');
        if (btn) btn.setAttribute('data-theme', THEMES.includes(theme) ? theme : 'teal');
    }

    let favModalState = null;

    function ensureFavoritesModal() {
        injectStyles();

        let modal = document.getElementById('ibaf-fav');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'ibaf-fav';
            modal.innerHTML = `
        <div class="panel" role="dialog" aria-modal="true">
          <div class="hdr">
            <div class="ttl">${ICON.STAR} Favorites</div>
            <div class="tools">
              <input id="ibaf-fav-search" type="text" placeholder="Search login / name / note…" autocomplete="off" spellcheck="false"/>
              <span class="pill"><input id="ibaf-fav-pinnedOnly" type="checkbox"/><label for="ibaf-fav-pinnedOnly">Pinned only</label></span>
              <select id="ibaf-fav-sort">
                <option value="last">Sort: last used</option>
                <option value="name">Sort: name</option>
                <option value="login">Sort: login</option>
                <option value="pin">Sort: pinned first</option>
              </select>
              <button class="x" type="button" aria-label="Close">✕</button>
            </div>
          </div>

          <div class="body">
            <div class="muted" style="margin-bottom:8px">
              Tip: click fields to edit. Use ${ICON.PIN} to pin. ${ICON.CHECK} logs in with that login.
            </div>

            <table>
              <thead>
                <tr>
                  <th style="width:140px">Login</th>
                  <th style="width:260px">Client name</th>
                  <th>Note</th>
                  <th style="width:220px">Preferences</th>
                  <th style="width:160px">Actions</th>
                </tr>
              </thead>
              <tbody id="ibaf-fav-tbody"></tbody>
            </table>

            <div class="rowhint">A blank row is always available at the bottom. Click it to add a new favorite.</div>
          </div>

          <div class="ftr">
            <div class="left" id="ibaf-fav-status"></div>
            <button class="btn" type="button" data-act="export">${ICON.COPY} Export JSON</button>
            <button class="btn" type="button" data-act="import">${ICON.UP} Import JSON</button>
            <button class="btn primary" type="button" data-act="close">Close</button>
          </div>
        </div>
      `;
            document.body.appendChild(modal);
        }
        return modal;
    }

    function formatAgo(ts) {
        const d = Math.max(0, Date.now() - (Number(ts) || 0));
        const s = Math.floor(d / 1000);
        if (s < 60) return `${s}s ago`;
        const m = Math.floor(s / 60);
        if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 48) return `${h}h ago`;
        const days = Math.floor(h / 24);
        return `${days}d ago`;
    }

    function sortFavorites(list, mode) {
        const arr = [...list];
        if (mode === 'name') arr.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'cs', { sensitivity: 'base' }));
        else if (mode === 'login') arr.sort((a, b) => String(a.login || '').localeCompare(String(b.login || '')));
        else if (mode === 'pin') arr.sort((a, b) => (b.pinned === a.pinned ? (b.lastUsedTs - a.lastUsedTs) : (b.pinned ? 1 : -1)));
        else arr.sort((a, b) => (b.lastUsedTs || 0) - (a.lastUsedTs || 0));
        return arr;
    }

    function validateFavorites(list) {
        const problems = [];
        const seen = new Map();
        list.forEach((x, idx) => {
            const l = String(x.login || '').trim();
            if (!l) return;
            if (!isValidLogin(l)) problems.push({ idx, type: 'bad-login', login: l });
            if (seen.has(l)) problems.push({ idx, type: 'dup-login', login: l, other: seen.get(l) });
            else seen.set(l, idx);
        });
        return problems;
    }

    function mergeImportedFavorites(imported) {
        const base = loadFavorites();
        const byLogin = new Map(base.map(x => [x.login, x]));
        const out = [...base];

        for (const item of imported) {
            const login = String(item?.login || '').trim();
            if (!isValidLogin(login)) continue;

            const next = {
                id: String(item?.id || makeFavId()),
                login,
                name: String(item?.name || ''),
                note: String(item?.note || ''),
                pinned: !!item?.pinned,
                lastUsedTs: Number(item?.lastUsedTs || 0),
                prefs: {
                    skipPassword: !!item?.prefs?.skipPassword,
                    skipOtp: !!item?.prefs?.skipOtp,
                    autoSubmit: (item?.prefs?.autoSubmit === undefined) ? true : !!item?.prefs?.autoSubmit
                }
            };

            if (byLogin.has(login)) {
                const cur = byLogin.get(login);
                const merged = {
                    ...cur,
                    name: cur.name || next.name,
                    note: cur.note || next.note,
                    pinned: !!(cur.pinned || next.pinned),
                    lastUsedTs: Math.max(Number(cur.lastUsedTs || 0), Number(next.lastUsedTs || 0)),
                    prefs: { ...cur.prefs, ...next.prefs }
                };
                const idx = out.findIndex(x => x.login === login);
                if (idx >= 0) out[idx] = merged;
            } else {
                out.push(next);
                byLogin.set(login, next);
            }
        }

        saveFavorites(out);
        return out;
    }

    function renderFavorites({ focusLogin = null } = {}) {
        const modal = ensureFavoritesModal();
        const tbody = modal.querySelector('#ibaf-fav-tbody');
        const status = modal.querySelector('#ibaf-fav-status');

        const q = String(modal.querySelector('#ibaf-fav-search')?.value || '').trim().toLowerCase();
        const pinnedOnly = !!modal.querySelector('#ibaf-fav-pinnedOnly')?.checked;
        const sortMode = String(modal.querySelector('#ibaf-fav-sort')?.value || 'last');

        let list = loadFavorites();

        if (pinnedOnly) list = list.filter(x => x.pinned);

        if (q) {
            list = list.filter(x => {
                const a = String(x.login || '').toLowerCase();
                const b = String(x.name || '').toLowerCase();
                const c = String(x.note || '').toLowerCase();
                return a.includes(q) || b.includes(q) || c.includes(q);
            });
        }

        list = sortFavorites(list, sortMode);

        const problems = validateFavorites(loadFavorites());
        const dupCount = problems.filter(p => p.type === 'dup-login').length;
        const badCount = problems.filter(p => p.type === 'bad-login').length;

        status.textContent = `${loadFavorites().length} saved • ${pinnedOnly ? 'pinned only • ' : ''}${q ? 'filtered • ' : ''}${badCount ? `⚠ bad logins: ${badCount} • ` : ''}${dupCount ? `⚠ duplicates: ${dupCount}` : 'ok'}`;

        const rows = [...list, { __blank: true, id: '__blank__' }];

        tbody.innerHTML = rows.map((x, i) => {
            const isBlank = !!x.__blank;
            const login = isBlank ? '' : String(x.login || '');
            const name = isBlank ? '' : String(x.name || '');
            const note = isBlank ? '' : String(x.note || '');
            const pinned = isBlank ? false : !!x.pinned;
            const lastUsed = isBlank ? '' : (x.lastUsedTs ? formatAgo(x.lastUsedTs) : '');

            const prefs = isBlank ? { skipPassword: false, skipOtp: false, autoSubmit: true } : (x.prefs || {});
            const sp = !!prefs.skipPassword;
            const so = !!prefs.skipOtp;
            const as = (prefs.autoSubmit === undefined) ? true : !!prefs.autoSubmit;

            return `
        <tr data-id="${escapeHtml(x.id)}" data-blank="${isBlank ? '1' : '0'}">
          <td>
            <div class="cell">
              <input class="f-login ${isBlank ? '' : ''}" type="text" value="${escapeHtml(login)}" placeholder="${isBlank ? 'Click to add…' : ''}" spellcheck="false" autocomplete="off"/>
            </div>
            ${isBlank ? '' : `<div class="tiny">${lastUsed ? `Last used: ${escapeHtml(lastUsed)}` : ''}</div>`}
          </td>
          <td>
            <div class="cell">
              <input class="f-name" type="text" value="${escapeHtml(name)}" placeholder="${isBlank ? '' : '—'}" spellcheck="false" autocomplete="off"/>
            </div>
          </td>
          <td>
            <div class="cell">
              <input class="f-note" type="text" value="${escapeHtml(note)}" placeholder="${isBlank ? '' : '—'}" spellcheck="false" autocomplete="off"/>
            </div>
          </td>
          <td>
            <div class="prefs">
              <span class="pp"><input class="f-skipPass" type="checkbox" ${sp ? 'checked' : ''}/> <span>Skip password</span></span>
              <span class="pp"><input class="f-skipOtp" type="checkbox" ${so ? 'checked' : ''}/> <span>Skip OTP</span></span>
              <span class="pp"><input class="f-autoSubmit" type="checkbox" ${as ? 'checked' : ''}/> <span>Auto submit</span></span>
            </div>
          </td>
          <td>
            <div class="cell" style="justify-content:flex-end">
              <button class="iconbtn f-pin" type="button" title="${pinned ? 'Unpin' : 'Pin'}">${pinned ? ICON.PIN : ICON.UNPIN}</button>
              <button class="iconbtn f-use" type="button" title="Use login">${ICON.CHECK}</button>
              <button class="iconbtn f-del" type="button" title="Delete">${ICON.TRASH}</button>
            </div>
            ${isBlank ? '' : `<div class="tiny" style="text-align:right;opacity:.65">Login must be exactly ${LOGIN_DIGITS} digits</div>`}
          </td>
        </tr>
      `;
        }).join('');

        if (focusLogin) {
            const row = [...tbody.querySelectorAll('tr')].find(r => String(r.querySelector('.f-login')?.value || '') === String(focusLogin));
            if (row) {
                row.scrollIntoView({ block: 'center', behavior: 'instant' });
                row.style.outline = '2px solid rgba(34,211,238,.28)';
                row.style.outlineOffset = '4px';
                setTimeout(() => { row.style.outline = ''; row.style.outlineOffset = ''; }, 1200);
            }
        }
    }

    function openFavorites({ focusLogin = null } = {}) {
        const modal = ensureFavoritesModal();

        const close = () => {
            modal.classList.remove('show');
            window.removeEventListener('keydown', onKey, true);
            favModalState = null;
        };

        const onKey = (ev) => { if (ev.key === 'Escape') close(); };

        if (!modal._ibafWired) {
            modal._ibafWired = true;

            modal.addEventListener('mousedown', (ev) => { if (ev.target === modal) close(); });
            modal.querySelector('.x').addEventListener('click', close);

            const rerender = () => renderFavorites();

            modal.querySelector('#ibaf-fav-search').addEventListener('input', rerender);
            modal.querySelector('#ibaf-fav-pinnedOnly').addEventListener('change', rerender);
            modal.querySelector('#ibaf-fav-sort').addEventListener('change', rerender);

            modal.querySelector('[data-act="close"]').addEventListener('click', close);

            modal.querySelector('[data-act="export"]').addEventListener('click', async () => {
                try {
                    const data = JSON.stringify(loadFavorites(), null, 2);
                    await navigator.clipboard.writeText(data);
                    showToastFromButton({ main: 'Exported', sub: 'Favorites JSON copied to clipboard', icon: ICON.COPY, duration: 1600 });
                } catch (e) {
                    showToastFromButton({ main: 'Export failed', sub: String(e?.message || e), icon: ICON.WARN, duration: 2200 });
                }
            });

            modal.querySelector('[data-act="import"]').addEventListener('click', async () => {
                showActionToast({
                    icon: ICON.UP,
                    main: 'Import favorites JSON',
                    sub: 'Paste JSON into the next prompt. Existing logins will be merged.',
                    primaryText: 'Paste now',
                    secondaryText: 'Cancel',
                    onPrimary: () => {
                        const txt = prompt('Paste favorites JSON here:');
                        if (!txt) return;
                        try {
                            const parsed = JSON.parse(txt);
                            if (!Array.isArray(parsed)) throw new Error('JSON must be an array');
                            mergeImportedFavorites(parsed);
                            renderFavorites();
                            showToastFromButton({ main: 'Imported', sub: 'Favorites updated', icon: ICON.OK, duration: 1500 });
                        } catch (e) {
                            showToastFromButton({ main: 'Import failed', sub: String(e?.message || e), icon: ICON.WARN, duration: 2600 });
                        }
                    }
                });
            });

            modal.addEventListener('click', async (ev) => {
                const tr = ev.target.closest?.('tr[data-id]');
                if (!tr) return;

                const id = tr.getAttribute('data-id');
                const isBlank = tr.getAttribute('data-blank') === '1';

                const btnPin = ev.target.closest?.('button.f-pin');
                const btnUse = ev.target.closest?.('button.f-use');
                const btnDel = ev.target.closest?.('button.f-del');

                if (btnPin || btnUse || btnDel) {
                    const loginVal = String(tr.querySelector('.f-login')?.value || '').trim();

                    if (isBlank) {
                        const normalized = normalizeLogin(loginVal);
                        if (!isValidLogin(normalized)) {
                            showToastFromButton({ main: 'Invalid login', sub: `Use exactly ${LOGIN_DIGITS} digits`, icon: ICON.WARN, duration: 2000 });
                            return;
                        }
                        const existing = findFavByLogin(normalized);
                        if (existing) {
                            renderFavorites({ focusLogin: normalized });
                            showToastFromButton({ main: 'Already exists', sub: `Login ${normalized} is already saved`, icon: ICON.INFO, duration: 1700 });
                            return;
                        }

                        const s = loadSettings();
                        const rowData = readFavRow(tr, { defaultsFromSettings: s });
                        const created = {
                            id: makeFavId(),
                            login: normalized,
                            name: rowData.name,
                            note: rowData.note,
                            pinned: false,
                            lastUsedTs: 0,
                            prefs: rowData.prefs
                        };
                        upsertFavorite(created);
                        renderFavorites({ focusLogin: normalized });
                    }

                    const list = loadFavorites();
                    const fav = list.find(x => x.id === id) || (isBlank ? findFavByLogin(normalizeLogin(loginVal)) : null);
                    if (!fav) return;

                    if (btnPin) {
                        upsertFavorite({ id: fav.id, login: fav.login, pinned: !fav.pinned });
                        renderFavorites({ focusLogin: fav.login });
                        return;
                    }

                    if (btnDel) {
                        deleteFavoriteById(fav.id);
                        renderFavorites();
                        showToastFromButton({ main: 'Deleted', sub: `Login ${fav.login}`, icon: ICON.TRASH, duration: 1400 });
                        return;
                    }

                    if (btnUse) {
                        await useFavoriteLogin(fav, { sourceEl: btnUse });
                        return;
                    }
                }
            });

            modal.addEventListener('input', (ev) => {
                const tr = ev.target.closest?.('tr[data-id]');
                if (!tr) return;

                const id = tr.getAttribute('data-id');
                const isBlank = tr.getAttribute('data-blank') === '1';
                if (isBlank) return;

                const row = readFavRow(tr, { defaultsFromSettings: loadSettings() });
                const loginInput = tr.querySelector('.f-login');
                if (loginInput) {
                    const l = String(loginInput.value || '').trim();
                    const ok = !l || isValidLogin(l);
                    loginInput.classList.toggle('bad', !!l && !ok);
                }

                if (row.login && isValidLogin(row.login)) {
                    upsertFavorite({ id, ...row });
                } else {
                    upsertFavorite({
                        id,
                        login: String(findFavoriteById(id)?.login || ''),
                        name: row.name,
                        note: row.note,
                        pinned: row.pinned,
                        prefs: row.prefs
                    });
                }

                renderFavorites();
            });

            modal.addEventListener('blur', (ev) => {
                const input = ev.target.closest?.('input.f-login');
                if (!input) return;

                const tr = ev.target.closest?.('tr[data-blank="1"]');
                if (!tr) return;

                const val = normalizeLogin(input.value);
                if (!isValidLogin(val)) return;

                const existing = findFavByLogin(val);
                if (existing) return;

                const s = loadSettings();
                const rowData = readFavRow(tr, { defaultsFromSettings: s });

                upsertFavorite({
                    id: makeFavId(),
                    login: val,
                    name: rowData.name,
                    note: rowData.note,
                    pinned: false,
                    lastUsedTs: 0,
                    prefs: rowData.prefs
                });

                renderFavorites({ focusLogin: val });
            }, true);
        }

        modal.querySelector('#ibaf-fav-pinnedOnly').checked = false;

        renderFavorites({ focusLogin });

        modal.classList.add('show');
        window.addEventListener('keydown', onKey, true);
        favModalState = { close };
    }

    function findFavoriteById(id) {
        const list = loadFavorites();
        return list.find(x => x.id === id) || null;
    }

    function readFavRow(tr, { defaultsFromSettings } = {}) {
        const login = String(tr.querySelector('.f-login')?.value || '').trim();
        const name = String(tr.querySelector('.f-name')?.value || '');
        const note = String(tr.querySelector('.f-note')?.value || '');
        const pinned = !!tr.querySelector('.f-pin')?.textContent?.includes(ICON.PIN);

        const skipPassword = !!tr.querySelector('.f-skipPass')?.checked;
        const skipOtp = !!tr.querySelector('.f-skipOtp')?.checked;
        const autoSubmit = !!tr.querySelector('.f-autoSubmit')?.checked;

        const prefs = {
            skipPassword,
            skipOtp,
            autoSubmit: (autoSubmit === undefined) ? true : autoSubmit
        };

        if (defaultsFromSettings && tr.getAttribute('data-blank') === '1') {
            prefs.autoSubmit = !!defaultsFromSettings.defaultAutoSubmit;
        }

        return { login, name, note, pinned, prefs };
    }

    function isValidOtp(v) { return /^\d{4,8}$/.test(v); }

    async function fillOtpInputs(code) {
        const inputs = findOtpInputs().filter(isVisible);
        if (!inputs.length) return false;

        const value = String(code || '').trim();
        if (!isValidOtp(value)) return false;

        if (inputs.length === 1) {
            simulateReactInput(inputs[0], value);
            return true;
        }

        const digits = value.split('');
        const n = Math.min(inputs.length, digits.length);

        for (let i = 0; i < n; i++) {
            const el = inputs[i];
            const d = digits[i] || '';
            simulateReactInput(el, d);
            await new Promise(r => setTimeout(r, 20));
        }

        try {
            const first = inputs[0];
            if (first) simulateReactInput(first, value);
        } catch {}

        return true;
    }

    async function tryFillOtpImmediate({ skipOtp = false, autoSubmit = true } = {}) {
        if (skipOtp) return false;

        const s = loadSettings();
        const ok = await fillOtpInputs(s.smsCode);
        if (!ok) return false;

        if (autoSubmit) {
            let send = null;
            for (const sel of SMS_SEND_BUTTON_SELECTORS) {
                send = queryDeepOne(sel);
                if (send && isButtonClickable(send)) break;
            }
            if (send) await safeClick(send);
        }

        showToastFromButton({ main: 'OTP filled', sub: autoSubmit ? 'Submitting…' : 'Ready', icon: ICON.SMS, duration: 1200 });
        return true;
    }

    async function waitForOtpAndFill(timeout = 12000, { skipOtp = false, autoSubmit = true } = {}) {
        if (skipOtp) return false;

        const otp = await waitUntil(() => {
            const arr = findOtpInputs().filter(isVisible);
            return arr.length ? arr : null;
        }, { timeout, interval: 120 });

        if (!otp) return false;
        return await tryFillOtpImmediate({ skipOtp, autoSubmit });
    }

    async function tryFillLoginFromClipboard({ force = false, continueFlow = false } = {}) {
        if (!isLoginInputRendered()) return { ok: false, reason: 'inactive' };

        const input = findLoginInput();
        if (!input || !isVisible(input)) return { ok: false, reason: 'no-input' };

        const current = (input.value || '').trim();
        if (current && !force) return { ok: false, reason: 'already-filled' };

        const clipRaw = await readClipboardText();
        const { list, total } = extractLoginCandidatesLimited(clipRaw);

        if (list.length === 0) {
            const sample = normalizeClipboardText(clipRaw).slice(0, 40);
            showToastFromButton({
                main: 'No login in clipboard',
                sub: sample ? `Clipboard: "${sample}${normalizeClipboardText(clipRaw).length > 40 ? '…' : ''}"` : `Looking for ${LOGIN_DIGITS} digits`,
                icon: ICON.WARN,
                duration: 2600
            });
            return { ok: false, reason: 'no-candidate' };
        }

        const doFill = async (login) => {
            simulateReactInput(input, login);
            setLastLogin(login);
            setSessionLastUsedLogin(login);
            markFavoriteUsed(login);
            showToastFromButton({ main: `Login ${login}`, sub: 'Filled from clipboard', icon: ICON.OK, duration: 1200 });
            return true;
        };

        if (list.length === 1) {
            await doFill(list[0]);
            return { ok: true, picked: list[0] };
        }

        const extra = total > list.length ? `Showing ${list.length} of ${total}` : 'Pick one';
        showToastFromButton({ main: 'Multiple logins found', sub: extra, icon: ICON.WARN, duration: 2000 });

        openClipboardPicker({
            candidates: list,
            anchorEl: input,
            keepBusyAfterPick: continueFlow,
            onPick: async (val) => {
                await doFill(val);
                if (continueFlow) await continueAfterLoginFilled();
            }
        });

        return { ok: false, reason: 'multiple-candidates' };
    }

    function getPerLoginPrefs(login) {
        const fav = findFavByLogin(login);
        if (!fav) return null;
        return fav.prefs || null;
    }

    async function continueAfterLoginFilled({ perLoginPrefs = null } = {}) {
        const submit = findSubmitButton();
        if (!submit) {
            showToastFromButton({ main: 'Submit not found', sub: 'Is this login screen?', icon: ICON.WARN, duration: 1800 });
            return;
        }

        captureAndSaveLastLogin();
        const login = (findLoginInput()?.value || '').trim();
        if (isValidLogin(login)) {
            setSessionLastUsedLogin(login);
            markFavoriteUsed(login);
        }

        const prefs = {
            skipPassword: !!perLoginPrefs?.skipPassword,
            skipOtp: !!perLoginPrefs?.skipOtp,
            autoSubmit: (perLoginPrefs?.autoSubmit === undefined) ? loadSettings().defaultAutoSubmit : !!perLoginPrefs?.autoSubmit
        };

        if (prefs.autoSubmit) {
            showToastFromButton({ main: 'Submitting…', sub: 'Login step', icon: ICON.WAIT, duration: 900 });
            await safeClick(submit);
        } else {
            showToastFromButton({ main: 'Login ready', sub: 'Auto submit is off', icon: ICON.INFO, duration: 1400 });
            return;
        }

        const pwi = await waitUntil(() => {
            const p = findPasswordInput();
            return (p && isVisible(p)) ? p : null;
        }, { timeout: 9000, interval: 80 });

        if (pwi) {
            if (prefs.skipPassword) {
                if (prefs.skipOtp) {
                    showToastFromButton({
                        main: 'Password skipped',
                        sub: 'OTP skipped (per-login preferences)',
                        icon: ICON.INFO,
                        duration: 1700
                    });
                    return;
                }

                showToastFromButton({
                    main: 'Password skipped',
                    sub: 'Enter password manually, then OTP will be filled automatically',
                    icon: ICON.WAIT,
                    duration: 2400
                });

                const ok = await waitForOtpAndFill(90000, { skipOtp: false, autoSubmit: true });
                if (!ok) {
                    showToastFromButton({
                        main: 'OTP not detected',
                        sub: 'Finish the password step and OTP will be filled when it appears',
                        icon: ICON.WARN,
                        duration: 2600
                    });
                }
                return;
            }

            const s = loadSettings();
            simulateReactInput(pwi, s.password);

            showToastFromButton({ main: 'Password filled', sub: prefs.autoSubmit ? 'Submitting…' : 'Ready', icon: ICON.PASS, duration: 1000 });

            if (prefs.autoSubmit) {
                const again = findSubmitButton();
                if (again) await safeClick(again);
            } else {
                return;
            }

            await waitForOtpAndFill(14000, { skipOtp: prefs.skipOtp, autoSubmit: prefs.autoSubmit });
            return;
        }

        const filled = await waitForOtpAndFill(12000, { skipOtp: prefs.skipOtp, autoSubmit: prefs.autoSubmit });
        if (!filled && !prefs.skipOtp) {
            showToastFromButton({ main: 'OTP input not found', sub: 'Selectors may have changed', icon: ICON.WARN, duration: 2200 });
        }
    }

    let running = false;

    async function handleLoginFlow({ forceOverwriteLogin = false } = {}) {
        if (!isLoginInputRendered()) return;
        if (running) return;

        running = true;
        setButtonBusy(true);

        const failsafe = setTimeout(() => {
            running = false;
            setButtonBusy(false);
        }, 45000);

        try {
            wireLoginAutosave();

            const phase = getPhase();
            const s = loadSettings();

            if (phase === 'otp') {
                await tryFillOtpImmediate({ skipOtp: false, autoSubmit: true });
                return;
            }

            if (phase === 'password') {
                const pw = await waitUntil(() => {
                    const p = findPasswordInput();
                    return (p && isVisible(p)) ? p : null;
                }, { timeout: 3000, interval: 60 });

                if (pw) {
                    simulateReactInput(pw, s.password);
                    showToastFromButton({ main: 'Password filled', sub: 'Submitting…', icon: ICON.PASS, duration: 900 });

                    const submit = findSubmitButton();
                    if (submit) await safeClick(submit);

                    await waitForOtpAndFill(14000, { skipOtp: false, autoSubmit: true });
                } else {
                    showToastFromButton({ main: 'Password input not found', sub: 'Try again after DOM changes', icon: ICON.WARN, duration: 1600 });
                }
                return;
            }

            if (phase === 'login') {
                const li = findLoginInput();
                if (li && LOGIN_EXACT_RE.test((li.value || '').trim())) {
                    maybeAutoSaveLoginFromInput(li);
                }

                const res = await tryFillLoginFromClipboard({ force: forceOverwriteLogin, continueFlow: true });
                if (res.reason === 'multiple-candidates') return;
                if (!res.ok && res.reason === 'no-candidate') return;

                await continueAfterLoginFilled({ perLoginPrefs: null });
                return;
            }

            showToastFromButton({ main: 'Unknown screen', sub: 'Login field is visible but phase detection failed', icon: ICON.SHRUG, duration: 1800 });
        } catch (err) {
            log.error('handleLoginFlow error:', err);
            showToastFromButton({ main: 'Script error', sub: String(err?.message || err), icon: ICON.ERR, duration: 2400 });
        } finally {
            clearTimeout(failsafe);
            running = false;
            if (!pickerOpen) setButtonBusy(false);
        }
    }

    async function loginWithLastLogin() {
        if (!isLoginInputRendered()) return;

        const last = getLastLogin();
        if (!last) {
            showToastFromButton({ main: 'No saved login', sub: 'Use clipboard (Alt+A) or Favorites (Alt+E)', icon: ICON.WARN, duration: 2200 });
            return;
        }

        const input = findLoginInput();
        if (!input) return;

        simulateReactInput(input, last);
        setSessionLastUsedLogin(last);
        markFavoriteUsed(last);
        showToastFromButton({ main: `Login ${last}`, sub: 'Using last saved login', icon: ICON.BACK, duration: 1300 });

        const prefs = getPerLoginPrefs(last);
        await continueAfterLoginFilled({ perLoginPrefs: prefs });
    }

    async function useFavoriteLogin(fav, { sourceEl = null } = {}) {
        if (!fav || !isValidLogin(fav.login)) {
            showToastFromButton({ main: 'Invalid favorite', sub: 'Login must be 9 digits', icon: ICON.WARN, duration: 1800 });
            return;
        }

        if (!isLoginInputRendered()) {
            showToastFromButton({ main: 'Not on login screen', sub: 'Favorites can be used only when login input is visible', icon: ICON.WARN, duration: 2200 });
            return;
        }

        const settings = loadSettings();
        const doIt = async () => {
            const input = findLoginInput();
            if (!input) return;

            simulateReactInput(input, fav.login);
            setLastLogin(fav.login);
            setSessionLastUsedLogin(fav.login);
            markFavoriteUsed(fav.login);

            showToastFromButton({ main: `Login ${fav.login}`, sub: fav.name ? fav.name : 'Using favorite', icon: ICON.OK, duration: 1200 });

            await continueAfterLoginFilled({ perLoginPrefs: fav.prefs });
        };

        if (settings.confirmBeforeUse) {
            openConfirmNear({
                anchorEl: sourceEl || document.getElementById('autofill-login-btn'),
                main: `Use login ${fav.login}?`,
                sub: fav.name ? `Client: ${fav.name}` : 'Confirm favorite login',
                onOk: doIt
            });
        } else {
            await doIt();
        }
    }

    function clampPosition(btn) {
        const rect = btn.getBoundingClientRect();
        const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
        const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);

        let top = parseInt(getComputedStyle(btn).top, 10);
        let left = parseInt(getComputedStyle(btn).left, 10);
        if (isNaN(top)) top = DEFAULT_OFFSET;
        if (isNaN(left)) left = DEFAULT_OFFSET;

        const maxLeft = Math.max(CLAMP_MARGIN, vw - rect.width - CLAMP_MARGIN);
        const maxTop = Math.max(CLAMP_MARGIN, vh - rect.height - CLAMP_MARGIN);

        left = Math.min(Math.max(left, CLAMP_MARGIN), maxLeft);
        top = Math.min(Math.max(top, CLAMP_MARGIN), maxTop);

        btn.style.left = left + 'px';
        btn.style.top = top + 'px';
    }

    function resetPositionTopLeft(btn) {
        btn.style.top = DEFAULT_OFFSET + 'px';
        btn.style.left = DEFAULT_OFFSET + 'px';
        clampPosition(btn);
        try { localStorage.setItem(BTN_POS_KEY, JSON.stringify({ top: btn.style.top, left: btn.style.left })); } catch {}
        showToastFromButton({ main: 'Position reset', sub: 'Top-left corner', icon: ICON.BACK, duration: 1200 });
    }

    function loadAndClamp(btn) {
        try {
            const s = JSON.parse(localStorage.getItem(BTN_POS_KEY) || 'null');
            if (s && s.top && s.left) { btn.style.top = s.top; btn.style.left = s.left; }
        } catch {}
        document.body.appendChild(btn);
        clampPosition(btn);
        try { localStorage.setItem(BTN_POS_KEY, JSON.stringify({ top: btn.style.top, left: btn.style.left })); } catch {}
    }

    function buildContextMenu() {
        let m = document.getElementById('ibaf-ctx');
        if (m) return m;

        m = document.createElement('div');
        m.id = 'ibaf-ctx';
        m.innerHTML = `
      <div class="item" data-cmd="reset">${ICON.BACK} Reset position (top-left)</div>
      <div class="item" data-cmd="clip">${ICON.COPY} Login from clipboard</div>

      <div class="item last" data-cmd="last">
        <span class="label">Last login</span>
        <span id="ibaf-last-login" class="last-val"></span>
      </div>

      <div class="item" data-cmd="favs">
        <span>${ICON.STAR} Favorites</span>
        <span class="rhs">ALT+E</span>
      </div>

      <div class="sec">Pinned favorites</div>
      <div id="ibaf-quick"></div>

      <div class="sec">Recent logins</div>
      <div id="ibaf-recent"></div>

      <div class="item sep"></div>
      <div class="item" data-cmd="settings">${ICON.GEAR} Settings</div>
    `;
        document.body.appendChild(m);
        return m;
    }

    function openMenuAt(x, y, btn) {
        const m = buildContextMenu();

        const span = m.querySelector('#ibaf-last-login');
        const last = getLastLogin();
        span.textContent = last ? `'${last}'` : '(none)';

        const lastItem = m.querySelector('[data-cmd="last"]');
        if (last) lastItem.classList.remove('disabled');
        else lastItem.classList.add('disabled');

        const qbox = m.querySelector('#ibaf-quick');
        const quick = favoritesQuickList(5);
        if (!quick.length) {
            qbox.innerHTML = `<div class="item disabled">No pinned favorites yet</div>`;
        } else {
            qbox.innerHTML = quick.map(f => `
        <div class="minirow" data-cmd="quick" data-login="${escapeHtml(f.login)}">
          <span>${ICON.PIN}</span>
          <span class="login">${escapeHtml(f.login)}</span>
          <span class="meta">${escapeHtml(f.name || '')}</span>
          <span class="edit" data-cmd="quickEdit" data-login="${escapeHtml(f.login)}">${ICON.EDIT}</span>
        </div>
      `).join('');
        }

        const rbox = m.querySelector('#ibaf-recent');
        const rec = loadRecents().slice(0, 6);
        if (!rec.length) {
            rbox.innerHTML = `<div class="item disabled">No recent logins</div>`;
        } else {
            rbox.innerHTML = rec.map(x => {
                const nm = String(x.name || '').trim();
                const meta = nm ? `${nm} • ${formatAgo(x.ts)}` : formatAgo(x.ts);

                return `
    <div class="minirow" data-cmd="recent" data-login="${escapeHtml(x.login)}">
      <span>${ICON.BACK}</span>
      <span class="login">${escapeHtml(x.login)}</span>
      <span class="meta">${escapeHtml(meta)}</span>
    </div>
  `;
            }).join('');

        }

        m.style.left = x + 'px';
        m.style.top = y + 'px';
        requestAnimationFrame(() => m.classList.add('show'));

        const onClick = async (ev) => {
            const el = ev.target.closest('.item, .minirow, .edit'); if (!el) return;
            const cmd = el.getAttribute('data-cmd');

            if (cmd === 'reset') resetPositionTopLeft(btn);

            if (cmd === 'clip') {
                const r = await tryFillLoginFromClipboard({ force: true, continueFlow: true });
                if (r.reason === 'multiple-candidates') return;
                if (r.ok) await continueAfterLoginFilled({ perLoginPrefs: getPerLoginPrefs(r.picked) });
            }

            if (cmd === 'last' && !el.classList.contains('disabled')) await loginWithLastLogin();

            if (cmd === 'favs') openFavorites();

            if (cmd === 'quick') {
                const login = el.getAttribute('data-login') || '';
                const fav = findFavByLogin(login);
                if (fav) await useFavoriteLogin(fav, { sourceEl: el });
            }

            if (cmd === 'quickEdit') {
                const login = el.getAttribute('data-login') || '';
                openFavorites({ focusLogin: login });
            }

            if (cmd === 'recent') {
                const login = el.getAttribute('data-login') || '';
                const fav = findFavByLogin(login);
                if (fav) await useFavoriteLogin(fav, { sourceEl: el });
                else {
                    if (!isLoginInputRendered()) return;
                    const input = findLoginInput();
                    if (!input) return;
                    simulateReactInput(input, login);
                    setLastLogin(login);
                    setSessionLastUsedLogin(login);
                    markFavoriteUsed(login);
                    await continueAfterLoginFilled({ perLoginPrefs: null });
                }
            }

            if (cmd === 'settings') openSettings();

            close();
        };

        const close = () => {
            m.classList.remove('show');
            setTimeout(() => { m.style.left = '-9999px'; m.style.top = '-9999px'; }, 120);
            m.removeEventListener('click', onClick);
            window.removeEventListener('mousedown', outside, true);
            window.removeEventListener('scroll', close, true);
            window.removeEventListener('resize', close, true);
            window.removeEventListener('keydown', onKey, true);
        };

        const outside = (ev) => { if (ev.target.closest && ev.target.closest('#ibaf-ctx')) return; close(); };
        const onKey = (ev) => { if (ev.key === 'Escape') close(); };

        m.addEventListener('click', onClick);
        window.addEventListener('mousedown', outside, true);
        window.addEventListener('scroll', close, true);
        window.addEventListener('resize', close, true);
        window.addEventListener('keydown', onKey, true);

        return m;
    }

    function openMenuNearButton() {
        const btn = ensureButton();
        if (!btn || btn.style.display === 'none') return;

        const r = btn.getBoundingClientRect();
        const x = Math.round(r.left);
        const y = Math.round(r.bottom + 8);
        openMenuAt(x, y, btn);
    }

    function ensureButton() {
        let btn = document.getElementById('autofill-login-btn');
        if (!btn) {
            injectStyles();

            btn = document.createElement('button');
            btn.id = 'autofill-login-btn';
            btn.type = 'button';
            btn.textContent = '🔐';
            btn.setAttribute('data-env', getEnvironmentName());
            btn.title = `Autofill ${getEnvironmentName()} — Alt+A (Alt+S menu)`;

            const s = loadSettings();
            btn.setAttribute('data-theme', THEMES.includes(s.theme) ? s.theme : 'teal');

            btn.addEventListener('click', (e) => {
                if (btn._dragging) return;
                const force = !!e.shiftKey;
                handleLoginFlow({ forceOverwriteLogin: force });
            });

            btn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (btn._dragging) return;
                openMenuAt(e.clientX, e.clientY, btn);
            });

            loadAndClamp(btn);

            btn.style.touchAction = 'none';
            btn.style.transform = 'translate(0,0)';

            let sx = 0, sy = 0, dragging = false, started = false, captured = false;
            let startTop = 0, startLeft = 0, curDx = 0, curDy = 0;
            const THRESHOLD = 5;

            btn.addEventListener('pointerdown', (e) => {
                const cs = getComputedStyle(btn);
                startTop = parseInt(cs.top, 10) || DEFAULT_OFFSET;
                startLeft = parseInt(cs.left, 10) || DEFAULT_OFFSET;
                sx = e.clientX; sy = e.clientY; curDx = 0; curDy = 0;
                dragging = false; started = true; captured = false;
            });

            btn.addEventListener('pointermove', (e) => {
                if (!started) return;
                const dx = e.clientX - sx, dy = e.clientY - sy;

                if (!dragging && (Math.abs(dx) > THRESHOLD || Math.abs(dy) > THRESHOLD)) {
                    dragging = true; btn._dragging = true;
                    if (btn.setPointerCapture) { btn.setPointerCapture(e.pointerId); captured = true; }
                }

                if (dragging) {
                    curDx = dx; curDy = dy;
                    btn.style.transform = `translate(${dx}px, ${dy}px)`;
                    if (e.cancelable) e.preventDefault();
                }
            });

            const finish = (e) => {
                if (captured && btn.releasePointerCapture) btn.releasePointerCapture(e.pointerId);

                if (dragging) {
                    const prev = btn.style.transition; btn.style.transition = 'none';

                    btn.style.top = (startTop + curDy) + 'px';
                    btn.style.left = (startLeft + curDx) + 'px';
                    btn.style.transform = 'translate(0,0)';
                    void btn.offsetHeight;

                    clampPosition(btn);
                    btn.style.transition = prev;

                    try { localStorage.setItem(BTN_POS_KEY, JSON.stringify({ top: btn.style.top, left: btn.style.left })); } catch {}
                    if (e.cancelable) e.preventDefault();
                    e.stopPropagation();
                    setTimeout(() => { btn._dragging = false; }, 0);
                } else {
                    btn._dragging = false;
                }

                dragging = false; started = false; captured = false;
            };

            btn.addEventListener('pointerup', finish);
            btn.addEventListener('pointercancel', finish);
            btn.addEventListener('pointerleave', (e) => { if (started) finish(e); });
        }

        return btn;
    }

    function extractClientNameFromDashboard() {
        for (const sel of DASHBOARD_NAME_SELECTORS) {
            const el = deepFirstVisible(sel);
            if (el && isVisible(el)) {
                const txt = String(el.textContent || '').trim();
                if (txt) return txt;
            }
        }
        return '';
    }

    let _saveFavPromptKey = '';

    function extractOwnerNameFromProfileModal() {

        const list = queryDeepAll('[data-testid="listProfiles"]');
        const listEl = list.find(isVisible) || list[0] || null;
        if (!listEl) return '';

        const items = listEl.querySelectorAll?.('[data-testid="itemProfile"]') || [];
        if (!items.length) return '';

        for (const it of items) {

            const roleEl =
                  it.querySelector('small.u-textXSmall') ||
                  it.querySelector('[data-testid="TextComponent"] small.u-textXSmall') ||
                  it.querySelector('small');

            const role = String(roleEl?.innerText || roleEl?.textContent || '').trim();
            if (!/(^|[\s,])majitel([\s,]|$)/i.test(role)) continue;

            const btn = it.querySelector('button');
            if (!btn) continue;

            const br = btn.querySelector('br');
            if (br && br.parentElement) {
                const container = br.parentElement;
                const firstLine = String(container.innerText || '').split('\n').map(x => x.trim()).filter(Boolean)[0] || '';
                const clean = normalizeClientName(firstLine);
                if (clean) return clean;
            }

            const spans = btn.querySelectorAll('span');
            for (const sp of spans) {
                const txt = String(sp.innerText || '').trim();
                if (!txt) continue;
                if (/\bmajitel\b/i.test(txt)) continue;
                if (txt.length < 6) continue;
                const line = txt.split('\n').map(x => x.trim()).filter(Boolean)[0] || '';
                const clean = normalizeClientName(line);
                if (clean) return clean;
            }
        }

        return '';
    }

    function maybeCaptureClientName() {
        const login = getSessionLastUsedLogin();
        if (!isValidLogin(login)) return;

        const ownerFromModal = extractOwnerNameFromProfileModal();
        if (ownerFromModal) {
            const r = commitBestName(login, ownerFromModal, { lock: true });
            if (!r.ok) return;

            const cleanName = r.name;
            if (!cleanName) return;

            setPendingName(login, cleanName);
            updateRecentName(login, cleanName);

            const fav = findFavByLogin(login);
            if (fav) {
                const old = normalizeClientName(fav.name || '');
                if (!old || old !== cleanName) {
                    upsertFavorite({ id: fav.id, login: fav.login, name: cleanName });
                    showToastFromButton({ main: 'Client name updated', sub: `${login} → ${cleanName}`, icon: ICON.OK, duration: 1800 });
                }
                clearSessionLastUsedLogin();
                clearPendingName(login);
                clearPromptedForLogin(login);
                return;
            }

            if (hasPromptedForLogin(login)) {
                updateSaveFavToastIfOpen(login, cleanName);
                return;
            }

            markPromptedForLogin(login);

            showActionToast({
                icon: ICON.STAR,
                main: 'Save as favorite?',
                sub: `${login} • ${cleanName}`,
                primaryText: 'Save',
                secondaryText: 'No',
                onPrimary: () => {
                    const latestName = normalizeClientName(getPendingName(login) || cleanName);

                    upsertFavorite({
                        id: makeFavId(),
                        login,
                        name: latestName,
                        note: '',
                        pinned: true,
                        lastUsedTs: nowTs(),
                        prefs: { skipPassword: false, skipOtp: false, autoSubmit: loadSettings().defaultAutoSubmit }
                    });

                    updateRecentName(login, latestName);

                    showToastFromButton({ main: 'Saved', sub: `Pinned ${login}`, icon: ICON.PIN, duration: 1600 });

                    clearSessionLastUsedLogin();
                    clearPendingName(login);
                    clearPromptedForLogin(login);
                },
                onSecondary: () => {
                    clearSessionLastUsedLogin();
                    clearPendingName(login);
                    clearPromptedForLogin(login);
                },
                duration: 10000
            });

            const box = document.getElementById('ibaf-atoast');
            if (box) { box.dataset.kind = 'save-fav'; box.dataset.login = String(login || '').trim(); }

            return;
        }

        if (!looksLikeDashboard()) return;

        const rawName = extractClientNameFromDashboard();
        if (!rawName) return;

        const r = commitBestName(login, rawName, { lock: false });
        if (!r.ok) return;

        const cleanName = r.name;
        if (!cleanName) return;

        setPendingName(login, cleanName);
        updateRecentName(login, cleanName);

        const fav = findFavByLogin(login);
        if (fav) {
            const old = normalizeClientName(fav.name || '');
            if (!old || old !== cleanName) {
                upsertFavorite({ id: fav.id, login: fav.login, name: cleanName });
                showToastFromButton({ main: 'Client name updated', sub: `${login} → ${cleanName}`, icon: ICON.OK, duration: 1800 });
            }
            clearSessionLastUsedLogin();
            clearPendingName(login);
            clearPromptedForLogin(login);
            return;
        }

        if (hasPromptedForLogin(login)) {
            updateSaveFavToastIfOpen(login, cleanName);
            return;
        }

        markPromptedForLogin(login);

        showActionToast({
            icon: ICON.STAR,
            main: 'Save as favorite?',
            sub: `${login} • ${cleanName}`,
            primaryText: 'Save',
            secondaryText: 'No',
            onPrimary: () => {
                const latestName = normalizeClientName(getPendingName(login) || cleanName);

                upsertFavorite({
                    id: makeFavId(),
                    login,
                    name: latestName,
                    note: '',
                    pinned: true,
                    lastUsedTs: nowTs(),
                    prefs: { skipPassword: false, skipOtp: false, autoSubmit: loadSettings().defaultAutoSubmit }
                });

                updateRecentName(login, latestName);

                showToastFromButton({ main: 'Saved', sub: `Pinned ${login}`, icon: ICON.PIN, duration: 1600 });

                clearSessionLastUsedLogin();
                clearPendingName(login);
                clearPromptedForLogin(login);
            },
            onSecondary: () => {
                clearSessionLastUsedLogin();
                clearPendingName(login);
                clearPromptedForLogin(login);
            },
            duration: 10000
        });

        const box = document.getElementById('ibaf-atoast');
        if (box) { box.dataset.kind = 'save-fav'; box.dataset.login = String(login || '').trim(); }
    }

    function updateSaveFavToastIfOpen(login, cleanName) {
        const box = document.getElementById('ibaf-atoast');
        if (!box || !box.classList.contains('show')) return false;

        if (box.dataset.kind !== 'save-fav' || box.dataset.login !== String(login || '').trim()) return false;

        const sub = box.querySelector('.sub');
        if (sub) {
            sub.textContent = `${login} • ${cleanName}`;
            return true;
        }

        return false;
    }

    function updateButtonAndActivation() {
        const active = isLoginInputRendered();

        if (!active) {
            closeClipboardPicker();
            closeConfirm();

            const ctx = document.getElementById('ibaf-ctx');
            if (ctx) { ctx.classList.remove('show'); ctx.style.left = '-9999px'; ctx.style.top = '-9999px'; }

            const modal = document.getElementById('ibaf-modal');
            if (modal) modal.classList.remove('show');

            const fav = document.getElementById('ibaf-fav');
            if (fav) fav.classList.remove('show');

            running = false;
            pickerOpen = false;
            setButtonBusy(false);
        }

        const btn = ensureButton();
        btn.style.display = active ? 'flex' : 'none';

        wireLoginAutosave();

        maybeCaptureClientName();
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

        return () => {
            if (history.pushState === wrappedPushState) history.pushState = push;
            if (history.replaceState === wrappedReplaceState) history.replaceState = rep;
            window.removeEventListener('popstate', fire);
        };
    }

    const onKeydown = (e) => {
        if (!isLoginInputRendered()) return;

        if (e.altKey && (e.key === 'a' || e.key === 'A')) {
            e.preventDefault();
            const force = !!e.shiftKey;
            handleLoginFlow({ forceOverwriteLogin: force });
            return;
        }

        if (e.altKey && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            openMenuNearButton();
            return;
        }

        if (e.altKey && (e.key === 'e' || e.key === 'E')) {
            e.preventDefault();
            openFavorites();
            return;
        }

        if (e.key === 'Escape') {
            closeClipboardPicker();
            closeConfirm();
        }
    };
    window.addEventListener('keydown', onKeydown, { passive: false });
    registerCleanup(() => window.removeEventListener('keydown', onKeydown, false));

    let debounce;
    const mo = new MutationObserver(() => {
        clearTimeout(debounce);
        debounce = setTimeout(updateButtonAndActivation, 120);
    });
    mo.observe(document, { childList: true, subtree: true });
    registerCleanup(() => {
        clearTimeout(debounce);
        mo.disconnect();
    });
    registerCleanup(onSpaUrlChange(() => updateButtonAndActivation()));

    function destroyRuntime({ silent = false } = {}) {
        runCleanups();
        [
            'ibaf-style',
            'ibaf-toast',
            'ibaf-atoast',
            'ibaf-clip',
            'ibaf-confirm',
            'ibaf-modal',
            'ibaf-fav',
            'ibaf-ctx',
            'autofill-login-btn'
        ].forEach(removeElementById);
        delete window[SCRIPT_KEY];
        if (!silent) console.info('[IBAF-LOGIN] Login snippet odinstalován.');
    }

    updateButtonAndActivation();

    window[SCRIPT_KEY] = {
        destroy: destroyRuntime,
        refresh: () => updateButtonAndActivation(),
        openMenu: () => openMenuNearButton(),
        openFavorites: () => openFavorites()
    };
    console.info('[IBAF-LOGIN] Login_AutoFill aktivní.', {
        version: SCRIPT_VERSION,
        env: getEnvironmentName(),
        runtimeApi: 'window.__IBAF_LOGIN_RUNTIME__'
    });

})();
