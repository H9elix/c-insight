import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import { combinedLayout, combinedLayoutRevision } from "../../src/combined/combinedModel";
import { PANE_REORDER_CLIENT } from "../../src/combined/combinedReorderClient";

function harness(vertical=false) {
  const listeners=new Map<string,Array<(event:any)=>void>>(),panes:any[]=[],attached:any[]=[];
  const raf=new Map<number,()=>void>();let next=0,started=0,ended=0,enabled=true,lastEnd:any;
  let layout=combinedLayout({enabled:true,direction:vertical?"vertical":"horizontal",views:["symbols","callers","preview"],ratios:[3,2,1]});
  const viewport={scrollLeft:0,scrollTop:0,getBoundingClientRect:()=>({left:0,top:0,right:300,bottom:180,width:300,height:180})};
  const element=()=>({hidden:false,style:{} as any,textContent:"Title",title:"",setAttribute:()=>undefined,
    classList:{add:()=>undefined,remove:()=>undefined},listeners:new Map<string,(event:any)=>void>(),capture:false,
    addEventListener(name:string,listener:(event:any)=>void){this.listeners.set(name,listener);},
    setPointerCapture(){this.capture=true;},hasPointerCapture(){return this.capture;},releasePointerCapture(){this.capture=false;}});
  for(const [index,role] of layout.views.entries())panes.push({...element(),role,titleElement:element(),getBoundingClientRect:()=>({
    left:vertical?0:index*100-viewport.scrollLeft,right:vertical?300:(index+1)*100-viewport.scrollLeft,
    top:vertical?index*80-viewport.scrollTop:0,bottom:vertical?(index+1)*80-viewport.scrollTop:180,width:vertical?300:100,height:vertical?80:180,
  })});
  const container={...element(),querySelectorAll:()=>panes,querySelector:(selector:string)=>panes.find(pane=>selector.includes('"'+pane.role+'"'))};
  const drops:any[]=[];
  const factory=runInNewContext(`${PANE_REORDER_CLIENT};createPaneReorder`,{
    document:{body:{append:(...items:unknown[])=>attached.push(...items)},createElement:element},
    window:{addEventListener:(name:string,listener:(event:any)=>void)=>listeners.set(name,[...(listeners.get(name)??[]),listener])},
    requestAnimationFrame:(callback:()=>void)=>{raf.set(++next,callback);return next;},cancelAnimationFrame:(id:number)=>raf.delete(id),
  });
  const controller=factory({container,viewport,readLayout:()=>layout,keyFor:combinedLayoutRevision,canStart:()=>enabled,
    onStart:()=>started++,onEnd:(event:unknown)=>{ended++;lastEnd=event;},onDrop:(...args:unknown[])=>drops.push(args),label:"Drag"});
  panes.forEach(pane=>controller.attach(pane.titleElement,pane.role));
  const event=(x=20,y=10,extra:Record<string,unknown>={})=>({button:0,buttons:1,pointerId:1,clientX:x,clientY:y,screenX:x+10,screenY:y+10,preventDefault:()=>undefined,stopImmediatePropagation:()=>undefined,...extra});
  const emit=(name:string,value=event())=>listeners.get(name)?.forEach(listener=>listener(value));
  const down=(role="symbols",value=event())=>panes.find(pane=>pane.role===role).titleElement.listeners.get("pointerdown")(value);
  return {controller,viewport,panes,attached,drops,event,emit,down,raf,get started(){return started;},get ended(){return ended;},get lastEnd(){return lastEnd;},
    get layout(){return layout;},set layout(value:typeof layout){layout=value;controller.layoutChanged(layout);},disable:()=>{enabled=false;},
    tick:()=>{const callbacks=[...raf];raf.clear();callbacks.forEach(([,callback])=>callback());}};
}

describe("combined pane reorder pointer handlers",()=>{
  it("does not drag on a small click or non-primary button",()=>{
    const h=harness();h.down();h.emit("pointermove",h.event(24,10));assert.equal(h.started,0);
    h.emit("pointerup",h.event(24,10));assert.equal(h.drops.length,0);assert(!h.controller.active);
    h.down("symbols",h.event(20,10,{button:2}));assert(!h.controller.active);
    h.disable();h.down();assert(!h.controller.active);
    const single=harness();single.layout={...single.layout,views:["symbols"],ratios:[1]};single.down();assert(!single.controller.active);
  });
  it("inserts horizontally and cleans capture, overlays and animation on release",()=>{
    const h=harness();h.down();h.emit("pointermove",h.event(280,100));
    assert.equal(h.started,1);assert(h.controller.active);assert(h.attached.every(item=>!item.hidden));assert.equal(h.drops.length,0);
    h.emit("pointercancel",h.event(280,100,{pointerId:2}));assert(h.controller.active,"An unrelated pointer cannot cancel this drag");
    h.emit("pointerup",h.event(280,100,{buttons:0}));assert.equal(h.drops.length,1);
    assert.deepEqual(h.drops[0].slice(0,3),["symbols","preview","after"]);
    assert.equal(h.drops[0][3],combinedLayoutRevision(h.layout));assert(!h.controller.active);
    assert(h.attached.every(item=>item.hidden));assert(!h.panes[0].titleElement.capture);assert.equal(h.raf.size,0);
  });
  it("uses vertical insertion and scrolls toward the active-axis edge",()=>{
    const h=harness(true);h.viewport.scrollTop=40;h.down("preview",h.event(100,130));h.emit("pointermove",h.event(100,4));h.tick();
    assert(h.viewport.scrollTop<40&&h.viewport.scrollTop>=0);assert.equal(h.viewport.scrollLeft,0);
    h.emit("pointerup",h.event(100,4,{buttons:0}));assert.deepEqual(h.drops[0].slice(0,3),["preview","symbols","before"]);
    const horizontal=harness();horizontal.down();horizontal.emit("pointermove",horizontal.event(296,100));horizontal.tick();
    assert(horizontal.viewport.scrollLeft>0);assert.equal(horizontal.viewport.scrollTop,0);horizontal.controller.cancel();assert.equal(horizontal.raf.size,0);
  });
  for(const cancel of ["Escape","pointercancel","blur","lostpointercapture","outside","released"]){
    it(`cancels on ${cancel} without a drop`,()=>{
      const h=harness();h.down();h.emit("pointermove",h.event(280,100));
      if(cancel==="Escape")h.emit("keydown",h.event(0,0,{key:"Escape"}));
      else if(cancel==="outside")h.emit("pointerup",h.event(350,100,{buttons:0}));
      else if(cancel==="released")h.emit("pointermove",h.event(280,100,{buttons:0}));
      else if(cancel==="lostpointercapture")h.panes[0].titleElement.listeners.get("lostpointercapture")(h.event());
      else h.emit(cancel,h.event());
      assert.equal(h.drops.length,0);assert(!h.controller.active);assert.equal(h.raf.size,0);assert(h.attached.every(item=>item.hidden));
      if(cancel==="Escape"||cancel==="blur")assert.equal(h.lastEnd.screenX,290,"Resume hover only after a new physical position, not stale pre-drag coordinates");
    });
  }
  it("retains a drag on unrelated title changes but cancels altered layouts",()=>{
    for(const change of ["weights","direction","roles","hoverSize"]){
      const h=harness();h.down();h.emit("pointermove",h.event(280,100));
      h.layout={...h.layout,title:"Renamed"};assert(h.controller.active);
      h.layout=change==="weights"?{...h.layout,ratios:[1,1,1]}:change==="direction"?{...h.layout,direction:"vertical"}:change==="hoverSize"?{...h.layout,hoverSizePercentages:{preview:65}}:{...h.layout,views:["callers","preview"]};
      assert(!h.controller.active);assert.equal(h.drops.length,0);assert.equal(h.raf.size,0);
    }
  });
});
