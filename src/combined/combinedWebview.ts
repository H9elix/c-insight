import { combinedPaneSizes } from "./combinedModel";
import { escapeHtml } from "../views/sourceHighlight";

export function renderCombinedWebview(nonce: string, cspSource: string, iconsUri: string, labels: Record<string, string>, testMode = false,
  icons: {css: string; font: string} = {css: "", font: ""}): string {
  return `<!doctype html><html><head><meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src 'self' ${cspSource}; script-src 'nonce-${nonce}'; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource} blob:; img-src ${cspSource} data:;">
  <link rel="stylesheet" href="${escapeHtml(iconsUri)}">
  <style>
  *{box-sizing:border-box}html,body{height:100%;margin:0;overflow:hidden}body{color:var(--vscode-foreground);background:var(--vscode-sideBar-background);font:var(--vscode-font-size) var(--vscode-font-family);display:flex;flex-direction:column}
  button{color:inherit;background:transparent;border:0;border-radius:3px;padding:3px;cursor:pointer;flex:none}button:hover{background:var(--vscode-toolbar-hoverBackground)}button:focus-visible{outline:1px solid var(--vscode-focusBorder)}button[aria-pressed=true]{background:var(--vscode-toolbar-activeBackground);color:var(--vscode-list-highlightForeground)}
  #bar{display:flex;align-items:center;gap:4px;min-height:27px;padding:2px 5px;border-bottom:1px solid var(--vscode-panel-border)}#name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #viewport{flex:1;min-height:0;overflow:auto}#panes{display:flex;height:100%;min-width:100%;min-height:100%;align-items:stretch}#panes:empty{display:none}#panes.vertical{flex-direction:column}
  .pane{display:flex;flex-direction:column;flex:none;overflow:hidden;transition:flex-basis 200ms ease;min-width:0;min-height:0}.pane header{display:flex;align-items:center;gap:2px;min-height:27px;padding:2px 3px;background:var(--vscode-sideBarSectionHeader-background);border-bottom:1px solid var(--vscode-panel-border)}.title{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:600}.actions{display:flex;overflow-x:auto;flex-shrink:1}.pane iframe{border:0;width:100%;flex:1;min-height:0;background:var(--vscode-sideBar-background)}.pane.collapsed iframe{visibility:hidden;pointer-events:none}
  .splitter{flex:0 0 5px;cursor:col-resize;background:var(--vscode-panel-border)}.vertical>.splitter{cursor:row-resize}.splitter:hover,.splitter:focus{background:var(--vscode-focusBorder)}#panes.dragging .pane{transition:none}#panes.dragging iframe{pointer-events:none}#empty{margin:14px;line-height:1.6}#empty[hidden]{display:none}
  .pane.collapsed iframe{display:none}#panes:not(.vertical)>.pane.collapsed header{height:100%;flex-direction:column}#panes:not(.vertical)>.pane.collapsed .title{writing-mode:vertical-rl}#panes:not(.vertical)>.pane.collapsed .actions{display:none}
  @media(prefers-reduced-motion:reduce){.pane{transition:none}}
  </style></head><body><div id="bar"><span id="name"></span></div><div id="viewport"><div id="panes"></div><p id="empty">${escapeHtml(labels.empty)}</p></div>
  <script nonce="${nonce}">const paneNonce=${scriptJson(nonce)};const icons=${scriptJson(icons)};const testMode=${testMode};const labels=${scriptJson(labels)};const sizesFor=${combinedPaneSizes.toString()};${COMBINED_CLIENT}</script></body></html>`;
}

/** Only trusted, escaped renderer output enters srcdoc. All executable code uses the outer nonce. */
export function embeddedDocument(html: string, nonce: string, generation: number): string {
  const bridge = `<script nonce="${nonce}">(${FRAME_BRIDGE})(${generation},null/*cInsightFrameState*/);</script>`;
  return html.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/gi, "")
    .replace(/<link\s+rel="stylesheet"\s+href="[^"]*codicon\.css"[^>]*>/gi, "<!--cInsightIcons-->")
    .replace(/nonce="[^"]*"/g, `nonce="${nonce}"`).replace(/<head([^>]*)>/i, `<head$1>${bridge}`);
}

function scriptJson(value: unknown): string { return JSON.stringify(value).replace(/</g, "\\u003c"); }

export const FRAME_BRIDGE = String.raw`function(generation, initialState) {
  let state = initialState;
  const send = (kind, payload) => parent.postMessage({bridge:'cInsight.pane',generation,kind,payload}, '*');
  const api = {postMessage:payload => send('message',payload), getState:()=>state,
    setState:value => {state=value;send('state',value);return value;}};
  window.acquireVsCodeApi = () => api;
  function theme(){
    const computed=parent.getComputedStyle(parent.document.body);
    for(let i=0;i<computed.length;i++){const name=computed[i];if(name.startsWith('--vscode-'))document.documentElement.style.setProperty(name,computed.getPropertyValue(name));}
    if(document.body){document.body.className=parent.document.body.className;for(const name of ['data-vscode-theme-kind','data-vscode-theme-name','data-vscode-theme-id']){const value=parent.document.body.getAttribute(name);if(value!==null)document.body.setAttribute(name,value);}}
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
  send('ready',{});
}`;

export const COMBINED_CLIENT = String.raw`
const vscode=acquireVsCodeApi(), container=document.getElementById('panes'), viewport=document.getElementById('viewport');
const fontUrl=URL.createObjectURL(new Blob([Uint8Array.from(atob(icons.font),character=>character.charCodeAt(0))],{type:'font/ttf'}));
const iconStyle='<style nonce="'+paneNonce+'">'+icons.css.replace(/\.\/codicon\.ttf(?:\?[^"')\s]+)?/g,fontUrl)+'</style>';
window.addEventListener('pagehide',()=>URL.revokeObjectURL(fontUrl));
const saved=vscode.getState()||{}, frames=new Map(), paneState=saved.panes||{};
let layout={views:[],ratios:[],direction:'horizontal'}, hoverEnabled=true, hovered=-1, candidate, enterTimer, leaveTimer, busy=false, suspended=false, dragging, lastPoint;
const post=message=>vscode.postMessage(message);
const persist=()=>vscode.setState({panes:paneState});
function button(icon,title,action){const button=document.createElement('button');button.className='codicon codicon-'+icon;button.title=title;button.setAttribute('aria-label',title);button.addEventListener('click',action);return button;}
document.getElementById('bar').append(
  button('add',labels.add,()=>post({type:'manage',action:'add'})),
  button('layout',labels.direction,()=>post({type:'manage',action:'direction'})),
  button('expand-all',labels.hover,()=>post({type:'manage',action:'hover'})),
  button('gear',labels.manage,()=>post({type:'manage',action:'menu'})));
function resize(){
  if(dragging)return;
  const vertical=layout.direction==='vertical', total=(vertical?viewport.clientHeight:viewport.clientWidth)-Math.max(0,layout.views.length-1)*5;
  const expanded=layout.views.filter(role=>!frames.get(role)?.element.classList.contains('collapsed'));
  const sizes=sizesFor(total-(layout.views.length-expanded.length)*28,expanded.map(role=>layout.ratios[layout.views.indexOf(role)]),vertical?80:160,hoverEnabled?expanded.indexOf(layout.views[hovered]):-1);
  layout.views.forEach(role=>{const item=frames.get(role);if(item)item.element.style.flexBasis=(expanded.includes(role)?sizes[expanded.indexOf(role)]:28)+'px';});
}
function consider(role,activity){
  busy=!!activity.busy;
  if(busy||suspended||dragging||!activity.move)return;
  if(lastPoint&&activity.x===lastPoint.x&&activity.y===lastPoint.y)return;
  lastPoint={x:activity.x,y:activity.y};
  clearTimeout(leaveTimer);
  if(candidate===role)return;
  candidate=role;clearTimeout(enterTimer);
  enterTimer=setTimeout(()=>{if(!busy&&!suspended&&!dragging&&hoverEnabled){hovered=layout.views.indexOf(role);resize();}},200);
}
document.body.addEventListener('pointermove',event=>{
  const pane=event.target.closest?.('.pane');
  if(pane)consider(pane.dataset.role,{move:true,x:event.screenX,y:event.screenY,busy:!!event.buttons});
});
document.body.addEventListener('mouseleave',()=>{
  clearTimeout(enterTimer);candidate=undefined;
  clearTimeout(leaveTimer);leaveTimer=setTimeout(()=>{if(!busy&&!suspended&&!dragging){hovered=-1;resize();}},250);
});
function render(message){
  const previousRoles=layout.views.join();layout=message.layout;hoverEnabled=message.hover;
  if(candidate&&!layout.views.includes(candidate)){candidate=undefined;hovered=-1;}
  hovered=candidate?layout.views.indexOf(candidate):-1;
  document.getElementById('name').textContent=message.title;
  const toggle=document.getElementById('bar').querySelector('.codicon-expand-all');toggle.setAttribute('aria-pressed',String(hoverEnabled));
  container.classList.toggle('vertical',layout.direction==='vertical');
  for(const [role,item] of frames)if(!layout.views.includes(role)){item.element.remove();frames.delete(role);delete paneState[role];}
  for(const pane of message.panes){
    let item=frames.get(pane.role);
    if(!item){
      const element=document.createElement('section');element.className='pane';element.dataset.role=pane.role;
      const header=document.createElement('header'), title=document.createElement('span');title.className='title';title.textContent=pane.title;
      const iframe=document.createElement('iframe');iframe.title=pane.title;iframe.setAttribute('sandbox','allow-scripts allow-same-origin');
      const actions=document.createElement('span');actions.className='actions';
      const collapse=button('chevron-down',labels.collapse,()=>{
        const collapsed=!element.classList.contains('collapsed');element.classList.toggle('collapsed',collapsed);
        collapse.className='codicon codicon-chevron-'+(collapsed?'right':'down');collapse.setAttribute('aria-expanded',String(!collapsed));
        paneState[pane.role]={...paneState[pane.role],collapsed};persist();post({type:'collapse',role:pane.role,collapsed});resize();
      });
      header.append(collapse,title,actions,button('ellipsis',labels.actions,()=>post({type:'paneMenu',role:pane.role})));
      element.append(header,iframe);item={element,iframe,actions,generation:-1};frames.set(pane.role,item);
      if(paneState[pane.role]?.collapsed){element.classList.add('collapsed');collapse.className='codicon codicon-chevron-right';post({type:'collapse',role:pane.role,collapsed:true});}
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
  if(frames.get(layout.views[index]).element.classList.contains('collapsed')||frames.get(layout.views[index+1]).element.classList.contains('collapsed'))return;
  if(event.button!==0)return;event.preventDefault();clearTimeout(enterTimer);clearTimeout(leaveTimer);hovered=-1;resize();
  const vertical=layout.direction==='vertical',sizes=layout.views.map(role=>frames.get(role).element.getBoundingClientRect()[vertical?'height':'width']);
  dragging={index,element,start:vertical?event.clientY:event.clientX,sizes};container.classList.add('dragging');element.setPointerCapture(event.pointerId);
}
function moveDrag(event){if(!dragging)return;const {index,start,sizes}=dragging,vertical=layout.direction==='vertical',minimum=vertical?80:160;
  const delta=Math.max(minimum-sizes[index],Math.min(sizes[index+1]-minimum,(vertical?event.clientY:event.clientX)-start));
  layout.ratios=[...sizes];layout.ratios[index]+=delta;layout.ratios[index+1]-=delta;
  layout.views.forEach((role,index)=>frames.get(role).element.style.flexBasis=layout.ratios[index]+'px');
}
function finishDrag(event){if(!dragging)return;const element=dragging.element;dragging=undefined;busy=false;candidate=undefined;container.classList.remove('dragging');
  if(element.hasPointerCapture(event.pointerId))element.releasePointerCapture(event.pointerId);post({type:'ratios',ratios:layout.ratios});resize();}
window.addEventListener('message',event=>{
  const message=event.data;
  if(message?.bridge==='cInsight.pane'){
    const entry=[...frames.entries()].find(([,item])=>item.iframe.contentWindow===event.source);
    if(!entry||entry[1].generation!==message.generation)return;
    const [role]=entry;
    if(message.kind==='state'){paneState[role]={...paneState[role],value:message.payload};persist();}
    else if(message.kind==='activity')consider(role,message.payload||{});
    else if(message.kind==='focus')post({type:'focus',role});
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
  }else if(message?.type==='suspend'){suspended=message.value;clearTimeout(enterTimer);if(suspended){hovered=-1;resize();}else{candidate=undefined;busy=false;}}
  else if(testMode&&message?.type==='testInteraction'){
    const item=frames.get(message.role);
    if(message.action==='hover')consider(message.role,{move:true,x:message.x||100,y:120,busy:false});
    else if(message.action==='leave')document.body.dispatchEvent(new MouseEvent('mouseleave'));
    else if(message.action==='collapse')item?.element.querySelector('button').click();
    else if(message.action==='filter'){
      const input=item?.iframe.contentDocument.getElementById('filter');if(input){input.value=message.value;input.dispatchEvent(new Event('input'));}
    }
    else if(message.action==='viewport'){viewport.style.width='1200px';viewport.style.height='500px';viewport.style.flex='none';resize();}
  }
  else if(testMode&&message?.type==='inspect')post({type:'inspection',request:message.request,panes:[...frames].map(([role,item])=>{
    const child=item.iframe.contentDocument,icon=child?.querySelector('.codicon');
    return {role,generation:item.generation,collapsed:item.element.classList.contains('collapsed'),width:item.element.clientWidth,height:item.element.clientHeight,filter:child?.getElementById('filter')?.value,theme:item.iframe.contentWindow?.getComputedStyle(child.body).getPropertyValue('--vscode-foreground'),iconFont:icon?item.iframe.contentWindow.getComputedStyle(icon).fontFamily:undefined};
  }),hovered});
});
new ResizeObserver(resize).observe(viewport);
new MutationObserver(()=>frames.forEach(item=>item.iframe.contentWindow.postMessage({bridge:'cInsight.theme'},'*'))).observe(document.body,{attributes:true,attributeFilter:['class','style','data-vscode-theme-kind','data-vscode-theme-name','data-vscode-theme-id']});
post({type:'ready',states:paneState});
`;
