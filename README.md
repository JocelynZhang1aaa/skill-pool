# 🎱 小麦台球 — 美式8球小游戏

在线地址：https://jocelynzhang1aaa.github.io/skill-pool/

---

## 简介

一款轻量级的美式8球（8-Ball）台球小游戏，基于 Matter.js 物理引擎，支持人机对战。搭载 AI 对手「小麦」，配有语音互动、可爱风结果页和分步新手引导。

## 功能特性

- 🎮 **完整8球规则**：开球、选组、合法击球、犯规判定、黑八制胜，规则完整实现
- 🤖 **AI 对手小麦**：具备瞄准、力度控制、失误模拟，难度可调
- 🔊 **语音互动**：小麦配有专属语音包，在关键节点（进球、犯规、胜利/失败）触发语音和弹幕
- 📊 **对局上报**：逐杆记录对局过程，通过 `summary_text` 回传完整对局摘要
- 🎓 **新手引导**：首次游玩自动弹出 4 步高亮引导，也可随时点击 ❓ 按钮查看
- 🏆 **可爱风结果页**：横幅奖牌 + 拍立得立绘 + 点评文本，胜利/失败各有不同表现
- 📱 **移动端适配**：支持手机触屏操作

## 技术栈

- **物理引擎**：[Matter.js](https://brm.io/matter-js/)
- **前端**：原生 JavaScript + CSS3
- **部署**：GitHub Pages

## 本地运行

无需安装依赖，直接打开即可：

```bash
# 克隆仓库
git clone https://github.com/JocelynZhang1aaa/skill-pool.git
cd skill-pool

# 用任意静态服务器打开，例如：
npx serve .
# 或直接用浏览器打开 index.html
```

## 项目结构

```
skill-pool-v3/
├── index.html             # 游戏入口（GitHub Pages 入口）
├── game_final.js          # 核心游戏逻辑
├── style_final.css        # 样式
├── assets/
│   ├── voice/xiaomai/    # 小麦语音包（19条 mp3）
│   ├── xiaomai-*.png    # 小麦立绘（4张）
│   └── *.mp3             # 击球音效
└── README.md
```

## 游戏规则（简述）

1. 开球后，首先进球的一方选定球组（全色/花色）
2. 每次击球必须先碰己方球组，且有球落袋或碰库
3. 己方球组全部清完后，可击打黑八
4. 黑八入袋即获胜；中途犯规则对方获得自由球

## 对局上报

对局结束后会自动生成 `summary_text` 并上报，包含：
- 对局结果（win/lose）
- 总杆数、时长
- 逐杆记录（击球力度、进球数、犯规情况等）

## License

MIT
