/** Browser-only pointer controller. It never moves a pane's DOM or owns feature state. */
export const PANE_REORDER_CLIENT = String.raw`
function createPaneReorder(options) {
  const {container,viewport,readLayout,keyFor,canStart,onStart,onEnd,onDrop,label}=options;
  let session,animation;
  const overlay=document.createElement('div'),ghost=document.createElement('div'),marker=document.createElement('div');
  overlay.className='reorder-overlay';ghost.className='reorder-ghost';marker.className='reorder-marker';
  overlay.hidden=ghost.hidden=marker.hidden=true;ghost.setAttribute('aria-hidden','true');marker.setAttribute('aria-hidden','true');
  document.body.append(overlay,ghost,marker);
  const bounds=()=>viewport.getBoundingClientRect();
  function inside(x,y){const rect=bounds();return x>=rect.left&&x<rect.right&&y>=rect.top&&y<rect.bottom;}
  function updateTarget(){
    if(!session?.started)return;
    const {x,y,vertical}=session;
    ghost.style.left=(x+12)+'px';ghost.style.top=(y+12)+'px';
    session.target=undefined;marker.hidden=true;
    if(!inside(x,y))return;
    const coordinate=vertical?y:x,rect=bounds();
    const candidates=readLayout().views.filter(role=>role!==session.role).map(role=>({role,rect:container.querySelector('[data-role="'+role+'"]').getBoundingClientRect()}));
    if(!candidates.length)return;
    let target=candidates.find(item=>coordinate<(vertical?(item.rect.top+item.rect.bottom):(item.rect.left+item.rect.right))/2);
    const side=target?'before':'after';target=target||candidates[candidates.length-1];
    session.target={role:target.role,side};
    const edge=side==='before'?(vertical?target.rect.top:target.rect.left):(vertical?target.rect.bottom:target.rect.right);
    marker.hidden=false;
    marker.style.left=(vertical?rect.left:Math.max(rect.left,Math.min(rect.right-3,edge-1)))+'px';
    marker.style.top=(vertical?Math.max(rect.top,Math.min(rect.bottom-3,edge-1)):rect.top)+'px';
    marker.style.width=(vertical?rect.width:3)+'px';marker.style.height=(vertical?3:rect.height)+'px';
  }
  function tick(){
    if(!session?.started)return;
    if(inside(session.x,session.y)){
      const rect=bounds(),coordinate=session.vertical?session.y:session.x;
      const start=session.vertical?rect.top:rect.left,end=session.vertical?rect.bottom:rect.right;
      const delta=coordinate<start+28?-Math.ceil(12*(start+28-coordinate)/28):coordinate>end-28?Math.ceil(12*(coordinate-end+28)/28):0;
      if(delta){if(session.vertical)viewport.scrollTop+=delta;else viewport.scrollLeft+=delta;updateTarget();}
    }
    animation=requestAnimationFrame(tick);
  }
  function cancel(event){finish(event,true);}
  function finish(event,cancelled=false){
    if(!session)return;
    if(event?.pointerId!==undefined&&event.pointerId!==session.pointerId)return;
    const current=session;
    if(event?.clientX!==undefined){current.x=event.clientX;current.y=event.clientY;updateTarget();}
    session=undefined;cancelAnimationFrame(animation);animation=undefined;
    overlay.hidden=ghost.hidden=marker.hidden=true;container.classList.remove('reordering');
    try{if(current.element.hasPointerCapture(current.pointerId))current.element.releasePointerCapture(current.pointerId);}catch{/* Window loss may have released it already. */}
    if(current.started&&!cancelled&&current.target&&inside(current.x,current.y)&&current.revision===keyFor(readLayout()))
      onDrop(current.role,current.target.role,current.target.side,current.revision);
    onEnd(cancelled?current.lastEvent:(event||current.lastEvent),current.started);
  }
  function move(event){
    if(!session||event.pointerId!==session.pointerId)return;
    session.lastEvent=event;
    if(event.buttons===0){cancel(event);return;}
    session.x=event.clientX;session.y=event.clientY;
    if(!session.started){
      if(Math.hypot(session.x-session.startX,session.y-session.startY)<6)return;
      session.started=true;
      const panes=[...container.querySelectorAll('.pane')].map(element=>({element,size:element.getBoundingClientRect()[session.vertical?'height':'width']}));
      container.classList.add('reordering');panes.forEach(({element,size})=>element.style.flexBasis=size+'px');
      overlay.hidden=ghost.hidden=false;ghost.textContent=session.element.textContent;onStart();
      animation=requestAnimationFrame(tick);
    }
    event.preventDefault();updateTarget();
  }
  window.addEventListener('pointermove',move,true);
  window.addEventListener('pointerup',event=>finish(event),true);
  window.addEventListener('pointercancel',cancel,true);
  window.addEventListener('blur',()=>cancel());
  window.addEventListener('pagehide',()=>cancel());
  window.addEventListener('keydown',event=>{if(event.key==='Escape'&&session){event.preventDefault();event.stopImmediatePropagation();cancel();}},true);
  return {
    get active(){return !!session;},
    attach(element,role){
      element.title=label; // Buttons remain separate siblings, not drag handles.
      element.addEventListener('pointerdown',event=>{
        if(event.button!==0||session||!canStart()||readLayout().views.length<2)return;
        event.preventDefault();
        session={element,role,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,
          vertical:readLayout().direction==='vertical',revision:keyFor(readLayout()),started:false,lastEvent:event};
        try{element.setPointerCapture(event.pointerId);}catch{/* Synthetic test events do not own a hardware pointer. */}
      });
      element.addEventListener('lostpointercapture',event=>cancel(event));
    },
    layoutChanged(next){if(session&&keyFor(next)!==session.revision)cancel();},
    cancel,
  };
}
`;
