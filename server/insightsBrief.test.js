import test from 'node:test';
import assert from 'node:assert/strict';

import {
  briefSlotLabel,
  buildInsightsBriefNotifications,
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

test('each requested signal becomes a short standalone Arabic notification', () => {
  const result = buildInsightsBriefNotifications({
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

  assert.deepEqual(result.map((item) => item.key), ['leads', 'website', 'campaigns', 'employees']);
  assert.match(result[0].body, /814 عميلًا محتملًا/);
  assert.match(result[0].body, /74 صفقة خاسرة/);
  assert.match(result[0].body, /712 حالة متابعة/);
  assert.match(result[0].body, /58 فاتورة مدفوعة/);
  assert.match(result[0].body, /معدل التحويل الفعلي 7\.1%/);
  assert.doesNotMatch(result[0].body, /÷|Lost|ROAS/);
  assert.match(result[1].body, /1,927 دولار مبيعات.*كل دولار إنفاق حقق 3\.9 دولار مبيعات/);
  assert.match(result[2].body, /2 حملة تحتاج تدخلًا/);
  assert.match(result[3].body, /Employee A: 10 من 100.*Employee B: 20 من 100.*Employee C: 30 من 100/);
  assert.doesNotMatch(result[3].body, /Missing data/);
});

test('missing API sections are omitted rather than rendered as zero', () => {
  const result = buildInsightsBriefNotifications({
    from: '2026-09-01',
    to: '2026-09-09',
    overview: { totals: { totalLeads: 12, orders: 3 } },
    leads: null,
    teams: null,
    website: null,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].key, 'leads');
  assert.match(result[0].body, /12 عميلًا محتملًا/);
  assert.match(result[0].body, /3 فاتورة مدفوعة/);
  assert.doesNotMatch(result[0].body, /صفقة خاسرة|متابعة|الموقع|أقل 3/);
});

function measuredAgent(name, overall, dataCoverage) {
  return {
    name,
    displayName: name,
    target: { complete: true },
    performanceScore: { overall, dataCoverage },
  };
}
