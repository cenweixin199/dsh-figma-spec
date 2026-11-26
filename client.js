/**
 * Client half of dsh-figma-spec.
 *
 * One surface: the bundle detail page (`plugins.bundle.config`, keyed by the
 * package name). It renders a header (logo, title, status chip, subtitle) and
 * a tabbed body, the same shape the connector bundles use.
 *
 * The README and the feature image are NOT rendered here. The host already
 * shows them above this slot, resolved from the package README through
 * `/api/plugin-manager/detail-file`, so drawing them again would duplicate the
 * picture and break the host's single scroll region.
 *
 * An optional sidebar row is registered only while the user turns on
 * "show a Figma panel in the sidebar" in Settings.
 */
window.__ModuleLoader__.load({
  id: 'dsh-figma-spec',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'dsh-figma-spec';
    const TOKEN_PATH = '/plugins/dsh-figma-spec/token';
    const SETTINGS_PATH = '/plugins/dsh-figma-spec/settings';
    const PANEL_LABEL_ZH = 'Figma 设计稿规格读取';
    const PANEL_LABEL_EN = 'Figma spec reader';

    const ZH = {
      title: 'Figma 设计稿规格读取',
      subtitle: '读取画板的真实样式数据，输出规格表、字号体系、色板或节点差异。',
      tabToken: '个人令牌',
      tabSettings: '设置',
      chipConfigured: '已配置',
      chipMissing: '未配置',
      chipChecking: '检查中',
      heading: 'Figma 个人访问令牌',
      intro:
        '插件通过 Figma REST API 读取画板的真实样式数据，需要一枚有文件读取权限的个人访问令牌。令牌只保存在本机凭据库，不会写入配置文件或日志。',
      statusConfigured: '已配置',
      statusMissing: '未配置',
      statusChecking: '检查中…',
      account: '账号',
      source: '来源',
      masked: '当前值',
      inputLabel: '令牌',
      placeholder: 'figd_...',
      save: '保存并验证',
      saving: '验证中…',
      remove: '移除令牌',
      removing: '移除中…',
      hint: '在 Figma 的 Settings → Personal access tokens 创建。保存时会先向 Figma 校验，校验通过才会写入。',
      emptyError: '请先填入令牌。',
      savedOk: '已保存并验证通过。',
      removedOk: '令牌已移除。',
      loadError: '读取当前配置失败',
      saveError: '操作失败',
      settings: '设置',
      settingsHint: '这些开关点一下即生效，不需要保存。',
      sectionInterface: '界面',
      sidebarPanel: '在侧边栏显示 Figma 面板',
      sidebarPanelHint: '打开后左侧栏会出现「Figma 设计稿规格读取」，点开就是这一页。',
      howToTitle: '怎么用',
      howToBody:
        '配置好令牌后，在对话里直接给出 Figma 链接（需带 ?node-id=）并说明要什么即可。也可以显式调用工具：figma_get_spec、figma_get_typography、figma_get_palette、figma_diff_nodes。',
      quotaTitle: '关于配额',
      quotaBody:
        'Figma 按套餐限流。Starter 套餐的令牌在几次节点读取后可能被锁定一天以上。插件会缓存已读画板，重复读取同一画板不消耗配额。',
    };

    const EN = {
      title: 'Figma spec reader',
      subtitle: "Read a frame's real style data as a spec table, type scale, palette, or node diff.",
      tabToken: 'Personal token',
      tabSettings: 'Settings',
      chipConfigured: 'Configured',
      chipMissing: 'Not configured',
      chipChecking: 'Checking',
      heading: 'Figma personal access token',
      intro:
        'The plugin reads a frame\u2019s real style data over the Figma REST API and needs a personal access token with file read access. The token is stored only in the local credential store, never in configuration files or logs.',
      statusConfigured: 'Configured',
      statusMissing: 'Not configured',
      statusChecking: 'Checking\u2026',
      account: 'Account',
      source: 'Source',
      masked: 'Current value',
      inputLabel: 'Token',
      placeholder: 'figd_...',
      save: 'Save and verify',
      saving: 'Verifying\u2026',
      remove: 'Remove token',
      removing: 'Removing\u2026',
      hint: 'Create one at Figma Settings \u2192 Personal access tokens. The value is checked against Figma before it is stored.',
      emptyError: 'Enter a token first.',
      savedOk: 'Saved and verified.',
      removedOk: 'Token removed.',
      loadError: 'Could not read the current setting',
      saveError: 'Operation failed',
      settings: 'Settings',
      settingsHint: 'These switches apply immediately; there is nothing to save.',
      sectionInterface: 'Interface',
      sidebarPanel: 'Show a Figma panel in the sidebar',
      sidebarPanelHint: 'Adds a row to the left rail that opens this page.',
      howToTitle: 'How to use it',
      howToBody:
        'Once a token is set, give a Figma link (with ?node-id=) in chat and say what you need, or call the tools directly: figma_get_spec, figma_get_typography, figma_get_palette, figma_diff_nodes.',
      quotaTitle: 'About quota',
      quotaBody:
        'Figma rate-limits by plan tier. A Starter token can be locked for over a day after a few node reads. The plugin caches frames, so re-reading the same frame costs no quota.',
    };

    const CSS = [
      '.fs-root{--fs-border:var(--dsw-alias-border-subtle,#e3e6ea);--fs-text:var(--dsw-alias-text-primary,#1f2328);--fs-sub:var(--dsw-alias-text-secondary,#5b6370);--fs-sunken:var(--dsw-alias-surface-sunken,#fafbfc);--fs-brand:#3EBA55;display:flex;flex-direction:column;gap:12px;min-width:0;padding:2px 0 14px}',
      '.fs-hero{display:flex;align-items:flex-start;gap:12px;min-width:0}',
      '.fs-logo{flex:none;width:36px;height:36px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;background:#fff;border:1px solid var(--fs-border);box-shadow:0 1px 3px rgba(0,0,0,.10)}',
      '.fs-hero-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px}',
      '.fs-title-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}',
      '.fs-title{margin:0;font-size:17px;font-weight:600;line-height:24px;color:var(--fs-text)}',
      '.fs-chip{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:600;line-height:18px;padding:0 7px;border-radius:999px;border:1px solid var(--fs-border);color:var(--fs-sub);background:var(--fs-sunken)}',
      '.fs-chip.ok{color:#23703a;border-color:rgba(62,186,85,.45);background:rgba(62,186,85,.10)}',
      '.fs-chip.warn{color:#8a5a00;border-color:rgba(230,162,60,.45);background:rgba(230,162,60,.12)}',
      '.fs-desc{margin:0;font-size:12px;line-height:19px;color:var(--fs-sub)}',
      '.fs-tabs{position:sticky;top:-1px;z-index:3;display:flex;gap:2px;min-width:0;overflow-x:auto;border-bottom:1px solid var(--fs-border);background:var(--dsw-alias-bg-base,#fff);scrollbar-width:none}',
      '.fs-tabs::-webkit-scrollbar{display:none}',
      '.fs-tab{appearance:none;font:inherit;font-size:13px;font-weight:600;line-height:20px;cursor:pointer;flex:none;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;background:transparent;padding:7px 11px;white-space:nowrap;color:var(--fs-sub);transition:color .15s,border-color .15s}',
      '.fs-tab:hover{color:var(--fs-text)}',
      '.fs-tab[aria-selected="true"]{color:var(--fs-text);border-bottom-color:var(--fs-brand)}',
      '.fs-tab:focus-visible{outline:2px solid var(--fs-brand);outline-offset:1px}',
      '.fs-pane{display:flex;flex-direction:column;gap:16px;min-width:0}',
      '.fs-h{font-size:14px;font-weight:600;color:var(--fs-text);margin:0}',
      '.fs-p{font-size:13px;line-height:1.65;color:var(--fs-sub);margin:0}',
      '.fs-card{border:1px solid var(--fs-border);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:14px;background:var(--dsw-alias-surface-raised,#fff);min-width:0}',
      '.fs-row{display:flex;align-items:center;gap:10px;font-size:13px;flex-wrap:wrap}',
      '.fs-label{color:var(--fs-sub);min-width:64px;font-size:13px}',
      '.fs-val{color:var(--fs-text);font-weight:500}',
      '.fs-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto}',
      '.fs-dot.on{background:#3EBA55}',
      '.fs-dot.off{background:#B7BDC6}',
      '.fs-dot.busy{background:#E6A23C}',
      '.fs-input{width:100%;box-sizing:border-box;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;padding:9px 11px;border-radius:6px;border:1px solid var(--dsw-alias-border-default,#cfd4da);background:var(--fs-sunken);color:var(--fs-text)}',
      '.fs-input:focus{outline:2px solid var(--fs-brand);outline-offset:1px}',
      '.fs-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}',
      '.fs-btn{font-size:13px;padding:7px 15px;border-radius:6px;border:1px solid transparent;cursor:pointer;font-weight:500}',
      '.fs-btn.primary{background:var(--fs-brand);color:#fff}',
      '.fs-btn.primary:disabled{opacity:.55;cursor:not-allowed}',
      '.fs-btn.ghost{background:transparent;border-color:var(--dsw-alias-border-default,#cfd4da);color:var(--fs-text)}',
      '.fs-btn.ghost:disabled{opacity:.5;cursor:not-allowed}',
      '.fs-msg{font-size:12.5px;line-height:1.5;padding:8px 11px;border-radius:6px}',
      '.fs-msg.ok{background:rgba(62,186,85,.10);color:#23703a}',
      '.fs-msg.err{background:rgba(225,72,72,.10);color:#a12b2b}',
      '.fs-note{font-size:12.5px;line-height:1.7;color:var(--fs-sub);margin:0}',
      '.fs-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:var(--fs-sunken);padding:1px 5px;border-radius:4px}',
      '.fs-setting{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:12px 0}',
      '.fs-setting+.fs-setting{border-top:1px solid var(--fs-border)}',
      '.fs-setting-main{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.fs-setting-title{font-size:13px;font-weight:500;color:var(--fs-text)}',
      '.fs-setting-hint{font-size:12px;line-height:1.6;color:var(--fs-sub)}',
      '.fs-switch{appearance:none;font:inherit;cursor:pointer;position:relative;flex:none;width:34px;height:20px;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-border-l2,#c9ced6);transition:background .18s}',
      '.fs-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.35);transition:transform .18s}',
      '.fs-switch[aria-checked="true"]{background:var(--fs-brand)}',
      '.fs-switch[aria-checked="true"]::after{transform:translateX(14px)}',
      '.fs-switch:disabled{opacity:.45;cursor:default}',
      '.fs-switch:focus-visible{outline:2px solid var(--fs-brand);outline-offset:2px}',
    ].join('\n');

    function pickLang() {
      const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en';
      return lang.toLowerCase().startsWith('zh') ? ZH : EN;
    }

    function FigmaLogo(props) {
      const size = props.size ?? 20;
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, style: { display: 'block' } },
        h('path', { d: 'M7.2 3h4.8v6H7.2a3 3 0 0 1 0-6z', fill: '#FF3737' }),
        h('path', { d: 'M12 3h2.4a3 3 0 0 1 0 6H12z', fill: '#FF7237' }),
        h('path', { d: 'M7.2 9h4.8v6H7.2a3 3 0 0 1 0-6z', fill: '#874FFF' }),
        h('circle', { cx: 14.4, cy: 12, r: 3, fill: '#00B6FF' }),
        h('path', { d: 'M7.2 15H12v3a3 3 0 1 1-4.8-3z', fill: '#24CB71' }),
      );
    }

    function Switch(props) {
      return h('button', {
        type: 'button',
        className: 'fs-switch',
        role: 'switch',
        'aria-checked': props.checked ? 'true' : 'false',
        'aria-label': props.label,
        disabled: props.disabled,
        onClick: props.onChange,
      });
    }

    function Chip(props) {
      return h('span', { className: `fs-chip${props.tone ? ` ${props.tone}` : ''}` }, props.children);
    }

    function Page() {
      const t = React.useMemo(pickLang, []);
      const [tab, setTab] = React.useState('token');
      const [state, setState] = React.useState(null);
      const [settings, setSettings] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [token, setToken] = React.useState('');
      const [message, setMessage] = React.useState(null);

      const loadToken = React.useCallback(async () => {
        try {
          const res = await fetch(TOKEN_PATH, { credentials: 'same-origin' });
          const body = await res.json();
          if (!res.ok) throw new Error(body?.error || String(res.status));
          setState(body);
        } catch (err) {
          setMessage({ kind: 'err', text: `${t.loadError}: ${err.message}` });
        }
      }, [t]);

      const loadSettings = React.useCallback(async () => {
        try {
          const res = await fetch(SETTINGS_PATH, { credentials: 'same-origin' });
          const body = await res.json();
          if (!res.ok) throw new Error(body?.error || String(res.status));
          setSettings(body);
        } catch {
          setSettings({ sidebarPanel: false });
        }
      }, []);

      React.useEffect(() => {
        loadToken();
        loadSettings();
      }, [loadToken, loadSettings]);

      const save = async () => {
        if (!token.trim()) {
          setMessage({ kind: 'err', text: t.emptyError });
          return;
        }
        setBusy(true);
        setMessage(null);
        try {
          const res = await fetch(TOKEN_PATH, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: token.trim() }),
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body?.error || String(res.status));
          setToken('');
          setMessage({ kind: 'ok', text: `${t.savedOk}${body.handle ? ` (${body.handle})` : ''}` });
          await loadToken();
        } catch (err) {
          setMessage({ kind: 'err', text: `${t.saveError}: ${err.message}` });
        } finally {
          setBusy(false);
        }
      };

      const remove = async () => {
        setBusy(true);
        setMessage(null);
        try {
          const res = await fetch(TOKEN_PATH, { method: 'DELETE', credentials: 'same-origin' });
          const body = await res.json();
          if (!res.ok) throw new Error(body?.error || String(res.status));
          setMessage({ kind: 'ok', text: t.removedOk });
          await loadToken();
        } catch (err) {
          setMessage({ kind: 'err', text: `${t.saveError}: ${err.message}` });
        } finally {
          setBusy(false);
        }
      };

      const toggleSidebar = async () => {
        const next = !(settings?.sidebarPanel === true);
        const previous = settings;
        setSettings({ ...(settings ?? {}), sidebarPanel: next });
        try {
          const res = await fetch(SETTINGS_PATH, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sidebarPanel: next }),
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body?.error || String(res.status));
          setSettings(body);
        } catch (err) {
          setSettings(previous ?? { sidebarPanel: !next });
          setMessage({ kind: 'err', text: `${t.saveError}: ${err.message}` });
        }
      };

      const configured = state?.configured === true;
      const loading = state === null;
      const dotClass = loading ? 'busy' : configured ? 'on' : 'off';
      const statusText = loading ? t.statusChecking : configured ? t.statusConfigured : t.statusMissing;
      const chipTone = loading ? 'warn' : configured ? 'ok' : 'warn';
      const chipText = loading ? t.chipChecking : configured ? t.chipConfigured : t.chipMissing;

      const tabs = [
        { id: 'token', label: t.tabToken },
        { id: 'settings', label: t.tabSettings },
      ];

      const tokenPane = h(
        'div',
        { className: 'fs-pane' },
        h('h2', { className: 'fs-h' }, t.heading),
        h('p', { className: 'fs-p' }, t.intro),
        h(
          'div',
          { className: 'fs-card' },
          h(
            'div',
            { className: 'fs-row' },
            h('span', { className: `fs-dot ${dotClass}` }),
            h('span', { className: 'fs-val' }, statusText),
            configured && state?.handle ? h('span', { className: 'fs-label' }, `${t.account}: ${state.handle}`) : null,
          ),
          configured && state?.masked
            ? h(
                'div',
                { className: 'fs-row' },
                h('span', { className: 'fs-label' }, t.masked),
                h('span', { className: 'fs-val fs-code' }, state.masked),
              )
            : null,
          configured && state?.source
            ? h(
                'div',
                { className: 'fs-row' },
                h('span', { className: 'fs-label' }, t.source),
                h('span', { className: 'fs-val' }, state.source),
              )
            : null,
          h(
            'div',
            null,
            h('div', { className: 'fs-label', style: { marginBottom: 6 } }, t.inputLabel),
            h('input', {
              className: 'fs-input',
              type: 'password',
              autoComplete: 'off',
              spellCheck: false,
              placeholder: t.placeholder,
              value: token,
              disabled: busy,
              onChange: (e) => setToken(e.target.value),
              onKeyDown: (e) => {
                if (e.key === 'Enter' && !busy) save();
              },
            }),
          ),
          h(
            'div',
            { className: 'fs-actions' },
            h('button', { className: 'fs-btn primary', onClick: save, disabled: busy }, busy ? t.saving : t.save),
            configured
              ? h(
                  'button',
                  { className: 'fs-btn ghost', onClick: remove, disabled: busy },
                  busy ? t.removing : t.remove,
                )
              : null,
          ),
          message ? h('div', { className: `fs-msg ${message.kind}` }, message.text) : null,
          h('p', { className: 'fs-note' }, t.hint),
        ),
        h(
          'div',
          { className: 'fs-card' },
          h('h3', { className: 'fs-h' }, t.howToTitle),
          h('p', { className: 'fs-note' }, t.howToBody),
        ),
        h(
          'div',
          { className: 'fs-card' },
          h('h3', { className: 'fs-h' }, t.quotaTitle),
          h('p', { className: 'fs-note' }, t.quotaBody),
        ),
      );

      const settingsPane = h(
        'div',
        { className: 'fs-pane' },
        h('h2', { className: 'fs-h' }, t.settings),
        h('p', { className: 'fs-p' }, t.settingsHint),
        h(
          'div',
          { className: 'fs-card' },
          h('div', { className: 'fs-label' }, t.sectionInterface),
          h(
            'div',
            { className: 'fs-setting' },
            h(
              'div',
              { className: 'fs-setting-main' },
              h('div', { className: 'fs-setting-title' }, t.sidebarPanel),
              h('div', { className: 'fs-setting-hint' }, t.sidebarPanelHint),
            ),
            h(Switch, {
              checked: settings?.sidebarPanel === true,
              label: t.sidebarPanel,
              disabled: settings === null,
              onChange: toggleSidebar,
            }),
          ),
        ),
      );

      return h(
        'div',
        { className: 'fs-root' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'fs-hero' },
          h('span', { className: 'fs-logo' }, h(FigmaLogo, { size: 20 })),
          h(
            'div',
            { className: 'fs-hero-main' },
            h(
              'div',
              { className: 'fs-title-row' },
              h('h1', { className: 'fs-title' }, t.title),
              h(Chip, { tone: chipTone }, chipText),
            ),
            h('p', { className: 'fs-desc' }, t.subtitle),
          ),
        ),
        h(
          'div',
          { className: 'fs-tabs', role: 'tablist' },
          tabs.map((item) =>
            h(
              'button',
              {
                key: item.id,
                type: 'button',
                role: 'tab',
                className: 'fs-tab',
                'aria-selected': tab === item.id ? 'true' : 'false',
                onClick: () => setTab(item.id),
              },
              item.label,
            ),
          ),
        ),
        tab === 'token' ? tokenPane : settingsPane,
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'dsh-figma-spec: locale');

        /**
         * Register a slot, logging instead of throwing on failure.
         *
         * `ctx.slots.inject(name, cb)` runs its callback late, and an exception
         * there is rethrown by a microtask outside the renderer, which blanks
         * the whole detail page. Each callback therefore guards itself.
         */
        const injectSlot = (name, register) => {
          try {
            return ctx.slots.inject(name, () => {
              try {
                return register();
              } catch (error) {
                console.error(`[dsh-figma-spec] slot registration failed: ${name}`, error);
                return undefined;
              }
            });
          } catch (error) {
            console.error(`[dsh-figma-spec] slot injection failed: ${name}`, error);
            return undefined;
          }
        };

        injectSlot('plugins.bundle.config', () =>
          ctx.slots.register({ name: 'plugins.bundle.config', key: NS, locale: NS }, Page),
        );

        // Optional sidebar row, driven by the persisted setting: registered and
        // disposed as it flips, so the left rail changes without a reload.
        let panelDisposer = null;
        let panelWanted = false;

        const applyPanel = (value) => {
          const wanted = value?.sidebarPanel === true;
          if (wanted === panelWanted) return;
          panelWanted = wanted;
          if (typeof panelDisposer === 'function') {
            panelDisposer();
            panelDisposer = null;
          }
          if (!wanted) return;
          panelDisposer = injectSlot('sidebar.panellist', () =>
            ctx.slots.register(
              {
                name: 'sidebar.panellist',
                id: NS,
                order: 42,
                label: () => (pickLang() === ZH ? PANEL_LABEL_ZH : PANEL_LABEL_EN),
                locale: NS,
              },
              FigmaLogo,
            ),
          );
          if (typeof panelDisposer === 'function') ctx.effect(() => panelDisposer);
        };

        ctx.effect(() => {
          let alive = true;
          fetch(SETTINGS_PATH, { credentials: 'same-origin' })
            .then((r) => (r.ok ? r.json() : null))
            .then((value) => {
              if (alive && value) applyPanel(value);
            })
            .catch(() => {});
          return () => {
            alive = false;
            if (typeof panelDisposer === 'function') panelDisposer();
            panelDisposer = null;
          };
        });
      },
    };
  },
});