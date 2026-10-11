import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const qa = process.env.QA_SOURCE;
if (!qa) throw new Error('Set QA_SOURCE to the matching Quick Access source checkout.');
const yze = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const bootstrap = `
const callbacks=new Map();
window.Hooks={once:(n,f)=>{const a=callbacks.get(n)||[];a.push(f);callbacks.set(n,a);},on:(n,f)=>Hooks.once(n,f),callAll:(n,...args)=>{for(const f of callbacks.get(n)||[])f(...args);}};
class CoreTracker {_onRender(){}}
class YzeTracker extends CoreTracker {_onRender(){} async _preparePartContext(_p,c){return c;}}
class Combat {async nextRound(){}}
window.CONFIG={Combat:{documentClass:Combat},ui:{combat:YzeTracker},statusEffects:[{id:'fastAction'},{id:'slowAction'}],fbl:{}};
window.CONST={DOCUMENT_OWNERSHIP_LEVELS:{OWNER:3,OBSERVER:2}};
let sequence=0;
window.foundry={utils:{randomID:()=>('op'+(++sequence))}};
const stored=new Map(JSON.parse(localStorage.getItem('test-settings')||'[]'));
const module={active:true,version:'1.4.0'};
const player={id:'player',active:true,isGM:false};
// Transport is simulated in one browser; identity/authority is tested separately.
const authority={id:'player',active:true,isGM:true};
window.game={user:player,users:[player],modules:new Map([['yze-combat-permission-fix',module],['yze-combat',{active:true,version:'1.6.1'}]]),socket:{on(){}},settings:{register:(_m,k,o)=>{if(!stored.has(k))stored.set(k,o.default);},get:(m,k)=>m==='yze-combat'?true:stored.get(k),set:async(_m,k,v)=>{stored.set(k,v);localStorage.setItem('test-settings',JSON.stringify([...stored]));}}};
window.ui={notifications:{warn:console.warn,error:console.error}};
game.i18n={localize:key=>key,format:key=>key};
game.system={id:'forbidden-lands'};
window.getDocumentClass=()=>({fromStatusEffect:async id=>({toObject:()=>({statuses:[id],name:id,flags:{}})})});
function makeActor(uuid){const flags={slots:['sword','shield','torch','bow',null,null,null,null]};return {documentName:'Actor',type:'character',uuid,id:uuid,name:'Игрок',isOwner:true,system:{attribute:{agility:{max:8}}},effects:[],statuses:new Set(),items:new Map(['sword','shield','torch','bow'].map((id,index)=>[id,{id,uuid:uuid+'.Item.'+id,name:['Меч','Щит','Факел','Лук'][index],img:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><rect width="22" height="22" fill="gray"/></svg>',type:'weapon',system:{weight:'normal'},sheet:{render:()=>window.openedItem=id}}])),testUserPermission:()=>true,getFlag:(_m,k)=>flags[k],update:async function(data){if(this.cancelNext){this.cancelNext=false;return undefined;}for(const [p,v]of Object.entries(data))flags[p.split('.').at(-1)]=structuredClone(v);Hooks.callAll('updateActor',this,data,{});return this;},refreshStatuses(){this.statuses=new Set(this.effects.flatMap(e=>[...e.statuses]));},async createEmbeddedDocuments(_type,data){if(this.failFee&&data[0].statuses.includes(this.failFee))throw new Error('fee unavailable');const created=data.map(d=>({...structuredClone(d),id:'effect'+(++sequence),parent:this,statuses:new Set(d.statuses),getFlag(m,k){return this.flags?.[m]?.[k];}}));this.effects.push(...created);this.refreshStatuses();for(const e of created)Hooks.callAll('createActiveEffect',e);return created;},async deleteEmbeddedDocuments(_type,ids){this.effects=this.effects.filter(e=>!ids.includes(e.id));this.refreshStatuses();Hooks.callAll('deleteActiveEffect',{parent:this});return ids;},async toggleStatusEffect(id,{active}){if(active)await this.createEmbeddedDocuments('ActiveEffect',[{statuses:[id],flags:{}}]);else await this.deleteEmbeddedDocuments('ActiveEffect',this.effects.filter(e=>e.statuses.has(id)).map(e=>e.id));}};}
const actor=makeActor('Actor.pc'),other=makeActor('Scene.scene.Token.other.Actor.pc');
const combatants=[{actor,tokenId:'pc',name:'Игрок'},{actor:other,tokenId:'other',name:'Второй персонаж'}];
game.combat={id:'combat',round:1,started:true,combatants,turns:combatants,turn:0,combatant:combatants[0]};game.combats=new Map([['combat',game.combat]]);
window.canvas={tokens:{controlled:[]}};
window.fromUuid=async uuid=>[actor,other].find(a=>a.uuid===uuid);
const equipment=await import('/qa/scripts/integration/equipment-api.js');
const slots=await import('/qa/scripts/quick-access.js');
const tooltips=await import('/qa/scripts/tooltips.js');tooltips.registerTooltipListeners();
const sheets=await import('/qa/scripts/equipment-sheet.js');Hooks.on('updateActor',sheets.refreshEquipmentSheets);
for(const pc of [actor,other]){const root=document.createElement('div');root.hidden=true;root.innerHTML='<div class="gear-tab"><section class="fblqa-panel"><div class="fblqa-slots"></div><input class="wallet-test" value="keep"></section></div>';document.body.append(root);pc.apps={test:{element:root}};pc.walletNode=root.querySelector('.wallet-test');}
equipment.registerEquipmentHooks();
const handlers=new Map();
const api={capabilities:{equipment:true,equipmentControls:true},equipmentApiVersion:1,getEquipmentState:equipment.getEquipmentState,performEquipmentAction:equipment.performEquipmentAction,previewEquipmentAction:equipment.previewEquipmentAction,getEquipmentReceipt:equipment.getEquipmentReceipt,getQuickAccessSlots:slots.getStoredSlots,registerSocketHandler:(key,fn)=>handlers.set(key,fn),getActiveGM:()=>authority,executeAsActiveGM:(key,payload)=>handlers.get(key)(payload,{requestUser:player})};
game.modules.set('fbl-quick-access',{active:true,api});
api.setupEquipmentItemTooltips=tooltips.setupEquipmentItemTooltips;
await import('/yze/scripts/main.js');Hooks.callAll('init');Hooks.callAll('ready');
window.harness={actor,other,module,stored,api};window.loaded=true;
`;
const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/yze/styles/action-widget.css"><link rel="stylesheet" href="/qa/styles/02-tooltips.css"><style>body{margin:0;background:#403d38;font-family:Arial}select option{background:#eee;color:inherit}</style><script type="module">${bootstrap}</script>`);return;}
  const root=url.pathname.startsWith('/qa/')?qa:yze;
  const file=resolve(root,url.pathname.replace(/^\/(qa|yze)\//,''));
  if(!file.startsWith(resolve(root)+sep)){res.statusCode=403;res.end();return;}
  try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8');res.end(readFileSync(file));}catch{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
try{
  const page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.loaded);
  const widget=page.locator('.yze-action-widget');await widget.waitFor({state:'visible'});
  assert.equal(await widget.evaluate(e=>Math.round(e.getBoundingClientRect().width)),268);
  assert.equal(await page.locator('[data-slot]').count(),8);
  assert.equal(await page.locator('.yze-equipment__slot').first().evaluate(e=>e.getBoundingClientRect().height),44);
  assert.equal(await page.locator('.yze-action-widget__reference').evaluate(e=>e.open),false);
  assert.equal(await page.locator('.yze-equipment__hands-head').count(),0);
  assert.equal(await page.locator('.yze-action-widget__handle [data-swap-hands]').count(),1);
  assert.equal(await page.locator('.yze-action-widget__handle [data-undo]').count(),1);
  await page.locator('[data-collapse]').click();
  await page.waitForFunction(()=>harness.stored.get('actionWidgetCollapsed')===true);
  assert.equal(await widget.evaluate(e=>Math.round(e.getBoundingClientRect().height)),29);
  assert.equal(await page.locator('.yze-action-widget__body').isVisible(),false);
  assert.equal(await page.locator('.yze-action-widget__actions').isVisible(),false);
  assert.equal(await page.locator('.yze-action-widget__name').textContent(),'Игрок');
  await page.reload();await page.waitForFunction(()=>window.loaded);
  assert.equal(await page.locator('[data-collapse]').getAttribute('aria-expanded'),'false');
  await page.evaluate(()=>{Hooks.callAll('updateCombat');Hooks.callAll('controlToken');});
  await page.waitForTimeout(50);
  assert.equal(await page.locator('.yze-action-widget__body').isVisible(),false);
  if(process.env.SCREENSHOT_DIR)await widget.screenshot({path:resolve(process.env.SCREENSHOT_DIR,'equipment-collapsed.png')});
  // Toolbar clicks must not capture a drag or write the widget position.
  const position=await page.evaluate(()=>harness.stored.get('actionWidgetPosition'));
  await page.locator('[data-collapse]').click();
  assert.deepEqual(await page.evaluate(()=>harness.stored.get('actionWidgetPosition')),position);
  if(process.env.SCREENSHOT_DIR){mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await widget.screenshot({path:resolve(process.env.SCREENSHOT_DIR,'equipment-desktop.png')});}
  await page.locator('[data-slot="0"]').hover();await page.locator('#fblqa-item-tooltip.is-visible').waitFor();
  assert.ok((await page.locator('#fblqa-item-tooltip').textContent()).includes('Меч'));
  assert.equal(await page.locator('[data-slot="0"] [tabindex]').count(),0);
  await page.mouse.move(0,0);
  await page.locator('[data-action="fastAction"]').click();
  await page.waitForFunction(()=>harness.actor.statuses.has('fastAction'));
  await page.locator('[data-action="fastAction"]').click();await page.waitForFunction(()=>!harness.actor.statuses.has('fastAction'));
  await page.locator('[data-slot="0"]').click();await page.locator('[data-open-item]').click();
  assert.equal(await page.evaluate(()=>window.openedItem),'sword');
  await page.locator('[data-grip="both"]').click();
  assert.deepEqual(await page.locator('[data-cost] option[value="free"]').evaluate(e=>({color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor})),{color:'rgb(240, 240, 224)',background:'rgb(41, 37, 31)'});
  assert.equal(await page.locator('[data-apply]').isDisabled(),true);
  assert.deepEqual(await page.evaluate(()=>harness.api.getEquipmentState(harness.actor).hands),{left:null,right:null});
  await page.locator('[data-cost]').selectOption('fast');await page.locator('[data-apply]').click();
  await page.waitForFunction(()=>harness.actor.getFlag('', 'equipmentOperation')?.phase==='complete');
  assert.deepEqual(await page.evaluate(()=>harness.api.getEquipmentState(harness.actor).hands),{left:'sword',right:'sword'});
  assert.equal(await page.locator('.yze-equipment__hand.is-both').count(),1);
  assert.deepEqual(await page.evaluate(()=>({grip:harness.actor.apps.test.element.querySelector('.fblqa-grip-label')?.textContent,wallet:harness.actor.apps.test.element.querySelector('.wallet-test')===harness.actor.walletNode})),{grip:'2Р',wallet:true});
  const translated=await page.evaluate(async()=>{
    const original=game.i18n, english=await fetch('/qa/lang/en.json').then(r=>r.json());
    const value=key=>key.split('.').reduce((object,part)=>object?.[part],english);
    game.i18n={has:key=>value(key)!==undefined,localize:key=>value(key)??key,format:key=>value(key)??key};
    const changes={'flags.fbl-quick-access.equipmentHands':harness.api.getEquipmentState(harness.actor).hands};
    Hooks.callAll('updateActor',harness.actor,changes,{render:false});
    const badge=harness.actor.apps.test.element.querySelector('.fblqa-grip-label');
    const result={text:badge.textContent,title:badge.title};game.i18n=original;
    Hooks.callAll('updateActor',harness.actor,changes,{render:false});return result;
  });
  assert.deepEqual(translated,{text:'2H',title:'Both hands'});
  assert.equal(await page.locator('[data-cost]').inputValue(),'');
  assert.equal(await page.locator('[data-cost] option[value="fast"]').isDisabled(),true);
  assert.equal(await page.locator('.yze-equipment__message').textContent(),'');
  assert.equal(await page.locator('[data-swap-hands]').isDisabled(),true);
  await page.locator('[data-undo]').click();await page.waitForFunction(()=>harness.actor.getFlag('', 'equipmentOperation')?.phase==='undone');
  assert.equal(await page.evaluate(()=>harness.actor.statuses.size),0);
  // Both-cost failure after the first native effect: visible recovery, one grip write.
  await page.locator('[data-slot="1"]').click();await page.locator('[data-grip="left"]').click();await page.locator('[data-cost]').selectOption('both');
  await page.evaluate(()=>harness.actor.failFee='slowAction');await page.locator('[data-apply]').click();
  await page.locator('[data-resume]').waitFor();
  await page.locator('[data-collapse]').click();
  assert.equal(await page.locator('[data-collapse]').getAttribute('aria-expanded'),'false');
  assert.ok((await page.locator('[data-collapse]').getAttribute('aria-label')).includes('незавершённая операция'));
  assert.equal(await page.locator('[data-swap-hands]').isDisabled(),true);
  assert.equal(await page.locator('[data-undo]').isVisible(),false);
  await page.locator('[data-collapse]').click();
  if(process.env.SCREENSHOT_DIR)await widget.screenshot({path:resolve(process.env.SCREENSHOT_DIR,'equipment-recovery.png')});
  assert.equal(await page.evaluate(()=>harness.actor.effects.length),1);
  await page.evaluate(()=>harness.actor.failFee=null);await page.locator('[data-resume]').click();
  await page.waitForFunction(()=>harness.actor.getFlag('', 'equipmentOperation')?.phase==='complete');
  assert.equal(await page.evaluate(()=>harness.actor.effects.length),2);
  await page.locator('[data-undo]').click();await page.waitForFunction(()=>harness.actor.getFlag('', 'equipmentOperation')?.phase==='undone');
  // Setup is free, clearing a held slot leaves the grip available for changes.
  await page.locator('[data-slot="0"]').click();await page.locator('[data-grip="left"]').click();await page.locator('[data-cost]').selectOption('free');await page.locator('[data-apply]').click();
  await page.waitForFunction(()=>harness.actor.getFlag('', 'equipmentOperation')?.phase==='complete');
  await page.locator('.yze-equipment__settings summary').click();await page.locator('[data-clear-slot]').click();
  await page.waitForFunction(()=>harness.api.getQuickAccessSlots(harness.actor)[0]===null);
  assert.equal(await page.evaluate(()=>harness.api.getEquipmentState(harness.actor).hands.left),'sword');
  await page.locator('[data-select-item="sword"]').click();await page.locator('[data-grip="both"]').click();await page.locator('[data-cost]').selectOption('free');await page.locator('[data-apply]').click();
  await page.waitForFunction(()=>harness.api.getEquipmentState(harness.actor).hands.right==='sword');
  await page.locator('[data-slot="0"]').click();await page.locator('.yze-equipment__settings summary').click();
  await page.locator('[data-assign-item]').selectOption('sword');await page.locator('[data-assign]').click();
  await page.waitForFunction(()=>harness.api.getQuickAccessSlots(harness.actor)[0]==='sword');
  await page.locator('.yze-equipment__settings summary').click();await page.locator('[data-move-to]').selectOption('1');await page.locator('[data-move]').click();
  await page.waitForFunction(()=>harness.api.getQuickAccessSlots(harness.actor)[1]==='sword');
  assert.equal(await page.evaluate(()=>harness.actor.statuses.size),0);
  // Menu is discarded when the selected Actor changes; a captured old revision fails.
  await page.locator('[data-slot="1"]').click();await page.locator('[data-grip="right"]').click();await page.locator('[data-cost]').selectOption('free');
  const oldRevision=await page.evaluate(()=>harness.module.api.quickAccess.getState().revision);
  await page.evaluate(()=>{canvas.tokens.controlled=[{id:'other',actor:harness.other}];Hooks.callAll('controlToken');});
  await page.waitForFunction(()=>document.querySelector('.yze-action-widget__name').textContent==='Второй персонаж');
  assert.equal(await page.locator('[data-apply]').count(),0);
  assert.equal(await page.evaluate(async revision=>{try{await harness.module.api.quickAccess.performAction({type:'swapHands'},{expectedRevision:revision});return false;}catch{return true;}},oldRevision),true);
  await page.evaluate(()=>{harness.other.system.attribute.agility.max=2;Hooks.callAll('updateActor',harness.other,{},{});});
  await page.waitForFunction(()=>document.querySelectorAll('.is-overflow').length===6);
  assert.equal(await page.locator('.is-overflow').count(),6);
  await page.locator('[data-slot="3"]').click();assert.equal(await page.locator('[data-grip="left"]').isDisabled(),true);
  await page.locator('.yze-action-widget__reference summary').click();
  const articles=await page.locator('.yze-action-widget__reference article').allTextContents();
  assert.equal(articles.length,6);assert.ok(articles[0].includes('0–2 м'));assert.ok(articles[1].includes('2–6 м'));
  assert.ok(articles[0].includes('−3, если противник в сознании'));assert.ok(articles[4].includes('Автоматически'));assert.ok(articles[5].includes('1 маневр = 10 м. 1 клетка = 2 м.'));
  // Collapse persistence and narrow viewport: the outer body scrolls, hands stay at top.
  await page.locator('.yze-equipment__slots > summary').click();await page.waitForFunction(()=>harness.stored.get('equipmentOpen')===false);
  await page.reload();await page.waitForFunction(()=>window.loaded);
  assert.equal(await page.locator('.yze-equipment__slots').evaluate(e=>e.open),false);
  await page.setViewportSize({width:320,height:480});await page.locator('.yze-equipment__slots > summary').click();
  await page.locator('[data-slot="0"]').click();await page.locator('[data-grip="both"]').click();
  await page.waitForFunction(()=>{const r=document.querySelector('.yze-action-widget').getBoundingClientRect();return r.left>=7&&r.top>=7&&r.right<=innerWidth-7&&r.bottom<=innerHeight-7;});
  const bounds=await page.locator('.yze-action-widget__body').evaluate(e=>({width:e.clientWidth,scrollWidth:e.scrollWidth,scroll:e.scrollHeight,height:e.clientHeight}));
  assert.ok(bounds.scroll>bounds.height);assert.equal(bounds.width,bounds.scrollWidth);
  await page.locator('[data-apply]').scrollIntoViewIfNeeded();assert.equal(await page.locator('[data-apply]').isVisible(),true);
  if(process.env.SCREENSHOT_DIR)await page.screenshot({path:resolve(process.env.SCREENSHOT_DIR,'equipment-narrow.png')});
  // Removing QA while a paid operation is pending retains native actions.
  await page.locator('[data-cost]').selectOption('both');
  await page.evaluate(()=>harness.actor.failFee='slowAction');await page.locator('[data-apply]').click();
  await page.locator('[data-resume]').waitFor();
  await page.evaluate(()=>{game.modules.get('fbl-quick-access').active=false;harness.actor.failFee=null;harness.module.api.refreshActionWidget();});
  await page.locator('.yze-equipment').waitFor({state:'hidden'});
  await page.locator('[data-action="slowAction"]').click();await page.waitForFunction(()=>harness.actor.statuses.has('slowAction'));
  await page.evaluate(()=>{game.modules.get('fbl-quick-access').active=true;harness.actor.failFee=null;harness.module.api.refreshActionWidget();});
  await page.locator('[data-cancel]').click();await page.waitForFunction(()=>harness.actor.getFlag('', 'equipmentOperation')?.phase==='undone');
  assert.deepEqual(await page.evaluate(()=>[...harness.actor.statuses]),['slowAction']);
  await page.evaluate(()=>{game.modules.get('fbl-quick-access').active=true;game.combat.started=false;game.user.character=harness.actor;harness.module.api.refreshActionWidget();});
  await page.locator('.yze-action-widget__actions').waitFor({state:'hidden'});
  await page.locator('[data-slot="2"]').click();await page.locator('[data-grip="right"]').click();
  assert.equal(await page.locator('[data-cost]').count(),0);await page.locator('[data-apply]').click();
  await page.waitForFunction(()=>harness.api.getEquipmentState(harness.actor).hands.right==='torch');
  await page.locator('[data-collapse]').click();
  await page.locator('[data-swap-hands]').click();
  assert.equal(await page.locator('[data-collapse]').getAttribute('aria-expanded'),'true');
  assert.equal(await page.locator('[data-apply]').isVisible(),true);
  const handsBeforeSwap=await page.evaluate(()=>harness.api.getEquipmentState(harness.actor).hands);
  await page.locator('[data-apply]').click();
  await page.waitForFunction(previous=>harness.api.getEquipmentState(harness.actor).hands.left===previous.right,handsBeforeSwap);
  await page.locator('[data-collapse]').click();await page.locator('[data-undo]').click();
  await page.waitForFunction(()=>harness.actor.getFlag('', 'equipmentOperation')?.phase==='undone');
  assert.deepEqual(await page.evaluate(()=>harness.api.getEquipmentState(harness.actor).hands),handsBeforeSwap);
  assert.equal(await page.locator('.yze-equipment__message').textContent(),'');
  await page.evaluate(()=>{game.user.isGM=true;harness.module.api.refreshActionWidget();});await widget.waitFor({state:'detached'});
  assert.deepEqual(errors,[]);
  const touch=await browser.newPage({viewport:{width:320,height:480},hasTouch:true,isMobile:true});
  await touch.goto('http://127.0.0.1:'+server.address().port);await touch.waitForFunction(()=>window.loaded);
  assert.equal(await touch.locator('.yze-action-widget__action').first().evaluate(e=>e.getBoundingClientRect().height),44);
  assert.equal(await touch.locator('[data-collapse]').evaluate(e=>e.getBoundingClientRect().height),44);
  await touch.locator('[data-slot="0"]').click();
  assert.equal(await touch.locator('[data-grip="left"]').evaluate(e=>e.getBoundingClientRect().height),44);
  if(process.env.SCREENSHOT_DIR)await touch.screenshot({path:resolve(process.env.SCREENSHOT_DIR,'equipment-touch.png')});
  console.log('Browser integration PASS: compact layout, hands/grips, explicit costs, native effects, partial recovery, undo, slot setup, Actor guards, overflow, memo/persistence, narrow/touch, optional QA, outside combat.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
