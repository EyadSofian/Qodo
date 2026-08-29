import assert from 'node:assert/strict';
import { test } from 'node:test';
import { __test } from './hrFx.js';

test('Banque Misr USD rate parser keeps the bulletin date and buy/sell sides', () => {
  const html = `
    <div class="generic-details-title"><p>29-08-2026 11:02:53</p></div>
    <tr><td><img src="/usd.ashx" /></td><td>50.17</td><td>50.27</td></tr>
  `;
  assert.deepEqual(__test.parseBanqueMisr(html), {
    buy: 50.17,
    sell: 50.27,
    asOf: '2026-08-29',
    source: 'Banque Misr',
    sourceUrl: 'https://www.banquemisr.com/en/Home/CAPITAL-MARKETS/Exchange-Rates-and-Currencies?sc_lang=ar-EG',
    live: true,
  });
});

test('Banque Misr parser fails closed when the bank layout is not recognised', () => {
  assert.equal(__test.parseBanqueMisr('<html>no rates</html>'), null);
});
