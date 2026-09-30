import assert from 'node:assert/strict';
import { test } from 'node:test';
import { __test as people, matchOdooEmployees, odooEmployeeByKey, odooEmployeeFor, odooOnlyCode } from './hr/odooPeople.js';
import { odooResolver, timeOffView } from './hr/odooHR.js';
import { ownOdooEmployee, teamOdooIds, teamReach } from './hr/teamReach.js';

const row = (id, fields) => ({ id, active: true, name: `Person ${id}`, work_email: false, registration_number: false, department_id: [7, 'HR SECTOR'], parent_id: false, ...fields });

function indexOf(rows) {
  return {
    rows,
    byId: new Map(rows.map((item) => [item.id, item])),
    byCode: people.uniqueMap(rows, (item) => (item.registration_number ? people.comparableCode(item.registration_number) : '')),
    byEmail: people.uniqueMap(rows, (item) => String(item.work_email || '').toLowerCase()),
    byName: people.uniqueMap(rows, (item) => people.comparableName(item.name)),
    departments: new Map(),
  };
}

test('the HR code joins through Odoo registration_number before e-mail or name', () => {
  const index = indexOf([
    row(1, { registration_number: '257', work_email: 'someone.else@test.local' }),
    row(2, { work_email: 'shahinda@test.local' }),
  ]);
  const profile = { employeeCode: '257', companyEmail: 'shahinda@test.local', nameEnglish: 'Shahinda Samir' };
  assert.equal(odooEmployeeFor(profile, index).id, 1, 'the code wins over a matching e-mail');
  assert.equal(odooEmployeeFor({ employeeCode: '0257', companyEmail: '', nameEnglish: '' }, index).id, 1, 'leading zeros do not break the code');
});

test('a code two active people share joins nobody, but a rehire keeps the active record', () => {
  const clash = indexOf([row(1, { registration_number: '300' }), row(2, { registration_number: '300' })]);
  assert.equal(odooEmployeeFor({ employeeCode: '300' }, clash), null);
  const rehire = indexOf([row(1, { registration_number: '301', active: false }), row(2, { registration_number: '301' })]);
  assert.equal(odooEmployeeFor({ employeeCode: '301' }, rehire).id, 2);
});

test('active Odoo employees the HR file does not claim are listed, and addressable', () => {
  const index = indexOf([row(1, { registration_number: '257' }), row(2, { registration_number: '999' }), row(3, {}), row(4, { active: false })]);
  const { odooOnly } = matchOdooEmployees([{ employeeCode: '257' }], index);
  assert.deepEqual(odooOnly.map((item) => item.id), [2, 3], 'archived people are not "missing"');
  assert.equal(odooOnlyCode(odooOnly[0]), '999');
  assert.equal(odooOnlyCode(odooOnly[1]), 'o3');
  assert.equal(odooEmployeeByKey('o3', index).id, 3);
  assert.equal(odooEmployeeByKey('999', index).id, 2);
});

test('time off: HR sees everyone, anyone else only themselves; away-from-desk is not absence', () => {
  const index = indexOf([row(1, { registration_number: '257' }), row(2, { registration_number: '420' })]);
  const resolver = odooResolver([{ employeeCode: '257', nameArabic: 'شهندا', nameEnglish: 'Shahinda', department: 'HR' }], index);
  const leave = (id, employee, state, type, from, to) => ({ id, odooEmployeeId: employee, employeeName: `Person ${employee}`, type, from, to, days: 1, duration: '1 day', hours: false, state, createdAt: null });
  const paid = { id: 1, name: 'Paid Time Off', color: 2, away: false };
  const wfh = { id: 13, name: 'WFH', color: 4, away: true };
  const data = {
    year: 2026,
    types: [{ ...paid, active: true }, { ...wfh, active: true }],
    leaves: [
      leave(10, 1, 'validate', paid, '2026-09-24', '2026-09-28'),
      leave(11, 2, 'validate', wfh, '2026-09-25', '2026-09-25'),
      leave(12, 2, 'confirm', paid, '2026-10-01', '2026-10-02'),
    ],
    allocations: [],
  };
  const hr = timeOffView(data, resolver, { everyone: true, today: '2026-09-25' });
  assert.deepEqual(hr.onLeaveToday.map((item) => item.employee.code), ['257']);
  assert.equal(hr.onLeaveToday[0].employee.nameArabic, 'شهندا', 'the HR file names the person');
  assert.deepEqual(hr.awayToday.map((item) => item.employee.code), ['420'], 'working from home is shown apart');
  assert.equal(hr.pending, 1);
  const own = timeOffView(data, resolver, { everyone: false, ownOdooId: 2, today: '2026-09-25' });
  assert.deepEqual(own.requests.map((item) => item.id), [11, 12]);
  const nobody = timeOffView(data, resolver, { everyone: false, ownOdooId: null, today: '2026-09-25' });
  assert.equal(nobody.requests.length, 0);
  assert.deepEqual(timeOffView(null, resolver, { everyone: true }), { connected: false });
});

test('a team is everyone below a manager in Odoo, every level, active only, and a loop cannot hang it', () => {
  const rows = [
    row(1, {}),
    row(2, { parent_id: [1, 'Boss'] }),
    row(3, { parent_id: [2, 'Lead'] }),
    row(4, { parent_id: [3, 'Senior'] }),
    row(5, { parent_id: [1, 'Boss'], active: false }),
    row(6, { parent_id: [9, 'Elsewhere'] }),
    row(7, { parent_id: [8, 'Loop'] }),
    row(8, { parent_id: [7, 'Loop'] }),
  ];
  assert.deepEqual([...teamOdooIds(rows, 1)].sort(), [2, 3, 4], 'a resigned report is history, not team');
  assert.deepEqual([...teamOdooIds(rows, 3)], [4]);
  assert.deepEqual([...teamOdooIds(rows, 7)], [8]);
});

test('the team scope finds the manager through the HR link or a unique work e-mail, and reads only their tree', () => {
  const index = indexOf([
    row(1, { registration_number: '216', work_email: 'boss@test.local' }),
    row(2, { registration_number: '300', parent_id: [1, 'Boss'] }),
    row(3, { parent_id: [2, 'Lead'] }),
    row(4, { registration_number: '400' }),
  ]);
  const profiles = [
    { employeeCode: '216', linkedUserId: 'u-boss' },
    { employeeCode: '300', linkedUserId: null },
    { employeeCode: '400', linkedUserId: null },
  ];
  const resolver = odooResolver(profiles, index);
  const manager = { id: 'u-boss', role: 'member', status: 'active', email: 'someone@test.local', permissions: ['hr.people.team'] };
  const reach = teamReach(manager, profiles, resolver, index);
  assert.deepEqual([...reach.codes].sort(), ['300', 'o3'], 'HR codes and Odoo-only people below them, not a peer');

  const byEmail = { id: 'u-x', role: 'member', status: 'active', email: 'BOSS@test.local', permissions: ['hr.people.team'] };
  assert.equal(ownOdooEmployee(byEmail, profiles.map((p) => ({ ...p, linkedUserId: null })), resolver, index).id, 1);

  const stranger = { id: 'u-y', role: 'member', status: 'active', email: 'nobody@test.local', permissions: ['hr.people.team'] };
  assert.equal(teamReach(stranger, profiles, resolver, index).codes.size, 0, 'no Odoo employee means no team, never everyone');
  assert.equal(teamReach({ ...manager, permissions: ['hr.view', 'hr.people.team'] }, profiles, resolver, index), null, 'hr.view already reads everyone');
  assert.equal(teamReach({ ...manager, permissions: [] }, profiles, resolver, index), null);
});
