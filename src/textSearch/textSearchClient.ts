/** Browser-only presentation state. All source access and replacement authority remain in the host. */
export const TEXT_SEARCH_CLIENT = String.raw`
const vscode=acquireVsCodeApi(), $=id=>document.getElementById(id);
let state,selected,sequence=0,generation=-1,flat=[],rowHeight=26,frame,maximumWidth=0;
const files=new Map(),checked=new Set(),collapsed=new Map(),rendered=new Map();
const send=(type,extra={})=>vscode.postMessage({type,revision:state?.revision,...extra});
$('openResultsTop').textContent=labels.openResults;$('openResultsTop').onclick=()=>send('openResults');
for(const id of ['search','current','checked','all'])$(id).textContent=labels[id];
for(const id of ['query','replacement','include','exclude']){$(id).placeholder=labels[id];$(id).setAttribute('aria-label',labels[id]);}
for(const id of ['clear','cancel','previous','next','folder']){$(id).title=labels[id];$(id).setAttribute('aria-label',labels[id]);}
$('toggle').title=labels.replace;$('preserveLabel').textContent=labels.preserveCase;$('ignoresLabel').textContent=labels.useIgnores;
for(const id of ['caseSensitive','wholeWord','regex']){
  const label=document.createElement('label');label.className='option';const input=document.createElement('input');input.type='checkbox';input.id=id;
  label.append(input,document.createTextNode(labels[id]));$('options').append(label);
}
for(const id of ['workspace','file','open','folder']){const option=document.createElement('option');option.value=id;option.textContent=labels[id];$('scope').append(option);}
$('scope').setAttribute('aria-label',labels.scope);
const input=()=>{const value={client,sequence:++sequence};for(const id of ['query','replacement','include','exclude','scope'])value[id]=$(id).value;
  for(const id of ['caseSensitive','wholeWord','regex','useIgnores','preserveCase'])value[id]=$(id).checked;send('input',value);};
for(const id of ['query','replacement','include','exclude'])$(id).addEventListener('input',input);
for(const id of ['caseSensitive','wholeWord','regex','useIgnores','preserveCase'])$(id).onchange=input;
$('scope').onchange=()=>{input();if($('scope').value==='folder')send('folder');};$('folder').onclick=()=>send('folder');
$('search').onclick=()=>{input();send('search');};$('clear').onclick=()=>{$('query').value='';input();$('query').focus();};
$('cancel').onclick=()=>send('cancel');$('toggle').onclick=()=>send('toggle');
for(const id of ['current','checked','all'])$(id).onclick=()=>send('plan',{mode:id});
for(const id of ['previous','next'])$(id).onclick=()=>send(id);
$('query').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();input();send('search');}};
document.addEventListener('keydown',event=>{
  if(!readOnly&&(event.ctrlKey||event.metaKey)&&['f','h'].includes(event.key.toLowerCase())){
    event.preventDefault();event.stopPropagation();if(event.key.toLowerCase()==='h')send('toggle',{show:true});else{$('query').focus();$('query').select();}
  }
});
const results=$('results'),space=document.createElement('div'),layer=document.createElement('div');
space.className='search-space';layer.className='search-layer';space.append(layer);results.append(space);
function rebuild(){
  const anchor=flat[Math.floor(results.scrollTop/rowHeight)]?.key,offset=results.scrollTop%rowHeight;
  flat=[];for(const file of files.values()){
    flat.push({key:'file/'+file.id,file});if(!collapsed.get(file.id))for(const match of file.matches)flat.push({key:match.id,file,match});
  }
  if(anchor){const index=flat.findIndex(row=>row.key===anchor);if(index>=0)results.scrollTop=index*rowHeight+offset;}
}
function rowFor(entry){
  if(!entry.match){
    const details=document.createElement('details'),summary=document.createElement('summary'),checkbox=document.createElement('input'),label=document.createElement('span'),replace=document.createElement('button');
    details.className='search-group';details.dataset.id=entry.file.id;checkbox.type='checkbox';checkbox.title=labels.selectAll;
    details.addEventListener('toggle',()=>{
      const closed=!details.open;if(!!collapsed.get(details.dataset.id)===closed)return;
      collapsed.set(details.dataset.id,closed);rebuild();draw();
    });
    checkbox.onclick=event=>{event.stopPropagation();send('check',{id:details.dataset.id,checked:checkbox.checked});};
    replace.textContent='⇄';replace.title=labels.inFile;replace.onclick=event=>{event.preventDefault();event.stopPropagation();send('plan',{mode:'file',id:details.dataset.id});};
    summary.append(checkbox,label,replace);details.append(summary);
    return {element:details,checkbox,label,replace};
  }
  const element=document.createElement('div'),checkbox=document.createElement('input'),location=document.createElement('span'),snippet=document.createElement('span');
  element.className='match';element.tabIndex=0;element.dataset.id=entry.match.id;checkbox.type='checkbox';checkbox.setAttribute('aria-label',labels.checked);
  checkbox.onclick=event=>{event.stopPropagation();send('check',{id:element.dataset.id,checked:checkbox.checked});};
  location.className='location';snippet.className='snippet';element.append(checkbox,location,snippet);
  element.onclick=event=>{if(event.detail===1)send('activate',{id:element.dataset.id,intent:'preview'});};
  element.ondblclick=()=>send('activate',{id:element.dataset.id,intent:'open'});
  element.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();send('activate',{id:element.dataset.id,intent:'open'});}};
  return {element,checkbox,location,snippet};
}
function updateRow(row,entry){
  row.element.style.height=rowHeight+'px';row.element.style.lineHeight=rowHeight+'px';
  if(!entry.match){
    const file=entry.file;row.element.open=!collapsed.get(file.id);
    row.label.textContent=' '+file.label+' ('+file.totalMatches+') ';
    row.checkbox.checked=file.checkedMatches===file.totalMatches;row.checkbox.indeterminate=!row.checkbox.checked&&file.checkedMatches>0;
    row.replace.hidden=!state.replaceVisible;row.replace.disabled=!state.ready||state.planning;
  }else{
    const match=entry.match;row.checkbox.checked=checked.has(match.id);row.element.classList.toggle('selected',match.id===selected);
    if(row.match!==match){
      row.location.textContent=(match.line+1)+':'+(match.character+1)+' ';const mark=document.createElement('mark');
      mark.textContent=match.snippet.slice(match.highlightStart,match.highlightEnd)||'▏';
      row.snippet.replaceChildren(document.createTextNode(match.snippet.slice(0,match.highlightStart)),mark,document.createTextNode(match.snippet.slice(match.highlightEnd)));
      row.match=match;
    }
  }
}
function draw(){
  if(!state)return;
  const style=getComputedStyle(document.body);
  rowHeight=Math.max(26,Math.ceil((parseFloat(style.fontSize)||13)*1.6),Math.ceil((parseFloat(style.getPropertyValue('--vscode-editor-font-size'))||13)*1.6));
  const window=windowFor(flat.length,results.clientHeight,results.scrollTop,rowHeight),keys=new Set();
  space.style.height=window.height+'px';layer.style.transform='translateY('+window.offset+'px)';
  let index=0;for(const entry of flat.slice(window.start,window.end)){
    keys.add(entry.key);let row=rendered.get(entry.key);if(!row){row=rowFor(entry);rendered.set(entry.key,row);}
    updateRow(row,entry);const at=layer.children[index++];if(at!==row.element)layer.insertBefore(row.element,at||null);
  }
  for(const [key,row]of rendered)if(!keys.has(key)){row.element.remove();rendered.delete(key);}
  maximumWidth=Math.max(maximumWidth,layer.scrollWidth,results.clientWidth);space.style.minWidth=maximumWidth+'px';
  document.body.dataset.searchRendered=String(rendered.size);document.body.dataset.searchTotal=String(flat.length);
}
function scheduleDraw(){if(frame)return;frame=requestAnimationFrame(()=>{frame=undefined;draw();});}
results.addEventListener('scroll',scheduleDraw,{passive:true});new ResizeObserver(scheduleDraw).observe(results);
new MutationObserver(scheduleDraw).observe(document.body,{attributes:true,attributeFilter:['class','style']});
function paint(next){
  state=next;selected=state.selected;const changedGeneration=generation!==state.generation;
  if(changedGeneration){generation=state.generation;collapsed.clear();maximumWidth=0;results.scrollTop=0;}
  if(state.reset){files.clear();checked.clear();}
  for(const id of state.removed||[])files.delete(id);for(const file of state.files||[])files.set(file.id,file);
  for(const id of state.checkedRemoved||[])checked.delete(id);for(const id of state.checkedAdded||[])checked.add(id);
  const pending=state.editOrigin===client&&state.editSequence<sequence;
  if(!pending){
    for(const id of ['query','include','exclude','scope']){const value=state.request[id]??'';if($(id).value!==value)$(id).value=value;}
    if($('replacement').value!==state.replacement)$('replacement').value=state.replacement;
    for(const id of ['caseSensitive','wholeWord','regex','useIgnores'])$(id).checked=state.request[id];$('preserveCase').checked=state.preserveCase;
  }
  $('replaceArea').hidden=!state.replaceVisible;$('cancel').disabled=!state.loading;$('search').disabled=state.planning;$('folder').hidden=state.request.scope!=='folder';
  $('snapshotQuery').textContent=readOnly?labels.snapshot+': '+state.request.query:'';
  for(const action of document.querySelectorAll('.result-actions'))action.hidden=!state.stats.matches;
  for(const id of ['current','checked','all'])$(id).disabled=!state.ready||state.planning;
  const stats=state.stats;$('status').textContent=[state.error,state.loading?labels.searching:'',state.stale?labels.stale:'',
    readOnly&&!state.loading?labels.frozen:'',(stats.cancelled||stats.limited||stats.skipped||stats.timedOut)?labels.partial:'',labels.summary+': '+[stats.matches,stats.files,stats.skipped,stats.timedOut].join(' / '),
    !readOnly?labels.shown+': '+state.shown+' / '+stats.matches+'; '+labels.hiddenChecked+': '+state.hiddenChecked:'',!files.size?labels.idle:''].filter(Boolean).join('\n');
  const plan=$('plan');plan.hidden=!state.plan;
  if(plan.dataset.plan!==(state.plan?.id||'')){
    plan.dataset.plan=state.plan?.id||'';plan.replaceChildren();if(state.plan){
      const apply=document.createElement('button');apply.textContent=labels.apply+' ('+state.plan.count+')';apply.onclick=()=>send('apply',{plan:state.plan.id});plan.append(apply);
      for(const file of state.plan.files){const button=document.createElement('button');button.textContent=file.label;button.title=labels.diff;button.onclick=()=>send('diff',{id:file.id});plan.append(button);}
    }
  }
  const apply=plan.querySelector('button');if(apply)apply.disabled=!state.ready||state.planning;
  if(changedGeneration||state.reset||state.files?.length||state.removed?.length)rebuild();draw();
}
window.addEventListener('message',event=>{if(event.data?.type==='state')paint(event.data);else if(event.data?.type==='focus')$('query').focus();});
send('ready');
`;
