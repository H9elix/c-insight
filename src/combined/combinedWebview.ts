import { combinedHoverTiming, combinedLayoutRevision, combinedPaneSizes, reorderCombinedPane } from "./combinedModel";
import { PANE_REORDER_CLIENT } from "./combinedReorderClient";
import { EMBEDDED_THEME_CSS } from "./embeddedTheme";
import { escapeHtml } from "../views/sourceHighlight";

export function renderCombinedWebview(nonce: string, cspSource: string, iconsUri: string, labels: Record<string, string>, testMode = false,
  icons: {css: string; font: string} = {css: "", font: ""}): string {
  return `<!doctype html><html><head><meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src 'self' ${cspSource}; script-src 'nonce-${nonce}'; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource} blob:; img-src ${cspSource} data:;">
  <link rel="stylesheet" href="${escapeHtml(iconsUri)}">
  <style>
  *{box-sizing:border-box}html,body{height:100%;margin:0;overflow:hidden}body{color:var(--vscode-foreground);background:var(--vscode-sideBar-background);font:var(--vscode-font-size) var(--vscode-font-family);display:flex;flex-direction:row}
  button{color:inherit;background:transparent;border:0;border-radius:3px;padding:3px;cursor:pointer;flex:none}button:hover{background:var(--vscode-toolbar-hoverBackground)}button:focus-visible{outline:1px solid var(--vscode-focusBorder)}button[aria-pressed=true]{background:var(--vscode-toolbar-activeBackground);color:var(--vscode-list-highlightForeground)}
  #bar{display:flex;flex-direction:column;align-items:center;gap:4px;flex:0 0 36px;width:36px;min-height:0;padding:3px 2px;overflow:hidden;border-right:1px solid var(--vscode-panel-border)}
  #bar-actions{display:flex;flex-direction:column;gap:3px;flex:0 1 auto;width:100%;min-height:0;min-width:0;max-width:100%;overflow:auto;scrollbar-width:thin;order:0}#bar-actions::-webkit-scrollbar{width:6px;height:6px}
  #name{flex:1;min-height:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;writing-mode:vertical-rl;text-orientation:mixed;text-align:end;order:1}
  .combined-vertical body{flex-direction:column}.combined-vertical #bar{flex:0 0 auto;flex-direction:row;width:auto;min-height:27px;padding:2px 5px;border-right:0;border-bottom:1px solid var(--vscode-panel-border)}
  .combined-vertical #name{writing-mode:horizontal-tb;text-align:start;order:0}.combined-vertical #bar-actions{flex-direction:row;width:auto;order:1}
  #viewport{flex:1;min-width:0;min-height:0;overflow:auto}#panes{display:flex;height:100%;min-width:100%;min-height:100%;align-items:stretch}#panes:empty{display:none}#panes.vertical{flex-direction:column}
  .pane{display:flex;flex-direction:column;flex:none;overflow:hidden;transition:flex-basis var(--ci-combined-animation-duration,200ms) ease;min-width:0;min-height:0;outline:1px solid var(--vscode-contrastBorder,transparent);outline-offset:-1px}.pane header{display:flex;align-items:center;gap:2px;min-height:27px;padding:2px 3px;color:var(--vscode-sideBarSectionHeader-foreground,var(--vscode-foreground));background:var(--vscode-sideBarSectionHeader-background);border-bottom:1px solid var(--vscode-panel-border)}.title{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:600}.actions{display:flex;overflow-x:auto;flex-shrink:1}.pane iframe{border:0;width:100%;flex:1;min-height:0;background:var(--vscode-sideBar-background)}.pane.collapsed iframe{visibility:hidden;pointer-events:none}
  .splitter{flex:0 0 5px;cursor:col-resize;background:var(--vscode-panel-border)}.vertical>.splitter{cursor:row-resize}.splitter:hover,.splitter:focus{background:var(--vscode-focusBorder)}#panes.dragging .pane{transition:none}#panes.dragging iframe{pointer-events:none}#empty{margin:14px;line-height:1.6}#empty[hidden]{display:none}
  .pane.collapsed iframe{display:none}#panes:not(.vertical)>.pane.collapsed header{height:100%;flex-direction:column}#panes:not(.vertical)>.pane.collapsed .title{writing-mode:vertical-rl}#panes:not(.vertical)>.pane.collapsed .actions{display:none}
  .vscode-reduce-motion .pane{transition:none}
  .title{cursor:grab;user-select:none;touch-action:none}#panes:has(>.pane:only-child) .title{cursor:default}
  #panes.reordering .pane{transition:none}#panes.reordering iframe{pointer-events:none}
  .reorder-overlay{position:fixed;inset:0;z-index:100;cursor:grabbing;touch-action:none}
  .reorder-ghost{position:fixed;z-index:102;pointer-events:none;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5px 9px;background:var(--vscode-editorWidget-background);color:var(--vscode-editorWidget-foreground,var(--vscode-foreground));border:1px solid var(--vscode-focusBorder);box-shadow:0 2px 8px var(--vscode-widget-shadow)}
  .reorder-marker{position:fixed;z-index:101;pointer-events:none;background:var(--vscode-focusBorder)}
  @media(prefers-reduced-motion:reduce){.pane{transition:none}}
  </style></head><body><div id="bar" role="toolbar" aria-label="${escapeHtml(labels.manage ?? "")}" aria-orientation="vertical"><div id="bar-actions"></div><span id="name"></span></div><div id="viewport"><div id="panes"></div><p id="empty">${escapeHtml(labels.empty)}</p></div>
  <script nonce="${nonce}">const paneNonce=${scriptJson(nonce)};const icons=${scriptJson(icons)};const testMode=${testMode};const labels=${scriptJson(labels)};const sizesFor=${combinedPaneSizes.toString()};const layoutKey=${combinedLayoutRevision.toString()};const timingFor=${combinedHoverTiming.toString()};const reorderPane=${reorderCombinedPane.toString()};${PANE_REORDER_CLIENT}${COMBINED_CLIENT}</script></body></html>`;
}

/** Only trusted, escaped renderer output enters srcdoc. All executable code uses the outer nonce. */
export function embeddedDocument(html: string, nonce: string, generation: number): string {
  const bridge = `<script nonce="${nonce}">(${FRAME_BRIDGE})(${generation},null/*cInsightFrameState*/);</script>`;
  const defaults = `<style nonce="${nonce}" id="c-insight-embedded-theme">${EMBEDDED_THEME_CSS}</style>`;
  return html.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/gi, "")
    .replace(/<link\b(?=[^>]*\brel="stylesheet")(?=[^>]*\bhref="[^"]*codicon\.css")[^>]*>/gi, "<!--cInsightIcons-->")
    .replace(/nonce="[^"]*"/g, `nonce="${nonce}"`).replace(/<head([^>]*)>/i, `<head$1>${defaults}${bridge}`);
}

function scriptJson(value: unknown): string { return JSON.stringify(value).replace(/</g, "\\u003c"); }

export const FRAME_BRIDGE = String.raw`function(generation, initialState) {
  let state = initialState;
  const send = (kind, payload) => parent.postMessage({bridge:'cInsight.pane',generation,kind,payload}, '*');
  const api = {postMessage:payload => send('message',payload), getState:()=>state,
    setState:value => {state=value;send('state',value);return value;}};
  window.acquireVsCodeApi = () => api;
  let themeProperties=new Set();
  const themeClasses=['vscode-light','vscode-dark','vscode-high-contrast','vscode-high-contrast-light','vscode-reduce-motion','vscode-using-screen-reader'];
  function theme(){
    const computed=parent.getComputedStyle(parent.document.body);
    const values=new Map();
    for(let i=0;i<computed.length;i++){const name=computed[i];if(name.startsWith('--vscode-'))values.set(name,computed.getPropertyValue(name));}
    // Older Chromium does not enumerate custom properties in computed styles.
    const declared=parent.document.documentElement?.style;
    for(let i=0;i<(declared?.length||0);i++){const name=declared[i];if(name.startsWith('--vscode-')&&!values.has(name))values.set(name,declared.getPropertyValue(name));}
    for(const name of themeProperties)if(!values.has(name))document.documentElement.style.removeProperty(name);
    values.forEach((value,name)=>document.documentElement.style.setProperty(name,value));themeProperties=new Set(values.keys());
    if(document.body){
      for(const name of themeClasses)document.body.classList.toggle(name,parent.document.body.classList.contains(name));
      for(const name of ['data-vscode-theme-kind','data-vscode-theme-name','data-vscode-theme-id']){
        const value=parent.document.body.getAttribute(name);if(value!==null)document.body.setAttribute(name,value);else document.body.removeAttribute(name);
      }
    }
  }
  theme();document.addEventListener('DOMContentLoaded',theme);
  window.addEventListener('message', event => {
    if(event.source===parent && event.data?.bridge==='cInsight.theme'){theme();return;}
    if(event.source===parent && event.data?.bridge==='cInsight.host')
      window.dispatchEvent(new MessageEvent('message',{data:event.data.payload}));
  });
  let lastMove=0;
  function activity(event) {
    const menu=document.getElementById('menu');
    send('activity',{x:event.screenX,y:event.screenY,buttons:event.buttons||0,
      busy:!!(event.buttons||String(window.getSelection()||'')||(menu&&!menu.hidden)),move:event.type==='pointermove'});
  }
  document.addEventListener('pointermove',event=>{const now=performance.now();if(now-lastMove>40){lastMove=now;activity(event);}},true);
  document.addEventListener('pointerdown',activity,true);document.addEventListener('pointerup',activity,true);
  document.addEventListener('selectionchange',()=>send('activity',{busy:!!String(window.getSelection()||''),move:false}));
  document.addEventListener('focusin',()=>send('focus',{}),true);
  const forwardedKeys=new Set();
  window.addEventListener('keydown',event=>{
    if(event.defaultPrevented||(!(event.ctrlKey||event.metaKey)&&event.key!=='F1'))return;
    if((event.ctrlKey||event.metaKey)&&!event.altKey&&['a','c','v','x','z','y'].includes(event.key.toLowerCase()))return;
    event.preventDefault();forwardedKeys.add(event.code||event.key);
    send('key',{type:'keydown',key:event.key,code:event.code,keyCode:event.keyCode,ctrlKey:event.ctrlKey,metaKey:event.metaKey,altKey:event.altKey,shiftKey:event.shiftKey,repeat:event.repeat});
  });
  window.addEventListener('keyup',event=>{
    if(!forwardedKeys.delete(event.code||event.key))return;
    send('key',{type:'keyup',key:event.key,code:event.code,keyCode:event.keyCode,ctrlKey:event.ctrlKey,metaKey:event.metaKey,altKey:event.altKey,shiftKey:event.shiftKey});
  });
  send('ready',{});
}`;

export const COMBINED_CLIENT = String.raw`
const vscode=acquireVsCodeApi(), container=document.getElementById('panes'), viewport=document.getElementById('viewport');
const fontUrl=URL.createObjectURL(new Blob([Uint8Array.from(atob(icons.font),character=>character.charCodeAt(0))],{type:'font/ttf'}));
const iconStyle='<style nonce="'+paneNonce+'">'+icons.css.replace(/\.\/codicon\.ttf(?:\?[^"')\s]+)?/g,fontUrl)+'</style>';
window.addEventListener('pagehide',()=>URL.revokeObjectURL(fontUrl));
const saved=vscode.getState()||{}, frames=new Map(), paneState=saved.panes||{};
let layout={views:[],ratios:[],direction:'horizontal'}, hoverEnabled=true, hoverTiming=timingFor(), hovered=-1, candidate, enterTimer, leaveTimer, busy=false, suspended=false, dragging, lastPoint;
let nextReorder=0,reorderPending,testReorderPoint;
const post=message=>vscode.postMessage(message);
const persist=()=>vscode.setState({panes:paneState});
const paneOrder=createPaneReorder({container,viewport,readLayout:()=>layout,keyFor:layoutKey,label:labels.reorder,
  canStart:()=>!dragging&&!suspended&&!reorderPending,
  onStart:()=>{clearTimeout(enterTimer);clearTimeout(leaveTimer);enterTimer=leaveTimer=undefined;hovered=-1;candidate=undefined;busy=true;},
  onEnd:(event,started)=>{busy=false;if(started){candidate=undefined;hovered=-1;lastPoint=event?{x:event.screenX,y:event.screenY}:lastPoint;resize();}},
  onDrop:(role,target,side,revision)=>{
    if(reorderPane(layout,role,target,side)===layout)return;
    reorderPending=++nextReorder;post({type:'reorder',request:reorderPending,role,target,side,revision});
  }});
function button(icon,title,action){const button=document.createElement('button');button.className='codicon codicon-'+icon;button.title=title;button.setAttribute('aria-label',title);button.addEventListener('click',action);return button;}
document.getElementById('bar-actions').append(
  button('add',labels.add,()=>post({type:'manage',action:'add'})),
  button('layout',labels.direction,()=>post({type:'manage',action:'direction'})),
  button('expand-all',labels.hover,()=>post({type:'manage',action:'hover'})),
  button('gear',labels.manage,()=>post({type:'manage',action:'menu'})));
function resize(){
  if(dragging||paneOrder.active||reorderPending)return;
  const vertical=layout.direction==='vertical', total=(vertical?viewport.clientHeight:viewport.clientWidth)-Math.max(0,layout.views.length-1)*5;
  const expanded=layout.views.filter(role=>!frames.get(role)?.element.classList.contains('collapsed'));
  const sizes=sizesFor(total-(layout.views.length-expanded.length)*28,expanded.map(role=>layout.ratios[layout.views.indexOf(role)]),vertical?80:160,hoverEnabled?expanded.indexOf(layout.views[hovered]):-1);
  layout.views.forEach(role=>{const item=frames.get(role);if(item)item.element.style.flexBasis=(expanded.includes(role)?sizes[expanded.indexOf(role)]:28)+'px';});
}
function consider(role,activity){
  busy=!!activity.busy;
  if(busy||suspended||dragging||paneOrder.active||reorderPending||!hoverEnabled||!activity.move)return;
  if(lastPoint&&activity.x===lastPoint.x&&activity.y===lastPoint.y)return;
  lastPoint={x:activity.x,y:activity.y};
  clearTimeout(leaveTimer);leaveTimer=undefined;
  if(candidate===role)return;
  candidate=role;scheduleEnter();
}
function scheduleEnter(){
  clearTimeout(enterTimer);const role=candidate;
  enterTimer=setTimeout(()=>{enterTimer=undefined;if(role===candidate&&!busy&&!suspended&&!dragging&&!paneOrder.active&&!reorderPending&&hoverEnabled){hovered=layout.views.indexOf(role);resize();}},hoverTiming.enterDelay);
}
function scheduleLeave(){
  clearTimeout(leaveTimer);
  leaveTimer=setTimeout(()=>{leaveTimer=undefined;if(!busy&&!suspended&&!dragging&&!paneOrder.active&&!reorderPending){hovered=-1;resize();}},hoverTiming.leaveDelay);
}
function applyHoverTiming(value){
  const next=timingFor(value),previous=hoverTiming;hoverTiming=next;
  const style=container.style,duration=next.animationDuration+'ms';
  if(style.getPropertyValue('--ci-combined-animation-duration')!==duration)style.setProperty('--ci-combined-animation-duration',duration);
  if(next.enterDelay!==previous.enterDelay&&enterTimer!==undefined&&candidate)scheduleEnter();
  if(next.leaveDelay!==previous.leaveDelay&&leaveTimer!==undefined)scheduleLeave();
}
document.body.addEventListener('pointermove',event=>{
  const pane=event.target.closest?.('.pane');
  if(pane)consider(pane.dataset.role,{move:true,x:event.screenX,y:event.screenY,busy:!!event.buttons});
});
document.addEventListener('pointerdown',()=>{busy=true;clearTimeout(enterTimer);enterTimer=undefined;candidate=undefined;});
document.addEventListener('pointerup',()=>{busy=false;});
document.body.addEventListener('mouseleave',()=>{
  clearTimeout(enterTimer);enterTimer=undefined;candidate=undefined;scheduleLeave();
});
function render(message){
  paneOrder.layoutChanged(message.layout);
  const previouslyHovered=layout.views[hovered],wasHoverEnabled=hoverEnabled;
  const previousRoles=layout.views.join();layout=message.layout;hoverEnabled=message.hover;
  if(candidate&&!layout.views.includes(candidate)){candidate=undefined;clearTimeout(enterTimer);enterTimer=undefined;}
  hovered=previouslyHovered?layout.views.indexOf(previouslyHovered):-1;
  if(wasHoverEnabled!==hoverEnabled){clearTimeout(enterTimer);clearTimeout(leaveTimer);enterTimer=leaveTimer=undefined;candidate=undefined;hovered=-1;}
  applyHoverTiming(message.hoverTiming);
  document.getElementById('name').textContent=message.title;
  document.getElementById('name').title=message.title;
  document.documentElement.classList.toggle('combined-vertical',layout.direction==='vertical');
  document.getElementById('bar').setAttribute('aria-orientation',layout.direction==='vertical'?'horizontal':'vertical');
  const toggle=document.getElementById('bar').querySelector('.codicon-expand-all');toggle.setAttribute('aria-pressed',String(hoverEnabled));
  container.classList.toggle('vertical',layout.direction==='vertical');
  for(const [role,item] of frames)if(!layout.views.includes(role)){item.element.remove();frames.delete(role);delete paneState[role];}
  for(const pane of message.panes){
    let item=frames.get(pane.role);
    if(!item){
      const element=document.createElement('section');element.className='pane';element.dataset.role=pane.role;element.setAttribute('aria-label',pane.title);
      const header=document.createElement('header'), title=document.createElement('span');title.className='title';title.textContent=pane.title;
      paneOrder.attach(title,pane.role);
      const iframe=document.createElement('iframe');iframe.title=pane.title;iframe.setAttribute('sandbox','allow-scripts allow-same-origin');
      const actions=document.createElement('span');actions.className='actions';
      const collapse=button('chevron-down',labels.collapse,()=>{
        const collapsed=!element.classList.contains('collapsed');element.classList.toggle('collapsed',collapsed);
        collapse.className='codicon codicon-chevron-'+(collapsed?'right':'down');collapse.setAttribute('aria-expanded',String(!collapsed));
        paneState[pane.role]={...paneState[pane.role],collapsed};persist();post({type:'collapse',role:pane.role,collapsed});resize();
      });
      collapse.setAttribute('aria-expanded','true');
      header.append(collapse,title,actions,button('ellipsis',labels.actions,()=>post({type:'paneMenu',role:pane.role})));
      element.append(header,iframe);item={element,iframe,actions,generation:-1};frames.set(pane.role,item);
      if(paneState[pane.role]?.collapsed){element.classList.add('collapsed');collapse.className='codicon codicon-chevron-right';collapse.setAttribute('aria-expanded','false');post({type:'collapse',role:pane.role,collapsed:true});}
    }
    item.actions.replaceChildren(...pane.actions.filter(action=>action.primary).map(action=>button(action.icon||'circle-outline',action.title,()=>post({type:'action',role:pane.role,command:action.command}))));
    if(item.generation!==pane.generation){
      item.generation=pane.generation;
      // The host supplies nonce-normalized trusted HTML, not source text or arbitrary URLs.
      const state=JSON.stringify(paneState[pane.role]?.value||{}).replace(/</g,'\\u003c');
      item.iframe.srcdoc=pane.html.replace('null/*cInsightFrameState*/',state).replace('<!--cInsightIcons-->',iconStyle);
    }
  }
  // Keep existing frames mounted on ordinary updates: moving them would reload the documents.
  if(previousRoles!==layout.views.join()){
    container.querySelectorAll('.splitter').forEach(element=>element.remove());
    layout.views.forEach((role,index)=>{
      const element=frames.get(role).element;
      if(element.parentNode!==container)container.append(element);
      element.style.order=String(index*2);
      if(index<layout.views.length-1){
        const splitter=document.createElement('div');splitter.className='splitter';splitter.style.order=String(index*2+1);splitter.tabIndex=0;
        splitter.setAttribute('role','separator');splitter.setAttribute('aria-label',labels.splitter);
        splitter.setAttribute('aria-orientation',layout.direction==='vertical'?'horizontal':'vertical');
        splitter.addEventListener('pointerdown',event=>startDrag(event,index,splitter));
        splitter.addEventListener('pointermove',moveDrag);
        splitter.addEventListener('pointerup',finishDrag);splitter.addEventListener('pointercancel',finishDrag);
        splitter.addEventListener('keydown',event=>{
          if(paneOrder.active||reorderPending)return;
          if(frames.get(layout.views[index]).element.classList.contains('collapsed')||frames.get(layout.views[index+1]).element.classList.contains('collapsed'))return;
          if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
          event.preventDefault();hovered=-1;resize();
          const sizes=layout.views.map(role=>frames.get(role).element.getBoundingClientRect()[layout.direction==='vertical'?'height':'width']);
          const minimum=layout.direction==='vertical'?80:160,delta=['ArrowLeft','ArrowUp'].includes(event.key)?-20:20;
          const change=Math.max(minimum-sizes[index],Math.min(sizes[index+1]-minimum,delta));sizes[index]+=change;sizes[index+1]-=change;
          layout.ratios=sizes;resize();post({type:'ratios',ratios:sizes});
        });container.append(splitter);
      }
    });
  }
  container.querySelectorAll('.splitter').forEach(element=>element.setAttribute('aria-orientation',layout.direction==='vertical'?'horizontal':'vertical'));
  document.getElementById('empty').hidden=layout.views.length>0;resize();
}
function startDrag(event,index,element){
  if(paneOrder.active||reorderPending)return;
  if(frames.get(layout.views[index]).element.classList.contains('collapsed')||frames.get(layout.views[index+1]).element.classList.contains('collapsed'))return;
  if(event.button!==0)return;event.preventDefault();clearTimeout(enterTimer);clearTimeout(leaveTimer);enterTimer=leaveTimer=undefined;
  const vertical=layout.direction==='vertical',sizes=layout.views.map(role=>frames.get(role).element.getBoundingClientRect()[vertical?'height':'width']);
  dragging={index,element,start:vertical?event.clientY:event.clientX,sizes,original:[...layout.ratios],moved:false};
  hovered=-1;container.classList.add('dragging');layout.views.forEach((role,index)=>frames.get(role).element.style.flexBasis=sizes[index]+'px');
  if(typeof event.pointerId==='number')element.setPointerCapture(event.pointerId);
}
function moveDrag(event){if(!dragging)return;const {index,start,sizes}=dragging,vertical=layout.direction==='vertical',minimum=vertical?80:160;
  const delta=Math.max(minimum-sizes[index],Math.min(sizes[index+1]-minimum,(vertical?event.clientY:event.clientX)-start));
  if(Math.abs(delta)<1&&!dragging.moved)return;dragging.moved=true;
  layout.ratios=[...sizes];layout.ratios[index]+=delta;layout.ratios[index+1]-=delta;
  layout.views.forEach((role,index)=>frames.get(role).element.style.flexBasis=layout.ratios[index]+'px');
}
function finishDrag(event){if(!dragging)return;const {element,original,moved}=dragging;dragging=undefined;busy=false;candidate=undefined;container.classList.remove('dragging');
  if(typeof event.pointerId==='number'&&element.hasPointerCapture(event.pointerId))element.releasePointerCapture(event.pointerId);
  if(moved)post({type:'ratios',ratios:layout.ratios});else layout.ratios=original;resize();}
window.addEventListener('message',event=>{
  const message=event.data;
  if(message?.bridge==='cInsight.pane'){
    const entry=[...frames.entries()].find(([,item])=>item.iframe.contentWindow===event.source);
    if(!entry||entry[1].generation!==message.generation)return;
    const [role]=entry;
    if(message.kind==='state'){paneState[role]={...paneState[role],value:message.payload};persist();}
    else if(message.kind==='activity')consider(role,message.payload||{});
    else if(message.kind==='focus')post({type:'focus',role});
    else if(message.kind==='key'){
      const key=message.payload;
      if(key&&['keydown','keyup'].includes(key.type)&&typeof key.key==='string'&&key.key.length<100){
        const event=new KeyboardEvent(key.type,{...key,bubbles:true,cancelable:true});
        Object.defineProperty(event,'keyCode',{value:Number.isInteger(key.keyCode)?key.keyCode:0});window.dispatchEvent(event);
      }
    }
    else if(message.kind==='ready')post({type:'frameReady',role,generation:message.generation});
    else if(message.kind==='message')post({type:'paneMessage',role,generation:message.generation,message:message.payload});
    return;
  }
  // VS Code masks window.parent. Reject every child window, then accept only same-origin preload messages.
  if([...frames.values()].some(item=>item.iframe.contentWindow===event.source))return;
  if(event.source&&event.origin!==location.origin)return;
  if(message?.type==='layout')render(message);
  else if(message?.type==='panePost'){
    const item=frames.get(message.role);if(item&&item.generation===message.generation)item.iframe.contentWindow.postMessage({bridge:'cInsight.host',payload:message.message},'*');
  }else if(message?.type==='reorderResult'&&message.request===reorderPending){reorderPending=undefined;candidate=undefined;hovered=-1;resize();}
  else if(message?.type==='cancelInteractions'){paneOrder.cancel();}
  else if(message?.type==='suspend'){suspended=message.value;if(suspended)paneOrder.cancel();clearTimeout(enterTimer);clearTimeout(leaveTimer);enterTimer=leaveTimer=undefined;if(!suspended){candidate=undefined;busy=false;}}
  else if(testMode&&message?.type==='testInteraction'){
    const item=frames.get(message.role);
    if(message.action==='hover')consider(message.role,{move:true,x:message.x||100,y:120,busy:false});
    else if(message.action==='leave')document.body.dispatchEvent(new MouseEvent('mouseleave'));
    else if(message.action==='collapse')item?.element.querySelector('button').click();
    else if(message.action==='filter'){
      const input=item?.iframe.contentDocument.getElementById('filter');if(input){input.value=message.value;input.dispatchEvent(new Event('input'));}
    }
    else if(message.action==='viewport'){viewport.style.width='1200px';viewport.style.height='500px';viewport.style.flex='none';resize();}
    else if(message.action==='naturalViewport'){viewport.style.width='';viewport.style.height='';viewport.style.flex='';resize();}
    else if(message.action==='surfaceSize'){document.body.style.width=message.width?message.width+'px':'';document.body.style.height=message.height?message.height+'px':'';resize();}
    else if(message.action==='focusLastToolbarButton'){document.querySelector('#bar-actions button:first-child')?.focus();document.querySelector('#bar-actions button:last-child')?.focus();}
    else if(message.action==='reducedMotion')document.body.classList.toggle('vscode-reduce-motion',!!message.value);
    else if(message.action==='reorderStart'){
      const title=item?.element.querySelector('.title'),rect=title?.getBoundingClientRect();
      if(rect){testReorderPoint={clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2};title.dispatchEvent(new PointerEvent('pointerdown',{...testReorderPoint,pointerId:901,button:0,buttons:1,bubbles:true,cancelable:true}));}
    }
    else if(message.action==='reorderMove'){
      const rect=item?.element.getBoundingClientRect(),box=viewport.getBoundingClientRect(),vertical=layout.direction==='vertical';
      if(rect){testReorderPoint={clientX:vertical?(box.left+box.right)/2:(message.side==='before'?rect.left+2:rect.right-2),clientY:vertical?(message.side==='before'?rect.top+2:rect.bottom-2):(box.top+box.bottom)/2};}
      if(message.edge)testReorderPoint={clientX:vertical?(box.left+box.right)/2:message.edge==='start'?box.left+2:box.right-2,clientY:vertical?(message.edge==='start'?box.top+2:box.bottom-2):(box.top+box.bottom)/2};
      if(testReorderPoint)window.dispatchEvent(new PointerEvent('pointermove',{...testReorderPoint,pointerId:901,buttons:1,bubbles:true,cancelable:true}));
    }
    else if(message.action==='reorderDrop'){
      if(testReorderPoint){const point=message.outside?{clientX:viewport.getBoundingClientRect().right+20,clientY:viewport.getBoundingClientRect().bottom+20}:testReorderPoint;
        window.dispatchEvent(new PointerEvent('pointerup',{...point,pointerId:901,buttons:0,bubbles:true,cancelable:true}));}
    }
    else if(message.action==='reorderCancel'){
      if(message.mode==='escape')window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      else if(message.mode==='blur')window.dispatchEvent(new Event('blur'));
      else window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:901,bubbles:true}));
    }
    else if(message.action==='markState'){
      for(const [role,frame] of frames){const child=frame.iframe.contentDocument;if(!child?.body)continue;child.body.dataset.reorderMarker=role;
        const row=child.querySelector('.row[data-id]');if(row)frame.iframe.contentWindow.postMessage({bridge:'cInsight.host',payload:{type:'reveal',id:row.dataset.id,select:true}},'*');
        const scroll=child.querySelector('.code,#tree,#results');if(scroll){scroll.scrollTop=30;scroll.scrollLeft=40;}}
    }
    else if(message.action==='narrow'){viewport.style.width='420px';viewport.style.height='240px';viewport.style.flex='none';resize();}
    else if(message.action==='drag'){
      const splitter=container.querySelector('.splitter'),vertical=layout.direction==='vertical';
      if(splitter){startDrag({button:0,clientX:0,clientY:0,preventDefault:()=>{}},0,splitter);
        moveDrag({clientX:vertical?0:message.delta,clientY:vertical?message.delta:0});finishDrag({});}
    }
  }
  else if(testMode&&message?.type==='inspect'){
    const rectangle=element=>{const {left,top,right,bottom,width,height}=element.getBoundingClientRect();return {left,top,right,bottom,width,height};};
    const bar=document.getElementById('bar'),actions=document.getElementById('bar-actions'),name=document.getElementById('name');
    post({type:'inspection',request:message.request,panes:[...frames].map(([role,item])=>{
    const child=item.iframe.contentDocument,icon=child?.querySelector('.codicon'),scroll=child?.querySelector('.code,#tree,#results');
    return {role,generation:item.generation,collapsed:item.element.classList.contains('collapsed'),width:item.element.clientWidth,height:item.element.clientHeight,filter:child?.getElementById('filter')?.value,theme:item.iframe.contentWindow?.getComputedStyle(child.body).getPropertyValue('--vscode-foreground'),iconFont:icon?item.iframe.contentWindow.getComputedStyle(icon).fontFamily:undefined,
      marker:child?.body?.dataset.reorderMarker,selected:child?.querySelector('.row.selected')?.dataset.id,scrollTop:scroll?.scrollTop,scrollLeft:scroll?.scrollLeft,headerDirection:getComputedStyle(item.element.querySelector('header')).flexDirection,transitionDuration:getComputedStyle(item.element).transitionDuration};
    }),hovered,hoverTiming,reducedMotion:document.body.classList.contains('vscode-reduce-motion'),toolbar:{bar:rectangle(bar),viewport:rectangle(viewport),actions:rectangle(actions),name:rectangle(name),writingMode:getComputedStyle(name).writingMode,actionsDirection:getComputedStyle(actions).flexDirection,orientation:bar.getAttribute('aria-orientation'),title:name.title,buttonCount:actions.querySelectorAll('button').length,
      lastButton:rectangle(actions.lastElementChild),scrollLeft:actions.scrollLeft,scrollTop:actions.scrollTop},
      reordering:paneOrder.active,reorderPending:!!reorderPending,visualOrder:[...frames].sort((a,b)=>Number(a[1].element.style.order)-Number(b[1].element.style.order)).map(([role])=>role),ratios:layout.ratios,scrollLeft:viewport.scrollLeft,scrollTop:viewport.scrollTop});
  }
});
new ResizeObserver(resize).observe(viewport);
new MutationObserver(()=>frames.forEach(item=>item.iframe.contentWindow.postMessage({bridge:'cInsight.theme'},'*'))).observe(document.body,{attributes:true,attributeFilter:['class','style','data-vscode-theme-kind','data-vscode-theme-name','data-vscode-theme-id']});
new MutationObserver(()=>frames.forEach(item=>item.iframe.contentWindow.postMessage({bridge:'cInsight.theme'},'*'))).observe(document.documentElement,{attributes:true,attributeFilter:['style']});
post({type:'ready',states:paneState});
`;
