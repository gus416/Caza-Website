/* Caza: phone visitors can't install a Chrome extension, so on phones the store
   buttons become "send it to my computer" (share sheet, or email as a fallback).
   No tracking, no cookies, nothing sent anywhere by this script. */
(function () {
  var mq = window.matchMedia ? window.matchMedia('(max-width: 820px) and (pointer: coarse)') : null;
  if (!mq || !mq.matches) return;
  var url = 'https://chromewebstore.google.com/detail/oojoopmelbnbddhjmemdggbkeflhjnpk?utm_source=usecaza&utm_medium=mobile-share&utm_campaign=send-to-desktop';
  var title = 'Caza for Chrome';
  var text = 'Open this on your computer to add Caza to Chrome (free right now):';
  var mail = 'mailto:?subject=' + encodeURIComponent(title + ' (open on your computer)') +
             '&body=' + encodeURIComponent(text + '\n' + url);
  function send(e) {
    if (navigator.share) {
      e.preventDefault();
      navigator.share({ title: title, text: text, url: url }).catch(function () {});
    }
  }
  var links = document.querySelectorAll('a[href*="chromewebstore.google.com/detail/oojoopmelbnbddhjmemdggbkeflhjnpk"]');
  for (var i = 0; i < links.length; i++) {
    var a = links[i];
    if (a.closest('.foot-nav')) continue;
    a.href = mail;
    a.removeAttribute('target');
    a.textContent = a.closest('.top') ? 'Get the link' : 'Send it to my computer';
    a.addEventListener('click', send);
  }
  var bar = document.createElement('div');
  bar.className = 'm-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Get Caza on your computer');
  bar.innerHTML = '<span>Caza runs on Chrome on your computer.</span>';
  var b = document.createElement('a');
  b.className = 'btn';
  b.href = mail;
  b.textContent = 'Send me the link';
  b.addEventListener('click', send);
  bar.appendChild(b);
  document.body.appendChild(bar);
  document.body.classList.add('has-mbar');
  function onScroll() {
    var y = window.scrollY || 0;
    var nearEnd = (window.innerHeight + y) >= (document.documentElement.scrollHeight - 160);
    bar.classList.toggle('show', y > 520 && !nearEnd);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
