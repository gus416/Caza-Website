/* Caza website analytics events (Google Analytics 4 via gtag). Sends only event names,
   the page path, a section label, button or link text, a campaign tag, a video file name and a
   tool or guide slug. Never form values, query strings or personal data. Does nothing if gtag is not loaded (blocked or offline). */
(function () {
  function send(name, params) {
    try { if (typeof window.gtag === 'function') window.gtag('event', name, params); } catch (e) {}
  }
  function path() { return location.pathname; }
  function slug() { return location.pathname.replace(/\/+$/, '').split('/').pop().replace(/\.html$/, ''); }
  function section(a) {
    if (a.closest('.m-bar')) return 'mobile_bar';
    if (a.closest('header.top, .top')) return 'nav';
    if (a.closest('footer, .foot')) return 'footer';
    if (a.closest('.hero')) return 'hero';
    var el = a.closest('[id]');
    while (el && (el.id === 'main' || el.tagName === 'BODY')) el = el.parentElement && el.parentElement.closest('[id]');
    if (el && el.id) return el.id;
    if (a.closest('.post-cta')) return 'guide_cta';
    return 'content';
  }
  function campaign(href) {
    var m = /[?&]utm_campaign=([^&#]+)/.exec(href || '');
    try { return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return m ? m[1] : ''; }
  }
  function clean(s, n) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, n || 60); }
  function target(a) {
    try {
      var u = new URL(a.href, location.href);
      return u.origin === location.origin ? u.pathname : u.hostname;
    } catch (e) { return ''; }
  }
  var CTA = '.btn, .link, .callout a, .guides-home a, .examples-home a, .index a, a.back, .post-cta a';
  function onClick(e) {
    try {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      var href = a.getAttribute('href') || '';
      var hash = href.charAt(0) === '#';
      if (a.hasAttribute('data-aud') || (hash && !a.matches('.btn, .link, .callout a') && !a.closest('.top-nav, .foot-nav'))) return;
      var where = section(a);
      // One event per click, in priority order: send_to_desktop, store_click, nav_click, cta_click, internal_link.
      if (href.indexOf('mailto:?subject=Caza') === 0) {
        send('send_to_desktop', { page_path: path(), link_location: where, method: navigator.share ? 'share_sheet' : 'email' });
      } else if (/^https?:\/\/chromewebstore\.google\.com\//.test(href)) {
        send('store_click', { page_path: path(), link_location: where, utm_campaign: campaign(href) });
      } else if (a.closest('.top-nav, .foot-nav, header.top')) {
        var area = a.closest('.foot-nav') ? 'footer' : (window.innerWidth <= 820 ? 'mobile' : 'header');
        send('nav_click', { page_path: path(), nav_item: clean(a.textContent) || (a.getAttribute('aria-label') || 'logo'), nav_area: area });
      } else if (a.matches(CTA) || a.closest('.callout, .guides-home, .examples-home, .index, .post-cta') || /^all (guides|calculators|four walkthroughs)/i.test(clean(a.textContent))) {
        var h = a.querySelector('h3');
        send('cta_click', { page_path: path(), cta_text: clean(h ? h.textContent : a.textContent), link_url: hash ? path() + href : target(a), link_location: where });
      } else if (a.closest('article, .post') && /^\/(guides|tools)\//.test(target(a)) && target(a) !== path().replace(/\.html$/, '')) {
        send('internal_link', { page_path: path(), from_slug: slug(), to_path: target(a) });
      }
    } catch (err) {}
  }
  document.addEventListener('click', onClick, true);

  // Demo videos: once per video per page view.
  var vseen = {};
  function vname(v) {
    var s = v.currentSrc || v.getAttribute('src') || (v.querySelector('source') || {}).src || '';
    return s.split('?')[0].split('#')[0].split('/').pop();
  }
  document.addEventListener('play', function (e) {
    try { var v = e.target; if (!v || v.tagName !== 'VIDEO') return; var k = vname(v) + ':start';
      if (vseen[k]) return; vseen[k] = 1; send('video_start', { page_path: path(), video: vname(v) }); } catch (err) {}
  }, true);
  document.addEventListener('ended', function (e) {
    try { var v = e.target; if (!v || v.tagName !== 'VIDEO') return; var k = vname(v) + ':end';
      if (vseen[k]) return; vseen[k] = 1; send('video_complete', { page_path: path(), video: vname(v) }); } catch (err) {}
  }, true);

  // FAQ answers opened.
  document.addEventListener('toggle', function (e) {
    try { var d = e.target; if (!d || d.tagName !== 'DETAILS' || !d.open) return;
      var s = d.querySelector('summary'); if (!s) return;
      send('faq_open', { page_path: path(), question: clean(s.textContent, 60) }); } catch (err) {}
  }, true);

  // Missing pages (404.html is served at the requested address).
  if (/^Page not found/i.test(document.title)) {
    var host = ''; try { host = document.referrer ? new URL(document.referrer).hostname : ''; } catch (err) {}
    send('page_404', { page_path: path(), missing_path: location.pathname, ref_host: host });
  }

  // Scroll depth on pages that are not guides (guides use guide_read at 75%).
  if (!/^\/guides\/[^/]+/.test(location.pathname)) {
    var marks = { 50: false, 90: false };
    var depth = function () {
      var h = document.documentElement.scrollHeight; if (!h) return;
      var pct = (window.pageYOffset + window.innerHeight) / h * 100;
      [50, 90].forEach(function (m) { if (!marks[m] && pct >= m) { marks[m] = true; send('scroll_depth', { page_path: path(), percent: m }); } });
      if (marks[50] && marks[90]) window.removeEventListener('scroll', depth);
    };
    window.addEventListener('scroll', depth, { passive: true });
  }

  // First touch of a calculator field, once per page view.
  var started = false;
  function toolStart(e) {
    try { if (started) return; var f = e.target && e.target.closest ? e.target.closest('form[data-tool]') : null;
      if (!f || !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      started = true; send('tool_input_start', { page_path: path(), tool: f.getAttribute('data-tool') }); } catch (err) {}
  }
  document.addEventListener('focusin', toolStart, true);
  document.addEventListener('input', toolStart, true);

  document.addEventListener('submit', function (e) {
    try {
      var f = e.target;
      if (!f || !f.getAttribute || !f.getAttribute('data-tool')) return;
      // Runs after the calculator's own submit handler: count it only if a result (not an error) is showing.
      var out = f.querySelector('.tool-out');
      if (!out || out.hidden || out.querySelector('.tool-err')) return;
      send('tool_calculate', { tool: f.getAttribute('data-tool'), page_path: path() });
    } catch (err) {}
  }, false);
  if (/^\/guides\/[^/]+/.test(location.pathname)) {
    var sent = false;
    var check = function () {
      if (sent) return;
      var art = document.querySelector('article');
      if (!art) return;
      var r = art.getBoundingClientRect(), top = r.top + window.pageYOffset;
      if (window.pageYOffset + window.innerHeight >= top + r.height * 0.75) {
        sent = true;
        send('guide_read', { guide: slug(), page_path: path() });
        window.removeEventListener('scroll', check);
      }
    };
    window.addEventListener('scroll', check, { passive: true });
  }
})();
