// Japanese Windows: the web UI ships a Japanese dictionary, the desktop-level
// banner and settings path follow the Windows language, character width does
// not decide a text match, and the takeover overlay draws Japanese text with a
// Japanese font. No desktop input is sent.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const checkout = fileURLToPath(new URL('../', import.meta.url));
const powershell = process.env.WINDOWS_CU_POWERSHELL || 'powershell.exe';
// The overlay is compiled by Windows PowerShell 5.1 in production; PS7 needs
// the reference set from windows-takeover.ps1, so this contract stays on 5.1.
const desktopPowerShell = 'powershell.exe';

// ---------------------------------------------------------------- client UI
// Load the browser bundle the way the DSH module loader does, then apply it
// against a stub host that records language registration.
function loadClient() {
  const source = readFileSync(path.join(checkout, 'mcp/client.js'), 'utf8');
  let entry;
  const window = { __ModuleLoader__: { load: value => { entry = value; } } };
  const React = {
    createElement: () => null, Fragment: 'fragment',
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
    useEffect: () => {}, useLayoutEffect: () => {}, useRef: value => ({ current: value }),
    useMemo: fn => fn(), useCallback: fn => fn(), useSyncExternalStore: () => null
  };
  new Function('window', 'navigator', 'document', source)(window, { languages: ['ja-JP'], language: 'ja-JP' }, undefined);
  const client = entry.factory(name => name === 'react' ? React : undefined);
  const languages = [];
  let dictionaries;
  const ctx = {
    effect: fn => fn(), inject: () => {}, on: () => {}, emit: () => {},
    logger: { warn() {}, error() {} },
    locale: {
      addLanguage: language => { languages.push(language); return () => {}; },
      register: (namespace, value) => { dictionaries = value; return () => {}; },
      bind: () => key => key
    },
    slots: { inject: () => {}, register: () => ({}) },
    uiConversation: { events: { register() {} } },
    settingsScope: { bind: () => ({ getSnapshot: () => ({}), subscribe: () => () => {}, set: async () => {} }) },
    configForms: { get: () => ({}) },
    connection: { api: { settings: { mutate: async () => ({ result: { ok: true } }) } } }
  };
  client.apply(ctx);
  return { dictionaries, languages };
}

const { dictionaries, languages } = loadClient();
assert.deepEqual(languages, [{ id: 'ja', label: '日本語', fallback: 'en' }],
  'Japanese must register as a language pack whose fallback is English');
assert.deepEqual(Object.keys(dictionaries.ja).sort(), Object.keys(dictionaries.en).sort(),
  'The Japanese dictionary must cover exactly the English keys');
for (const key of Object.keys(dictionaries.ja)) {
  const value = dictionaries.ja[key];
  assert.equal(typeof value, 'string', `ja.${key} must be a string`);
  // starPrefix is deliberately empty: "Star" is the link text itself.
  if (key !== 'starPrefix') assert.ok(value.trim().length > 0, `ja.${key} must not be empty`);
}
for (const key of ['nav', 'title', 'save', 'discard', 'stop', 'preview', 'record', 'browserTitle',
  'indicatorTitle', 'toolsTitle', 'customTools', 'toolGroup_observe', 'tool_ocr', 'typeAction',
  'searchObserved', 'seriesCount', 'escTitle']) {
  assert.notEqual(dictionaries.ja[key], dictionaries.en[key], `ja.${key} must be translated, not copied`);
}
assert.match(dictionaries.ja.nav, /^[^\x00-\x7F]+$/u, 'The Japanese tab label must not be English');
assert.match(dictionaries.ja.nav, /[\u3040-\u30ff\u4e00-\u9fff]/u, 'The Japanese tab label must be Japanese');

// ------------------------------------------------------- desktop-level text
const probe = (locale, module = 'system-locale.mjs', expression = '{language:systemLanguage(),banner:defaultIndicatorText(),path:settingsPathHint()}') =>
  JSON.parse(spawnSync(process.execPath, ['--input-type=module', '-e',
    `import ${module === 'settings.mjs' ? '{ DEFAULT_SETTINGS }' : '{ systemLanguage, defaultIndicatorText, settingsPathHint }'} from ${JSON.stringify(pathToFileURL(path.join(checkout, 'mcp', module)).href)};` +
    `console.log(JSON.stringify(${module === 'settings.mjs' ? '{banner:DEFAULT_SETTINGS.indicatorText}' : expression}));`
  ], { encoding: 'utf8', env: { ...process.env, WCU_LOCALE: locale } }).stdout);

assert.deepEqual(probe('ja'), {
  language: 'ja', banner: 'DSH がコンピューターを操作しています',
  path: 'Settings > Computer Use (設定 > コンピューター操作 in the Japanese interface)'
}, 'A Japanese Windows shows a Japanese banner and names the Japanese settings path');
assert.equal(probe('ja-JP').language, 'ja', 'A full language tag must resolve to its language');
assert.equal(probe('zh-CN').banner, 'DSH 正在控制电脑', 'A Chinese Windows keeps the Chinese banner');
assert.equal(probe('en').path, 'Settings > Computer Use', 'An English Windows quotes the English path');
assert.equal(probe('ja', 'settings.mjs').banner, 'DSH がコンピューターを操作しています',
  'The default takeover banner must follow the Windows language');
assert.equal(probe('en', 'settings.mjs').banner, 'DSH is controlling your computer');

// ------------------------------------------------- width-insensitive match
const root = await mkdtemp(path.join(os.tmpdir(), 'wcu-locale-ja-'));
const matcherScript = path.join(root, 'match.ps1');
await writeFile(matcherScript, '\uFEFF' + `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$tokens = $null
$parseErrors = $null
$source = [IO.File]::ReadAllText('${path.join(checkout, 'scripts', 'windows-uia.ps1').replace(/'/g, "''")}', [Text.Encoding]::UTF8)
$ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Backend source did not parse.' }
foreach ($name in @('Get-Prop', 'Invoke-Safe', 'Convert-MatchText', 'Element-Matches', 'Get-OcrWordBounds', 'Find-OcrWordRun')) {
  $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if ($null -eq $definition) { throw "Missing backend function: $name" }
  . ([scriptblock]::Create($definition.Extent.Text))
}
function Check { param([string]$Message, [bool]$Condition) if (-not $Condition) { throw "FAILED: $Message" } }
$info = @{ name = 'カタカナの保存ボタン OK'; automationId = 'save'; className = 'Button'; controlType = 'Button'; localizedControlType = 'ボタン'; value = '' }
Check 'half-width katakana query matches full-width name' (Element-Matches -Info $info -Query 'ｶﾀｶﾅ' -ControlType '')
Check 'full-width katakana query matches full-width name' (Element-Matches -Info $info -Query 'カタカナ' -ControlType '')
Check 'kanji query matches' (Element-Matches -Info $info -Query '保存' -ControlType '')
Check 'full-width Latin matches ASCII name' (Element-Matches -Info $info -Query 'ＯＫ' -ControlType '')
Check 'a different word does not match' (-not (Element-Matches -Info $info -Query '設定' -ControlType ''))
$halfwidth = @(@{ text = 'ﾌｧｲﾙ'; x = 10; y = 20; width = 30; height = 12 })
$fullwidth = @(@{ text = 'ファイル'; x = 10; y = 20; width = 30; height = 12 })
Check 'OCR half-width word matches a full-width query' ($null -ne (Find-OcrWordRun -Words $halfwidth -Query 'ファイル'))
Check 'OCR full-width word matches a half-width query' ($null -ne (Find-OcrWordRun -Words $fullwidth -Query 'ﾌｧｲﾙ'))
Check 'OCR miss stays a miss' ($null -eq (Find-OcrWordRun -Words @(@{ text = '設定'; x = 1; y = 2; width = 3; height = 4 }) -Query '保存'))
Write-Output 'MATCH_OK'
`, 'utf8');
const matcher = spawnSync(powershell, ['-NoProfile', '-File', matcherScript], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
assert.equal(matcher.status, 0, `${matcher.stderr}${matcher.stdout}`);
assert.match(matcher.stdout, /MATCH_OK/, 'The matcher contract must run to the end');

// --------------------------------------------------- takeover overlay text
const overlayScript = path.join(root, 'overlay.ps1');
await writeFile(overlayScript, '\uFEFF' + `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[System.Threading.Thread]::CurrentThread.CurrentUICulture = [System.Globalization.CultureInfo]::GetCultureInfo('ja-JP')
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -AssemblyName System.Web.Extensions
$source = [IO.File]::ReadAllText('${path.join(checkout, 'scripts', 'windows-takeover.cs').replace(/'/g, "''")}', [Text.Encoding]::UTF8)
Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions
function Check { param([string]$Message, [bool]$Condition) if (-not $Condition) { throw "FAILED: $Message" } }
Check 'Japanese banner' ([DshTakeover.UiText]::Banner() -eq 'DSH がコンピューターを操作しています')
Check 'Japanese Esc hint' ([DshTakeover.UiText]::StopHint() -eq '停止')
$font = [DshTakeover.UiText]::Pick([DshTakeover.UiText]::Banner(), 10.5, [System.Drawing.FontStyle]::Regular)
Check 'a Japanese-capable font family' ($font.Name -match '^(Yu Gothic UI|Meiryo UI|Yu Gothic|Meiryo|MS UI Gothic|Microsoft YaHei UI)$')
$latin = [DshTakeover.UiText]::Pick('DSH is controlling your computer', 10.5, [System.Drawing.FontStyle]::Regular)
Check 'Latin text stays in Segoe UI' ($latin.Name -eq 'Segoe UI')
Write-Output 'OVERLAY_OK'
`, 'utf8');
const overlay = spawnSync(desktopPowerShell, ['-NoProfile', '-File', overlayScript], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
assert.equal(overlay.status, 0, `${overlay.stderr}${overlay.stdout}`);
assert.match(overlay.stdout, /OVERLAY_OK/, 'The overlay must draw Japanese text with a Japanese font');

console.log('PASS Japanese dictionary, Windows language defaults, width-insensitive matching and overlay fonts');
