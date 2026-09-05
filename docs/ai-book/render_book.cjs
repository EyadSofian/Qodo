const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const INPUT = path.join(__dirname, 'AI_FROM_ZERO_EGYPTIAN_AR.md');
const OUTPUT = path.join(PROJECT_ROOT, 'output/pdf/ai-from-zero-egyptian-ar.pdf');
const HTML_OUTPUT = path.join(PROJECT_ROOT, 'tmp/pdfs/ai-from-zero-egyptian-ar.html');
const LOGO = path.join(PROJECT_ROOT, 'public/logo.png');

const NODE_MODULES = '/Users/eyad/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { marked } = require(path.join(NODE_MODULES, 'marked'));
const { chromium } = require(path.join(NODE_MODULES, 'playwright'));

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderInlineLabels(html) {
  const terms = [
    'AI', 'ML', 'DL', 'LLM', 'Model', 'Parameter', 'Weight', 'Gradient',
    'Transformer', 'Attention', 'Token', 'Embedding', 'Fine-tuning', 'LoRA',
    'QLoRA', 'RAG', 'GGUF', 'Qodo', 'Railway', 'llama.cpp'
  ];
  const pattern = new RegExp(`(?<![\\w>])(${terms.map((term) => term.replace('.', '\\.')).join('|')})(?![\\w<])`, 'g');
  return html.replace(pattern, '<span class="latin-term" dir="ltr">$1</span>');
}

function buildHtml(markdown, logoData) {
  marked.use({
    gfm: true,
    breaks: false,
    mangle: false,
    headerIds: false,
  });

  let content = marked.parse(markdown);
  content = content.replace('<section class="cover">', `<section class="cover"><img class="cover-logo" src="${logoData}" alt="Engosoft">`);
  content = renderInlineLabels(content);

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>الذكاء الاصطناعي من الصفر بالبلدي</title>
  <style>
    :root {
      --navy: #062d55;
      --blue: #0b74de;
      --sky: #38a9f4;
      --ink: #142b45;
      --muted: #60758d;
      --line: #d9e6f2;
      --wash: #f3f8fd;
      --paper: #ffffff;
      --warm: #f7b955;
    }

    * { box-sizing: border-box; }

    @page {
      size: A4;
      margin: 19mm 17mm 21mm 17mm;
    }

    @page cover {
      size: A4;
      margin: 0;
    }

    html { direction: rtl; }

    body {
      margin: 0;
      color: var(--ink);
      background: var(--paper);
      font-family: Arial, "Arial Unicode MS", "Geeza Pro", sans-serif;
      font-size: 10.8pt;
      line-height: 1.7;
      direction: rtl;
      text-align: right;
      text-rendering: optimizeLegibility;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .cover {
      position: relative;
      page: cover;
      width: 210mm;
      height: 297mm;
      min-height: 297mm;
      margin: 0;
      padding: 37mm 24mm 27mm;
      overflow: hidden;
      color: #fff;
      background:
        radial-gradient(circle at 15% 15%, rgba(56,169,244,.48), transparent 28%),
        radial-gradient(circle at 90% 82%, rgba(11,116,222,.35), transparent 33%),
        linear-gradient(145deg, #052545 0%, #073962 58%, #075aa2 100%);
      break-after: page;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    .cover::before,
    .cover::after {
      content: "";
      position: absolute;
      border: 1px solid rgba(255,255,255,.13);
      border-radius: 50%;
    }

    .cover::before { width: 165mm; height: 165mm; left: -76mm; top: -82mm; }
    .cover::after { width: 132mm; height: 132mm; right: -53mm; bottom: -72mm; }

    .cover-logo {
      width: 47mm;
      height: auto;
      margin: 0 0 22mm auto;
      filter: brightness(0) invert(1);
    }

    .cover h1 {
      color: #fff;
      border: 0;
      margin: 0 0 7mm;
      padding: 0;
      font-size: 31pt;
      line-height: 1.25;
      letter-spacing: -.4px;
    }

    .cover h2 {
      margin: 0 0 4mm;
      color: #bfe2ff;
      font-size: 17pt;
      line-height: 1.5;
    }

    .cover h3 {
      margin: 0 0 17mm;
      color: #fff;
      font-size: 12.5pt;
      font-weight: 500;
    }

    .cover p { max-width: 145mm; font-size: 10.5pt; color: #d8ecff; }
    .cover strong { color: #fff; }
    .cover blockquote {
      border-right-color: #62baff;
      background: rgba(255,255,255,.08);
      color: #e9f6ff;
      backdrop-filter: blur(2px);
    }

    .chapter-break { break-before: page; height: 0; }

    h1, h2, h3 { color: var(--navy); break-after: avoid-page; }

    h1 {
      margin: 0 0 7mm;
      padding: 0 0 4mm;
      font-size: 22pt;
      line-height: 1.35;
      border-bottom: 3px solid var(--blue);
    }

    h1::before {
      content: "";
      display: inline-block;
      width: 5mm;
      height: 5mm;
      margin-left: 3mm;
      border-radius: 1.4mm;
      background: linear-gradient(135deg, var(--blue), var(--sky));
      vertical-align: .6mm;
    }

    .cover h1::before { display: none; }

    h2 {
      margin: 6mm 0 2.7mm;
      font-size: 15.2pt;
      line-height: 1.45;
    }

    h3 {
      margin: 4.5mm 0 1.8mm;
      color: var(--blue);
      font-size: 12.6pt;
    }

    p { margin: 0 0 2.8mm; orphans: 3; widows: 3; }
    strong { color: var(--navy); }
    em { color: var(--muted); }

    ul, ol { margin: 1.8mm 0 3.2mm; padding-right: 7mm; }
    li { margin: 1.2mm 0; padding-right: 1.2mm; }
    li::marker { color: var(--blue); font-weight: 700; }

    blockquote {
      margin: 5mm 0;
      padding: 4mm 5mm;
      border: 0;
      border-right: 4px solid var(--blue);
      border-radius: 2.5mm;
      background: linear-gradient(90deg, #f7fbff, #eaf5ff);
      color: #24435f;
      break-inside: avoid-page;
    }

    blockquote p:last-child { margin-bottom: 0; }

    table {
      width: 100%;
      margin: 4mm 0 6mm;
      border-collapse: separate;
      border-spacing: 0;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 2.8mm;
      font-size: 9.6pt;
      line-height: 1.55;
      break-inside: auto;
    }

    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th {
      padding: 2.7mm 3mm;
      color: #fff;
      background: var(--navy);
      text-align: right;
      font-weight: 700;
    }
    td { padding: 2.5mm 3mm; border-top: 1px solid var(--line); vertical-align: top; }
    tbody tr:nth-child(even) { background: var(--wash); }

    code, pre {
      direction: ltr;
      text-align: left;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    }

    code {
      padding: .25mm 1mm;
      border: 1px solid #d8e7f4;
      border-radius: 1mm;
      background: #eff6fc;
      color: #064b88;
      font-size: .86em;
      unicode-bidi: isolate;
    }

    pre {
      margin: 4mm 0 6mm;
      padding: 4mm 4.5mm;
      overflow: hidden;
      border: 1px solid #163f62;
      border-radius: 2.8mm;
      background: #0c2942;
      color: #e8f4ff;
      font-size: 8.6pt;
      line-height: 1.55;
      white-space: pre-wrap;
      break-inside: avoid-page;
    }

    pre code { padding: 0; border: 0; background: transparent; color: inherit; }
    hr { margin: 9mm 0; border: 0; border-top: 1px solid var(--line); }

    .latin-term {
      display: inline;
      unicode-bidi: isolate;
      color: inherit;
    }

    a { color: var(--blue); text-decoration: none; }

    @media print {
      body { background: #fff; }
      a { color: inherit; }
    }
  </style>
</head>
<body>${content}</body>
</html>`;
}

async function main() {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.mkdirSync(path.dirname(HTML_OUTPUT), { recursive: true });

  const markdown = fs.readFileSync(INPUT, 'utf8');
  const logoMime = path.extname(LOGO).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  const logoData = `data:${logoMime};base64,${fs.readFileSync(LOGO).toString('base64')}`;
  const html = buildHtml(markdown, logoData);
  fs.writeFileSync(HTML_OUTPUT, html);

  const chromeExecutable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({ headless: true, executablePath: chromeExecutable });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(pathToFileURL(HTML_OUTPUT).href, { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    await page.pdf({
      path: OUTPUT,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `<div style="width:100%;padding:0 17mm;color:#6d8298;font:8px Arial;text-align:center;direction:ltr"><span class="pageNumber"></span><span style="padding:0 5px;color:#b2c0ce">/</span><span class="totalPages"></span></div>`,
      margin: { top: '19mm', right: '17mm', bottom: '21mm', left: '17mm' },
    });
  } finally {
    await browser.close();
  }

  console.log(OUTPUT);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
