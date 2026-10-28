import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldPlayMt4WindowSound, normalizeMt4ChartMotion } from '../app/lib/mt4ChartWindow.mjs';
import { createNotificationSound } from '../app/lib/notificationSound.mjs';

const settings={enabled:true,startSeconds:10,endSeconds:10,soundEnabled:true};
const frame=(window,patch={})=>({scope:'account-a:XAUUSD:15:session',window,settings,...patch});
test('sound occurs only when a frozen chart resumes, including the next opening window',()=>{
  assert.equal(shouldPlayMt4WindowSound(frame('frozen'),frame('live')),true);
  for(const before of [null,frame('live'),frame('waiting'),frame('clock'),frame('paused')])
    assert.equal(shouldPlayMt4WindowSound(before,frame('live')),false);
  for(const next of ['frozen','waiting','clock','paused'])
    assert.equal(shouldPlayMt4WindowSound(frame('frozen'),frame(next)),false);
});
test('settings, identity changes and switching sound on never create a false resume alert',()=>{
  for(const patch of [{soundEnabled:false},{enabled:false},{startSeconds:20},{endSeconds:20}])
    assert.equal(shouldPlayMt4WindowSound(frame('frozen'),frame('live',{settings:{...settings,...patch}})),false);
  assert.equal(shouldPlayMt4WindowSound(frame('frozen',{settings:{...settings,soundEnabled:false}}),frame('live')),false);
  assert.equal(shouldPlayMt4WindowSound(frame('frozen'),frame('live',{scope:'account-b:EURUSD:5:session'})),false);
  assert.equal(normalizeMt4ChartMotion({}).soundEnabled,false);
  assert.equal(normalizeMt4ChartMotion({soundEnabled:'true'}).soundEnabled,false);
  assert.equal(normalizeMt4ChartMotion({soundEnabled:true}).soundEnabled,true);
});
const fakeContext=()=>{
  const events=[];
  const context={state:'suspended',currentTime:2,destination:{},
    async resume(){events.push('resume');this.state='running';},
    createOscillator(){events.push('oscillator');return {frequency:{setValueAtTime(){}},connect(){},disconnect(){events.push('disconnect-oscillator');},start(){events.push('start');},stop(){events.push('stop');}}},
    createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){events.push('disconnect-gain');}}}
  };
  return {context,events};
};
test('browser sound is lazy, brief, and never queues a blocked sound for later',async()=>{
  const {context,events}=fakeContext();let created=0;
  const sound=createNotificationSound(()=>{created++;return context;});
  assert.equal(sound.play(),false);assert.equal(created,0);
  assert.equal(await sound.unlock(),true);assert.equal(created,1);assert.deepEqual(events,['resume']);
  assert.equal(sound.play(),true);assert.equal(events.filter(e=>e==='start').length,1);
  context.state='suspended';assert.equal(sound.play(),false);
  await sound.unlock();assert.equal(events.filter(e=>e==='start').length,1);
  assert.equal(await sound.preview(),true);assert.equal(created,1);
});
test('unsupported or denied audio fails recoverably without throwing or pending playback',async()=>{
  for(const create of [()=>{throw Error('unavailable');},()=>({state:'suspended',resume:async()=>{throw Error('denied');}})]){
    const sound=createNotificationSound(create);
    assert.equal(await sound.unlock(),false);assert.equal(sound.play(),false);assert.equal(await sound.preview(),false);
  }
});
