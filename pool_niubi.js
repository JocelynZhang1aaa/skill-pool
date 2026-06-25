/* =========================================================
   pool-niubi · game.js · v4 修复版
   ---------------------------------------------------------
   修复清单：
   1. 物理/渲染同步 — 固定步长累加器，单 RAF 顺序执行
   2. script 路径 — HTML 已指向 pool_niubi.js（无 404）
   3. 回合卡死 — _settleGuard 锁，一杆只切一次回合
   4. 震颤（亚像素）— renderBalls 中坐标 Math.round
   5. 震颤（慢速蠕变）— dampCreepingBalls 硬清零
   6. 母球落袋 — 切回合前统一复位，不打断流程
   7. botPlay 空值防御
   ========================================================= */

(function(){
'use strict';

// ---------- Matter.js 加载检查 ----------
if (typeof Matter === 'undefined'){
  console.error('[niubi] Matter.js 未加载（matter.min.js 404？）');
  return;
}
const { Engine, World, Bodies, Body, Composite, Events, Vector } = Matter;

// ---------- 0. 工具 ----------
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function angDiff(a, b){
  let d = a - b;
  while (d > Math.PI) d -= 2*Math.PI;
  while (d < -Math.PI) d += 2*Math.PI;
  return d;
}
function log(...args){
  const box = $('#dev-log');
  if (box){
    const el = document.createElement('div');
    el.innerHTML = '<span class="ts">' + new Date().toLocaleTimeString() + '</span> ' + args.join(' ');
    box.prepend(el);
  }
  console.log('[niubi]', ...args);
}

// ---------- 1. Bot Profile ----------
const BOT_PROFILES = {
  xiaomai: {
    id:'xiaomai', name:'小麦', emoji:'🌾',
    personality:{ trash_talk:0.7, encouragement:0.6, calm:0.3 },
    skill:{ power_control:0.55, angle_precision:0.5, english_use:0.2, safety_preference:0.2, pressure_resistance:0.4 },
    win_rate:0.5,
    memory_focus:'玩家自嘲、爆笑失误、连胜瞬间',
    callbacks:['你上次那杆白球都进了我笑了一周','别紧张啊~深呼吸','这球我猜你会打丢——果然']
  },
  xien: {
    id:'xien', name:'席恩', emoji:'🌙',
    personality:{ trash_talk:0.1, encouragement:0.3, calm:0.9 },
    skill:{ power_control:0.8, angle_precision:0.85, english_use:0.6, safety_preference:0.7, pressure_resistance:0.85 },
    win_rate:0.7,
    memory_focus:'关键球决策、防守路线、长台准度',
    callbacks:['上次你那杆斯诺克让我守了三杆才解开','稳一点','这球先做球型']
  },
  daike: {
    id:'daike', name:'代柯', emoji:'🔥',
    personality:{ trash_talk:0.4, encouragement:0.1, calm:0.2 },
    skill:{ power_control:0.7, angle_precision:0.65, english_use:0.8, safety_preference:0.1, pressure_resistance:0.5 },
    win_rate:0.6,
    memory_focus:'极限走位、暴力翻袋、连击瞬间',
    callbacks:['硬干','我直接清台','这球能翻']
  }
};

// ---------- 2. 桌面坐标 & 物理调参 ----------
const TABLE = { w:400, h:800, cushion:22, ballR:14 };
const PHYS = {
  frictionAir:0.018, friction:0.02, frictionStatic:0.02,
  restitution:0.95, wallRestitution:0.78,
  density:0.045, maxSpeed:34, minSpeed:6,
  sleepSpeed:0.18, spinFactor:0.05, pocketR:17
};
const POCKETS = [
  { x:26,  y:26,  r:22, kind:'corner', name:'top_left' },
  { x:374, y:26,  r:22, kind:'corner', name:'top_right' },
  { x:20,  y:400, r:19, kind:'side',   name:'middle_left' },
  { x:380, y:400, r:19, kind:'side',   name:'middle_right' },
  { x:26,  y:774, r:22, kind:'corner', name:'bottom_left' },
  { x:374, y:774, r:22, kind:'corner', name:'bottom_right' }
];
const BALL_COLORS = {
  1:'#f4c93a',2:'#1f5fbd',3:'#d63a3a',4:'#5a3aa8',
  5:'#e3801c',6:'#1f7d3d',7:'#7a1d1d',8:'#1a1a1a',
  9:'#f4c93a',10:'#1f5fbd',11:'#d63a3a',12:'#5a3aa8',
  13:'#e3801c',14:'#1f7d3d',15:'#7a1d1d'
};

// ---------- 3. 状态 ----------
const State = {
  matchId:null, startTs:null,
  botProfile:BOT_PROFILES.xiaomai,
  balls:[], cue:null,
  turn:'me', shotSeq:0,
  telemetry:[], pttHistory:[],
  myGroup:null, botGroup:null,
  ended:false, result:null,
  broke:false,
  phase:'IDLE',
  aimAngle:-Math.PI/2,
  aimTargetAngle:-Math.PI/2,
  aimPower:0,
  spin:{ x:0, y:0 },
  cueBallResetting:false   // 修复6：母球复位中，延迟切回合
};

let engine=null, world=null, walls=[];
let ballCache = {};
let canvas=null, ctx=null;

// 修复3：回合卡死防御锁
let _settleGuard = false;

// 修复1：固定步长累加器
let _lastTS = 0;
let _accumulator = 0;
const FIXED_DT = 1000 / 60;   // 16.667 ms
const MAX_PHYS_STEPS = 4;     // 防 spiral of death

// ---------- 4. 音效 ----------
const AudioFx = (() => {
  let actx = null, noiseBuf = null;
  function ensure(){
    if (!actx){
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch(e){ return null; }
      const len = Math.floor(actx.sampleRate * 0.6);
      noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i=0; i<len; i++) d[i] = Math.random()*2-1;
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function tone(opts){
    const c = ensure(); if (!c) return;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = opts.type||'sine';
    osc.frequency.value = opts.freq||800;
    let last = g;
    if (opts.filterFreq){
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = opts.filterFreq;
      g.connect(f); last = f;
    }
    osc.connect(g); last.connect(c.destination);
    const t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(opts.vol||0.3, t + (opts.attack||0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + (opts.attack||0.004) + (opts.decay||0.06));
    osc.start(t); osc.stop(t + (opts.dur||0.08) + 0.02);
  }
  function noise(opts){
    const c = ensure(); if (!c || !noiseBuf) return;
    const src = c.createBufferSource(); src.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    f.type = opts.type||'bandpass'; f.frequency.value = opts.filterFreq||2000; f.Q.value = opts.q||1;
    const g = c.createGain();
    src.connect(f); f.connect(g); g.connect(c.destination);
    const t = c.currentTime;
    g.gain.setValueAtTime(opts.vol||0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (opts.dur||0.15));
    src.start(t); src.stop(t + (opts.dur||0.15) + 0.02);
  }
  return {
    init: ensure,
    cueHit(power){
      tone({ freq:280+power*260, dur:0.13, type:'triangle', vol:0.4, attack:0.001, decay:0.11, filterFreq:2000 });
      noise({ dur:0.05, vol:0.22, filterFreq:1400, q:0.6 });
    },
    ballCollide(speed){
      const f = 1000 + speed*500;
      tone({ freq:f, dur:0.07, type:'sine', vol:0.2+speed*0.18, attack:0.001, decay:0.06 });
      noise({ dur:0.03, vol:0.1, filterFreq:3800, q:1.4 });
    },
    cushion(){
      tone({ freq:150, dur:0.11, type:'sine', vol:0.3, attack:0.001, decay:0.1, filterFreq:600 });
      noise({ dur:0.04, vol:0.1, filterFreq:500, q:0.5 });
    },
    pocket(){
      tone({ freq:200, dur:0.2, type:'sine', vol:0.34, attack:0.004, decay:0.18, filterFreq:1200 });
      tone({ freq:90, dur:0.26, type:'sine', vol:0.22, attack:0.01, decay:0.24, filterFreq:700 });
    }
  };
})();
['pointerdown','touchstart','click'].forEach(ev =>
  document.addEventListener(ev, () => AudioFx.init(), { once:true, passive:true })
);

// ---------- 5. 引擎初始化 ----------
function initEngine(){
  if (engine){ World.clear(world, false); Engine.clear(engine); }
  engine = Engine.create();
  engine.gravity.x = 0; engine.gravity.y = 0;
  engine.positionIterations = 8;
  engine.velocityIterations = 8;
  world = engine.world;

  const c = TABLE.cushion, w = TABLE.w, h = TABLE.h, t = 60;
  const wallOpts = { isStatic:true, restitution:PHYS.wallRestitution, friction:0.05, label:'wall' };
  walls = [
    Bodies.rectangle(w/2, c-t/2,   w, t, wallOpts),
    Bodies.rectangle(w/2, h-c+t/2, w, t, wallOpts),
    Bodies.rectangle(c-t/2,   h/2, t, h, wallOpts),
    Bodies.rectangle(w-c+t/2, h/2, t, h, wallOpts)
  ];
  World.add(world, walls);

  // 碰撞事件
  Events.on(engine, 'collisionStart', (ev) => {
    for (const pair of ev.pairs){
      const { bodyA, bodyB } = pair;
      const la = bodyA.label, lb = bodyB.label;
      if (la==='wall'||lb==='wall'){
        AudioFx.cushion();
        if (window.__shotCtx) window.__shotCtx.cushionHit = true;
      }
      if (bodyA.ball && bodyB.ball){
        const a = bodyA.ball, b = bodyB.ball;
        const mid = { x:(bodyA.position.x+bodyB.position.x)/2, y:(bodyA.position.y+bodyB.position.y)/2 };
        spawnImpact(mid.x, mid.y, Vector.magnitude(Vector.sub(bodyA.velocity, bodyB.velocity)));
        if (window.__shotCtx){
          if (!window.__shotCtx.firstContact) window.__shotCtx.firstContact = (a.id==='cue' ? b : a);
        }
      }
    }
  });
}

// ---------- 6. 摆球 ----------
function makeBallBody(x, y){
  return Bodies.circle(x, y, TABLE.ballR, {
    restitution:PHYS.restitution,
    friction:PHYS.friction,
    frictionStatic:PHYS.frictionStatic,
    frictionAir:PHYS.frictionAir,
    density:PHYS.density,
    label:'ball', slop:0.02
  });
}

function setupRack(){
  State.balls = [];
  ballCache = {};
  State.cueBallResetting = false;
  _settleGuard = false;

  // 母球
  const cueBall = { id:'cue', num:0, type:'cue', pocketed:false };
  cueBall.body = makeBallBody(200, 600);
  cueBall.body.ball = cueBall;
  State.balls.push(cueBall);

  // 三角形摆球
  const apex = { x:200, y:240 };
  const order = [1,11,3,13,8,6,9,4,12,5,14,2,7,10,15];
  let idx = 0;
  for (let row=0; row<5; row++){
    for (let col=0; col<=row; col++){
      const num = order[idx++];
      const x = apex.x + (col - row/2) * (2*TABLE.ballR + 0.5);
      const y = apex.y + row * (2*TABLE.ballR * 0.88);
      const b = { id:'b'+num, num, type:num===8?'eight':(num<=7?'solid':'stripe'), pocketed:false };
      b.body = makeBallBody(x, y);
      b.body.ball = b;
      State.balls.push(b);
    }
  }
  State.cue = State.balls[0];
  World.add(world, State.balls.map(b=>b.body));
  buildAllBallImages();
}

// ---------- 7. 球体离屏缓存（修复 lightenColor 缺逗号）----------
function buildBallImage(ball){
  const R = TABLE.ballR;
  const S = (R+3)*2;
  const off = document.createElement('canvas');
  off.width = S; off.height = S;
  const c = off.getContext('2d');
  const cx = S/2, cy = S/2;

  if (ball.type === 'cue'){
    c.beginPath(); c.arc(cx,cy,R,0,Math.PI*2);
    const g = c.createRadialGradient(cx+3,cy+3,0, cx,cy,R);
    g.addColorStop(0,'#ffffff'); g.addColorStop(0.7,'#f0f0f0'); g.addColorStop(1,'#d0d0d0');
    c.fillStyle=g; c.fill();
    // 高光
    const g1 = c.createRadialGradient(cx-5,cy-6,1, cx-5,cy-6,R*0.6);
    g1.addColorStop(0,'rgba(255,255,255,0.8)'); g1.addColorStop(1,'rgba(255,255,255,0)');
    c.beginPath(); c.arc(cx,cy,R,0,Math.PI*2); c.fillStyle=g1; c.fill();
    // 红点
    c.beginPath(); c.arc(cx,cy-7,2.5,0,Math.PI*2);
    c.fillStyle='#e03030'; c.fill();
    c.strokeStyle='#a00000'; c.lineWidth=0.5; c.stroke();
  }
  else if (ball.type === 'eight'){
    c.beginPath(); c.arc(cx,cy,R,0,Math.PI*2);
    const g = c.createRadialGradient(cx+3,cy+3,0, cx,cy,R);
    g.addColorStop(0,'#3a3a3a'); g.addColorStop(0.7,'#1a1a1a'); g.addColorStop(1,'#000000');
    c.fillStyle=g; c.fill();
    // 白色圆圈 + 8
    c.beginPath(); c.arc(cx,cy,8,0,Math.PI*2);
    c.fillStyle='#ffffff'; c.fill();
    c.strokeStyle='#000000'; c.lineWidth=0.5; c.stroke();
    c.fillStyle='#1a1a1a'; c.font='bold 11px Helvetica Neue,Arial,sans-serif';
    c.textAlign='center'; c.textBaseline='middle';
    c.strokeStyle='#ffffff'; c.lineWidth=2.5; c.lineJoin='round';
    c.strokeText('8',cx,cy+1); c.fillText('8',cx,cy+1);
    // 高光
    const g2 = c.createRadialGradient(cx-5,cy-6,1, cx-5,cy-6,R*0.6);
    g2.addColorStop(0,'rgba(255,255,255,0.25)'); g2.addColorStop(1,'rgba(255,255,255,0)');
    c.beginPath(); c.arc(cx,cy,R,0,Math.PI*2); c.fillStyle=g2; c.fill();
  }
  else if (ball.type === 'solid'){
    const col = BALL_COLORS[ball.num];
    c.beginPath(); c.arc(cx,cy,R,0,Math.PI*2);
    const g = c.createRadialGradient(cx+3,cy+3,0, cx,cy,R);
    g.addColorStop(0, lightenColor(col,30));
    g.addColorStop(0.6, col);
    g.addColorStop(1, darkenColor(col,40));
    c.fillStyle=g; c.fill();
    // 白色圆圈 + 数字
    c.beginPath(); c.arc(cx,cy,8,0,Math.PI*2);
    c.fillStyle='#ffffff'; c.fill();
    c.strokeStyle='rgba(0,0,0,0.2)'; c.lineWidth=0.5; c.stroke();
    c.fillStyle='#1a1a1a'; c.font='bold 11px Helvetica Neue,Arial,sans-serif';
    c.textAlign='center'; c.textBaseline='middle';
    c.strokeStyle='#ffffff'; c.lineWidth=2.5; c.lineJoin='round';
    c.strokeText(String(ball.num),cx,cy+1); c.fillText(String(ball.num),cx,cy+1);
    // 高光
    const g2 = c.createRadialGradient(cx-5,cy-6,1, cx-5,cy-6,R*0.6);
    g2.addColorStop(0,'rgba(255,255,255,0.5)'); g2.addColorStop(1,'rgba(255,255,255,0)');
    c.beginPath(); c.arc(cx,cy,R,0,Math.PI*2); c.fillStyle=g2; c.fill();
  }
  else {
    // stripe
    const col = BALL_COLORS[ball.num];
    c.beginPath(); c.arc(cx,cy,R,0,Math.PI*2);
    const sg = c.createLinearGradient(0,cy-R,0,cy+R);
    sg.addColorStop(0,'#f8f8f5'); sg.addColorStop(0.35,'#f8f8f5');
    sg.addColorStop(0.35,col); sg.addColorStop(0.65,col);
    sg.addColorStop(0.65,'#f8f8f5'); sg.addColorStop(1,'#f8f8f5');
    c.fillStyle=sg; c.fill();
    // 3D 叠加
    const g = c.createRadialGradient(cx+3,cy+3,0, cx,cy,R);
    g.addColorStop(0,'rgba(255,255,255,0.3)'); g.addColorStop(0.5,'rgba(255,255,255,0)'); g.addColorStop(1,'rgba(0,0,0,0.2)');
    c.fillStyle=g; c.fill();
    // 白色圆圈 + 数字
    c.beginPath(); c.arc(cx,cy,8,0,Math.PI*2);
    c.fillStyle='#ffffff'; c.fill();
    c.strokeStyle='rgba(0,0,0,0.2)'; c.lineWidth=0.5; c.stroke();
    c.fillStyle='#1a1a1a'; c.font='bold 11px Helvetica Neue,Arial,sans-serif';
    c.textAlign='center'; c.textBaseline='middle';
    c.strokeStyle='#ffffff'; c.lineWidth=2.5; c.lineJoin='round';
    c.strokeText(String(ball.num),cx,cy+1); c.fillText(String(ball.num),cx,cy+1);
    // 高光
    const g2 = c.createRadialGradient(cx-5,cy-6,1, cx-5,cy-6,R*0.6);
    g2.addColorStop(0,'rgba(255,255,255,0.45)'); g2.addColorStop(1,'rgba(255,255,255,0)');
    c.beginPath(); c.arc(cx,cy,R,0,Math.PI*2); c.fillStyle=g2; c.fill();
  }

  ballCache[ball.id] = off;
}

// 修复：lightenColor / darkenColor 缺逗号（v4 有 bug）
function lightenColor(color, percent){
  const num = parseInt(color.replace('#',''), 16);
  const r = Math.min(255, (num>>16)+percent);
  const g = Math.min(255, ((num>>8)&0xff)+percent);
  const b = Math.min(255, (num&0xff)+percent);
  return '#'+(0x1000000+r*0x10000+g*0x100+b).toString(16).slice(1);
}
function darkenColor(color, percent){
  const num = parseInt(color.replace('#',''), 16);
  const r = Math.max(0, (num>>16)-percent);
  const g = Math.max(0, ((num>>8)&0xff)-percent);
  const b = Math.max(0, (num&0xff)-percent);
  return '#'+(0x1000000+r*0x10000+g*0x100+b).toString(16).slice(1);
}

function buildAllBallImages(){
  State.balls.forEach(b => buildBallImage(b));
}

// ---------- 8. 冲击粒子 ----------
let _impacts = [];
function spawnImpact(x, y, impactV){
  if (!isFinite(x)||!isFinite(y)) return;
  const strength = clamp(impactV/PHYS.maxSpeed, 0, 1);
  const n = Math.round(4 + strength*10);
  for (let i=0; i<n; i++){
    const a = Math.random()*Math.PI*2;
    const sp = (1.2+Math.random()*3.5)*(0.5+strength);
    const r = 1+Math.random()*1.8;
    _impacts.push({
      x,y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp,
      life:0, max:10+Math.random()*12+strength*10,
      r, color:i%3===0?'#fff':'rgba(255,236,180,0.95)'
    });
  }
}
function stepImpacts(){
  if (!_impacts.length) return;
  _impacts = _impacts.filter(p => {
    p.life++;
    p.x += p.vx; p.y += p.vy;
    p.vx *= 0.86; p.vy *= 0.86;
    if (p.life >= p.max) return false;
    if (ctx){
      ctx.globalAlpha = clamp(1 - p.life/p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(Math.round(p.x), Math.round(p.y), p.r*(1-p.life/p.max), 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    return true;
  });
}
function shakeTable(power){
  const tableEl = $('#table');
  if (!tableEl) return;
  const amp = clamp((power-0.45)*7, 1, 5);
  let n = 0;
  (function tick(){
    if (n>=6){ tableEl.style.transform=''; return; }
    const dx = (Math.random()-0.5)*amp*(1-n/6);
    const dy = (Math.random()-0.5)*amp*(1-n/6);
    tableEl.style.transform = 'translate('+dx+'px,'+dy+'px)';
    n++; requestAnimationFrame(tick);
  })();
}

// ---------- 9. 瞄准系统（SVG overlay）----------
const aimLayer   = $('#aim-layer');
const aimLine    = $('#aim-line');
const aimBracket = $('#aim-bracket');
const targetLine = $('#target-line');
const cueAfterLine = $('#cue-after-line');
const bounceLine = $('#bounce-line');
const ghostBall  = $('#ghost-ball');
const tableCue     = $('#table-cue');
const tableCueStick = $('#table-cue-stick');
const tableCueTip  = $('#table-cue-tip');

function setPhase(p){
  State.phase = p;
  updateTurnUI();
  if (p === 'IDLE'){
    if (State.turn==='me' && !State.ended){
      State.aimPower = 0;
      setRailFill(0);
      redrawAim();
      showTableCue();
    } else {
      hideAim(); hideTableCue(); setRailFill(0);
    }
  }
}

function findFirstContact(cx, cy, ang){
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let best = null;
  for (const b of State.balls){
    if (b.pocketed || b.type==='cue') continue;
    const ex = b.body.position.x-cx, ey = b.body.position.y-cy;
    const proj = ex*dx + ey*dy;
    if (proj < 0) continue;
    const perp2 = (ex*ex+ey*ey) - proj*proj;
    const R2 = (TABLE.ballR*2)*(TABLE.ballR*2);
    if (perp2 > R2) continue;
    const back = Math.sqrt(R2 - perp2);
    const t = proj - back;
    if (t < 0) continue;
    if (!best || t < best.t){
      best = { ball:b, t, contactPoint:{ x:cx+dx*t, y:cy+dy*t } };
    }
  }
  return best;
}

function redrawAim(){
  if (State.phase==='SHOOTING'||State.phase==='LOCKED') return;
  const ang = State.aimAngle;
  const cx = State.cue.body.position.x, cy = State.cue.body.position.y;
  const contact = findFirstContact(cx, cy, ang);
  const startX = cx + Math.cos(ang)*TABLE.ballR;
  const startY = cy + Math.sin(ang)*TABLE.ballR;
  const endP = contact ? contact.contactPoint : projectToWall(cx,cy,ang,900);
  showAim(startX, startY, endP.x, endP.y);

  if (contact){
    showGhost(contact.contactPoint.x, contact.contactPoint.y);
    showBracket(contact.ball.body.position.x, contact.ball.body.position.y);
    const tAng = Math.atan2(contact.ball.body.position.y-contact.contactPoint.y, contact.ball.body.position.x-contact.contactPoint.x);
    const tEnd = projectToWall(contact.ball.body.position.x, contact.ball.body.position.y, tAng, 220);
    showTargetLine(contact.ball.body.position.x, contact.ball.body.position.y, tEnd.x, tEnd.y);
    const side = angDiff(tAng, ang)>0 ? -1 : 1;
    const sepAng = tAng + side*Math.PI/2;
    const cut = Math.abs(angDiff(tAng, ang));
    const sepLen = clamp(70*Math.cos(cut)+18, 18, 88);
    const cEnd = projectToWall(contact.contactPoint.x, contact.contactPoint.y, sepAng, sepLen);
    showCueAfterLine(contact.contactPoint.x, contact.contactPoint.y, cEnd.x, cEnd.y);
    hideBounceLine();
  } else {
    hideBracket(); hideTargetLine(); hideCueAfterLine(); hideGhost();
    const hit = firstWallHit(cx,cy,ang);
    if (hit){
      let rAng;
      if (hit.axis==='x') rAng = Math.atan2(Math.sin(ang), -Math.cos(ang));
      else rAng = Math.atan2(-Math.sin(ang), Math.cos(ang));
      const rEnd = projectToWall(hit.x, hit.y, rAng, 160);
      showBounceLine(hit.x, hit.y, rEnd.x, rEnd.y);
    } else hideBounceLine();
  }
  showTableCue();
}

function projectToWall(cx,cy,ang,maxLen){
  const dx=Math.cos(ang), dy=Math.sin(ang);
  let t=maxLen;
  if (dx>0) t=Math.min(t, (TABLE.w-TABLE.cushion-cx)/dx);
  else if (dx<0) t=Math.min(t, (TABLE.cushion-cx)/dx);
  if (dy>0) t=Math.min(t, (TABLE.h-TABLE.cushion-cy)/dy);
  else if (dy<0) t=Math.min(t, (TABLE.cushion-cy)/dy);
  t=Math.max(t,0);
  return { x:cx+dx*t, y:cy+dy*t };
}
function firstWallHit(cx,cy,ang){
  const dx=Math.cos(ang), dy=Math.sin(ang);
  const minX=TABLE.cushion+TABLE.ballR, maxX=TABLE.w-TABLE.cushion-TABLE.ballR;
  const minY=TABLE.cushion+TABLE.ballR, maxY=TABLE.h-TABLE.cushion-TABLE.ballR;
  let tx=Infinity, ty=Infinity;
  if (dx>0) tx=(maxX-cx)/dx; else if (dx<0) tx=(minX-cx)/dx;
  if (dy>0) ty=(maxY-cy)/dy; else if (dy<0) ty=(minY-cy)/dy;
  if (tx<0) tx=Infinity; if (ty<0) ty=Infinity;
  if (tx===Infinity&&ty===Infinity) return null;
  if (tx<ty) return { x:cx+dx*tx, y:cy+dy*tx, axis:'x' };
  return { x:cx+dx*ty, y:cy+dy*ty, axis:'y' };
}

// SVG 瞄准绘制函数
function showAim(x1,y1,x2,y2){
  aimLine.setAttribute('x1',x1); aimLine.setAttribute('y1',y1);
  aimLine.setAttribute('x2',x2); aimLine.setAttribute('y2',y2);
  aimLine.setAttribute('opacity',1);
}
function hideAim(){ aimLine.setAttribute('opacity',0); hideBracket(); hideTargetLine(); hideCueAfterLine(); hideGhost(); hideBounceLine(); }
function showBracket(x,y){ aimBracket.setAttribute('transform','translate('+x+' '+y+')'); aimBracket.setAttribute('opacity',1); }
function hideBracket(){ aimBracket.setAttribute('opacity',0); }
function showTargetLine(x1,y1,x2,y2){
  targetLine.setAttribute('x1',x1); targetLine.setAttribute('y1',y1);
  targetLine.setAttribute('x2',x2); targetLine.setAttribute('y2',y2);
  targetLine.setAttribute('opacity',1);
}
function hideTargetLine(){ targetLine.setAttribute('opacity',0); }
function showCueAfterLine(x1,y1,x2,y2){
  cueAfterLine.setAttribute('x1',x1); cueAfterLine.setAttribute('y1',y1);
  cueAfterLine.setAttribute('x2',x2); cueAfterLine.setAttribute('y2',y2);
  cueAfterLine.setAttribute('opacity',1);
}
function hideCueAfterLine(){ cueAfterLine.setAttribute('opacity',0); }
function showGhost(x,y){ ghostBall.setAttribute('cx',x); ghostBall.setAttribute('cy',y); ghostBall.setAttribute('opacity',1); }
function hideGhost(){ ghostBall.setAttribute('opacity',0); }
function showBounceLine(x1,y1,x2,y2){
  bounceLine.setAttribute('x1',x1); bounceLine.setAttribute('y1',y1);
  bounceLine.setAttribute('x2',x2); bounceLine.setAttribute('y2',y2);
  bounceLine.setAttribute('opacity',1);
}
function hideBounceLine(){ bounceLine.setAttribute('opacity',0); }

// 桌面上球杆
function showTableCue(extraPull, wobble){
  if (State.phase==='SHOOTING'||State.phase==='LOCKED') return;
  const ang = State.aimAngle;
  const cx = State.cue.body.position.x, cy = State.cue.body.position.y;
  const tipLen=16, stickLen=230, gap=TABLE.ballR+5;
  const pullback = State.aimPower*70 + (extraPull||0);
  const px = Math.cos(ang+Math.PI/2)*(wobble||0);
  const py = Math.sin(ang+Math.PI/2)*(wobble||0);
  const baseX = cx + Math.cos(ang+Math.PI)*(gap+pullback) + px;
  const baseY = cy + Math.sin(ang+Math.PI)*(gap+pullback) + py;
  const tipEndX = baseX + Math.cos(ang+Math.PI)*tipLen;
  const tipEndY = baseY + Math.sin(ang+Math.PI)*tipLen;
  const stickEndX = tipEndX + Math.cos(ang+Math.PI)*stickLen;
  const stickEndY = tipEndY + Math.sin(ang+Math.PI)*stickLen;
  tableCueTip.setAttribute('x1',baseX); tableCueTip.setAttribute('y1',baseY);
  tableCueTip.setAttribute('x2',tipEndX); tableCueTip.setAttribute('y2',tipEndY);
  tableCueStick.setAttribute('x1',tipEndX); tableCueStick.setAttribute('y1',tipEndY);
  tableCueStick.setAttribute('x2',stickEndX); tableCueStick.setAttribute('y2',stickEndY);
  tableCue.setAttribute('opacity',1);
}
function hideTableCue(){ tableCue.setAttribute('opacity',0); stopChargeWobble(); }

let _wobbleRAF = null;
function startChargeWobble(){
  if (_wobbleRAF) return;
  const tick = () => {
    if (State.phase!=='POWER'){ _wobbleRAF=null; showTableCue(); return; }
    const amp = State.aimPower*State.aimPower*2.2;
    const w = (Math.random()-0.5)*2*amp;
    showTableCue(0, w);
    _wobbleRAF = requestAnimationFrame(tick);
  };
  _wobbleRAF = requestAnimationFrame(tick);
}
function stopChargeWobble(){
  if (_wobbleRAF){ cancelAnimationFrame(_wobbleRAF); _wobbleRAF=null; }
}

// ---------- 10. 交互 ----------
let aimDragging = false;
const canvas_el = $('#table-canvas');
canvas_el.addEventListener('pointerdown', (e) => {
  if (State.turn!=='me'||State.ended) return;
  if (State.phase==='SHOOTING'||State.phase==='LOCKED') return;
  AudioFx.init();
  canvas_el.setPointerCapture(e.pointerId);
  aimDragging = true;
  setPhase('AIM');
  updateAim(e);
});
canvas_el.addEventListener('pointermove', (e) => { if (aimDragging) updateAim(e); });
canvas_el.addEventListener('pointerup', () => { aimDragging = false; });
canvas_el.addEventListener('pointercancel', () => { aimDragging = false; });

function updateAim(e){
  const rect = canvas_el.getBoundingClientRect();
  const px = (e.clientX-rect.left)/rect.width * TABLE.w;
  const py = (e.clientY-rect.top)/rect.height * TABLE.h;
  const cx = State.cue.body.position.x, cy = State.cue.body.position.y;
  const dx=px-cx, dy=py-cy;
  if (Math.hypot(dx,dy) < 4) return;
  State.aimTargetAngle = Math.atan2(dy,dx);
  startAimSmooth();
}

let _aimSmoothRAF = null;
function startAimSmooth(){
  if (_aimSmoothRAF) return;
  const tick = () => {
    const d = angDiff(State.aimTargetAngle, State.aimAngle);
    if (Math.abs(d) < 0.0015){
      State.aimAngle = State.aimTargetAngle;
      redrawAim(); _aimSmoothRAF = null; return;
    }
    State.aimAngle += d*0.35;
    redrawAim();
    _aimSmoothRAF = requestAnimationFrame(tick);
  };
  _aimSmoothRAF = requestAnimationFrame(tick);
}

// 左侧球杆轨道
const cueRail  = $('#cue-rail');
const railFill = $('#rail-fill');
const railStick = $('#rail-stick');
let railDragging = false, railStartY = 0, railStartPower = 0;

cueRail.addEventListener('pointerdown', (e) => {
  if (State.turn!=='me'||State.ended) return;
  if (e.target.closest('.spin-entry')) return;
  if (State.phase==='SHOOTING'||State.phase==='LOCKED') return;
  AudioFx.init();
  setPhase('POWER');
  cueRail.setPointerCapture(e.pointerId);
  railDragging = true;
  railStartY = e.clientY;
  railStartPower = State.aimPower;
  redrawAim();
});
cueRail.addEventListener('pointermove', (e) => {
  if (!railDragging) return;
  const track = $('.rail-track');
  const trackH = track? track.getBoundingClientRect().height : 300;
  const dy = e.clientY - railStartY;
  setPower(clamp(railStartPower + dy/trackH, 0, 1));
});
cueRail.addEventListener('pointerup', () => {
  if (!railDragging) return;
  railDragging = false;
  if (State.aimPower > 0.04){
    doShot('me', State.aimAngle, State.aimPower, { x:State.spin.x, y:State.spin.y });
  } else { setPower(0); setPhase('IDLE'); }
});
cueRail.addEventListener('pointercancel', () => { railDragging=false; setPower(0); setPhase('IDLE'); });

function setPower(p){
  State.aimPower = clamp(p,0,1);
  setRailFill(State.aimPower);
  if (State.phase==='POWER'){
    if (State.aimPower>0.12) startChargeWobble();
    else { stopChargeWobble(); showTableCue(); }
  } else if (State.phase==='AIM'){ showTableCue(); }
}
function setRailFill(p){
  if (!railFill) return;
  railFill.style.height = (p*100)+'%';
  const track = $('.rail-track');
  const trackH = track? track.getBoundingClientRect().height : 300;
  const maxDrag = Math.max(1, trackH-70);
  if (railStick) railStick.style.transform = 'translate(-50%,'+ (p*maxDrag)+'px)';
}

// ---------- 11. SPIN 模态 ----------
const spinMask = $('#spin-mask');
const spinBall = $('#spin-ball');
const spinDot  = $('#spin-dot');
let spinDrag = false;

$('#btn-spin').addEventListener('click', () => {
  if (State.turn!=='me'||State.ended) return;
  if (State.phase==='SHOOTING'||State.phase==='LOCKED') return;
  spinMask.classList.add('spin-active');
  placeSpinDot(State.spin.x, State.spin.y);
});
$('#btn-spin-done').addEventListener('click', () => {
  spinMask.classList.remove('spin-active');
  $('#btn-spin').classList.toggle('active', State.spin.x!==0||State.spin.y!==0);
});
spinBall.addEventListener('pointerdown', (e) => { spinDrag=true; spinBall.setPointerCapture(e.pointerId); moveSpin(e); });
spinBall.addEventListener('pointermove', (e) => { if (spinDrag) moveSpin(e); });
spinBall.addEventListener('pointerup', () => { spinDrag=false; });

function moveSpin(e){
  const r = spinBall.getBoundingClientRect();
  const cx = r.left+r.width/2, cy = r.top+r.height/2;
  const radius = r.width/2 - r.width*0.08;
  let nx = (e.clientX-cx)/radius, ny = (e.clientY-cy)/radius;
  const dist = Math.hypot(nx,ny);
  if (dist>1){ nx/=dist; ny/=dist; }
  State.spin.x = +nx.toFixed(2);
  State.spin.y = +ny.toFixed(2);
  placeSpinDot(nx,ny);
}
function placeSpinDot(x, y){
  const ballR = spinBall.getBoundingClientRect().width/2;
  const usable = ballR - ballR*0.14;
  spinDot.style.left = 'calc(50% + '+x*usable+'px)';
  spinDot.style.top  = 'calc(50% + '+y*usable+'px)';
}

// 母球归位
$('#btn-cue-ball').addEventListener('click', () => {
  if (State.turn!=='me'||State.ended) return;
  if (State.phase==='SHOOTING'||State.phase==='LOCKED') return;
  Body.setPosition(State.cue.body, { x:200, y:600 });
  Body.setVelocity(State.cue.body, { x:0, y:0 });
  Body.setAngularVelocity(State.cue.body, 0);
  setPower(0); setPhase('IDLE');
  log('母球归位');
});

// ---------- 12. 出杆（修复：真实球杆动画）----------
async function doShot(shooter, angle, power, spin){
  setPhase('SHOOTING');
  AudioFx.init();
  State.shotSeq++;
  const seq = State.shotSeq;
  hideAim();

  // 修复：真实球杆出杆动画
  await animateCueStrike(angle, power);
  AudioFx.cueHit(power);
  hideTableCue();

  const v0 = PHYS.minSpeed + (PHYS.maxSpeed-PHYS.minSpeed)*Math.pow(power, 1.5);
  let vx = Math.cos(angle)*v0, vy = Math.sin(angle)*v0;
  if (spin.x){
    vx += Math.cos(angle+Math.PI/2)*spin.x*v0*PHYS.spinFactor;
    vy += Math.sin(angle+Math.PI/2)*spin.x*v0*PHYS.spinFactor;
  }
  Body.setVelocity(State.cue.body, { x:vx, y:vy });

  // 冲击粒子
  const tipX = State.cue.body.position.x + Math.cos(angle)*TABLE.ballR*2.2;
  const tipY = State.cue.body.position.y + Math.sin(angle)*TABLE.ballR*2.2;
  spawnImpact(tipX, tipY, power*PHYS.maxSpeed);
  shakeTable(power);

  // 射击上下文（用于碰撞记录）
  window.__shotCtx = { firstContact:null, contacted:new Set(), cushionHit:false };
}

// 真实出杆动画（修复 v4 空壳问题）
function animateCueStrike(angle, power){
  return new Promise(resolve => {
    const dur = 100 + (1-power)*90;
    const startTime = performance.now();
    const startX = State.cue.body.position.x;
    const startY = State.cue.body.position.y;
    // 球杆从当前位置向母球方向"弹出"
    function tick(now){
      const elapsed = now - startTime;
      const t = Math.min(elapsed / dur, 1);
      // easeOutQuad
      const ease = 1 - (1-t)*(1-t);
      const pullDist = State.aimPower * 70;
      const currentPull = pullDist * (1 - ease);
      showTableCue(currentPull, 0);
      if (t >= 1){
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

// ---------- 13. 主循环（修复1：固定步长）----------
function gameLoop(ts){
  requestAnimationFrame(gameLoop);

  if (!_lastTS) { _lastTS = ts; return; }
  let dt = ts - _lastTS;
  _lastTS = ts;

  // 限制 dt，防止 tab 切到后台回来后 dt 暴增
  dt = Math.min(dt, FIXED_DT * MAX_PHYS_STEPS);

  _accumulator += dt;

  // 固定步长跑物理
  let steps = 0;
  while (_accumulator >= FIXED_DT && steps < MAX_PHYS_STEPS){
    Engine.update(engine, FIXED_DT);
    _accumulator -= FIXED_DT;
    steps++;

    // 每步物理后检测进袋
    checkPockets();
  }

  // 修复5：慢速蠕变硬清零
  dampCreepingBalls();

  // 静止检测（在物理步之后、渲染之前）
  checkSettled();

  // 渲染
  renderTable();
  renderBalls();
  stepImpacts();
}

// 修复5：慢速蠕变清零
function dampCreepingBalls(){
  for (const b of State.balls){
    if (b.pocketed || !b.body) continue;
    const speed = Math.hypot(b.body.velocity.x, b.body.velocity.y);
    if (speed < 0.15 && speed > 0.01){
      Body.setVelocity(b.body, { x:0, y:0 });
      Body.setAngularVelocity(b.body, 0);
      // 同时强制位置对齐到像素网格（修复4）
      Body.setPosition(b.body, { x:Math.round(b.body.position.x), y:Math.round(b.body.position.y) });
    }
  }
}

// ---------- 14. 渲染 ----------
function renderTable(){
  if (!ctx) return;
  ctx.clearRect(0, 0, TABLE.w, TABLE.h);
  // 台呢
  ctx.fillStyle = '#2c7e9e';
  ctx.fillRect(0, 0, TABLE.w, TABLE.h);
  // 袋口
  for (const pk of POCKETS){
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.beginPath();
    ctx.arc(pk.x, pk.y, pk.r, 0, Math.PI*2);
    ctx.fill();
  }
}

// 修复4：Math.round 坐标，避免亚像素震颤
function renderBalls(){
  if (!ctx) return;
  for (const b of State.balls){
    if (b.pocketed || !b.body) continue;
    const px = Math.round(b.body.position.x);
    const py = Math.round(b.body.position.y);
    const off = ballCache[b.id];
    if (!off) continue;

    // 累计滚动角度
    if (b._lx===undefined){ b._lx=px; b._ly=py; b._ang=0; }
    const dx = px-b._lx, dy = py-b._ly;
    const dist = Math.hypot(dx,dy);
    if (dist > 0.03){ b._ang += dist/TABLE.ballR; b._lx=px; b._ly=py; }

    // 阴影
    ctx.save();
    ctx.translate(px+2, py+3);
    ctx.scale(1.2, 0.7);
    const sg = ctx.createRadialGradient(0,0,0,0,0,TABLE.ballR);
    sg.addColorStop(0,'rgba(0,0,0,0.3)');
    sg.addColorStop(0.6,'rgba(0,0,0,0.15)');
    sg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(0,0,TABLE.ballR,0,Math.PI*2); ctx.fill();
    ctx.restore();

    // 球体
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(b._ang);
    ctx.drawImage(off, -off.width/2, -off.height/2);
    ctx.restore();
  }
}

// ---------- 15. 进袋检测（修复6：母球落袋延迟切回合）----------
function checkPockets(){
  if (State.phase!=='SHOOTING' && State.phase!=='LOCKED') return;
  const pr = PHYS.pocketR + 2;
  for (const b of State.balls){
    if (b.pocketed || !b.body) continue;
    const {x,y} = b.body.position;
    for (const pk of POCKETS){
      if (Math.hypot(x-pk.x, y-pk.y) < pr){
        b.pocketed = true;
        World.remove(world, b.body);
        const oldBody = b.body;
        b.body = null;
        AudioFx.pocket();

        if (b.id === 'cue'){
          // 修复6：母球落袋，标记复位中，延迟切回合
          State.cueBallResetting = true;
          setTimeout(() => {
            if (oldBody) World.remove(world, oldBody);
            b.pocketed = false;
            b.body = makeBallBody(200, 600);
            b.body.ball = b;
            World.add(world, b.body);
            b._lx = undefined;
            State.cueBallResetting = false;
            log('母球已复位');
            // 复位后如果应该在 bot 回合，触发 bot
            if (State.turn==='bot' && !State.ended && State.phase==='LOCKED'){
              setTimeout(botPlay, 500);
            }
          }, 2500);
        } else {
          updateHUDBalls();
        }
        break;
      }
    }
  }
}

// ---------- 16. 静止检测（修复3：_settleGuard 锁）----------
function checkSettled(){
  if (State.phase!=='SHOOTING' && State.phase!=='LOCKED') return;
  if (_settleGuard) return; // 已经安排切回合了，不再重复

  const allStop = State.balls.every(b => {
    if (b.pocketed || !b.body) return true;
    return Math.hypot(b.body.velocity.x, b.body.velocity.y) < PHYS.sleepSpeed;
  });

  if (allStop){
    _settleGuard = true; // 加锁，防止重复排队
    State.phase = 'LOCKED';
    // 修复6：如果母球在复位中，等复位完再切回合
    if (State.cueBallResetting){
      log('母球复位中，延迟切回合');
      // 轮询检查，直到复位完成
      const waitInterval = setInterval(() => {
        if (!State.cueBallResetting){
          clearInterval(waitInterval);
          setTimeout(nextTurn, 400);
        }
      }, 100);
    } else {
      setTimeout(nextTurn, 900);
    }
  }
}

// ---------- 17. 切回合（修复6：统一复位后再切）----------
function nextTurn(){
  if (State.ended) return;
  if (State.cueBallResetting){
    // 还在复位中，再等等
    setTimeout(nextTurn, 200);
    return;
  }
  _settleGuard = false; // 解锁，下一杆可以再检测

  if (State.turn === 'me'){
    State.turn = 'bot';
    AudioFx.init();
    setTimeout(botPlay, 700);
  } else {
    State.turn = 'me';
    State.aimPower = 0;
    setRailFill(0);
    State.phase = 'IDLE';
    redrawAim();
    AudioFx.init();
  }
  updateTurnUI();
}

// ---------- 18. Bot（修复7：空值防御）----------
function botPlay(){
  if (State.ended) return;
  // 修复7：空值防御
  if (!State.cue || !State.cue.body){
    log('botPlay: 母球未就绪，推迟');
    setTimeout(botPlay, 500);
    return;
  }

  const targets = State.balls.filter(b => !b.pocketed && b.id!=='cue' && b.body);
  if (targets.length === 0) return;

  // 简单 AI：找最近球
  const cpx = State.cue.body.position.x, cpy = State.cue.body.position.y;
  let best = null, bestD = Infinity;
  for (const b of targets){
    const d = Math.hypot(b.body.position.x-cpx, b.body.position.y-cpy);
    if (d < bestD){ bestD = d; best = b; }
  }

  if (!best) return;

  const tpx = best.body.position.x, tpy = best.body.position.y;
  State.aimAngle = Math.atan2(tpy-cpy, tpx-cpx) + (Math.random()-0.5)*0.2;
  State.aimPower = 0.35 + Math.random()*0.45;
  setRailFill(State.aimPower);

  redrawAim();
  setTimeout(() => doShot('bot', State.aimAngle, State.aimPower, { x:0, y:0 }), 600);
}

// ---------- 19. HUD 更新 ----------
function updateTurnUI(){
  const pill = $('#turn-pill');
  if (pill){
    pill.textContent = State.turn==='me' ? '你的回合' : State.botProfile.name+'的回合';
    pill.classList.toggle('bot-turn', State.turn!=='me');
  }
}

function updateHUDBalls(){
  const rackMe = $('#rack-me');
  const rackOpp = $('#rack-opp');
  if (!rackMe || !rackOpp) return;

  // 清空
  $$('li', rackMe).forEach(li => { li.className='slot'; li.removeAttribute('data-num'); });
  $$('li', rackOpp).forEach(li => { li.className='slot'; li.removeAttribute('data-num'); });

  // 显示已进袋的球
  let meIdx=0, oppIdx=0;
  for (const b of State.balls){
    if (b.pocketed && b.type!=='cue'){
      // 简化：全分配给对手（实际应根据花色归属）
      const li = rackOpp.children[oppIdx++] || null;
      if (li){
        li.className = 'slot '+b.type;
        li.style.setProperty('--ball-color', BALL_COLORS[b.num]||'#fff');
        li.setAttribute('data-num', b.num);
      }
    }
  }
}

// ---------- 20. 初始化 ----------
function init(){
  canvas = $('#table-canvas');
  if (canvas){
    ctx = canvas.getContext('2d');
  }

  initEngine();
  setupRack();
  updateTurnUI();

  State.phase = 'IDLE';
  redrawAim();

  // 修复1：使用固定步长主循环
  _lastTS = 0;
  _accumulator = 0;
  requestAnimationFrame(gameLoop);

  log('niubi 初始化完成');
}

if (document.readyState === 'complete') init();
else window.addEventListener('load', init);

})();
