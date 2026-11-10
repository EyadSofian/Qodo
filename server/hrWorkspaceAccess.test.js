import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hrWorkspaceOnly } from '../shared/permissions.js';
import { hrWorkspaceAccess } from './hrWorkspaceAccess.js';

const user={id:'hr-specialist',role:'member',status:'active',appIds:['hr']};
function result(path,who=user) {
  let outcome='next';
  const res={status(code){outcome=code;return this;},json(){return this;}};
  hrWorkspaceAccess({path,user:who},res,()=>{outcome='next';});
  return outcome;
}
test('an explicit HR-only app scope allows HR and shared identity, denies every unrelated module',()=>{
  assert.equal(hrWorkspaceOnly(user),true);
  for(const path of ['/hr/access','/hr/recruitment/offers/catalog','/hr/personnel','/kpi/overview','/offices','/auth/me','/auth/directory','/auth/logout','/auth/password','/notifications/stream','/apps','/health'])assert.equal(result(path),'next',path);
  for(const path of ['/mail/bootstrap','/calendar','/tasks','/tasks/counts','/management','/projects','/learning-production','/events','/prices','/booking','/search','/assistant','/users','/invites','/hr-operations','/auth/sso/events','/apps/events','/hr-lookalike'])assert.equal(result(path),403,path);
});
test('HR-only restrictions do not alter existing accounts or admin access',()=>{
  for(const who of [null,{...user,role:'admin'},{...user,appIds:null},{...user,appIds:['hr','calendar']}]){
    assert.equal(hrWorkspaceOnly(who),false);
    assert.equal(result('/mail/bootstrap',who),'next');
  }
});
