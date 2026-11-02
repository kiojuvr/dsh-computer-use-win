// Desktop-level text follows this Windows installation, not DSH's web UI
// language: the takeover banner and the settings path quoted in an error are
// read on the desktop, next to Japanese or Chinese windows. The web UI's own
// language comes from the locale service (see client.js).
//
// The language is the Windows user locale Node already resolves (ja-JP on a
// Japanese Windows). WCU_LOCALE overrides it, so a mixed installation can pin
// one language for the banner without touching the settings file.
const LABELS = Object.freeze({
  zh: Object.freeze({ indicator: 'DSH 正在控制电脑', settings: '设置 > 电脑操控', interface: 'Chinese' }),
  ja: Object.freeze({ indicator: 'DSH がコンピューターを操作しています', settings: '設定 > コンピューター操作', interface: 'Japanese' }),
  ko: Object.freeze({ indicator: 'DSH가 컴퓨터를 제어하고 있습니다', settings: '설정 > 컴퓨터 조작', interface: 'Korean' }),
  en: Object.freeze({ indicator: 'DSH is controlling your computer', settings: 'Settings > Computer Use', interface: 'English' })
});

function normalizeLanguage(value) {
  const tag = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (!tag) return '';
  const primary = tag.split('-')[0];
  return LABELS[primary] ? primary : '';
}

let cached;
export function systemLanguage() {
  if (cached !== undefined) return cached;
  cached = normalizeLanguage(process.env.WCU_LOCALE);
  if (!cached) {
    try { cached = normalizeLanguage(new Intl.DateTimeFormat().resolvedOptions().locale); }
    catch { cached = ''; }
  }
  if (!cached) cached = 'en';
  return cached;
}

function labels() {
  return LABELS[systemLanguage()] ?? LABELS.en;
}

// Default banner of the takeover indicator. The user can replace it in
// Settings > Computer Use, so this only has to read naturally at first run.
export function defaultIndicatorText() {
  return labels().indicator;
}

// "Settings > Computer Use (設定 > コンピューター操作 in the Japanese
// interface)": the English path first, then the name the user sees when their
// Windows interface is in another language.
export function settingsPathHint() {
  const label = labels();
  if (label === LABELS.en) return label.settings;
  return `${LABELS.en.settings} (${label.settings} in the ${label.interface} interface)`;
}

// For tests and for a caller that needs a language other than this machine's.
export function labelsFor(language) {
  return LABELS[normalizeLanguage(language)] ?? LABELS.en;
}
