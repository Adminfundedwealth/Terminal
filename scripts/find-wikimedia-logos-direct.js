#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const repoRoot = path.resolve(__dirname, '..');
const logosDir = path.join(repoRoot, 'public', 'logos');
const baseRedirect = 'https://commons.wikimedia.org/wiki/Special:Redirect/file/';

const candidates = {
  RELIANCE: ['Reliance_Industries_logo.svg', 'Reliance_logo.svg', 'Reliance_Industry_logo.svg', 'Reliance_Industries_Logo.svg'],
  TCS: ['TCS_logo.svg', 'Tata_Consultancy_Services_logo.svg', 'TCS_(logo).svg', 'TCS_Logo.svg'],
  ITC: ['ITC_logo.svg', 'ITC_Limited_logo.svg', 'ITC_Ltd_logo.svg'],
  HDFCBANK: ['HDFC-Bank-Logo.svg', 'HDFC_Bank_logo.svg'],
  ICICIBANK: ['ICICI_Bank_logo.svg', 'ICICI_Bank_Logo.svg'],
  SBIN: ['State_Bank_of_India_logo.svg', 'SBI_logo.svg', 'SBI_Logo.svg'],
  LT: ['Larsen_%26_Toubro_logo.svg', 'Larsen_and_Toubro_logo.svg', 'Larsen_%26_Toubro_Logo.svg'],
  AXISBANK: ['Axis_Bank_logo.svg', 'AXISBank_Logo.svg'],
  INFY: ['Infosys_logo.svg', 'Infosys_Logo.svg'],
  HDFC: ['HDFC_Limited_logo.svg', 'HDFC_logo.svg', 'HDFC_Ltd_logo.svg'],
  KOTAKBANK: ['Kotak_Bank_logo.svg', 'Kotak_Mahindra_Bank_logo.svg', 'Kotak_Bank_Logo.svg'],
  BAJFINANCE: ['Bajaj_Finance_Logo.svg', 'Bajaj_Finance_logo.svg'],
  MANDM: ['Mahindra_logo.svg', 'Mahindra_%26_Mahindra_logo.svg'],
  MARUTI: ['Maruti_Suzuki_logo.svg', 'Maruti_Suzuki_Logo.svg', 'Maruti_Suzuki_Logo_(2020).svg'],
  NTPC: ['NTPC_logo.svg', 'NTPC_Logo.svg'],
  ONGC: ['ONGC_logo.svg', 'ONGC_Logo.svg'],
  POWERGRID: ['Power_Grid_logo.svg', 'POWERGRID_logo.svg'],
  TATAMOTORS: ['Tata_Motors_logo.svg', 'Tata_Motors_Logo.svg'],
  ASIANPAINT: ['Asian_Paints_logo.svg', 'Asian_Paints_Logo.svg'],
  HCLTECH: ['HCLTech_logo.svg', 'HCLTech_Logo.svg'],
  ULTRACEMCO: ['UltraTech_Cement_logo.svg', 'UltraTech_Cement_Logo.svg'],
  WIPRO: ['Wipro_logo.svg', 'Wipro_Logo.svg'],
  CIPLA: ['Cipla_logo.svg', 'Cipla_Logo.svg'],
  TECHM: ['Tech_Mahindra_logo.svg', 'Tech_Mahindra_Logo.svg'],
  BHARTIARTL: ['Bharti_Airtel_logo.svg', 'Bharti_Airtel_Logo.svg'],
  JSWSTEEL: ['JSW_Steel_logo.svg', 'JSW_Steel_Logo.svg'],
  DRREDDY: ["Dr_Reddy's_Laboratories_logo.svg", 'Dr_Reddys_Laboratories_logo.svg', 'Dr_Reddy%27s_Laboratories_logo.svg'],
  GRASIM: ['Grasim_Industries_logo.svg', 'Grasim_logo.svg'],
  INDUSINDBK: ['IndusInd_Bank_logo.svg', 'IndusInd_Bank_Logo.svg'],
  ADANIENT: ['Adani_Enterprises_logo.svg', 'Adani_Enterprises_Logo.svg'],
  SUNPHARMA: ['Sun_Pharma_logo.svg', 'Sun_Pharmaceutical_Industries_logo.svg', 'Sun_Pharma_Logo.svg'],
  EICHERMOT: ['Eicher_Motors_logo.svg', 'Eicher_Motors_Logo.svg'],
  HERO: ['Hero_MotoCorp_logo.svg', 'Hero_Motocorp_logo.svg'],
  TATASTEEL: ['Tata_Steel_logo.svg', 'Tata_Steel_Logo.svg'],
  NESTLEIND: ['Nestle_India_logo.svg', 'Nestle_logo.svg'],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRedirect(url) {
  const res = await fetch(url, {
    method: 'HEAD',
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; fundedwealth-terminal/1.0)',
      Accept: 'image/svg+xml,*/*',
    },
  });
  return res;
}

async function downloadFile(url, destPath) {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; fundedwealth-terminal/1.0)',
      Accept: 'image/svg+xml,*/*',
    },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  const body = await res.text();
  fs.writeFileSync(destPath, body, 'utf8');
}

async function findAndDownload(symbol, knownNames) {
  for (const name of knownNames) {
    const url = baseRedirect + name;
    try {
      const res = await fetchRedirect(url);
      const ok = res.ok;
      const contentType = res.headers.get('content-type') || '';
      const finalUrl = res.url;
      if (ok && contentType.includes('image/svg+xml') && finalUrl && finalUrl.endsWith('.svg')) {
        return { name, url: finalUrl };
      }
      if (ok && finalUrl && finalUrl.endsWith('.svg')) {
        return { name, url: finalUrl };
      }
      process.stdout.write(` ${name}->${res.status}`);
    } catch (error) {
      process.stdout.write(` ${name}->ERR`);
    }
    await sleep(500);
  }
  return null;
}

(async () => {
  if (!fs.existsSync(logosDir)) fs.mkdirSync(logosDir, { recursive: true });

  for (const [symbol, names] of Object.entries(candidates)) {
    process.stdout.write(`Checking ${symbol}`);
    const result = await findAndDownload(symbol, names);
    if (!result) {
      console.log(' not found');
      continue;
    }
    const destPath = path.join(logosDir, `${symbol}.svg`);
    try {
      await downloadFile(result.url, destPath);
      console.log(` -> downloaded ${result.name} to ${path.relative(repoRoot, destPath)}`);
    } catch (err) {
      console.log(` -> failed download ${result.name}: ${err.message}`);
    }
    await sleep(1200);
  }
})();
