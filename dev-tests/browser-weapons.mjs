import {createServer} from "node:http";
import {readFileSync, mkdirSync} from "node:fs";
import {resolve, sep} from "node:path";
import assert from "node:assert/strict";
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const qa = process.env.QA_SOURCE;
if (!qa || !process.env.FBL_SOURCE) throw new Error("Set QA_SOURCE and FBL_SOURCE (local Forbidden Lands 13.0.5 bundle).");
const yze = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const core = readFileSync(process.env.FBL_SOURCE, "utf8");
const start = core.indexOf("var FBLRollHandler=class"), end = core.indexOf(";init_define_GLOBALPATHS();", start);
if (start < 0 || end < 0) throw new Error("Unsupported FBL bundle layout");
const gearBody = core.match(/rollGear\(itemId\)\{([\s\S]*?)\}rollSkill/)[1];
const nativeModule = `${core.slice(start, end)}; export {FBLRollHandler,FBLRoll}; export function attach(sheet) {sheet.rollGear=function(itemId){${gearBody}};}`;
const legacy = readFileSync(new URL("browser-equipment.mjs", import.meta.url), "utf8");
const marker = "const bootstrap = `", bootstrapStart = legacy.indexOf(marker) + marker.length;
let bootstrap = legacy.slice(bootstrapStart, legacy.indexOf("\n`;", bootstrapStart));
const extension = `
Hooks.on=(name,callback)=>{const list=callbacks.get(name)||[];list.push(callback);callbacks.set(name,list);return callback;};
Hooks.off=(name,callback)=>callbacks.set(name,(callbacks.get(name)||[]).filter(value=>value!==callback));
game.system.version='13.0.5';module.version='1.6.0';
game.users.get=id=>game.users.find(user=>user.id===id);
const presentation=await import('/qa/scripts/integration/weapon-presentation.js');api.getHeldItemPresentation=presentation.getHeldItemPresentation;api.capabilities.heldItemPresentation=true;
const firearm={current:0,capacity:6,loads:0,topOffs:0,shots:0,reloadType:'MAG',reloadValue:'',topOffCost:''};
const gun={id:'gun',uuid:actor.uuid+'.Item.gun',name:'Длинный револьвер',img:actor.items.get('sword').img,type:'weapon',parent:actor,actor,system:{weight:'normal',category:'ranged',bonus:{value:2,max:2},damage:2,range:'near',grip:'1h',features:{}}};
actor.items.set('gun',gun);
for(const pc of [actor,other]){pc.canAct=true;for(const item of pc.items.values()){item.parent=pc;item.actor=pc;item.system.bonus??={value:2};item.system.damage??=2;item.system.range??='arm';item.system.features??={edged:true,pointed:true,parrying:true};item.getRollData=()=>({isBroken:false,artifactDie:''});}}
game.modules.set('fl-firearms',{active:true,version:'0.4.7',api:{
  getFirearmTooltipData:item=>item.id==='gun'?{isFirearm:true,firearmType:'regular',reloadType:firearm.reloadType,reloadValue:firearm.reloadValue,magCapacity:6,magCurrent:firearm.current,apOp:'*',apValue:0.5,features:[{key:'Reliable',label:'Надежное',automated:true},{key:'TopOff',label:'Дозарядка',automated:true,hasInput:true,value:firearm.topOffCost},{key:'Rapid',label:'Скорострельное',hasInput:true,value:2,automated:false}]}:null,
  getMagazineProfile:()=>({current:firearm.current,capacity:6}),
  async loadMagazine(){const oldAmmo=firearm.current;firearm.loads++;firearm.current=6;Hooks.callAll('updateItem',gun);return {oldAmmo,newAmmo:6};},
  async topOffMagazine(){const oldAmmo=firearm.current;firearm.topOffs++;firearm.current++;Hooks.callAll('updateItem',gun);return {oldAmmo,newAmmo:firearm.current};},
}});
await actor.update({'flags.fbl-quick-access.equipmentHands':{left:'sword',right:'gun'}});
game.messages=new Map();game.actors=new Map([[actor.id,actor],[other.id,other]]);
window.localizeString=value=>value;
window.YearZeroRoll=class {};
window.YearZeroRollManager={};
window.FormApplication=class {
  constructor(_data,options){this.options=options;this.title=options.title;}
  render(){window.nativeApp=this;const root=document.createElement('section');root.id='native-dialog';root.innerHTML='<strong>Штатный диалог FBL</strong><button data-native-roll>Бросить</button><button data-native-cancel>Отмена</button>';document.body.append(root);root.querySelector('[data-native-roll]').onclick=()=>this._handleYZRoll({base:3,skill:2,gear:2,artifact:'',modifier:0});root.querySelector('[data-native-cancel]').onclick=()=>this.close();Hooks.callAll('renderApplication',this);return this;}
  async close(){document.getElementById('native-dialog')?.remove();Hooks.callAll('closeApplication',this);}
};
const native=await import('/native.js');native.attach(actor.sheet??={});
actor.sheet.actor=actor;
actor.sheet.rollAction=()=>{};
actor.sheet.getGear=itemId=>({attribute:{name:'agility',value:3,label:'Agility'},skill:{name:'marksmanship',value:2,label:'Marksmanship'},gear:{...actor.items.get(itemId).system,name:actor.items.get(itemId).name,itemId,value:2,artifactDie:''}});
actor.sheet.getRollOptions=()=>({actorId:actor.id,actorType:'character',type:'skill'});
actor.sheet.getGears=()=>[];
native.FBLRoll.forge=(_terms,_data,options)=>{const roll={dice:[{}],type:'skill',options,pushed:false,async roll(){if(options.isAttack&&options.itemId==='gun'){firearm.shots++;firearm.current--;Hooks.callAll('updateItem',gun);}return this;},async toMessage(){const message={id:'roll'+(++sequence),author:player,rolls:[this]};game.messages.set(message.id,message);Hooks.callAll('createChatMessage',message,{},player.id);return message;}};return roll;};
window.weaponHarness={actor,other,firearm,api,stored,async requirement(type,value,topOff=''){await actor.update({'flags.yze-combat-permission-fix.==weaponReload':{}});firearm.reloadType=type;firearm.reloadValue=value;firearm.topOffCost=topOff;Hooks.callAll('updateItem',gun);},round(){actor.effects=[];actor.refreshStatuses();game.combat.round++;Hooks.callAll('updateCombat',game.combat);},ammo(value){firearm.current=value;Hooks.callAll('updateItem',gun);}};
`;
bootstrap = bootstrap.replace("await import('/yze/scripts/main.js');Hooks.callAll('init');Hooks.callAll('ready');", `${extension}\nawait import('/yze/scripts/main.js');Hooks.callAll('init');Hooks.callAll('ready');`);
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/") {res.setHeader("Content-Type", "text/html; charset=utf-8");res.end(`<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/yze/styles/action-widget.css"><link rel="stylesheet" href="/yze/styles/weapon-ribbon.css"><style>body{margin:0;background:#403d38;font-family:Arial}#native-dialog{position:fixed;top:20px;left:20px;background:#eee;color:#222;padding:15px;z-index:1000}#native-dialog button{margin:4px}</style><script type="module">${bootstrap}</script>`);return;}
  if (path === "/native.js") {res.setHeader("Content-Type", "text/javascript");res.end(nativeModule);return;}
  const root = path.startsWith("/qa/") ? qa : yze, file = resolve(root, path.replace(/^\/(qa|yze)\//, ""));
  if (!file.startsWith(resolve(root) + sep)) {res.statusCode=403;res.end();return;}
  try {res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".json") ? "application/json" : "text/css");res.end(readFileSync(file));}
  catch {res.statusCode=404;res.end();}
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const screenshot=process.env.SCREENSHOT_DIR;
if (screenshot) mkdirSync(screenshot,{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:1100,height:800}}), errors=[];
  page.on("pageerror", error=>{errors.push(error.message); console.error("Browser:",error.message);});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.loaded);
  const ribbon=page.locator("#yze-combat-permission-fix-weapon-ribbon");
  await ribbon.waitFor(); assert.equal(await page.locator("[data-weapon-row]").count(),2);
  assert.equal(await page.locator(".yze-equipment__hand").count(),0);
  assert.ok((await ribbon.textContent()).includes("Патроны"));
  await page.locator('[data-weapon-action="load"]').click();
  await page.locator('[data-weapon-input="target"]').fill("2");
  assert.equal(await page.locator("[data-weapon-execute]").isDisabled(),true);
  await page.locator("[data-weapon-cost]").selectOption("slow");await page.locator("[data-weapon-execute]").click();
  await page.waitForFunction(()=>weaponHarness.actor.getFlag('', 'weaponReload')?.['gun:load']?.current===1);
  assert.equal(await page.evaluate(()=>weaponHarness.firearm.loads),0);
  assert.ok((await page.locator(".yze-weapon__progress").textContent()).includes("1/2"));
  await page.evaluate(()=>weaponHarness.round());
  await page.locator('[data-weapon-action="load"]').click();
  await page.locator("[data-weapon-cost]").selectOption("fast");await page.locator("[data-weapon-execute]").click();
  await page.waitForFunction(()=>weaponHarness.firearm.loads===1);
  await page.waitForFunction(()=>weaponHarness.actor.getFlag('', 'weaponOperation')?.phase==='complete');
  assert.ok((await ribbon.textContent()).includes("6/6"));
  await page.evaluate(()=>{weaponHarness.round();weaponHarness.ammo(2);});
  await page.locator('[data-weapon-action="topOff"]').click();
  await page.locator("[data-weapon-cost]").selectOption("free");await page.locator("[data-weapon-execute]").click();
  await page.waitForFunction(()=>weaponHarness.firearm.topOffs===1);
  assert.equal(await page.evaluate(()=>weaponHarness.firearm.current),3);
  // Manual progress and target: no API loading and no action effect.
  await page.locator('[data-weapon-action="load"]').click();
  await page.locator('[data-weapon-input="target"]').fill("4");await page.locator('[data-weapon-input="current"]').fill("2");
  await page.locator("[data-weapon-save-progress]").click();
  await page.waitForFunction(()=>weaponHarness.actor.getFlag('', 'weaponReload')?.['gun:load']?.target===4);
  assert.equal(await page.evaluate(()=>weaponHarness.actor.statuses.size),0);
  assert.equal(await page.evaluate(()=>weaponHarness.firearm.loads),1);
  // A draft is bound to the displayed mechanical snapshot, not silently refreshed.
  await page.locator('[data-weapon-action="load"]').click();
  await page.evaluate(()=>weaponHarness.ammo(4));
  await page.waitForFunction(()=>!document.querySelector('[data-weapon-execute]'));
  assert.ok((await ribbon.textContent()).includes('Выберите действие заново'));
  await page.locator('[data-weapon-action="attack"][data-weapon-id="gun"]').click();
  await page.locator("[data-weapon-cost]").selectOption("slow");await page.locator("[data-weapon-execute]").click();
  await page.locator("#native-dialog").waitFor();
  assert.equal(await page.evaluate(()=>weaponHarness.actor.statuses.size),0);
  await page.locator("[data-native-cancel]").click();
  await page.waitForFunction(()=>weaponHarness.actor.getFlag('', 'weaponOperation')?.phase==='cancelled');
  assert.equal(await page.evaluate(()=>weaponHarness.firearm.shots),0);
  await page.locator('[data-weapon-action="attack"][data-weapon-id="gun"]').click();
  await page.locator("[data-weapon-cost]").selectOption("slow");await page.locator("[data-weapon-execute]").click();
  await page.locator("[data-native-roll]").click();
  await page.waitForFunction(()=>weaponHarness.actor.getFlag('', 'weaponOperation')?.phase==='complete');
  assert.equal(await page.evaluate(()=>weaponHarness.firearm.shots),1);
  assert.equal(await page.evaluate(()=>weaponHarness.actor.effects.length),1);
  assert.equal(await page.evaluate(()=>[...game.messages.values()][0].rolls[0].options.yzeWidgetAttack.actorUuid),'Actor.pc');
  await page.evaluate(()=>document.getElementById('native-dialog')?.remove());
  // Read 2F from TopOff: slow substitutes for fast, each paid step is explicit.
  await page.evaluate(async()=>{weaponHarness.round();await weaponHarness.requirement('MAG','','2F');});
  await page.locator('[data-weapon-action="topOff"]').click();
  assert.equal(await page.locator('[data-weapon-calculation]').inputValue(),'auto');
  assert.equal(await page.locator('[data-weapon-unit]').inputValue(),'fast');
  await page.locator('[data-weapon-cost]').selectOption('slow');
  assert.equal(await page.locator('[data-weapon-input="amount"]').inputValue(),'1');
  await page.locator('[data-weapon-execute]').click();
  await page.waitForFunction(()=>weaponHarness.actor.getFlag('', 'weaponReload')?.['gun:topOff']?.current===1);
  assert.equal(await page.evaluate(()=>weaponHarness.firearm.topOffs),1);
  await page.evaluate(()=>weaponHarness.round());
  await page.locator('[data-weapon-action="topOff"]').click();
  await page.locator('[data-weapon-cost]').selectOption('fast');await page.locator('[data-weapon-execute]').click();
  await page.waitForFunction(()=>weaponHarness.firearm.topOffs===2);
  // Seconds are full F+S pairs, never an invented half-step.
  await page.evaluate(async()=>{weaponHarness.round();await weaponHarness.requirement('S','20');});
  await page.locator('[data-weapon-action="load"]').click();
  assert.equal(await page.locator('[data-weapon-unit]').inputValue(),'seconds');
  assert.equal(await page.locator('[data-weapon-cost] option[value="fast"]').evaluate(option=>option.disabled),true);
  assert.equal(await page.locator('[data-weapon-cost] option[value="slow"]').evaluate(option=>option.disabled),true);
  await page.locator('[data-weapon-cost]').selectOption('both');
  assert.equal(await page.locator('[data-weapon-input="amount"]').inputValue(),'10');
  assert.equal(await page.locator('[data-weapon-input="amount"]').isDisabled(),true);
  await page.locator('[data-weapon-execute]').click();
  await page.waitForFunction(()=>weaponHarness.actor.getFlag('', 'weaponReload')?.['gun:load']?.current===10);
  await page.evaluate(()=>weaponHarness.round());await page.locator('[data-weapon-action="load"]').click();
  await page.locator('[data-weapon-cost]').selectOption('both');await page.locator('[data-weapon-execute]').click();
  await page.waitForFunction(()=>weaponHarness.actor.getFlag('', 'weaponReload')?.['gun:load']?.finished);
  assert.equal(await page.evaluate(()=>weaponHarness.firearm.loads),1);
  // 3S does not accept a fast action; manual mode keeps ability inputs editable.
  await page.evaluate(async()=>{weaponHarness.round();await weaponHarness.requirement('MAG','','3S');});
  await page.locator('[data-weapon-action="topOff"]').click();
  assert.equal(await page.locator('[data-weapon-unit]').inputValue(),'slow');
  assert.equal(await page.locator('[data-weapon-cost] option[value="fast"]').evaluate(option=>option.disabled),true);
  await page.locator('[data-weapon-calculation]').selectOption('manual');
  assert.equal(await page.locator('[data-weapon-input="amount"]').isDisabled(),false);
  await page.locator('[data-weapon-input="amount"]').fill('2');
  await page.locator('[data-weapon-save-progress]').click();
  await page.waitForFunction(()=>weaponHarness.actor.getFlag('', 'weaponReload')?.['gun:topOff']?.calculation==='manual');
  await page.evaluate(()=>weaponHarness.round());await page.locator('[data-weapon-action="topOff"]').click();
  assert.equal(await page.locator('[data-weapon-calculation]').inputValue(),'manual');
  assert.equal(await page.locator('[data-weapon-input="amount"]').inputValue(),'2');
  await page.locator('[data-weapon-close]').click();
  await page.locator('[data-weapon-action="attack"][data-weapon-id="gun"]').click();
  assert.equal(await page.locator('[data-weapon-cost] option[value="fast"]').evaluate(option=>option.disabled),false);
  await page.locator('[data-weapon-close]').click();await page.locator('[data-weapon-action="topOff"]').click();
  if (screenshot) await ribbon.screenshot({path:resolve(screenshot,"weapon-ribbon-desktop.png")});
  await page.locator("[data-weapon-pin]").click();await page.locator("[data-collapse]").click();
  assert.equal(await ribbon.isVisible(),true);
  await page.locator("[data-weapon-pin]").click();assert.equal(await ribbon.isVisible(),false);
  await page.locator("[data-collapse]").click();
  for (const width of [360,320]) {
    await page.setViewportSize({width,height:740});await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(50);
    assert.equal(await ribbon.evaluate(element=>element.scrollWidth>element.clientWidth),false);
    assert.equal(await ribbon.isVisible(),true);
    const bounds=await ribbon.boundingBox();
    assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width && bounds.y>=0 && bounds.y+bounds.height<=740);
    if (screenshot) await ribbon.screenshot({path:resolve(screenshot,`weapon-ribbon-${width}.png`)});
  }
  await page.evaluate(()=>{game.modules.get('fbl-quick-access').active=false;Hooks.callAll('fblQuickAccess.apiReady');});
  await page.waitForTimeout(50);assert.equal(await ribbon.isVisible(),false);assert.equal(await page.locator('.yze-equipment__hand').count(),0);
  assert.deepEqual(errors,[]);
  console.log("PASS: native FBL dialog; multi-round load, exact +1 TopOff, 2F/3S/seconds, slow-as-fast, manual abilities, stale draft, attack/cancel, one payment/ammo use, collapse/pin, 320/360px and absent QA.");
} finally {await browser.close();server.close();}
