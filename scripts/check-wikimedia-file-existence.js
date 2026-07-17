#!/usr/bin/env node
const fetch = global.fetch;
const api = 'https://commons.wikimedia.org/w/api.php';
const candidates = {
  RELIANCE: ['Reliance logo.svg', 'Reliance_Industries_logo.svg', 'Reliance_Logo.svg'],
  TCS: ['TCS logo.svg', 'TCS Logo.svg', 'Tata Consultancy Services logo.svg', 'TCS_(logo).svg'],
  ITC: ['ITC logo.svg', 'ITC_Limited_logo.svg', 'ITC_Logo.svg'],
  HDFCBANK: ['HDFC-Bank-Logo.svg', 'HDFC_Bank_logo.svg', 'HDFC Bank logo.svg'],
  ICICIBANK: ['ICICI Bank logo.svg', 'ICICI_Bank_logo.svg', 'ICICI_logo.svg'],
  SBIN: ['State Bank of India logo.svg', 'SBI logo.svg', 'SBI_Logo.svg'],
  LT: ['Larsen & Toubro logo.svg', 'Larsen_%26_Toubro_logo.svg', 'Larsen and Toubro logo.svg'],
  AXISBANK: ['Axis Bank logo.svg', 'AXISBank Logo.svg'],
  INFY: ['Infosys logo.svg', 'Infosys_Logo.svg'],
  HDFC: ['HDFC Bank logo.svg', 'HDFC-Bank-Logo.svg'],
  KOTAKBANK: ['Kotak Bank logo.svg', 'Kotak_Bank_logo.svg', 'Kotak Mahindra Bank logo.svg'],
  BAJFINANCE: ['Bajaj Finance Logo.svg', 'Bajaj_Finance_logo.svg'],
  MANDM: ['Mahindra logo.svg', 'Mahindra & Mahindra logo.svg', 'Mahindra and Mahindra logo.svg'],
  MARUTI: ['Maruti Suzuki logo.svg', 'Maruti_Suzuki_logo.svg'],
  NTPC: ['NTPC logo.svg', 'NTPC_Logo.svg'],
  ONGC: ['ONGC logo.svg', 'ONGC_Logo.svg'],
  POWERGRID: ['Power Grid logo.svg', 'POWERGRID_logo.svg'],
  TATAMOTORS: ['Tata Motors logo.svg', 'Tata_Motors_logo.svg'],
  ASIANPAINT: ['Asian Paints logo.svg', 'Asian_Paints_logo.svg'],
  HCLTECH: ['HCLTech logo.svg', 'HCLTech_Logo.svg'],
  ULTRACEMCO: ['UltraTech Cement logo.svg', 'UltraTech_Cement_logo.svg'],
  WIPRO: ['Wipro logo.svg', 'Wipro_Logo.svg'],
  CIPLA: ['Cipla logo.svg', 'Cipla_Logo.svg'],
  TECHM: ['Tech Mahindra logo.svg', 'Tech_Mahindra_logo.svg'],
  BHARTIARTL: ['Bharti Airtel logo.svg', 'Bharti_Airtel_logo.svg'],
  JSWSTEEL: ['JSW Steel logo.svg', 'JSW_Steel_logo.svg'],
  DRREDDY: ['Dr Reddy\'s Laboratories logo.svg', 'Dr Reddys Laboratories logo.svg'],
  GRASIM: ['Grasim Industries logo.svg', 'Grasim_logo.svg'],
  INDUSINDBK: ['IndusInd Bank logo.svg', 'IndusInd_Bank_logo.svg'],
  ADANIENT: ['Adani Enterprises logo.svg', 'Adani_Enterprises_logo.svg'],
  SUNPHARMA: ['Sun Pharmaceutical Industries logo.svg', 'Sun_Pharma_logo.svg'],
  EICHERMOT: ['Eicher Motors logo.svg', 'Eicher_Motors_logo.svg'],
  HERO: ['Hero MotoCorp logo.svg', 'Hero_MotoCorp_logo.svg'],
  TATASTEEL: ['Tata Steel logo.svg', 'Tata_Steel_logo.svg'],
  NESTLEIND: ['Nestle India logo.svg', 'Nestle_India_logo.svg'],
};

async function queryFile(title) {
  const url = new URL(api);
  url.searchParams.set('action', 'query');
  url.searchParams.set('titles', `File:${title}`);
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url|mime');
  url.searchParams.set('format', 'json');
  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; fundedwealth-terminal/1.0)' },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

(async function main() {
  for (const [symbol, titles] of Object.entries(candidates)) {
    console.log(`=== ${symbol} ===`);
    for (const title of titles) {
      try {
        const data = await queryFile(title);
        const page = Object.values(data.query.pages)[0];
        if (page && !page.missing && page.imageinfo && page.imageinfo.length) {
          const info = page.imageinfo[0];
          console.log(`FOUND ${title} -> ${info.url} ${info.mime}`);
          break;
        }
        console.log(`MISS ${title}`);
      } catch (err) {
        console.log(`ERR ${title} -> ${err.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1400));
    }
  }
})();
