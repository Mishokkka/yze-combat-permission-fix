import { createServer } from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import assert from "node:assert/strict";
import { assertReadable, assertTheme } from "./browser-style-utils.mjs";

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const qa = process.env.QA_SOURCE;
if (!qa) throw new Error("Set QA_SOURCE to the matching Quick Access source checkout.");
const root = fileURLToPath(new URL("..", import.meta.url));
const styles = JSON.parse(readFileSync(resolve(root, "module.json"), "utf8")).styles.map(path => `<link rel="stylesheet" href="/yze/${path}">`).join("");
const bootstrap = `
const hooks = new Map(), registrations = new Map(); let sequence = 0;
window.Hooks = {
  on(name, fn) { const id = ++sequence; const list = hooks.get(name) ?? new Map(); list.set(id, fn); hooks.set(name, list); return id; },
  once(name, fn) { const id = this.on(name, (...args) => {this.off(name, id); return fn(...args);}); return id; },
  off(name, id) {hooks.get(name)?.delete(id);},
  callAll(name, ...args) {for (const fn of [...(hooks.get(name)?.values() ?? [])]) fn(...args);}
};
class CoreTracker {_onRender(){}}
class YzeTracker extends CoreTracker {_onRender(){} async _preparePartContext(_part, context){return context;}}
class Combat {async nextRound(){}}
window.CONFIG = {Combat: {documentClass: Combat}, ui: {combat: YzeTracker}, statusEffects: [{id:'fastAction'},{id:'slowAction'}], fbl:{}};
window.CONST = {DOCUMENT_OWNERSHIP_LEVELS: {OWNER:3, OBSERVER:2}};
window.foundry = {utils: {randomID: () => 'id' + (++sequence)}};
window.ui = {notifications: {warn: console.warn, error: console.error}};
const saved = new Map(JSON.parse(localStorage.getItem('gm-settings') || '[]'));
const gm = {id:'gm',name:'GM',isGM:true,active:true}, module = {active:true, version:'1.8.0'};
window.game = {user:gm, users:[gm], system:{id:'forbidden-lands',version:'13.0.5'}, modules:new Map([['yze-combat-permission-fix',module],['yze-combat',{active:true,version:'1.6.1'}]]), socket:{on(){}}, i18n:{localize:key=>key,format:key=>key}, settings:{
  register(module, key, options) {registrations.set(key, options); if(!saved.has(key)) saved.set(key, options.default);},
  get(module,key) {return module === 'yze-combat' ? window.tracking !== false : saved.get(key);},
  async set(module,key,value) {saved.set(key,value);localStorage.setItem('gm-settings',JSON.stringify([...saved]));registrations.get(key)?.onChange?.(value);return value;}
}};
function makeActor(id, name, owner, uuid='Actor.'+id) {
  const flags = {equipmentHands:{left:null,right:null}};
  const actor = {id,uuid,name,documentName:'Actor',type:'character',isOwner:true,canAct:true,system:{attribute:{agility:{max:4}}},effects:[],statuses:new Set(),items:new Map(),flags,
    getFlag:(_module,key)=>flags[key],testUserPermission:user=>user.isGM || user.id===owner,sheet:{render:()=>{window.openedActor=uuid;}},
    update(){throw new Error('Summary must not write Actors');},setFlag(){throw new Error('Summary must not write flags');}};
  return actor;
}
function item(actor,id,name,type='weapon') {const value={id,uuid:actor.uuid+'.Item.'+id,name,type,system:{weight:'normal',damage:1},parent:actor,sheet:{render:()=>{window.openedItem=actor.uuid+'.Item.'+id;}}}; actor.items.set(id,value);return value;}
const base=makeActor('eira','Эйра','alice'), eira=makeActor('eira','Эйра','alice','Scene.scene.Token.eira.Actor.eira');
const bran=makeActor('bran','Бран','bob'), mira=makeActor('mira','Мира','carol');
item(eira,'shield','Щит');item(eira,'sword','Меч');const gun=item(bran,'gun','Карабин');
eira.flags.equipmentHands={left:'shield',right:'sword'};bran.flags.equipmentHands={left:'gun',right:'gun'};
bran.flags.weaponReload={'gun:load':{version:1,current:2,target:4,unit:'steps',finished:false}};
bran.statuses.add('fastAction');mira.statuses=new Set(['fastAction','slowAction']);
const alice={id:'alice',name:'Аня',active:true,isGM:false,character:base},bob={id:'bob',name:'Борис',active:true,isGM:false,character:bran},carol={id:'carol',name:'Вера',active:true,isGM:false,character:mira};
game.users.push(alice,bob,carol);game.users.get=id=>game.users.find(user=>user.id===id);game.users.activeGM=gm;
const combatants=[{id:'eira',actor:eira,name:eira.name},{id:'bran',actor:bran,name:bran.name},{id:'mira',actor:mira,name:mira.name}];
game.combat={id:'combat',round:3,started:true,combatants,turns:combatants,combatant:combatants[0]};game.combats=new Map([['combat',game.combat]]);
window.canvas={tokens:{controlled:[]}};
const equipment=await import('/qa/scripts/integration/equipment-api.js');
const weapons=await import('/qa/scripts/integration/weapon-presentation.js');
const api={equipmentApiVersion:1,capabilities:{equipment:true,heldItemPresentation:true},getEquipmentState:equipment.getEquipmentState,performEquipmentAction(){throw new Error('Summary must not mutate hands');},getHeldItemPresentation:weapons.getHeldItemPresentation};
let magazine=0;
game.modules.set('fbl-quick-access',{active:true,api});
game.modules.set('fl-firearms',{active:true,api:{getFirearmTooltipData:item=>item.id==='gun'?{isFirearm:true,reloadType:'MAG',magCapacity:6,magCurrent:magazine,features:[]}:null,getMagazineProfile:()=>({current:magazine,capacity:6})}});
equipment.registerEquipmentHooks();
if(new URLSearchParams(location.search).has('player')) game.user=alice;
await import('/yze/scripts/main.js');Hooks.callAll('init');
const controls={tokens:{activeTool:'select',tools:{select:{order:0}}}};
Hooks.callAll('getSceneControlButtons',controls);Hooks.callAll('ready');
window.harness={base,eira,bran,mira,alice,bob,carol,combatants,controls,saved,module,api,registrations,hooks,setMagazine:value=>{magazine=value;Hooks.callAll('fl-firearms.magazineChanged',bran,gun);}};
window.loaded=true;
`;
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${process.env.FOUNDRY_CSS ? '<link rel="stylesheet" href="/foundry.css">' : ""}${styles}<style>body{margin:0;background:#403d38}</style><body class="game theme-dark"><script type="module">${bootstrap}</script>`);
    return;
  }
  if (path === "/foundry.css" && process.env.FOUNDRY_CSS) {res.setHeader("Content-Type", "text/css"); res.end(readFileSync(process.env.FOUNDRY_CSS)); return;}
  const directory = path.startsWith("/qa/") ? qa : root;
  const file = resolve(directory, path.replace(/^\/(qa|yze)\//, ""));
  if (!file.startsWith(resolve(directory) + sep)) {res.statusCode = 403; res.end(); return;}
  try {res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8"); res.end(readFileSync(file));}
  catch (_) {res.statusCode = 404; res.end();}
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {})});
  const page = await browser.newPage({viewport: {width: 1000, height: 700}}), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url); await page.waitForFunction(() => window.loaded);
  const summary = page.locator("#yze-combat-permission-fix-gm-summary");
  assert.equal(await summary.count(), 0, "Hidden by default");
  await page.evaluate(() => harness.controls.tokens.tools.yzeGMSummary.onChange());
  await summary.waitFor({state: "visible"});
  assert.equal(await summary.locator("tbody tr").count(), 3);
  assert.equal(await page.locator("#yze-combat-permission-fix-action-widget").count(), 0, "GM never gets player controls");
  const rows = summary.locator("tbody tr");
  assert.equal(await rows.nth(0).getAttribute("data-gm-row"), "Scene.scene.Token.eira.Actor.eira");
  assert.equal(await rows.nth(1).locator(".yze-gm__hand").count(), 1);
  assert.equal(await rows.nth(1).locator(".yze-gm__ammo").textContent(), "0/6");
  assert.match(await rows.nth(1).locator(".yze-gm__progress").textContent(), /2\/4/);
  await rows.nth(0).locator("[data-gm-actor]").click();
  await rows.nth(0).locator('[data-gm-item="sword"]').click();
  assert.equal(await page.evaluate(() => window.openedActor), "Scene.scene.Token.eira.Actor.eira");
  assert.equal(await page.evaluate(() => window.openedItem), "Scene.scene.Token.eira.Actor.eira.Item.sword");
  await page.evaluate(() => {harness.eira.statuses.add("fastAction");Hooks.callAll("createActiveEffect", {parent: harness.eira});});
  await page.waitForFunction(() => document.querySelector('[data-gm-row="Scene.scene.Token.eira.Actor.eira"] .yze-gm__action').classList.contains("is-spent"));
  await page.evaluate(() => {game.combat.combatant=harness.combatants[1];game.combat.round++;Hooks.callAll("updateCombat", game.combat);harness.setMagazine(4);});
  await page.waitForFunction(() => document.querySelector('.yze-gm__ammo').textContent === "4/6");
  assert.equal(await rows.nth(1).getAttribute("class"), "is-current");
  assert.equal(await rows.nth(0).getAttribute("data-gm-row"), "Scene.scene.Token.eira.Actor.eira");
  await page.evaluate(() => {harness.bran.flags.weaponReload['gun:load'].current=3;Hooks.callAll("updateActor",harness.bran);});
  await page.waitForFunction(() => document.querySelector('.yze-gm__progress').textContent.includes("3/4"));
  await page.evaluate(() => {harness.eira.flags.equipmentHands={left:null,right:null};Hooks.callAll("updateActor",harness.eira);});
  await page.waitForFunction(() => document.querySelector('[data-gm-row="Scene.scene.Token.eira.Actor.eira"]').textContent.includes("Руки свободны"));
  await page.evaluate(() => {harness.bob.active=false;Hooks.callAll("userConnected",harness.bob,false);});
  await page.waitForFunction(() => document.querySelectorAll('[data-gm-row]').length === 2);
  await page.evaluate(() => {harness.bob.active=true;Hooks.callAll("userConnected",harness.bob,true);});
  await page.waitForFunction(() => document.querySelectorAll('[data-gm-row]').length === 3);
  // Missing providers remain distinct from intentionally empty hands.
  await page.evaluate(() => {game.modules.get('fbl-quick-access').active=false;Hooks.callAll('fblQuickAccess.apiReady');});
  await page.waitForFunction(() => [...document.querySelectorAll('[data-gm-row]')].every(row => row.textContent.includes('Нет данных о руках')));
  assert.equal(await summary.locator('.yze-gm__action').count(),6);
  await page.evaluate(() => {game.modules.get('fbl-quick-access').active=true;Hooks.callAll('fblQuickAccess.apiReady');});
  await page.waitForFunction(() => !!document.querySelector('.yze-gm__ammo'));
  await page.evaluate(() => {window.tracking=false;Hooks.callAll('updateSetting');});
  await page.waitForFunction(() => document.querySelectorAll('.yze-gm__action').length === 0);
  await page.evaluate(() => {window.tracking=true;Hooks.callAll('updateSetting');});
  await page.waitForFunction(() => document.querySelectorAll('.yze-gm__action').length === 6);
  const header = summary.locator('.yze-gm__header'), before = await summary.boundingBox(), handle = await header.boundingBox();
  await page.mouse.move(handle.x+50,handle.y+12);await page.mouse.down();await page.mouse.move(handle.x+140,handle.y+67);await page.mouse.up();
  await page.waitForFunction(() => Number.isFinite(harness.saved.get('gmSummaryPosition')?.left));
  const position = await page.evaluate(() => harness.saved.get('gmSummaryPosition'));
  assert.ok(position.left > before.x+70);
  await summary.locator('[data-gm-collapse]').click();
  await page.waitForFunction(() => harness.saved.get('gmSummaryCollapsed')===true);
  await summary.locator('.yze-gm__body').waitFor({state:'hidden'});
  assert.equal(await summary.locator('.yze-gm__body').isVisible(),false);
  assert.deepEqual(await page.evaluate(() => harness.saved.get('gmSummaryPosition')),position,"Header buttons do not start dragging");
  await page.reload();await page.waitForFunction(() => window.loaded);await summary.waitFor({state:'visible'});
  assert.equal(await summary.locator('[data-gm-collapse]').getAttribute('aria-expanded'),'false');
  assert.equal(Math.round((await summary.boundingBox()).x),Math.round(position.left));
  await summary.locator('[data-gm-collapse]').click();
  await summary.locator('[data-gm-hide]').click();await summary.waitFor({state:'hidden'});
  await page.reload();await page.waitForFunction(() => window.loaded);
  assert.equal(await summary.count(),0);
  await page.evaluate(() => harness.controls.tokens.tools.yzeGMSummary.onChange());await summary.waitFor({state:'visible'});
  for (const theme of ['light','dark']) {
    await assertTheme(page,'#yze-combat-permission-fix-gm-summary',theme);
    for (const selector of ['.yze-gm__link','.yze-gm__action','.yze-gm__progress','.yze-gm__muted','.yze-gm__ammo','th']) await assertReadable(page,'#yze-combat-permission-fix-gm-summary '+selector);
  }
  if (process.env.SCREENSHOT_DIR) {mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await summary.screenshot({path:resolve(process.env.SCREENSHOT_DIR,'gm-summary-desktop.png')});}
  // Item/character text is escaped and long names fit inside the narrow table.
  await page.evaluate(() => {harness.bran.items.get('gun').name='<img src=x onerror="window.injected=true">';Hooks.callAll('updateItem',harness.bran.items.get('gun'));});
  await page.waitForFunction(() => document.querySelector('[data-gm-item="gun"]').textContent.startsWith('<img'));
  assert.equal(await summary.locator('img').count(),0);
  for (const width of [360,320]) {
    await page.setViewportSize({width,height:480});
    assert.ok(await summary.evaluate(element => {const rect=element.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight&&element.scrollWidth<=element.clientWidth;}));
    assert.equal(await summary.locator('td').evaluateAll(cells=>cells.filter(cell=>cell.scrollWidth>cell.clientWidth).length),0);
  }
  await page.evaluate(() => {harness.bran.items.get('gun').name='Карабин';Hooks.callAll('updateItem',harness.bran.items.get('gun'));});
  await page.waitForFunction(() => document.querySelector('[data-gm-item="gun"]').textContent==='Карабин');
  if (process.env.SCREENSHOT_DIR) await summary.screenshot({path:resolve(process.env.SCREENSHOT_DIR,'gm-summary-narrow.png')});
  await page.evaluate(() => {game.combat=null;Hooks.callAll('deleteCombat');});
  await page.waitForFunction(() => document.querySelector('[data-gm-row="Actor.eira"]'));
  assert.equal(await summary.locator('.yze-gm__action').count(),0);
  await page.evaluate(() => {for(const user of game.users)if(!user.isGM)user.active=false;Hooks.callAll('userConnected');});
  await page.waitForFunction(() => document.querySelector('.yze-gm__empty'));
  assert.match(await summary.textContent(),/Нет подключённых игроков/);
  await page.evaluate(() => harness.module.api.gmSummary.destroy());
  assert.equal(await summary.count(),0);
  await page.evaluate(() => Hooks.callAll('userConnected'));assert.equal(await summary.count(),0);
  const touch = await browser.newPage({viewport:{width:320,height:500},hasTouch:true,isMobile:true});
  touch.on('pageerror',error=>errors.push(error.message));
  await touch.goto(url);await touch.waitForFunction(() => window.loaded);
  await touch.evaluate(() => harness.controls.tokens.tools.yzeGMSummary.onChange());
  const touchSummary=touch.locator('#yze-combat-permission-fix-gm-summary');await touchSummary.waitFor({state:'visible'});
  assert.ok(await touchSummary.locator('[data-gm-collapse]').evaluate(element=>element.getBoundingClientRect().height>=44));
  assert.ok(await touchSummary.evaluate(element=>element.getBoundingClientRect().right<=innerWidth&&element.scrollWidth<=element.clientWidth));
  if(process.env.SCREENSHOT_DIR)await touchSummary.screenshot({path:resolve(process.env.SCREENSHOT_DIR,'gm-summary-touch.png')});
  const player = await browser.newPage();player.on('pageerror',error=>errors.push(error.message));
  await player.goto(url+'?player');await player.waitForFunction(() => window.loaded);
  assert.equal(await player.evaluate(() => harness.module.api.gmSummary),null);
  assert.equal(await player.evaluate(() => !!harness.controls.tokens.tools.yzeGMSummary),false);
  assert.equal(await player.locator('#yze-combat-permission-fix-gm-summary').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: real QA read API, token identity, live membership/effects/hands/ammo/progress, sheets, read-only controls, drag/collapse/hide persistence, optional providers, escaping, Foundry themes, narrow layout and GM-only lifecycle.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
