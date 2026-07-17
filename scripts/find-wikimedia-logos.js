#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const fetch = global.fetch || require('node:node-fetch');

const repoRoot = path.resolve(__dirname, '..');
const logosDir = path.join(repoRoot, 'public', 'logos');
const apiBase = 'https://commons.wikimedia.org/w/api.php';

const companies = {
  RELIANCE: 'Reliance Industries logo',
  TCS: 'TCS logo',
  ITC: 'ITC logo',
  HDFCBANK: 'HDFC Bank logo',
  ICICIBANK: 'ICICI Bank logo',
  SBIN: 'SBI logo',
  LT: 'Larsen & Toubro logo',
  AXISBANK: 'Axis Bank logo',
  INFY: 'Infosys logo',
  HDFC: 'HDFC Bank logo',
  KOTAKBANK: 'Kotak Bank logo',
  BAJFINANCE: 'Bajaj Finance logo',
  MANDM: 'Mahindra & Mahindra logo',
  MARUTI: 'Maruti Suzuki logo',
  NTPC: 'NTPC logo',
  ONGC: 'ONGC logo',
  POWERGRID: 'Power Grid logo',
  TATAMOTORS: 'Tata Motors logo',
  ASIANPAINT: 'Asian Paints logo',
  HCLTECH: 'HCLTech logo',
  ULTRACEMCO: 'UltraTech Cement logo',
  WIPRO: 'Wipro logo',
  CIPLA: 'Cipla logo',
  TECHM: 'Tech Mahindra logo',
  BHARTIARTL: 'Bharti Airtel logo',
  JSWSTEEL: 'JSW Steel logo',
  DRREDDY: "Dr Reddy's Laboratories logo",
  GRASIM: 'Grasim Industries logo',
  INDUSINDBK: 'IndusInd Bank logo',
  ADANIENT: 'Adani Enterprises logo',
  SUNPHARMA: 'Sun Pharmaceutical logo',
  EICHERMOT: 'Eicher Motors logo',
  HERO: 'Hero MotoCorp logo',
  TATASTEEL: 'Tata Steel logo',
  NESTLEIND: 'Nestle India logo',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryApi(params) {
  const url = new URL(apiBase);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; fundedwealth-terminal/1.0)' },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function findLogoForSymbol(symbol, label) {
  const query = `${label}`;
  const searchData = await queryApi({ action: 'query', list: 'search', srsearch: query, srnamespace: '6', format: 'json', srlimit: '10' });
  const candidates = searchData.query?.search?.map((item) => item.title) || [];
  const fileCandidates = candidates.filter((title) => title.toLowerCase().includes('logo'));

  for (const title of fileCandidates) {
    try {
      const info = await queryApi({ action: 'query', titles: title, prop: 'imageinfo', iiprop: 'url|mime', format: 'json' });
      const page = Object.values(info.query.pages)[0];
      if (page && !page.missing && page.imageinfo?.length) {
        const imageinfo = page.imageinfo[0];
        if (imageinfo.mime === 'image/svg+xml' && imageinfo.url.endsWith('.svg')) {
          return { title, url: imageinfo.url };
        }
      }
    } catch (error) {
      console.error(`  [${symbol}] candidate failed: ${title} ->`, error.message);
    }
    await sleep(400);
  }

  return null;
}

async function downloadSvg(url, destPath) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; fundedwealth-terminal/1.0)' } });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  fs.writeFileSync(destPath, text, 'utf8');
}

(async () => {
  if (!fs.existsSync(logosDir)) {
    fs.mkdirSync(logosDir, { recursive: true });
  }

  for (const [symbol, label] of Object.entries(companies)) {
    process.stdout.write(`Searching ${symbol} (${label})... `);
    try {
      const result = await findLogoForSymbol(symbol, label);
      if (!result) {
        console.log('not found');
        continue;
      }
      const dest = path.join(logosDir, `${symbol}.svg`);
      console.log(`found ${result.title} -> ${result.url}`);
      try {
        await downloadSvg(result.url, dest);
        console.log(`  downloaded to ${path.relative(repoRoot, dest)}`);
      } catch (downloadError) {
        console.error(`  download failed: ${downloadError.message}`);
      }
    } catch (error) {
      console.error(`failed: ${error.message}`);
    }
    await sleep(1200);
  }
})();
