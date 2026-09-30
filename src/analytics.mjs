// Basic consent mode: do not even load Google's tag before an opt-in.
const id = import.meta.env.VITE_GA_MEASUREMENT_ID;
const consentKey = 'enamel-studio.analytics-consent.v1';
if (/^G-[A-Z0-9]+$/.test(id ?? '')) initialize();

function initialize() {
  const panel = document.createElement('div');
  panel.className = 'analytics-consent';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Analytics consent');
  panel.innerHTML = `<p><strong>Help improve Enamel Studio?</strong> Optional Google Analytics measures visits using cookies. Badge designs and file names stay in your browser. <a href="./privacy.html" target="_blank" rel="noopener">Privacy details</a></p><div><button type="button" class="act" data-choice="granted">Allow analytics</button><button type="button" class="act" data-choice="denied">No thanks</button></div>`;
  const settings = document.createElement('button');
  settings.type = 'button';
  settings.className = 'act analytics-settings';
  settings.textContent = 'Privacy settings';
  document.body.append(panel, settings);
  let loaded = false;
  let choice;
  try { choice = localStorage.getItem(consentKey); } catch { /* Ask each visit if storage is unavailable. */ }

  function gtag() { window.dataLayer.push(arguments); }
  function enable() {
    window[`ga-disable-${id}`] = false;
    if (loaded) {
      gtag('consent', 'update', { analytics_storage: 'granted' });
      return;
    }
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = gtag;
    gtag('consent', 'default', {
      analytics_storage: 'denied', ad_storage: 'denied',
      ad_user_data: 'denied', ad_personalization: 'denied',
    });
    gtag('consent', 'update', { analytics_storage: 'granted' });
    gtag('js', new Date());
    // Never pass query strings, fragments, referring URLs, or user-provided names.
    const location = `${window.location.origin}${window.location.pathname}`;
    gtag('config', id, {
      send_page_view: false,
      page_location: location,
      page_referrer: '',
      page_title: 'Enamel Studio',
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_flags: 'SameSite=Lax;Secure',
    });
    gtag('event', 'page_view', {page_location: location, page_referrer: '', page_title: 'Enamel Studio'});
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    document.head.append(script);
  }
  function disable() {
    window[`ga-disable-${id}`] = true;
    if (loaded) gtag('consent', 'update', {analytics_storage: 'denied'});
    const names = document.cookie.split(';').map(cookie => cookie.split('=')[0].trim()).filter(name => name === '_ga' || name.startsWith('_ga_'));
    const host = window.location.hostname.split('.');
    const domains = ['', ...host.map((_, i) => host.slice(i).join('.'))];
    for (const name of names) {
      for (const domain of domains) {
        document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain ? `; Domain=${domain}` : ''}`;
      }
    }
  }
  function select(next) {
    choice = next;
    try { localStorage.setItem(consentKey, next); } catch { /* The current choice still applies. */ }
    if (next === 'granted') enable(); else disable();
    panel.hidden = true;
    settings.focus();
  }
  panel.querySelectorAll('[data-choice]').forEach(button => button.addEventListener('click', () => select(button.dataset.choice)));
  settings.addEventListener('click', () => { panel.hidden = false; panel.querySelector('button').focus(); });
  window.addEventListener('storage', event => {
    if (event.key !== consentKey && event.key !== null) return;
    choice = event.key === null ? null : event.newValue;
    if (choice === 'granted') enable(); else disable();
    panel.hidden = choice === 'granted' || choice === 'denied';
  });
  panel.hidden = choice === 'granted' || choice === 'denied';
  if (choice === 'granted') enable(); else disable();
}
