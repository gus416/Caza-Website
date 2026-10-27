/* Caza website analytics events (Google Analytics 4 via gtag). Sends only event names,
   the page path, a section label, a campaign tag and a tool or guide slug. Never form values,
   query strings or personal data. Does nothing if gtag is not loaded (blocked or offline). */
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
  document.addEventListener('click', function (e) {
    try {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (href.indexOf('mailto:?subject=Caza') === 0) {
        send('send_to_desktop', { page_path: path(), link_location: section(a), method: navigator.share ? 'share_sheet' : 'email' });
      } else if (/^https?:\/\/chromewebstore\.google\.com\//.test(href)) {
        send('store_click', { page_path: path(), link_location: section(a), utm_campaign: campaign(href) });
      }
    } catch (err) {}
  }, true);
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
