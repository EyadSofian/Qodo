import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PERMISSIONS as P, performanceOnly, permissionsFor } from '../shared/permissions.js';
import { __test as people } from './hr/odooPeople.js';
import { performanceSubjectAllowed, resolvePerformanceTeam } from './hr/performanceAccess.js';

const manager={id:'manager',email:'boss@example.test',organizationId:'test-org',status:'active',role:'manager',permissions:[P.APPS_VIEW,P.TASKS_VIEW,P.HR_PERFORMANCE_TEAM_VIEW]};
const row=(id,code,parent,extra={})=>({id,name:`Employee ${id}`,active:true,registration_number:code,work_email:`person${id}@example.test`,parent_id:parent?[parent,'Manager']:false,...extra});
function indexOf(rows) {
  return {rows,byId:new Map(rows.map((r)=>[r.id,r])),byCode:people.uniqueMap(rows,(r)=>r.registration_number),byEmail:people.uniqueMap(rows,(r)=>r.work_email),byName:people.uniqueMap(rows,(r)=>people.comparableName(r.name)),departments:new Map()};
}
test('performance access is explicit, read-only, and does not derive general HR authority',()=>{
  assert.equal(performanceOnly(manager),true);
  for(const key of [P.HR_VIEW,P.HR_MANAGE,P.HR_PAYROLL,P.HR_PEOPLE_TEAM,P.HR_PERFORMANCE_REVIEW,P.HR_RECRUITMENT_VIEW])assert.ok(!permissionsFor(manager).includes(key));
  assert.equal(performanceOnly({...manager,role:'admin',permissions:null}),false);
  assert.equal(performanceOnly({...manager,status:'inactive'}),false);
  assert.equal(performanceOnly({...manager,permissions:['hr.performance.team_only']}),false,'old unknown keys do not silently grant other accounts access');
});
test('team performance includes all active descendants and self, rejects peers and foreign account joins',()=>{
  const index=indexOf([row(1,'100',null,{work_email:manager.email}),row(2,'200',1),row(3,'300',2),row(4,'400',1,{active:false}),row(5,'500',null)]);
  const profiles=[{employeeCode:'100',linkedUserId:manager.id},{employeeCode:'200',linkedUserId:'report'},{employeeCode:'300'},{employeeCode:'400'},{employeeCode:'500',linkedUserId:'peer'}];
  const scope=resolvePerformanceTeam(manager,profiles,index,[{id:'grandchild',email:'person3@example.test',organizationId:'test-org'},{id:'foreign',email:'person3@example.test',organizationId:'foreign'}]);
  assert.deepEqual([...scope.codes].sort(),['100','200','300']);
  assert.deepEqual([...scope.userIds].sort(),['grandchild','manager','report']);
  assert.equal(performanceSubjectAllowed(scope,{subjectType:'employee',subjectId:'200'}),true);
  assert.equal(performanceSubjectAllowed(scope,{subjectType:'user',subjectId:'grandchild'}),true);
  for(const subject of [{subjectType:'employee',subjectId:'500'},{subjectType:'employee',subjectId:'400'},{subjectType:'user',subjectId:'peer'},{subjectType:'user',subjectId:'foreign'}])assert.equal(performanceSubjectAllowed(scope,subject),false);
});
test('missing or ambiguous Odoo identity fails closed, with no name or department fallback',()=>{
  const profiles=[{employeeCode:'100',linkedUserId:'manager'},{employeeCode:'200',linkedUserId:'report'}];
  assert.deepEqual([...resolvePerformanceTeam(manager,profiles,null).codes],['100']);
  const index=indexOf([row(1,'10',null,{name:'Same name',work_email:manager.email}),row(2,'20',null,{name:'Same name',work_email:manager.email}),row(3,'30',1)]);
  const scope=resolvePerformanceTeam(manager,[],index);
  assert.equal(scope.codes.size,0);
  assert.deepEqual([...scope.userIds],['manager']);
});
