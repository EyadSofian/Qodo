import test from 'node:test';
import assert from 'node:assert/strict';

import {
  briefSlotLabel,
  buildInsightsBrief,
  latestDueBriefSlot,
  parseBriefTimes,
} from './insightsBrief.js';

test('management brief times are validated, deduplicated and ordered', () => {
  assert.deepEqual(parseBriefTimes('19:00, 11:30,11:30,25:00,bad'), [690, 1140]);
});

test('the latest due slot catches up once without repeating', () => {
  const times = parseBriefTimes('11:30,19:00');
  assert.equal(
    latestDueBriefSlot({ day: '2026-09-09', hour: 11, minute: 29, times, lastSlot: null }),
    null
  );
  assert.equal(
    latestDueBriefSlot({ day: '2026-09-09', hour: 11, minute: 34, times, lastSlot: null }),
    '2026-09-09T11:30'
  );
  assert.equal(
    latestDueBriefSlot({
      day: '2026-09-09',
      hour: 18,
      minute: 59,
      times,
      lastSlot: '2026-09-09T11:30',
    }),
    null
  );
  assert.equal(
    latestDueBriefSlot({
      day: '2026-09-09',
      hour: 19,
      minute: 0,
      times,
      lastSlot: '2026-09-09T11:30',
    }),
    '2026-09-09T19:00'
  );
  assert.equal(briefSlotLabel('2026-09-09T19:00'), '7:00 م');
});

test('brief uses paid invoices over all leads and includes every requested signal', () => {
  const result = buildInsightsBrief({
    from: '2026-09-01',
    to: '2026-09-09',
    overview: {
      activity: {
        atRisk: [
          { campaignName: 'Traffic campaign' },
          { campaignName: 'Automotive campaign' },
        ],
      },
    },
    leads: {
      totals: { totalLeads: 814, orders: 58, lost: 74 },
      pipeline: { followUp: 712 },
    },
    website: {
      totals: { sales: 1926.57, websiteCampaignSpend: 500 },
    },
    teams: {
      agents: [
        measuredAgent('Employee C', 30, 70),
        measuredAgent('Employee A', 10, 60),
        measuredAgent('Employee B', 20, 50),
        measuredAgent('Missing data', 0, 20),
      ],
    },
  });

  assert.ok(result);
  assert.match(result.body, /814 إجمالي/);
  assert.match(result.body, /74 Lost/);
  assert.match(result.body, /712 متابعة/);
  assert.match(result.body, /58 فاتورة مدفوعة ÷ 814 ليد = 7\.1%/);
  assert.match(result.body, /الموقع:.*\$1,927 مبيعات.*عائد 3\.9×/);
  assert.match(result.body, /تحتاج مراجعة: 2 حملة/);
  assert.match(result.body, /Employee A \(10\/100\).*Employee B \(20\/100\).*Employee C \(30\/100\)/);
  assert.doesNotMatch(result.body, /Missing data/);
});

test('missing API sections are omitted rather than rendered as zero', () => {
  const result = buildInsightsBrief({
    from: '2026-09-01',
    to: '2026-09-09',
    overview: { totals: { totalLeads: 12, orders: 3 } },
    leads: null,
    teams: null,
    website: null,
  });
  assert.match(result.body, /12 إجمالي/);
  assert.match(result.body, /3 فاتورة مدفوعة/);
  assert.doesNotMatch(result.body, /Lost|متابعة|الموقع|أقل 3/);
});

function measuredAgent(name, overall, dataCoverage) {
  return {
    name,
    displayName: name,
    target: { complete: true },
    performanceScore: { overall, dataCoverage },
  };
}
