/*! =========================================================
   skill-pool · game_final.js · FINAL (clean rebuild)
   - Base: v4 game_v4.js (1100 lines, clean)
   - Ported fixes (systematic, not hotfixed):
     1. Physics: single-threaded RAF loop (fix tremor)
     2. Pocket physics: wall gaps + 3-tier detection
     3. Aim offset fix: SVG preserveAspectRatio="none"
     4. Ghost ball: findFirstContact rewrite
     5. Cue strike animation: real visual
     6. Spin: full spin.x + spin.y
     7. Settle: _stillFrames + _settleGuard (fix round hang)
     8. 8-ball rule engine: resolveShot()
     9. Ball rendering: 2x supersampling + 3D gradient
    10. AudioFx.pocket: improved sound
   ========================================================= */

(function(){
'use strict';

// Matter.js 检查 + 解构（必须在文件顶部，否则后续 Engine/World/Bodies 全是 undefined）
if (typeof Matter === 'undefined'){
  console.error('[game_final] Matter.js 未加载（matter.min.js 404？）');
  return;
}
const { Engine, World, Bodies, Body, Composite, Events, Vector } = Matter;

/* ================================================================
   0. UTILS
   ================================================================ */
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => {
  let d = a - b;
  while (d > Math.PI) d -= 2*Math.PI;
  while (d < -Math.PI) d += 2*Math.PI;
  return d;
};

/* ================================================================
   1. BOT PROFILES
   ================================================================ */
const BOT_PROFILES = {
  xiaomai: {
    id:'xiaomai', name:'小麦', emoji:'🌾',
    skill: { angle_precision:0.50, safety:0.20, power_min:0.30, power_max:0.75 },
    win_rate: 0.50,
    // 立绘（按情绪切换）
    avatars: {
      idle:  './assets/xiaomai-happy.png',  // 默认 / 待机
      happy: './assets/xiaomai-happy.png',  // 开心（进球/夸赞）
      cute:  './assets/xiaomai-cute.png',   // 卖萌/撒娇
      smug:  './assets/xiaomai-smug.png',   // 得瑟（嘲讽/赢）
      pout:  './assets/xiaomai-pout.png'    // 委屈嘟嘴（输/自己犯规）
    }
  },
  xien: {
    id:'xien', name:'席恩', emoji:'🌙',
    skill: { angle_precision:0.82, safety:0.70, power_min:0.25, power_max:0.70 },
    win_rate: 0.68
  },
  daike: {
    id:'daike', name:'代柯', emoji:'🔥',
    skill: { angle_precision:0.65, safety:0.10, power_min:0.40, power_max:0.92 },
    win_rate: 0.58
  }
};

/* ================================================================
   1b. 角色台词 + 语音
   ================================================================ */
const VOICE_LINES = {
  xiaomai: {
    // ===== 嘲讽（贱萌+网络梗）×10 =====
    taunt: [
      '就这？我还以为你有多厉害呢~结果你是在给我表演杂技吗😂',
      '哈哈哈哈这杆走位，你是想让我笑死好继承我的奶茶吗？',
      '白球都进袋了诶……你要不要我给你整个《桌球入门》PDF？',
      '你这走位挺有创意的，属于那种"我没想到你会这么打"的创意',
      '我闭着眼都能比你打得好，真的，我不夸张',
      '哎呀又给我送分了，那我可就不客气啦~',
      '你这杆打得……怎么说呢，很有个人风格（bushi',
      '不是吧阿Sir，这都能打丢？我直接一个好家伙',
      '你这准头……建议去挂个眼科，我帮你挂号',
      '笑死，这杆打得比我奶奶打麻将还随意',
    ],
    // ===== 撒娇/卖萌 ×10 =====
    cute: [
      '喂喂喂！人家明明很认真在打了好不好🥺不许笑！',
      '哼……等下我赢了你请我喝奶茶，要全糖去冰的那种！',
      '你是不是背着我偷偷练了？感觉你今天有点东西啊',
      '打得好！——等等，我刚才是在夸我还是夸我自己来着？',
      '其实我觉得你刚才那杆……也还行吧（小声）',
      '能不能稍微让我一下下？就一下下嘛~不然我很没面子的诶',
      '你看我都让你这么多球了，你也让让我嘛好不好',
      '人家才没有紧张呢！只是……手心出了点汗而已',
      '哼，你今天状态也太好了吧，是不是开挂了啊喂',
      '好吧好吧算你厉害，但下次可不一定了哦',
    ],
    // ===== 夸赞 ×10 =====
    praise: [
      '哇哦这杆可以啊！走位很丝滑嘛，有点东西的',
      '不错不错，看来你不是纯靠颜值吃饭的人呢~',
      '这K球做得挺到位的诶，夸你一句（仅此一次',
      '行啊你！进步很大嘛，我都开始紧张了',
      '这杆打得……好吧我承认，确实有点帅',
      '嗯~这个角度选得不错嘛，学得很快呀',
      '可以啊这力度控制，比上次强了不止一点点',
      '这走位绝了，你是偷偷看了教学视频吗',
      '稳准狠！今天这是开了什么buff啊',
      '不错不错，继续保持这个水平哦~',
    ],
    // ===== 赢了 ×10 =====
    on_win: [
      '耶！！我赢了！！快说小麦最厉害！快说！！',
      '哼哼~赢了就是赢了，不服？不服憋着（叉腰）',
      '小意思啦~不过你打得也不差啦，下次再接再厉',
      '赢了！今晚必须加餐！我要吃两份炸鸡！',
      '这就是实力的证明✨ 感谢对手的精彩表现（指送分）',
      '哈哈哈哈赢了！感觉今天的运气都在我这边',
      '赢了赢了！你要不要来拜我为师啊？打八折哦',
      '耶！本小姐的桌球技术果然天下无敌！',
      '赢啦~不过说实话你今天也打得挺好的（小声）',
      '胜利属于小麦！不接受反驳！',
    ],
    // ===== 输了 ×10 =====
    on_lose: [
      '……你绝对作弊了吧？？不算不算这局不算！',
      '再来一局！刚才那是手滑，手滑懂吗！！',
      '你运气好的原因罢了，下次我可不会这么温柔了',
      '呜……好吧你赢了，但是！但是我刚才明显状态不好！',
      '哼，让你一局而已，别得意太早啊喂',
      '这局是战略性失败！战略性的！懂吗！',
      '……行吧你赢了。但是下一局我绝对不会输的！',
      '肯定是桌子不平！不然我怎么会输给你！',
      '算了算了，胜败乃兵家常事……但我还是不服！',
      '你也就赢这一次而已，别高兴得太早哼',
    ],
    // ===== 玩家犯规 ×10 =====
    on_player_foul: [
      '哦豁~犯规了犯规了！白球都哭了你知道吗😂',
      '哎呀母球进袋了……它是不是觉得你的技术配不上它？',
      '犯规咯~按规则换我来打，那我就……勉为其难收下这个福利吧',
      '空杆？！你是来打球的还是来给白球做按摩的？',
      '犯规了哦亲~这下轮到我表演了，请准备好掌声👏',
      '哇哦犯规了！这下换我了嘿嘿嘿',
      '哎呀，白球都进去了……它可能想换个主人',
      '犯规！裁判！他犯规了！（虽然我就是裁判）',
      '你这犯规犯得很有艺术感啊，我给满分💯',
      '好了好了犯规了别难过，来我教你正确的打开方式',
    ],
    // ===== 自己犯规 ×10 =====
    on_bot_foul: [
      '咳咳……刚才那杆当我没打过，系统bug，绝对是bug',
      '手滑了手滑了！这不怪我，怪重力！',
      '啊这……那个，我刚刚在想今晚吃什么来着',
      '犯规是犯规我声明一下：我不是菜，我是有个性',
      '好吧我承认这杆打得离谱……但你也不许笑啊！！',
      '这个……刚才有只蚊子干扰了我的发挥！真的！',
      '犯规了怎么了！大不了……大不了下杆好好打呗',
      '谁还没个失误时候嘛，这不叫犯规这叫艺术发挥',
      '哎呀手抖了一下……就一下下而已！',
      '犯规归犯规但你不能因此质疑我的实力啊喂！',
    ],
  }
};

// 真人语音文件 — 按"真实场景"精确分类（2026-06-26 重置音频包，19 条全 mp3）
// 注：本批未提供 on_win(小麦赢) / pfoul_cue(母球落袋专属) 语音 → 这两类回退文字气泡
const VOICE_CLIPS = {
  xiaomai: {
    // 通用嘲讽（玩家单纯没进球/打丢，没犯规）—— 不含"白球/犯规"字眼
    taunt: [
      { audio:'./assets/voice/xiaomai/taunt_01_jiuzhe.mp3', text:'就这？我还以为你有多厉害呢~' },
      { audio:'./assets/voice/xiaomai/taunt_02_biyan.mp3',  text:'我闭着眼都能比你打得好' },
      { audio:'./assets/voice/xiaomai/taunt_03_dadiu.mp3',  text:'不是吧阿Sir，这都能打丢？' },
    ],
    // 小麦自己进球时的得瑟（"送分"= 对方送分给我）
    brag: [
      { audio:'./assets/voice/xiaomai/brag_01_songfen.mp3', text:'哈哈哈 又给我送分了' },
    ],
    // 夸赞 / 酸玩家（玩家进球或打出好杆时，小麦的反应）
    praise: [
      { audio:'./assets/voice/xiaomai/praise_01_sihua.mp3',  text:'哇哦这杆可以啊！走位很丝滑嘛，有点东西的' },
      { audio:'./assets/voice/xiaomai/praise_02_lidu.mp3',   text:'可以啊这力度控制，比上次强了不止一点点' },
      { audio:'./assets/voice/xiaomai/praise_03_baochi.mp3', text:'不错不错，继续保持这个水平哦~' },
      { audio:'./assets/voice/xiaomai/cute_01_toulian.mp3',  text:'你是不是背着我偷偷练了？感觉你今天有点东西啊' },
      { audio:'./assets/voice/xiaomai/cute_03_kaigua.mp3',   text:'你今天状态也太好了吧，是不是开挂了啊喂' },
    ],
    // 小麦自己没进球时的撒娇（自嘲，不夸玩家）
    cute: [
      { audio:'./assets/voice/xiaomai/cute_02_haixing.mp3',  text:'其实我觉得刚才那杆…也还行吧' },
    ],
    // 输了（终局，小麦落败）
    on_lose: [
      { audio:'./assets/voice/xiaomai/lose_01_zuobi.mp3',     text:'…你绝对作弊了吧？？不算不算这局不算' },
      { audio:'./assets/voice/xiaomai/lose_02_zailai.mp3',    text:'…再来一局！这把只是你运气好罢了' },
      { audio:'./assets/voice/xiaomai/lose_03_zhuangtai.mp3', text:'…好吧你赢了，但是！但是我刚才明显状态不好！' },
      { audio:'./assets/voice/xiaomai/lose_04_rangju.mp3',    text:'哼，让你一局而已，别得意太早' },
      { audio:'./assets/voice/xiaomai/lose_05_buchala.mp3',   text:'你这次打得也不差啦，下次再接再厉' },
    ],
    // 玩家空杆专属
    pfoul_empty: [
      { audio:'./assets/voice/xiaomai/pfoul_empty_01.mp3', text:'空杆？！你是来打球的还是来给白球做按摩的？' },
    ],
    // 玩家其它犯规（先碰对方球/黑8 等；母球落袋也暂用这条通用犯规）
    pfoul_other: [
      { audio:'./assets/voice/xiaomai/pfoul_other_01.mp3', text:'哦豁~犯规了犯规了！' },
    ],
    // 小麦自己犯规（找借口）
    on_bot_foul: [
      { audio:'./assets/voice/xiaomai/bfoul_01_bug.mp3',     text:'咳咳…刚才那杆当我没打过，系统bug，绝对是bug' },
      { audio:'./assets/voice/xiaomai/bfoul_02_shoudou.mp3', text:'哎呀手抖了一下…' },
    ],
    // on_win / pfoul_cue 本批无语音 → say() 自动回退到文字气泡
  }
};

/* ================================================================
   2. TABLE + PHYSICS
   ================================================================ */
const TABLE = { w:400, h:800, cushion:22, ballR:14 };

// Physics — tuned for real billiards feel
// 物理参数：参考 funny-billards 的"线性减速"思路（每帧减一个固定速度模长）
// 转换到 Matter.js：frictionAir 数值越大滚动越短；通过实测调到接近真实手感
const PHYS = {
  frictionAir:      0.014,  // 平衡：太大滚动僵硬，太小晃荡
  friction:         0.04,
  frictionStatic:   0.04,
  restitution:      0.86,   // 略降弹性，减少碰撞后多次微弹造成的"震动"
  wallRestitution:  0.66,
  density:          0.045,
  maxSpeed:         24,
  minSpeed:          3,
  sleepSpeed:        0.25,  // checkSettled 判停阈值
  spinFactor:       0.05,
  powerCurve:       1.4,
  minShotDuration: 600
};

// 出杆首发位置（开球后母球默认点）— 用于母球复位
const CUE_DEFAULT = { x:200, y:600 };

// Pocket config（简化为 2 段）：
//   r        = visual radius (draw)
//   pocketR  = "真正落袋"半径 — 球心进入这个范围就算进
// 不再有"detectionR"吸引区 — 球必须靠自己滚到 pocketR 内才会进，自然得多
// Pocket config（简化为 2 段）：
//   r        = visual radius (draw)
//   pocketR  = "真正落袋"半径 — 球心进入这个范围就算进
//   suckR    = 辅助吸附半径 — 球进入后给一个温和的"袋口斜面"助力
// 不再有强烈的"detectionR"吸引区 — 但在球贴住袋口时给助力，模拟真实斜面
const POCKETS = [
  { x:26,  y:26,  r:22, pocketR:26, suckR:38, kind:'corner', name:'top_left'   },
  { x:374, y:26,  r:22, pocketR:26, suckR:38, kind:'corner', name:'top_right'  },
  { x:20,  y:400, r:19, pocketR:22, suckR:34, kind:'side',   name:'middle_left' },
  { x:380, y:400, r:19, pocketR:22, suckR:34, kind:'side',   name:'middle_right'},
  { x:26,  y:774, r:22, pocketR:26, suckR:38, kind:'corner', name:'bottom_left' },
  { x:374, y:774, r:22, pocketR:26, suckR:38, kind:'corner', name:'bottom_right'}
];

const BALL_COLORS = {
  1:'#f4c93a',2:'#1f5fbd',3:'#d63a3a',4:'#5a3aa8',
  5:'#e3801c',6:'#1f7d3d',7:'#7a1d1d',8:'#1a1a1a',
  9:'#f4c93a',10:'#1f5fbd',11:'#d63a3a',12:'#5a3aa8',
  13:'#e3801c',14:'#1f7d3d',15:'#7a1d1d'
};

/* ================================================================
   3. STATE
   ================================================================ */
const State = {
  matchId:   null,
  startTs:   null,
  botProfile: BOT_PROFILES.xiaomai,
  balls:     [],
  cue:       null,
  turn:      'me',
  shotSeq:   0,
  ended:     false,
  result:    null,
  myGroup:   null,   // 'solid' | 'stripe' | null
  oppGroup:  null,
  phase:     'IDLE',
  aimAngle:      -Math.PI/2,
  aimTargetAngle: -Math.PI/2,
  aimPower:  0,
  shotHistory: [],   // 逐杆记录（用于对局 summary 回传）
  breakPocketed: [], // 开球进袋记录
  reported:  false   // 本局是否已回传过结果（避免重复上报）
};

let engine=null, world=null, walls=[];
let ballCache = {};
let canvas=null, ctx=null;

// Settle guard
let _settleGuard  = false;
let _stillFrames  = 0;
let _shotStartTime = 0;
const STILL_FRAMES_REQ = 14;
const SETTLE_CHECK_INTERVAL = 80; // ms between settle checks
let _lastSettleCheck = 0;

// Shot context (for rule engine)
let _shotCtx = null;


/* ================================================================
   4. AUDIO
   ================================================================ */
const AudioFx = (() => {
  let actx = null, noiseBuf = null;
  function ensure(){
    if (!actx){
      try { actx = new (window.AudioContext||window.webkitAudioContext)(); }
      catch(e){ return null; }
      const len = Math.floor(actx.sampleRate * 0.6);
      noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i=0;i<len;i++) d[i] = Math.random()*2-1;
    }
    if (actx.state==='suspended') actx.resume();
    return actx;
  }
  function tone({freq=800, dur=0.08, type='sine', vol=0.3, filterFreq=null}){
    const c = ensure(); if (!c) return;
    const osc = c.createOscillator();
    const g   = c.createGain();
    osc.type = type; osc.frequency.value = freq;
    let last = g;
    if (filterFreq){
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = filterFreq;
      g.connect(f); last = f;
    }
    osc.connect(g); last.connect(c.destination);
    const t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t+0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    osc.start(t); osc.stop(t+dur+0.02);
  }
  function noise({dur=0.15, vol=0.2, filterFreq=2000}){
    const c = ensure(); if (!c||!noiseBuf) return;
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    f.type='bandpass'; f.frequency.value=filterFreq; f.Q.value=1;
    const g = c.createGain();
    src.connect(f); f.connect(g); g.connect(c.destination);
    const t = c.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    src.start(t); src.stop(t+dur+0.02);
  }
  return {
    init: ensure,
    ctx: () => actx,          // 暴露 AudioContext，供小麦语音共用同一音频会话
    cueHit(power){
      const f = 280 + power*260;
      tone({freq:f, dur:0.13, type:'triangle', vol:0.4, attack:0.001, decay:0.11, filterFreq:2000});
      noise({dur:0.05, vol:0.22, filterFreq:1400});
    },
    ballCollide(speed=0.5){
      const f = 1000 + speed*500;
      tone({freq:f, dur:0.07, type:'sine', vol:0.2+speed*0.18, attack:0.001, decay:0.06});
    },
    cushion(){
      tone({freq:150, dur:0.11, type:'sine', vol:0.3, attack:0.001, decay:0.1, filterFreq:600});
    },
    pocket(){
      // Improved: low thud + short wooden knock + decay
      tone({freq:180, dur:0.25, type:'sine', vol:0.38, attack:0.004, decay:0.22, filterFreq:1000});
      tone({freq:80,  dur:0.30, type:'sine', vol:0.25, attack:0.01,  decay:0.28, filterFreq:600});
      setTimeout(()=> tone({freq:300, dur:0.1, type:'sine', vol:0.14, attack:0.004, decay:0.09}), 60);
    }
  };
})();

/* ================================================================
   4b. CHARACTER — 小麦立绘 / 气泡台词 / 真人语音
   ================================================================ */
const Character = (() => {
  // 小麦语音改为走 Web Audio（与打球音效共用同一个 AudioContext / 音频会话）
  // 否则 iOS 上 HTML5 <audio> 播放会打断 Web Audio 的打球音效
  let _bufCache = {};      // url -> decoded AudioBuffer
  let _curSrc = null;      // 当前播放的 BufferSource（便于打断）
  let _bubbleTimer = null;
  let _moodTimer = null;
  let _muted = false;
  // 冷却控制：避免连珠炮
  let _lastBubbleAt = 0;
  let _lastVoiceAt  = 0;
  const BUBBLE_COOLDOWN = 4500;   // 两次气泡至少间隔 4.5s
  const VOICE_COOLDOWN  = 9000;   // 两次真人语音至少间隔 9s（每类都有语音了，可适当放宽频率）

  // 解码并缓存一个语音文件（返回 Promise<AudioBuffer>）；_loading 去重并发请求
  const _loading = {};
  function loadBuffer(url){
    if (_bufCache[url]) return Promise.resolve(_bufCache[url]);
    if (_loading[url]) return _loading[url];
    const c = AudioFx.ctx() || AudioFx.init();
    if (!c) return Promise.reject();
    const p = fetch(url)
      .then(r => r.arrayBuffer())
      .then(ab => new Promise((res, rej) => {
        // Safari 老接口用回调式 decodeAudioData
        c.decodeAudioData(ab, (buf)=>{ _bufCache[url] = buf; delete _loading[url]; res(buf); }, (e)=>{ delete _loading[url]; rej(e); });
      }))
      .catch(e => { delete _loading[url]; throw e; });
    _loading[url] = p;
    return p;
  }

  // 解锁：用户手势内 resume AudioContext（Web Audio 解锁），并预解码全部语音
  function unlock(){
    const c = AudioFx.init();               // 确保 AudioContext 创建 + resume
    if (!c) return;
    // 预加载所有小麦语音，避免首次播放时的解码延迟
    const clips = VOICE_CLIPS.xiaomai || {};
    Object.values(clips).forEach(arr => arr.forEach(cl => { loadBuffer(cl.audio).catch(()=>{}); }));
  }

  // 防重复：记录每个分类上一次抽到的索引，避免同一局连续触发同一条
  const _lastIdx = {};
  // 从数组里随机取一条，但不与该分类上一次相同（数组长度>1 时）
  function pickNoRepeat(arr, key){
    if (!arr || !arr.length) return undefined;
    if (arr.length === 1) return arr[0];
    let i, guard = 0;
    do { i = (Math.random()*arr.length)|0; guard++; }
    while (i === _lastIdx[key] && guard < 12);
    _lastIdx[key] = i;
    return arr[i];
  }
  // 新一局重置防重复记录（避免跨局还记着上一局最后一条）
  function resetRepeat(){ for (const k in _lastIdx) delete _lastIdx[k]; }

  function pick(arr){ return arr[(Math.random()*arr.length)|0]; }

  // 切换立绘表情；duration 后回到 idle
  // mood: idle/happy/cute/smug/pout → 切 .char-frame 的 mood-* class
  const MOOD_CLASS = { idle:'mood-happy', happy:'mood-happy', cute:'mood-cute', smug:'mood-smug', pout:'mood-pout' };
  function setMood(mood, holdMs = 3500){
    const frame = document.getElementById('char-frame');
    if (!frame) return;
    const cls = MOOD_CLASS[mood] || 'mood-happy';
    if (!frame.classList.contains(cls)){
      frame.classList.remove('mood-happy','mood-cute','mood-smug','mood-pout');
      frame.classList.add(cls);
    }
    clearTimeout(_moodTimer);
    if (holdMs > 0){
      _moodTimer = setTimeout(()=> setMood('idle', 0), holdMs);
    }
  }

  // 显示台词气泡（带冷却）
  function showBubble(text, holdMs = 3200, force = false){
    const stage = document.getElementById('char-stage');
    const bubble = document.getElementById('char-bubble');
    if (!stage || !bubble || !text) return false;
    const now = Date.now();
    if (!force && now - _lastBubbleAt < BUBBLE_COOLDOWN) return false;
    _lastBubbleAt = now;
    bubble.textContent = text;
    stage.classList.add('talking');
    clearTimeout(_bubbleTimer);
    _bubbleTimer = setTimeout(()=>{
      stage.classList.remove('talking');
    }, holdMs);
    return true;
  }

  // 播放真人语音（走 Web Audio，与打球音效同一会话，不会互相打断）
  function playClip(clip, force = false){
    if (_muted || !clip || !clip.audio) return false;
    const now = Date.now();
    if (!force && now - _lastVoiceAt < VOICE_COOLDOWN) return false;
    const c = AudioFx.ctx() || AudioFx.init();
    if (!c) return false;
    _lastVoiceAt = now;
    loadBuffer(clip.audio).then(buf => {
      if (_muted) return;
      try {
        if (_curSrc){ try{ _curSrc.stop(); }catch(e){} _curSrc = null; }
        const src = c.createBufferSource();
        src.buffer = buf;
        const g = c.createGain();
        g.gain.value = 0.95;
        src.connect(g); g.connect(c.destination);
        src.start(0);
        _curSrc = src;
        src.onended = () => { if (_curSrc === src) _curSrc = null; };
      } catch(e){}
    }).catch(()=>{});
    return true;
  }

  /**
   * 角色"说话"——语音优先：切表情 +（冷却内才）播真人语音 + 同步字幕气泡
   * @param {string} category   分类（taunt/cute/praise/on_win/on_lose/on_player_foul/on_bot_foul）
   * @param {string} mood       立绘表情（smug/happy/cute/pout）
   * @param {object} opts
   *   - voiceChance {number}  尝试播语音的概率 0~1（默认 1，必尝试；受冷却约束）
   *   - bubble {boolean}      语音被冷却挡下时，是否退化为纯文字气泡（默认 false，安静）
   *   - force {boolean}       忽略所有冷却（终局等关键时刻必出语音+字幕）
   */
  function say(category, mood = 'idle', opts = {}){
    const id = State.botProfile && State.botProfile.id;
    if (id !== 'xiaomai') return;  // 目前只有小麦有素材

    const { voiceChance = 1, bubble = false, force = false } = opts;

    // 表情总是切换（纯视觉反馈，不吵）
    setMood(mood, 3800);

    // 语音优先：命中概率 + 冷却通过 → 播音频 + 显示对应字幕
    const clips = (VOICE_CLIPS[id] && VOICE_CLIPS[id][category]) || [];
    if (clips.length && (force || Math.random() < voiceChance)){
      const clip = pickNoRepeat(clips, id + ':v:' + category);
      if (playClip(clip, force)){
        showBubble(clip.text, 4400, force);
        return;
      }
    }

    // 语音被冷却挡下：默认安静（只留表情）；显式允许时退化为文字气泡
    if (bubble){
      // 优先用台词库；没有对应分类则回退到 VOICE_CLIPS 的字幕文本
      let lines = (VOICE_LINES[id] && VOICE_LINES[id][category]) || [];
      if (!lines.length && clips.length) lines = clips.map(c => c.text);
      if (lines.length) showBubble(pickNoRepeat(lines, id + ':t:' + category), 3400, force);
    }
  }

  function toggleMute(){ _muted = !_muted; if (_muted && _curSrc){ try{ _curSrc.stop(); }catch(e){} _curSrc = null; } return _muted; }

  return { say, setMood, showBubble, toggleMute, resetRepeat, unlock };
})();
// 暴露到 window，便于静音开关 / 调试触发
try { window.Character = Character; } catch(e){}

// 首次用户手势：解锁共用的 AudioContext（打球音效 + 小麦语音都走它）
['pointerdown','touchstart','click'].forEach(ev =>
  document.addEventListener(ev, ()=>{ AudioFx.init(); Character.unlock(); }, {once:true, passive:true}));

/* ================================================================
   5. MATTER.JS ENGINE INIT
   ================================================================ */
function initEngine(){
  if (engine){ World.clear(world,false); Engine.clear(engine); }
  engine = Engine.create({
    gravity: { x:0, y:0 },
    // 提高迭代次数 → 多球接触/贴库时求解更稳，减少"原地抖动"
    positionIterations: 12,
    velocityIterations: 12,
    constraintIterations: 4
  });
  world = engine.world;

  const c  = TABLE.cushion;
  const w  = TABLE.w;
  const h  = TABLE.h;
  const t  = 60;  // wall thickness

  // 袋口缺口大小（要 > 球直径 28，让球能自然滚进袋口而不是被库边弹走）
  // 角袋缺口 = 32px，边袋缺口 = 30px
  const cm = 32;  // corner pocket gap（之前 24 太窄，球会被库边弹走）
  const sm = 30;  // side pocket gap（之前 26 太窄）

  const wallOpts = {
    isStatic: true,
    restitution: PHYS.wallRestitution,
    friction: 0.05,
    label: 'wall'
  };

  walls = [

    // Top cushion (split at pockets)
    Bodies.rectangle(c+cm+(w/2-c-cm)/2, c-t/2, w/2-c-cm, t, wallOpts),
    Bodies.rectangle(w/2+c+cm/2, c-t/2, w/2-c-cm, t, wallOpts),

    // Bottom cushion
    Bodies.rectangle(c+cm+(w/2-c-cm)/2, h-c+t/2, w/2-c-cm, t, wallOpts),
    Bodies.rectangle(w/2+c+cm/2, h-c+t/2, w/2-c-cm, t, wallOpts),

    // Left cushion (split at side pockets)
    Bodies.rectangle(c-t/2, c+sm+(h/2-c-c-sm)/2, t, h/2-c-c-sm, wallOpts),
    Bodies.rectangle(c-t/2, h/2+c+sm/2, t, h/2-c-c-sm, wallOpts),

    // Right cushion
    Bodies.rectangle(w-c+t/2, c+sm+(h/2-c-c-sm)/2, t, h/2-c-c-sm, wallOpts),
    Bodies.rectangle(w-c+t/2, h/2+c+sm/2, t, h/2-c-c-sm, wallOpts)
  ];
  Composite.add(world, walls);

  // —— 外围保险墙：完整包住整个桌面，防止球从袋口缝隙之外滑出 ——
  // 这是兜底，正常情况下不会碰到（球应该被库边或袋口截住）
  const safety = 60;
  const safetyOpts = { isStatic:true, restitution:0.3, friction:0.1, label:'safety' };
  const safetyWalls = [
    Bodies.rectangle(-safety/2,    h/2, safety, h+200, safetyOpts), // 左
    Bodies.rectangle(w+safety/2,   h/2, safety, h+200, safetyOpts), // 右
    Bodies.rectangle(w/2, -safety/2,    w+200, safety, safetyOpts), // 上
    Bodies.rectangle(w/2, h+safety/2,   w+200, safety, safetyOpts)  // 下
  ];
  Composite.add(world, safetyWalls);

  // Collision events
  Events.on(engine, 'collisionStart', (ev) => {
    for (const pair of ev.pairs){
      const {bodyA,bodyB} = pair;
      const la = bodyA.label, lb = bodyB.label;
      const rel = (bodyA.ball&&bodyB.ball)
        ? Math.hypot(bodyA.velocity.x-bodyB.velocity.x, bodyA.velocity.y-bodyB.velocity.y) : 0;
      if (la==='wall'||lb==='wall'){
        AudioFx.cushion();
        if (_shotCtx) _shotCtx.cushionHit = true;
      } else if (bodyA.ball && bodyB.ball){
        AudioFx.ballCollide(clamp(rel/PHYS.maxSpeed, 0.2, 1));
        const a = bodyA.ball, b = bodyB.ball;
        const mid = { x:(bodyA.position.x+bodyB.position.x)/2, y:(bodyA.position.y+bodyB.position.y)/2 };
        spawnImpact(mid.x, mid.y, rel);
        recordContact(a, b);
      }
    }
  });
}

/* ================================================================
   6. BALL SETUP + 2X SUPERSAMPLED RENDERING
   ================================================================ */
function makeBallBody(x, y){
  return Bodies.circle(x, y, TABLE.ballR, {
    restitution:    PHYS.restitution,
    friction:       PHYS.friction,
    frictionStatic: PHYS.frictionStatic,
    frictionAir:   PHYS.frictionAir,
    density:        PHYS.density,
    label:          'ball',
    slop:           0.02
  });
}

// Build offscreen ball image — 复刻 v4 的 3D 球面着色（基底渐变 + 主/次高光 + 边缘暗化）
function buildBallImage(ball){
  const Rscreen = TABLE.ballR;             // 屏幕半径 14
  const SCALE   = 4;                        // 4x 超采样
  const S       = Rscreen * 2 * SCALE;      // 最终缓存 = 112px
  const S2      = S * 2;                    // 离屏绘制 = 224px（8x 超采样）
  const off = document.createElement('canvas');
  off.width = S2; off.height = S2;
  const c = off.getContext('2d');
  const cx = S2/2, cy = S2/2;
  const Roff = S2/2 - 4;                    // 离屏球半径，留 4px 抗锯齿

  // 基底颜色
  let baseColor = '#ffffff';
  let isStripe = false;
  if (ball.type === 'cue')      baseColor = '#f8f8f0';
  else if (ball.type === 'eight') baseColor = '#1a1a1a';
  else if (ball.type === 'solid') baseColor = BALL_COLORS[ball.num] || '#f8f8f0';
  else { isStripe = true; baseColor = '#f8f8f0'; }

  // 球面基底渐变（左上 → 右下，模拟顶光球面）
  c.beginPath(); c.arc(cx, cy, Roff, 0, Math.PI*2);
  const baseGrad = c.createRadialGradient(cx-Roff*0.25, cy-Roff*0.25, Roff*0.1, cx, cy, Roff);
  if (ball.type === 'eight'){
    baseGrad.addColorStop(0, '#3a3a3a');
    baseGrad.addColorStop(0.7, '#1a1a1a');
    baseGrad.addColorStop(1, '#000000');
  } else {
    const col = isStripe ? '#f8f8f0' : baseColor;
    baseGrad.addColorStop(0, lightenColor(col, 40));
    baseGrad.addColorStop(0.6, col);
    baseGrad.addColorStop(1, darkenColor(col, 50));
  }
  c.fillStyle = baseGrad; c.fill();

  // 条纹球的彩色横带
  if (isStripe){
    const col = BALL_COLORS[ball.num] || '#f8f8f0';
    c.save();
    c.beginPath(); c.arc(cx, cy, Roff, 0, Math.PI*2); c.clip();
    const stripeY = cy - Roff*0.35;
    const stripeH = Roff * 0.7;
    c.fillStyle = col;
    c.fillRect(cx-Roff, stripeY, Roff*2, stripeH);
    // 条纹边缘阴影（卷曲感）
    const eg1 = c.createLinearGradient(cx-Roff, stripeY, cx-Roff, stripeY+Roff*0.18);
    eg1.addColorStop(0, 'rgba(0,0,0,0)');
    eg1.addColorStop(1, 'rgba(0,0,0,0.18)');
    c.fillStyle = eg1; c.fillRect(cx-Roff, stripeY, Roff*2, Roff*0.18);
    const eg2 = c.createLinearGradient(cx-Roff, stripeY+stripeH-Roff*0.18, cx-Roff, stripeY+stripeH);
    eg2.addColorStop(0, 'rgba(0,0,0,0.18)');
    eg2.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = eg2; c.fillRect(cx-Roff, stripeY+stripeH-Roff*0.18, Roff*2, Roff*0.18);
    c.restore();
  }

  // 白圆 + 数字（8 球 / 实心 / 条纹球都画）
  if (ball.type === 'eight' || ball.type === 'solid' || isStripe){
    const label = ball.type === 'eight' ? '8' : String(ball.num);
    c.beginPath(); c.arc(cx, cy, Roff*0.45, 0, Math.PI*2);
    c.fillStyle = '#ffffff'; c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.12)'; c.lineWidth = Roff*0.04; c.stroke();
    c.lineWidth = Roff*0.12; c.lineJoin = 'round'; c.strokeStyle = '#ffffff';
    c.fillStyle = '#1a1a1a';
    c.font = 'bold ' + (Roff*0.65) + 'px "Helvetica Neue",Arial,sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.strokeText(label, cx, cy+Roff*0.04);
    c.fillText(label, cx, cy+Roff*0.04);
  }

  // 球面高光（主 + 次）— 这是 3D 感的关键
  c.save();
  c.beginPath(); c.arc(cx, cy, Roff, 0, Math.PI*2); c.clip();
  // 主高光（左上，强亮）
  const hl1 = c.createRadialGradient(cx-Roff*0.3, cy-Roff*0.3, Roff*0.05,
                                     cx-Roff*0.3, cy-Roff*0.3, Roff*0.7);
  hl1.addColorStop(0, 'rgba(255,255,255,0.55)');
  hl1.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  hl1.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = hl1; c.fillRect(0, 0, S2, S2);
  // 次高光（右上，柔光）
  const hl2 = c.createRadialGradient(cx+Roff*0.25, cy-Roff*0.2, Roff*0.05,
                                     cx+Roff*0.25, cy-Roff*0.2, Roff*0.5);
  hl2.addColorStop(0, 'rgba(255,255,255,0.2)');
  hl2.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = hl2; c.fillRect(0, 0, S2, S2);
  // 底部边缘暗化（增加立体感）
  const edge = c.createRadialGradient(cx, cy, Roff*0.7, cx, cy, Roff);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,0.22)');
  c.fillStyle = edge; c.fillRect(0, 0, S2, S2);
  c.restore();

  // 母球红点
  if (ball.type === 'cue'){
    c.beginPath(); c.arc(cx, cy-Roff*0.25, Roff*0.13, 0, Math.PI*2);
    c.fillStyle = '#e03030'; c.fill();
    c.strokeStyle = '#a00000'; c.lineWidth = Roff*0.03; c.stroke();
  }

  // 缩到最终缓存（8x → 4x），保证 drawImage 时再缩 2x 抗锯齿仍清晰
  const offFinal = document.createElement('canvas');
  offFinal.width = S; offFinal.height = S;
  const cFinal = offFinal.getContext('2d');
  cFinal.imageSmoothingEnabled = true;
  cFinal.imageSmoothingQuality = 'high';
  cFinal.drawImage(off, 0, 0, S2, S2, 0, 0, S, S);
  ballCache[ball.id] = offFinal;
}

function lightenColor(color, p){
  const n = parseInt(color.replace('#',''),16);
  const r = Math.min(255,(n>>16)+p);
  const g = Math.min(255,((n>>8)&0xFF)+p);
  const b = Math.min(255,(n&0xFF)+p);
  return '#'+(0x1000000+r*0x10000+g*0x100+b).toString(16).slice(1);
}
function darkenColor(color, p){
  const n = parseInt(color.replace('#',''),16);
  const r = Math.max(0,(n>>16)-p);
  const g = Math.max(0,((n>>8)&0xFF)-p);
  const b = Math.max(0,(n&0xFF)-p);
  return '#'+(0x1000000+r*0x10000+g*0x100+b).toString(16).slice(1);
}

function buildAllBallImages(){
  State.balls.forEach(b => buildBallImage(b));
}

function setupRack(){
  State.balls = [];
  ballCache = {};
  const cueBall = { id:'cue', num:0, type:'cue', pocketed:false };
  cueBall.body = makeBallBody(200, 600);
  cueBall.body.ball = cueBall;
  State.balls.push(cueBall);

  const apex = { x:200, y:240 };
  const order = [1,11,3,13,8,6,9,4,12,5,14,2,7,10,15];
  let i=0;
  for (let row=0;row<5;row++){
    for (let col=0;col<=row;col++){
      const num = order[i++];
      const x = apex.x + (col-row/2)*(TABLE.ballR*2+0.5);
      const y = apex.y + row*(TABLE.ballR*2*0.88);
      const b = {
        id: 'b'+num, num,
        type: num===8?'eight':(num<=7?'solid':'stripe'),
        pocketed: false
      };
      b.body = makeBallBody(x,y); b.body.ball = b;
      State.balls.push(b);
    }
  }
  State.cue = State.balls[0];
  Composite.add(world, State.balls.map(b=>b.body));
  buildAllBallImages();
}

/* ================================================================
   7. IMPACT PARTICLES
   ================================================================ */
let _impacts = [];
function spawnImpact(x,y,impactV){
  if (!isFinite(x)||!isFinite(y)) return;
  const strength = clamp(impactV/PHYS.maxSpeed, 0, 1);
  const n = Math.round(4 + strength*10);
  for (let i=0;i<n;i++){
    const a = Math.random()*Math.PI*2;
    const sp = (1.2+Math.random()*3.5)*(0.5+strength);
    const r = 1+Math.random()*1.8;
    _impacts.push({
      x,y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp,
      life:0, max:10+Math.random()*12+strength*10,
      r, color: i%3===0?'#fff':'rgba(255,236,180,0.95)'
    });
  }
}
function stepImpacts(){
  if (!_impacts.length) return;
  _impacts = _impacts.filter(p=>{
    p.life++;
    p.x+=p.vx; p.y+=p.vy;
    p.vx*=0.86; p.vy*=0.86;
    if (p.life>=p.max) return false;
    if (ctx){
      ctx.globalAlpha = clamp(1-p.life/p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x,p.y, p.r*(1-p.life/p.max), 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    return true;
  });
}

function shakeTable(power){
  const el = $('#table'); if (!el) return;
  const amp = clamp((power-0.45)*7, 1, 5);
  let n=0;
  (function tick(){
    if (n>=6){ el.style.transform=''; return; }
    const dx = (Math.random()-0.5)*amp*(1-n/6);
    const dy = (Math.random()-0.5)*amp*(1-n/6);
    el.style.transform = `translate(${dx}px,${dy}px)`;
    n++; requestAnimationFrame(tick);
  })();
}

/* ================================================================
   8. AIM SYSTEM (SVG overlay)
   ================================================================ */
const aimLayer    = $('#aim-layer');
const aimLine     = $('#aim-line');
const aimBracket  = $('#aim-bracket');
const targetLine  = $('#target-line');
const cueAfterLine= $('#cue-after-line');
const bounceLine  = $('#bounce-line');
const ghostBall   = $('#ghost-ball');
const tableCue    = $('#table-cue');
const tableCueStick=$('#table-cue-stick');
const tableCueTip  =$('#table-cue-tip');

function setPhase(p){
  State.phase = p;
  updateTurnUI();
  if (p==='IDLE'){
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

// Ghost ball calculation — rewritten for accuracy
function findFirstContact(cx, cy, ang){
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const D  = TABLE.ballR * 2;  // collision diameter = 28
  const D2 = D * D;
  let best = null;
  for (const b of State.balls){
    if (b.pocketed || b.type==='cue') continue;
    const bx=b.body.position.x, by=b.body.position.y;
    const ex=bx-cx, ey=by-cy;
    const proj = ex*dx + ey*dy;
    if (proj <= D) continue;       // too close or behind
    const perp2 = ex*ex + ey*ey - proj*proj;
    if (perp2 >= D2) continue;    // ray misses
    const back = Math.sqrt(D2 - perp2);
    const t = proj - back;
    if (t<1) continue;
    if (!best || t<best.t){
      const gcgX = cx + dx*t;
      const gcY  = cy + dy*t;
      best = {
        ball: b,
        t,
        ghostCenter: { x:gcgX, y:gcY },
        hitPoint: {
          x: bx + (gcgX-bx)*(TABLE.ballR/D),
          y: by + (gcY-by)*(TABLE.ballR/D)
        }
      };
    }
  }
  return best;
}

function redrawAim(){
  if (!State.cue||!State.cue.body) { hideAim(); return; }
  const ang = State.aimAngle;
  const cx=State.cue.body.position.x, cy=State.cue.body.position.y;
  const contact = findFirstContact(cx,cy,ang);

  const startX = cx + Math.cos(ang)*TABLE.ballR;
  const startY = cy + Math.sin(ang)*TABLE.ballR;

  if (contact){
    // Aim line ends at edge of ghost ball (not center!)
    const gc = contact.ghostCenter;
    const aimEndX = gc.x - Math.cos(ang)*TABLE.ballR;
    const aimEndY = gc.y - Math.sin(ang)*TABLE.ballR;
    showAim(startX, startY, aimEndX, aimEndY);

    showGhost(gc.x, gc.y);
    showBracket(contact.ball.body.position.x, contact.ball.body.position.y);

    // Target ball travel direction
    const tAng = Math.atan2(
      contact.ball.body.position.y - gc.y,
      contact.ball.body.position.x - gc.x
    );
    const tEnd = projectToWall(contact.ball.body.position.x, contact.ball.body.position.y, tAng, 220);
    showTargetLine(contact.ball.body.position.x, contact.ball.body.position.y, tEnd.x, tEnd.y);

    // Cue ball separation direction
    const side = angDiff(tAng,ang)>0 ? -1 : 1;
    const sepAng = tAng + side*Math.PI/2;
    const cut = Math.abs(angDiff(tAng, ang));
    const sepLen = clamp(70*Math.cos(cut)+18, 18, 88);
    const cEnd = projectToWall(gc.x, gc.y, sepAng, sepLen);
    showCueAfterLine(gc.x, gc.y, cEnd.x, cEnd.y);
    hideBounceLine();
  } else {
    const endP = projectToWall(cx,cy,ang,900);
    showAim(startX, startY, endP.x, endP.y);
    hideBracket(); hideTargetLine(); hideCueAfterLine(); hideGhost();

    const hit = firstWallHit(cx,cy,ang);
    if (hit){
      let rAng;
      if (hit.axis==='x') rAng = Math.atan2(Math.sin(ang), -Math.cos(ang));
      else                  rAng = Math.atan2(-Math.sin(ang), Math.cos(ang));
      const rEnd = projectToWall(hit.x,hit.y,rAng,160);
      showBounceLine(hit.x,hit.y,rEnd.x,rEnd.y);
    } else hideBounceLine();
  }
  showTableCue();
}

function projectToWall(cx,cy,ang,maxLen){
  const dx=Math.cos(ang), dy=Math.sin(ang);
  let t=maxLen;
  if (dx>0)       t=Math.min(t, (TABLE.w-TABLE.cushion-cx)/dx);
  else if (dx<0)  t=Math.min(t, (TABLE.cushion-cx)/dx);
  if (dy>0)       t=Math.min(t, (TABLE.h-TABLE.cushion-cy)/dy);
  else if (dy<0)  t=Math.min(t, (TABLE.cushion-cy)/dy);
  t = Math.max(t,0);
  return {x:cx+dx*t, y:cy+dy*t};
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
  if (tx<ty) return {x:cx+dx*tx, y:cy+dy*tx, axis:'x'};
  return {x:cx+dx*ty, y:cy+dy*ty, axis:'y'};
}

// SVG helper functions
function showAim(x1,y1,x2,y2){
  aimLine.setAttribute('x1',x1); aimLine.setAttribute('y1',y1);
  aimLine.setAttribute('x2',x2); aimLine.setAttribute('y2',y2);
  aimLine.setAttribute('opacity',1);
}
function hideAim(){
  aimLine.setAttribute('opacity',0);
  hideBracket(); hideTargetLine(); hideCueAfterLine(); hideGhost(); hideBounceLine();
}
function showBracket(x,y){ aimBracket.setAttribute('transform',`translate(${x} ${y})`); aimBracket.setAttribute('opacity',1); }
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

// Table cue (SVG stick) — with charge wobble
function showTableCue(extraPull=0, wobble=0){
  const ang = State.aimAngle;
  const cx=State.cue.body.position.x, cy=State.cue.body.position.y;
  const tipLen=16, stickLen=230, gap=TABLE.ballR+5;
  const pullback = State.aimPower*70 + extraPull;
  const px = Math.cos(ang+Math.PI/2)*wobble;
  const py = Math.sin(ang+Math.PI/2)*wobble;
  const baseX = cx + Math.cos(ang+Math.PI)*(gap+pullback) + px;
  const baseY = cy + Math.sin(ang+Math.PI)*(gap+pullback) + py;
  const tipEndX = baseX + Math.cos(ang+Math.PI)*tipLen;
  const tipEndY = baseY + Math.sin(ang+Math.PI)*tipLen;
  const stickEndX = tipEndX + Math.cos(ang+Math.PI)*stickLen;
  const stickEndY = tipEndY + Math.sin(ang+Math.PI)*stickLen;
  tableCueTip.setAttribute('x1',baseX);  tableCueTip.setAttribute('y1',baseY);
  tableCueTip.setAttribute('x2',tipEndX); tableCueTip.setAttribute('y2',tipEndY);
  tableCueStick.setAttribute('x1',tipEndX); tableCueStick.setAttribute('y1',tipEndY);
  tableCueStick.setAttribute('x2',stickEndX); tableCueStick.setAttribute('y2',stickEndY);
  tableCue.setAttribute('opacity',1);
}
function hideTableCue(){ tableCue.setAttribute('opacity',0); stopChargeWobble(); }

let _wobbleRAF = null;
function startChargeWobble(){
  if (_wobbleRAF) return;
  const tick=()=>{
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

/* ================================================================
   9. INTERACTION (pointer + rail)
   ================================================================ */
let aimDragging = false;
const canvas_el = $('#table-canvas');
canvas_el.addEventListener('pointerdown', (e)=>{
  if (State.turn!=='me'||State.ended) return;
  if (State.phase==='SHOOTING'||State.phase==='LOCKED') return;
  AudioFx.init();
  canvas_el.setPointerCapture(e.pointerId);
  aimDragging=true;
  setPhase('AIM');
  updateAim(e);
});
canvas_el.addEventListener('pointermove', (e)=>{ if (aimDragging) updateAim(e); });
canvas_el.addEventListener('pointerup',   ()=>{ aimDragging=false; });
canvas_el.addEventListener('pointercancel', ()=>{ aimDragging=false; });

function updateAim(e){
  const rect = canvas_el.getBoundingClientRect();
  const px = (e.clientX-rect.left)/rect.width*TABLE.w;
  const py = (e.clientY-rect.top)/rect.height*TABLE.h;
  const cx=State.cue.body.position.x, cy=State.cue.body.position.y;
  const dx=px-cx, dy=py-cy;
  if (Math.hypot(dx,dy)<4) return;
  State.aimTargetAngle = Math.atan2(dy,dx);
  startAimSmooth();
}

let _aimSmoothRAF = null;
function startAimSmooth(){
  if (_aimSmoothRAF) return;
  const tick=()=>{
    const d = angDiff(State.aimTargetAngle, State.aimAngle);
    if (Math.abs(d)<0.0015){
      State.aimAngle = State.aimTargetAngle;
      redrawAim(); _aimSmoothRAF=null; return;
    }
    State.aimAngle += d*0.35;
    redrawAim();
    _aimSmoothRAF = requestAnimationFrame(tick);
  };
  _aimSmoothRAF = requestAnimationFrame(tick);
}

// Rail (power)
const cueRail  = $('#cue-rail');
const railFill  = $('#rail-fill');
const railStick = $('#rail-stick');
let railDragging=false, railStartY=0, railStartPower=0;

cueRail.addEventListener('pointerdown', (e)=>{
  if (State.turn!=='me'||State.ended) return;
  if (State.phase==='SHOOTING'||State.phase==='LOCKED') return;
  AudioFx.init();
  setPhase('POWER');
  cueRail.setPointerCapture(e.pointerId);
  railDragging=true;
  railStartY=e.clientY;
  railStartPower=State.aimPower;
  redrawAim();
});
cueRail.addEventListener('pointermove', (e)=>{
  if (!railDragging) return;
  const track = $('.rail-track');
  const trackH = track? track.getBoundingClientRect().height : 300;
  const dy = e.clientY - railStartY;
  setPower(clamp(railStartPower + dy/trackH, 0, 1));
});
cueRail.addEventListener('pointerup', ()=>{
  if (!railDragging) return;
  railDragging=false;
  if (State.aimPower>0.04){
    doShot('me', State.aimAngle, State.aimPower);
  } else { setPower(0); setPhase('IDLE'); }
});
cueRail.addEventListener('pointercancel', ()=>{ railDragging=false; setPower(0); setPhase('IDLE'); });

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
  railFill.style.height = `${p*100}%`;
  const track = $('.rail-track');
  const trackH = track? track.getBoundingClientRect().height : 300;
  const maxDrag = Math.max(1, trackH-70);
  if (railStick) railStick.style.transform = `translate(-50%, ${p*maxDrag}px)`;
}

// Cue ball reset (按钮已移除，保留判空避免脚本中断)
const _cueBallBtn = $('#btn-cue-ball');
if (_cueBallBtn){
  _cueBallBtn.addEventListener('click', ()=>{
    if (State.turn!=='me'||State.ended) return;
    if (State.phase==='SHOOTING'||State.phase==='LOCKED') return;
    Body.setPosition(State.cue.body, {x:200,y:600});
    Body.setVelocity(State.cue.body, {x:0,y:0});
    Body.setAngularVelocity(State.cue.body, 0);
    setPower(0); setPhase('IDLE');
  });
}

/* ================================================================
   11. SHOT EXECUTION
   ================================================================ */
function markCushionHit(){ if (_shotCtx) _shotCtx.cushionHit=true; }

function recordContact(a, b){
  if (!_shotCtx) return;
  if (a.id==='cue' && b.type!=='cue' && !_shotCtx.firstContact) _shotCtx.firstContact = b;
  if (b.id==='cue' && a.type!=='cue' && !_shotCtx.firstContact) _shotCtx.firstContact = a;
  if (a.type!=='cue') _shotCtx.contacted.add(a.id);
  if (b.type!=='cue') _shotCtx.contacted.add(b.id);
}

async function doShot(shooter, angle, power){
  setPhase('SHOOTING');
  _settleGuard  = false;
  _stillFrames  = 0;
  _shotStartTime = performance.now() + 250;  // delay settle check until after cue strike animation
  AudioFx.init();
  State.shotSeq += 1;

  hideAim();

  // Animate cue strike (visual)
  await animateCueStrike(angle, power);
  AudioFx.cueHit(power);
  hideTableCue();

  // Reset rail fill AFTER animation completes
  setRailFill(0);
  State.aimPower = 0;

  // Record shot context (for rule engine) — MUST be set before setVelocity
  _shotCtx = { shooter, firstContact:null, contacted:new Set(), pocketedThisShot:[], cushionHit:false };

  // Apply velocity with power curve
  const v0 = PHYS.minSpeed + (PHYS.maxSpeed-PHYS.minSpeed)*Math.pow(power, PHYS.powerCurve);
  const vx = Math.cos(angle)*v0;
  const vy = Math.sin(angle)*v0;
  Body.setVelocity(State.cue.body, {x:vx, y:vy});

  _shotStartTime = performance.now();

  // Impact particles + table shake
  const tipX = State.cue.body.position.x + Math.cos(angle)*TABLE.ballR*2.2;
  const tipY = State.cue.body.position.y + Math.sin(angle)*TABLE.ballR*2.2;
  spawnImpact(tipX, tipY, power*PHYS.maxSpeed);
  shakeTable(power);
}

// Cue strike animation — REAL visual (not empty)
function animateCueStrike(angle, power){
  return new Promise(resolve => {
    const dur = 120 + (1-power)*100;  // faster for harder shots
    const t0 = performance.now();
    let pulled = false;

    function tick(){
      const elapsed = performance.now() - t0;
      if (elapsed >= dur){
        resolve();
        return;
      }
      // Pull back phase: 0→40% of duration
      // Strike phase: 40%→60%
      // Follow-through: 60%→100%
      const progress = elapsed / dur;
      let extraPull = 0;

      if (progress < 0.4){
        // Pull back: ease out
        const p = 1 - Math.pow(1 - progress/0.4, 2);
        extraPull = p * power * 70;
        showTableCue(extraPull, 0);
      } else if (progress < 0.6){
        // Strike forward: rapid movement
        const p = (progress-0.4)/0.2;
        extraPull = (1-p) * power * 70;  // snap forward
        showTableCue(extraPull * -2, 0);  // move past cue ball
      } else {
        // Follow-through: slowly return to rest position
        const p = (progress-0.6)/0.4;
        showTableCue(0, 0);
      }

      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

/* ================================================================
   12. MAIN LOOP (single-threaded, no Runner)
   ================================================================ */
let _lastTS = 0;
const PHYS_STEP = 1000/60;  // 16.67ms fixed physics step
let _physAccum = 0;

function gameLoop(ts){
  requestAnimationFrame(gameLoop);

  // Fixed timestep physics
  const frameDt = _lastTS ? Math.min(ts-_lastTS, 30) : 16;
  _lastTS = ts;
  _physAccum += frameDt;

  while (_physAccum >= PHYS_STEP){
    Engine.update(engine, PHYS_STEP);
    dampCreepingBalls();           // 物理步后立即衰减微速球
    checkPockets();                 // 每物理步都查进袋（避免高速穿过）
    checkOutOfBounds();             // 出界保险
    _physAccum -= PHYS_STEP;
  }

  // Render
  renderTable();
  renderBalls();
  stepImpacts();

  // Settle 检测保留 throttled
  const now = performance.now();
  if (now - _lastSettleCheck > SETTLE_CHECK_INTERVAL){
    _lastSettleCheck = now;
    checkSettled();
  }
}

// 出界检查：每物理步都跑，球跑出桌外立刻判进最近袋
function checkOutOfBounds(){
  State.balls.forEach(b => {
    if (b.pocketed || !b.body) return;
    const {x, y} = b.body.position;
    if (x < -6 || x > TABLE.w+6 || y < -6 || y > TABLE.h+6){
      let nearest = POCKETS[0], minD = Infinity;
      for (const pk of POCKETS){
        const d = Math.hypot(pk.x-x, pk.y-y);
        if (d < minD){ minD = d; nearest = pk; }
      }
      pocketBall(b, nearest);
    }
  });
}

/* ================================================================
   12b. CREEPING BALL DAMPING — 只抑制"几乎不动还在抖"的球
   - 只在 SHOOTING/LOCKED 阶段干预（IDLE 不动球）
   - 阈值不能太高，否则球还在滚就被吞掉 → 看上去"软绵绵"
   - 在 suckR 范围内的球不被阻尼归零（checkPockets 正在给助力）
   ================================================================ */
function dampCreepingBalls(){
  if (State.phase !== 'SHOOTING' && State.phase !== 'LOCKED') return;
  const R = TABLE.ballR;
  for (const b of State.balls){
    if (b.pocketed || !b.body) continue;

    // 关键：在 suckR 范围内的球不要被衰减归零
    // （checkPockets 正在给它助力，要让它自然滚进袋）
    let nearPocket = false;
    const { x, y } = b.body.position;
    for (const pk of POCKETS){
      const d = Math.hypot(pk.x - x, pk.y - y);
      if (d < pk.suckR){   // 用 suckR 而不是 pocketR
        nearPocket = true; break;
      }
    }
    if (nearPocket) continue;

    const v = b.body.velocity;
    const speed = Math.hypot(v.x, v.y);

    // 分级阻尼：消除"碰撞后低速微弹/震动"，但不影响正常滚动
    //  - speed < 0.12：直接归零（这就是肉眼看到的"抖动"区间）
    //  - 0.12 ~ 0.6 ：每帧额外衰减一点，让残余的微小弹跳快速收敛
    //  > 0.6 保持不动，正常滚动/反弹手感不受影响
    if (speed > 0 && speed < 0.12){
      Body.setVelocity(b.body, {x:0, y:0});
      Body.setAngularVelocity(b.body, 0);
    } else if (speed < 0.6){
      Body.setVelocity(b.body, { x: v.x * 0.82, y: v.y * 0.82 });
      Body.setAngularVelocity(b.body, b.body.angularVelocity * 0.82);
    }

    // 角速度单独收敛：碰撞常给球残余自旋，造成视觉上"原地抖/晃"
    if (Math.abs(b.body.angularVelocity) < 0.02){
      Body.setAngularVelocity(b.body, 0);
    }
  }
}

/* ================================================================
   13. TABLE + BALL RENDERING (Canvas)
   ================================================================ */
function renderTable(){
  if (!ctx) return;
  ctx.clearRect(0,0,TABLE.w,TABLE.h);

  // Felt
  const fGrad = ctx.createRadialGradient(TABLE.w/2,TABLE.h/2,0, TABLE.w/2,TABLE.h/2,TABLE.h*0.6);
  fGrad.addColorStop(0, '#2c7e9e');
  fGrad.addColorStop(0.75,'#1f6280');
  fGrad.addColorStop(1, '#154860');
  ctx.fillStyle = fGrad;
  ctx.fillRect(0,0,TABLE.w,TABLE.h);

  // Pockets (visual)
  POCKETS.forEach(pk=>{
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.beginPath();
    ctx.arc(pk.x, pk.y, pk.r, 0, Math.PI*2);
    ctx.fill();
  });
}

function renderBalls(){
  if (!ctx) return;
  State.balls.forEach(b=>{
    if (b.pocketed||!b.body) return;

    // 浮点坐标（用于滚动累积 + 朝向计算），整数坐标（用于绘制对齐像素，避免抖动）
    const fx = b.body.position.x;
    const fy = b.body.position.y;
    const px = Math.round(fx);
    const py = Math.round(fy);

    const off = ballCache[b.id];
    if (!off) return;

    // —— 滚动累积（用浮点 + 速度向量，避免整数 round 把慢速球的滚动吞掉）——
    if (b._lfx === undefined){ b._lfx = fx; b._lfy = fy; b._ang = 0; }
    const dx = fx - b._lfx;
    const dy = fy - b._lfy;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.005){
      // 经典做法：弧长 / 半径 = 转过的弧度
      b._ang += dist / TABLE.ballR;
      b._lfx = fx; b._lfy = fy;
    }

    // 椭圆桌面阴影
    ctx.save();
    ctx.translate(px+3, py+5);
    ctx.scale(1.25, 0.55);
    const shGrad = ctx.createRadialGradient(0,0,0, 0,0,TABLE.ballR);
    shGrad.addColorStop(0,'rgba(0,0,0,0.45)');
    shGrad.addColorStop(0.55,'rgba(0,0,0,0.20)');
    shGrad.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=shGrad;
    ctx.beginPath(); ctx.arc(0,0,TABLE.ballR*1.05,0,Math.PI*2); ctx.fill();
    ctx.restore();

    // 球体：按累计滚动角旋转
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(b._ang);
    const d = TABLE.ballR * 2;
    ctx.drawImage(off, -d/2, -d/2, d, d);
    ctx.restore();
  });
}

/* ================================================================
   14. POCKET DETECTION
   - 球心进入 pocketR → 直接进（加宽后更容易触发）
   - 球进入 suckR 范围 → 给一个朝袋口的持续微弱助力
     （模拟真实袋口斜面：球靠近袋口时会被"喂"进去）
   - 这样不需要"吸力"，球靠自然滚动 + 微弱助力就能落袋
   ================================================================ */
function checkPockets(){
  if (State.phase !== 'SHOOTING' && State.phase !== 'LOCKED') return;

  const R = TABLE.ballR;

  State.balls.forEach(b => {
    if (b.pocketed || !b.body) return;
    const { x, y } = b.body.position;
    const vx = b.body.velocity.x;
    const vy = b.body.velocity.y;
    const speed = Math.hypot(vx, vy);

    // 每颗球只处理最近的袋口
    let bestPk = null, bestD = Infinity;
    for (const pk of POCKETS){
      const d = Math.hypot(pk.x - x, pk.y - y);
      if (d < bestD){ bestD = d; bestPk = pk; }
    }
    if (!bestPk) return;

    // (1) 球心已进入 pocketR → 直接判进
    if (bestD < bestPk.pocketR){
      pocketBall(b, bestPk);
      return;
    }

    // (2) 球在 suckR 范围内 → 给一个朝袋口的微弱助力
    //     这个助力很小，不会让球"被吸进去"，只是克服静摩擦让它滚进去
    //     高速球（speed > 3）不干预，让它靠惯性自然进或弹走
    //     只助力"正在朝袋口运动"的球（dot > 0），避免把远离袋口的球吸回来
    if (bestD < bestPk.suckR && speed < 3.0){
      const dirX = (bestPk.x - x) / bestD;
      const dirY = (bestPk.y - y) / bestD;
      const dot  = vx * dirX + vy * dirY;
      if (dot > 0){
        // 助力大小与"离袋口多近"成正比，与速度成反比
        const closeness = 1 - (bestD - bestPk.pocketR) / (bestPk.suckR - bestPk.pocketR);
        const assistMag = (0.05 + closeness * 0.25) * Math.max(0.15, 1 - speed / 3.0);
        Body.setVelocity(b.body, {
          x: vx + dirX * assistMag,
          y: vy + dirY * assistMag
        });
      }
    }
  });
}

function pocketBall(b, pk){
  if (b.pocketed) return;  // 防止重入
  b.pocketed = true;
  if (b.body){
    Matter.World.remove(world, b.body);
    b.body = null;
  }
  AudioFx.pocket();
  if (_shotCtx) _shotCtx.pocketedThisShot.push(b);

  if (b.id !== 'cue'){
    updateHUDBalls();
  }
  // 母球落袋不再自动复位 — 由 resolveShot 在判完犯规、切换回合时统一复位
}

// 母球复位（由 resolveShot 调用）
function respawnCueBall(){
  const cue = State.balls[0];
  if (!cue || !cue.pocketed) return;
  cue.pocketed = false;
  cue.body = makeBallBody(CUE_DEFAULT.x, CUE_DEFAULT.y);
  cue.body.ball = cue;
  Matter.World.add(world, cue.body);
  cue._lx = undefined;
  cue._lfx = undefined;
  cue._lfy = undefined;
  cue._ang = 0;
}

/* ================================================================
   15. SETTLED DETECTION (with _stillFrames + _settleGuard)
   ================================================================ */
function checkSettled(){
  if (State.phase!=='SHOOTING' && State.phase!=='LOCKED') return;
  if (_settleGuard) return;
  if (performance.now()-_shotStartTime < PHYS.minShotDuration) return;

  const allStop = State.balls.every(b=>{
    if (b.pocketed||!b.body) return true;
    return Math.hypot(b.body.velocity.x, b.body.velocity.y) < PHYS.sleepSpeed;
  });

  if (allStop){
    _stillFrames++;
    if (_stillFrames >= STILL_FRAMES_REQ){
      _settleGuard = true;
      State.phase = 'LOCKED';
      setTimeout(()=>{ resolveShot(); }, 500);
    }
  } else {
    _stillFrames = 0;
  }
}

/* ================================================================
   16. 8-BALL RULE ENGINE
   ================================================================ */
/*
  美国 8 球规则严格实现（参考世界规则）：
  - 开球：第一颗进的非黑8彩球确定花色（1-7 solid / 9-15 stripe）
  - 续杆：合法进了至少 1 颗自己花色球 → 继续；否则换手
  - 犯规：母球落袋 / 空杆 / 先碰对方球 / 已分花色后先碰黑8（未清完）
  - 输：① 母球随黑8一起进  ② 没清完己方就进黑8  ③ 任何犯规同时进黑8
  - 赢：清完自己7颗，合法（不犯规）打进黑8
*/
function resolveShot(){
  if (!_shotCtx) { nextTurn(); return; }
  const ctx = _shotCtx;
  const me  = ctx.shooter === 'me';

  // 出杆者花色（可能 null = 还没定花色）
  const shooterGroup = me ? State.myGroup : State.oppGroup;

  // 进球分类
  const pockets = ctx.pocketedThisShot || [];
  const pocketedEight = pockets.some(b => b.num === 8);
  const cuePocketed = State.balls[0].pocketed;

  // ===== 文案主角（绝对视角，分清"谁") =====
  // me = true  → 出杆者是玩家（你）
  // me = false → 出杆者是 bot（小麦）
  const botName  = State.botProfile.name;          // 小麦 / 席恩 / 代柯
  const shooterName = me ? '你' : botName;          // 本杆出杆的人
  const otherName   = me ? botName : '你';          // 本杆的对手
  // 换手后轮到谁：犯规/没进 → 轮到对手
  const nextTurnTip = `轮到${otherName}击球`;
  // 出杆主语：你出杆省略"你"（简短），小麦出杆带名字（区分）
  const subj = me ? '' : botName;

  // ===== 第 1 步：先判定本杆是否犯规 =====
  let foul = false;
  let foulReason = '';
  let foulToast  = '';   // 完整的 toast 文案（已分清是谁）

  // (1) 母球落袋 = 犯规
  if (cuePocketed){
    foul = true; foulReason = '母球落袋';
    foulToast = me ? '你白球进袋犯规' : `${botName}白球进袋犯规`;
  }

  // (2) 空杆 = 犯规
  if (!foul && !ctx.firstContact){
    foul = true; foulReason = '空杆';
    foulToast = me ? '你空杆犯规了' : `${botName}空杆犯规了`;
  }

  // (3) 已分花色后，第一颗碰到的必须是己方花色
  //     未清完时先碰黑8 也算犯规
  if (!foul && shooterGroup && ctx.firstContact){
    const fc = ctx.firstContact;
    if (fc.type === 'eight'){
      if (!groupCleared(shooterGroup)){
        foul = true; foulReason = '未清完就先碰黑8';
        foulToast = me ? '你误碰黑8犯规' : `${botName}误碰黑8犯规`;
      }
    } else if (fc.type !== shooterGroup){
      // 先碰到对方花色球
      foul = true; foulReason = '先碰到对方球';
      foulToast = me ? '你碰错球犯规' : `${botName}碰错球犯规`;
    }
  }

  // ===== 第 2 步：黑8 终局判定（最高优先级，决定胜负） =====
  if (pocketedEight){
    if (me){
      const myCleared = groupCleared(State.myGroup);
      // 输的三种情形：
      if (cuePocketed) { endMatch('lose', '母球随黑8一起进袋'); return; }
      if (!myCleared)  { endMatch('lose', '还没清完自己的球就进黑8'); return; }
      if (foul)        { endMatch('lose', '进黑8时犯规（' + foulReason + '）'); return; }
      endMatch('win', ''); return;
    } else {
      const oppCleared = groupCleared(State.oppGroup);
      if (cuePocketed) { endMatch('win', '对手母球随黑8进袋'); return; }
      if (!oppCleared) { endMatch('win', '对手未清完就进黑8'); return; }
      if (foul)        { endMatch('win', '对手进黑8时犯规'); return; }
      endMatch('lose', '对手合法打进黑8'); return;
    }
  }

  // ===== 第 3 步：分花色（开球后第一颗非黑8彩球进袋）=====
  if (!State.myGroup && pockets.length > 0){
    const firstColor = pockets.find(b => b.type === 'solid' || b.type === 'stripe');
    if (firstColor && !foul){   // 犯规时不分配花色（规则之一）
      if (me){
        State.myGroup  = firstColor.type;
        State.oppGroup = firstColor.type === 'solid' ? 'stripe' : 'solid';
      } else {
        State.oppGroup = firstColor.type;
        State.myGroup  = firstColor.type === 'solid' ? 'stripe' : 'solid';
      }
      showGroupBanner();
      // 分花色：说清楚本杆出杆者打什么
      const shooterGroupNow = me ? State.myGroup : State.oppGroup;
      const gLabel = shooterGroupNow === 'solid' ? '全色球' : '花色球';
      showToast(`${shooterName}打${gLabel}`, 'info');
    }
  }

  // ===== 第 4 步：进了己方花色？=====
  const finalShooterGroup = me ? State.myGroup : State.oppGroup;
  const pocketedOwn = pockets.some(b => {
    if (b.num === 8) return false;
    if (!finalShooterGroup) return true;   // 开球阶段：任何彩球都算"自己的"
    return b.type === finalShooterGroup;
  });

  // ===== 第 5 步：续杆 / 换手 =====
  // 续杆计数：只在 "刚刚有过一段连续进球后第一次没进" 时提示换手
  if (!State.runStreak) State.runStreak = { me:0, bot:0 };
  const sideKey = me ? 'me' : 'bot';

  // ===== 逐杆记录（用于对局 summary 回传） =====
  const ballLabel = (b) => {
    if (b.num === 8) return '8号(黑8)';
    const g = b.type === 'solid' ? '全色' : (b.type === 'stripe' ? '花色' : '');
    return `${b.num}号${g?'('+g+')':''}`;
  };
  const isBreak = (State.shotHistory.length === 0);
  if (isBreak && me) State.breakPocketed = pockets.map(ballLabel);
  State.shotHistory.push({
    seq: State.shotHistory.length + 1,
    isBreak,
    shooter: me ? '你' : botName,
    shooterId: me ? 'me' : (State.botProfile.id || 'bot'),
    pocketed: pockets.map(ballLabel),
    firstContact: ctx.firstContact ? ballLabel(ctx.firstContact) : '空杆(未碰球)',
    cushionHit: !!ctx.cushionHit,
    cuePocketed,
    foul,
    foulReason: foul ? foulReason : '',
    pocketedOwn,
    pocketedEight
  });

  if (foul){
    // 犯规 toast 已在第 1 步按"谁犯规"组装好
    showToast(foulToast, 'foul');
    State.runStreak[sideKey] = 0;
    if (me){
      // 玩家犯规 → 小麦挑衅。本批音频仅空杆有专属，其余犯规(含母球落袋)用通用犯规语音
      const cat = (foulReason === '空杆') ? 'pfoul_empty' : 'pfoul_other';
      Character.say(cat, 'smug', { voiceChance:1, bubble:true });
    } else {
      // 小麦自己犯规 → 找借口（只有真 foul 才会进这里）
      Character.say('on_bot_foul', 'pout', { voiceChance:1, bubble:true });
    }
    switchTurn(me ? 'bot' : 'me');
  } else if (pocketedOwn){
    // 进了自己球 → 续杆
    State.runStreak[sideKey] += 1;
    showToast(`${shooterName}进球了，继续击球`, 'ok');
    // 玩家进球 → 夸赞；小麦进球 → 得瑟"送分"(brag)
    if (me) Character.say('praise', 'happy', { voiceChance:0.6 });
    else    Character.say('brag',   'smug',  { voiceChance:0.6 });
    continueTurn(me ? 'me' : 'bot');
  } else {
    // 没进球（没犯规，单纯打丢）→ 换手
    State.runStreak[sideKey] = 0;
    showToast(`现在${nextTurnTip}`, 'info');
    // 玩家打丢 → 嘲讽"这都能打丢"(taunt)；小麦自己打丢 → 自嘲撒娇(cute，不夸玩家)
    if (me) Character.say('taunt', 'smug', { voiceChance:0.4 });
    else    Character.say('cute',  'cute', { voiceChance:0.4 });
    switchTurn(me ? 'bot' : 'me');
  }
}

function groupCleared(group){
  if (!group) return false;
  return !State.balls.some(b=>!b.pocketed && b.type===group && b.num !== 8);
}

function continueTurn(who){
  State.turn = who;
  _shotCtx = null;
  _settleGuard = false;
  _stillFrames = 0;
  // 续杆不会因为犯规复位母球；正常情况下母球应该还在桌上
  if (State.balls[0].pocketed) respawnCueBall();
  if (who === 'me'){
    setPhase('IDLE');
  } else {
    setPhase('IDLE');
    setTimeout(botPlay, 700);
  }
  updateTurnUI();
}

function switchTurn(who){
  State.turn = who;
  _shotCtx = null;
  _settleGuard = false;
  _stillFrames = 0;
  // 换手时如果母球落袋，由对手在初始点重新开球（简化版的"ball-in-hand"）
  if (State.balls[0].pocketed) respawnCueBall();
  if (who === 'me'){
    setPhase('IDLE');
  } else {
    setPhase('IDLE');
    setTimeout(botPlay, 700);
  }
  updateTurnUI();
}

function nextTurn(){
  // Legacy fallback — should go through resolveShot now
  resolveShot();
}

/* ================================================================
   17. BOT AI
   ================================================================ */
function botPlay(){
  if (State.ended) return;
  if (State.turn!=='bot') return;

  // Wait for balls to fully stop
  const anyMoving = State.balls.some(b=>{
    if (b.pocketed||!b.body) return false;
    return Math.hypot(b.body.velocity.x, b.body.velocity.y) > 0.5;
  });
  if (anyMoving){
    setTimeout(botPlay, 300);
    return;
  }

  const profile = State.botProfile;
  const targets = State.balls.filter(b=>!b.pocketed && b.id!=='cue' && b.body);
  if (targets.length===0) return;

  // Pick target ball
  let best=null, bestD=Infinity;
  targets.forEach(b=>{
    const d = Math.hypot(b.body.position.x-200, b.body.position.y-400);
    if (d<bestD){ bestD=d; best=b; }
  });

  if (!best) return;

  const cpx=State.cue.body.position.x, cpy=State.cue.body.position.y;
  const tpx=best.body.position.x, tpy=best.body.position.y;
  const precision = profile.skill.angle_precision * (0.6 + profile.win_rate*0.6);
  const angle = Math.atan2(tpy-cpy, tpx-cpx) + (Math.random()-0.5)*(1-precision)*0.15;
  const power = profile.skill.power_min + Math.random()*(profile.skill.power_max-profile.skill.power_min);

  State.aimAngle = angle;
  State.aimPower = power;
  setRailFill(power);
  redrawAim();

  setTimeout(()=>{
    doShot('bot', angle, power);
  }, 600);
}

/* ================================================================
   18. HUD UPDATES
   ================================================================ */
function updateTurnUI(){
  const pill = $('#turn-pill');
  if (pill){
    pill.textContent = State.turn==='me' ? '你的回合' : `${State.botProfile.name}的回合`;
    pill.classList.toggle('bot-turn', State.turn!=='me');
  }
}

// HUD：展示双方"全部 7 颗" — 未进 = 亮色实球；已进 = 加 .pocketed（CSS 暗化 + 打勾）
// 开球前未分花色：两边都显示占位（空槽）
function updateHUDBalls(){
  const rackMe  = $('#rack-me');
  const rackOpp = $('#rack-opp');
  if (!rackMe || !rackOpp) return;

  // 清空
  $$('li', rackMe).forEach(li => {
    li.className = 'slot';
    li.removeAttribute('data-num');
    li.style.removeProperty('--ball-color');
  });
  $$('li', rackOpp).forEach(li => {
    li.className = 'slot';
    li.removeAttribute('data-num');
    li.style.removeProperty('--ball-color');
  });

  // 未分花色时不渲染（保持空槽）
  if (!State.myGroup || !State.oppGroup) return;

  // 按花色把球分到两边（每边 7 颗，按号码排序）
  const myBalls  = State.balls.filter(b => b.type === State.myGroup).sort((a,b)=>a.num-b.num);
  const oppBalls = State.balls.filter(b => b.type === State.oppGroup).sort((a,b)=>a.num-b.num);

  const fill = (li, b) => {
    if (!li) return;
    li.className = 'slot ' + b.type + (b.pocketed ? ' pocketed' : '');
    li.style.setProperty('--ball-color', BALL_COLORS[b.num] || '#fff');
    li.setAttribute('data-num', b.num);
  };

  myBalls.forEach((b, i)  => fill(rackMe.children[i],  b));
  oppBalls.forEach((b, i) => fill(rackOpp.children[i], b));
}

function showGroupBanner(){
  // Update HUD labels
  const meLabel  = $('#hud-me-label');
  const oppLabel = $('#hud-opp-label');
  if (meLabel){
    meLabel.textContent = '你的';
  }
  if (oppLabel){
    oppLabel.textContent = State.botProfile.name + '的';
  }
  updateHUDBalls();
}

/* ========== Toast 提示（弹幕风格，动态创建）
   - 位置：绝对定位浮层，挂在回合行上，永不挤动桌面布局
   - 弹幕风：统一淡色文字，无底色块，轻飘
   - 同一时刻只显示一条（新 toast 替换旧的）
   ============================================== */
function showToast(msg, kind = 'info'){
  const layer = document.getElementById('toast-layer');
  if (!layer) return;          // HTML 里 turn-strip 内已有 #toast-layer

  // 弹幕风格：统一白色，不加粗（kind 仅保留语义，颜色不再区分）
  // 同一时刻只保留最新一条
  layer.innerHTML = '';

  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = [
    'color:#ffffff',
    'font-size:11.5px', 'font-weight:400',
    'letter-spacing:0.3px',
    'line-height:1',
    // 弹幕轻阴影，保证在桌面/深色背景上都可读
    'text-shadow:0 1px 3px rgba(0,0,0,0.65)',
    'transform:translateX(10px)',
    'opacity:0',
    'transition:opacity 0.3s ease, transform 0.3s ease',
    'white-space:nowrap'
  ].join(';');
  layer.appendChild(el);
  // 入场动画：从右侧轻飘入场，像弹幕
  requestAnimationFrame(()=>{
    el.style.opacity = '1';
    el.style.transform = 'translateX(0)';
  });
  // 2.4s 后向左淡出
  setTimeout(()=>{
    el.style.opacity = '0';
    el.style.transform = 'translateX(-10px)';
    setTimeout(()=>{ if (el.parentNode) el.remove(); }, 300);
  }, 2400);
}

/* ================================================================
   数据回传通道（落地页上报接口）
   - content 字段 = summary_text（纯文本对局摘要）
   - 同一局所有事件携带相同 contentId
   ================================================================ */
const Reporter = (() => {
  const ENDPOINT = 'https://testuniuni.html5.qq.com/api/external-report/reportExternal';
  const SCENE = 'pool8';            // 场景标识：美式8球
  const pageEnterTime = Date.now();

  // URL 查询参数整体透传
  function getUrlParams(){
    const out = {};
    try {
      const sp = new URLSearchParams(window.location.search);
      for (const [k, v] of sp.entries()) out[k] = v;
    } catch(e){}
    return out;
  }
  const urlParams = getUrlParams();
  // 本局会话标识
  const contentId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  function send(eventName, opts = {}){
    const body = { urlParams, sceneName: SCENE, eventName, contentId };
    if (opts.withStayDuration) body.eventTime = Date.now() - pageEnterTime;
    if (opts.content) body.content = String(opts.content).slice(0, 10000); // 接口上限 10000
    try {
      return fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: !!opts.keepalive   // 页面卸载场景需要 keepalive
      }).then(r => r.json()).catch(() => {});
    } catch(e){ return Promise.resolve(); }
  }

  return { send, contentId };
})();

/* 生成对局 summary_text（按 summary_text_template 填充） */
function buildSummaryText(kind){
  const bot = State.botProfile;
  const botName = bot.name;
  const d = new Date(State.startTs || Date.now());
  const dateStr = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
  const timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

  // 双方清袋统计
  const groupCleared = (g) => g ? State.balls.filter(b=>b.type===g && b.pocketed).length : 0;
  const userPocketed = groupCleared(State.myGroup);
  const botPocketed  = groupCleared(State.oppGroup);
  const groupLabel = (g) => g==='solid' ? '全色(solid)' : (g==='stripe' ? '花色(stripe)' : '未定');

  // 逐杆记录文本
  const lines = State.shotHistory.map(s => {
    const tag = s.isBreak ? `[开球·${s.shooter}]` : `[第${s.seq}杆·${s.shooter}]`;
    const pk = s.pocketed.length ? s.pocketed.join('、') : '无';
    let res;
    if (s.foul)            res = `犯规：${s.foulReason}`;
    else if (s.pocketedEight) res = '打进黑8';
    else if (s.pocketedOwn) res = '进球续杆';
    else                   res = '未进，换手';
    return `${s.seq}. ${tag} 进袋：${pk} | 首碰：${s.firstContact} | ${res}`;
  }).join('\n');

  if (kind === 'interrupt'){
    const userLeft = State.myGroup ? State.balls.filter(b=>b.type===State.myGroup && !b.pocketed && b.num!==8).length : '未定';
    const botLeft  = State.oppGroup ? State.balls.filter(b=>b.type===State.oppGroup && !b.pocketed && b.num!==8).length : '未定';
    const eightAlive = !State.balls.find(b=>b.num===8 && b.pocketed);
    return [
      `用户与${botName}（bot_id: ${bot.id}）于 ${dateStr} ${timeStr} 开始「skill-pool」美式8球桌球对局。`,
      ``,
      `对局进行到第 ${State.shotHistory.length} 杆时中断（用户离开页面）。当前比分：用户清袋 ${userPocketed}/7，${botName}清袋 ${botPocketed}/7。`,
      ``,
      `当前局面：`,
      `- 用户花色：${groupLabel(State.myGroup)}（剩余 ${userLeft} 颗）`,
      `- ${botName}花色：${groupLabel(State.oppGroup)}（剩余 ${botLeft} 颗）`,
      `- 黑8状态：${eightAlive ? '仍在台面' : '已落袋'}`,
      `- 当前轮次：${State.turn==='me' ? '用户的回合' : botName+'的回合'}`,
      ``,
      `已完成的回合记录：`,
      lines || '（无）'
    ].join('\n');
  }

  // 结束
  const outcomeDesc = State.result === 'win' ? '用户获胜！' : '用户落败。';
  return [
    `用户与${botName}（bot_id: ${bot.id}）于 ${dateStr} ${timeStr} 进行了一局「skill-pool」美式8球桌球对局。`,
    ``,
    `${outcomeDesc}${State._endReason ? '（'+State._endReason+'）' : ''} 共进行了 ${State.shotHistory.length} 杆。`,
    ``,
    `对局记录：`,
    lines || '（无）',
    ``,
    `最终比分：用户清袋 ${userPocketed}/7，${botName}清袋 ${botPocketed}/7。`,
    `胜负原因：${State._endReason || (State.result==='win'?'用户合法打进黑8获胜':'对局结束')}`
  ].join('\n');
}

/* 回传对局结果（结束 / 中断）。reported 标记避免重复 */
function reportMatch(kind){
  if (State.reported) return;
  State.reported = true;
  const content = buildSummaryText(kind === 'interrupt' ? 'interrupt' : 'end');
  const eventName = kind === 'interrupt' ? 'game_interrupt' : 'game_result';
  Reporter.send(eventName, { content, keepalive: kind === 'interrupt' });
  try { window.__lastSummary = content; } catch(e){}   // 便于调试查看
}
// 暴露便于调试 / 外部触发回传
try { window.__poolReport = { buildSummaryText, reportMatch, Reporter }; window.__poolState = State; } catch(e){}

function endMatch(result, reason){
  State.ended = true;
  State.result = result;
  State._endReason = reason || '';
  // 对局结果回传（summary_text 通过 content 字段）
  reportMatch('end');
  // 角色反应：玩家赢 = 小麦输（委屈）；玩家输 = 小麦赢（嘚瑟）。终局是大事，force 弹气泡
  if (result === 'win') Character.say('on_lose', 'pout', { bubble:true, force:true });
  else                  Character.say('on_win', 'smug', { bubble:true, force:true });
  const icon  = document.getElementById('game-over-icon');
  const title = document.getElementById('game-over-title');
  const rEl   = document.getElementById('game-over-reason');
  const mask  = document.getElementById('game-over-mask');
  if (icon)  icon.textContent  = result === 'win' ? '🎉' : '😢';
  if (title) title.textContent = result === 'win' ? '恭喜🎉 你赢了～' : '你输了。';
  if (rEl)   rEl.textContent  = reason || '';
  if (mask)  mask.classList.add('active');
}

/* ================================================================
   19. INIT
   ================================================================ */
function init(){
  console.log('[game_final.js] v=20240626l loaded');
  State.startTs = Date.now();
  canvas = $('#table-canvas');
  if (canvas){
    ctx = canvas.getContext('2d');
  }

  // 页面 PV 上报（每次访问一次）
  Reporter.send('pv');

  // 页面离开/隐藏：若对局未结束，回传"中断"摘要 + 曝光停留时长
  const onLeave = () => {
    if (!State.ended && State.shotHistory.length > 0) reportMatch('interrupt');
    Reporter.send('exp', { withStayDuration: true, keepalive: true });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onLeave();
  });
  window.addEventListener('pagehide', onLeave);

  // "再来一次" 按钮
  const btnR = $('#btn-game-restart');
  if (btnR){
    btnR.addEventListener('click', ()=>{
      const mask = document.getElementById('game-over-mask');
      if (mask) mask.classList.remove('active');
      // 彻底重置状态
      State.balls.forEach(b=>{
        if (b.body && b.body !== State.balls[0].body) Matter.Composite.remove(world, b.body);
        b.body = null; b.pocketed = false; b._lx = undefined; b._lfx = undefined; b._lfy = undefined; b._ang = 0;
      });
      State.balls[0].pocketed = false; State.balls[0].body = null;
      State.myGroup = null; State.oppGroup = null;
      State.turn = 'me'; State.phase = 'IDLE'; State.ended = false; State.result = null;
      State.shotHistory = []; State.breakPocketed = []; State.reported = false;
      State._endReason = ''; State.startTs = Date.now(); State.shotSeq = 0;
      _shotCtx = null; _stillFrames = 0; _settleGuard = false;
      if (!State.runStreak) State.runStreak = { me:0, bot:0 };
      initEngine(); setupRack(); updateTurnUI(); showGroupBanner();
      Character.resetRepeat();  // 新一局清空语音防重复记录
      State.phase = 'IDLE'; redrawAim();
    });
  }

  // "取消" 按钮：只关闭弹窗，保留当前局面
  const btnC = $('#btn-game-cancel');
  if (btnC){
    btnC.addEventListener('click', ()=>{
      const mask = document.getElementById('game-over-mask');
      if (mask) mask.classList.remove('active');
    });
  }

  initEngine();
  setupRack();
  updateTurnUI();
  Character.setMood('idle', 0);   // 初始化小麦立绘
  State.phase = 'IDLE';
  redrawAim();
  // 开局引导 toast（也用于确认 toast 显示位置正确）
  setTimeout(()=> showToast('你先开球吧', 'info'), 400);
  requestAnimationFrame(gameLoop);

  // 新手引导：首次进入自动弹；问号按钮随时可重看
  Guide.init();
}

/* ================================================================
   20. 新手分步高亮引导（方案B）
   ================================================================ */
const Guide = (() => {
  const SEEN_KEY = 'pool_guide_seen_v1';
  // 4 步：目标元素选择器 + 文案 + 气泡相对位置(below/above/auto)
  const STEPS = [
    { sel:'#cue-rail',   text:'拖动左侧这根球杆来蓄力 —— 往下拖得越多，击球力度越大，松手即出杆。', pos:'right' },
    { sel:'#table',      text:'在球桌上拖动可以调整瞄准方向，白色虚线就是母球的去向。', pos:'auto' },
    { sel:'.hud',        text:'顶部显示你和小麦各自要打的球，把自己花色的球全部打进、最后打进黑8 就赢啦。', pos:'below' },
    { sel:'#char-stage', text:'小麦会全程陪你玩、随口点评，赢了她试试看 😏', pos:'below' },
  ];
  let idx = 0;
  let mask, hole, tip, stepEl, textEl, nextBtn;

  function el(id){ return document.getElementById(id); }

  function place(){
    const step = STEPS[idx];
    const target = document.querySelector(step.sel);
    const stage = document.getElementById('stage') || document.body;
    if (!target){ next(); return; }   // 目标不存在则跳过该步
    const tr = target.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    // 高亮洞（相对 stage 定位，留 6px 内边距）
    const pad = 6;
    const left = tr.left - sr.left - pad;
    const top  = tr.top  - sr.top  - pad;
    const w = tr.width + pad*2;
    const h = tr.height + pad*2;
    hole.style.left = left + 'px';
    hole.style.top = top + 'px';
    hole.style.width = w + 'px';
    hole.style.height = h + 'px';

    // 气泡文案
    stepEl.textContent = `${idx+1} / ${STEPS.length}`;
    textEl.textContent = step.text;
    nextBtn.textContent = (idx === STEPS.length-1) ? '开始游戏' : '下一步';

    // 气泡位置：默认放洞下方；放不下则放上方
    const tipW = 248, tipH = 120;
    let tipLeft = Math.min(Math.max(left, 10), sr.width - tipW - 10);
    let tipTop;
    const spaceBelow = sr.height - (top + h);
    if (step.pos === 'above' || (step.pos !== 'below' && spaceBelow < tipH + 20)){
      tipTop = top - tipH - 12;
    } else {
      tipTop = top + h + 12;
    }
    tipTop = Math.min(Math.max(tipTop, 10), sr.height - tipH - 10);
    tip.style.left = tipLeft + 'px';
    tip.style.top = tipTop + 'px';
  }

  function show(){
    idx = 0;
    mask.hidden = false;
    place();
  }
  function next(){
    idx++;
    if (idx >= STEPS.length){ finish(); return; }
    place();
  }
  function finish(){
    mask.hidden = true;
    try { localStorage.setItem(SEEN_KEY, '1'); } catch(e){}
  }

  function init(){
    mask = el('guide-mask'); hole = el('guide-hole'); tip = el('guide-tip');
    stepEl = el('guide-step'); textEl = el('guide-text'); nextBtn = el('guide-next');
    if (!mask) return;
    el('guide-next').addEventListener('click', next);
    el('guide-skip').addEventListener('click', finish);
    const help = el('btn-help');
    if (help) help.addEventListener('click', show);
    // 窗口尺寸变化时重新定位当前步
    window.addEventListener('resize', ()=>{ if (!mask.hidden) place(); });

    // 首次进入自动弹（延迟一点，等布局稳定）
    let seen = false;
    try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch(e){}
    if (!seen) setTimeout(show, 700);
  }

  return { init, show };
})();

if (document.readyState==='complete') init();
else window.addEventListener('load', init);

})();
