// app.js
// Story Playback Engine for browser RPG
// 想定する story.json 形式:
// {
//   "chapter": 1,
//   "title": "旅立ちの刻",
//   "scenes": [
//     {
//       "id": "1-1",
//       "bg": "village_day",
//       "characters": ["主人公", "リアナ"],
//       "dialogues": [
//         {"name": "主人公", "text": "……今日もいい天気だな。"}
//       ],
//       "battle": {"enemy": "シャドウ", "tutorial": true},
//       "end": true
//     }
//   ]
// }
//
// 必要DOM（最低限）:
// <div id="story-screen">
//   <div id="story-bg"></div>
//   <div id="story-characters"></div>
//   <div id="story-ui">
//     <div id="story-chapter"></div>
//     <div id="story-title"></div>
//     <div id="story-name"></div>
//     <div id="story-text"></div>
//     <button id="story-prev">戻る</button>
//     <button id="story-next">次へ</button>
//     <button id="story-skip">スキップ</button>
//   </div>
// </div>
//
// オプション:
// <button id="start-story">ストーリー開始</button>
//
// 画像パス規約（必要に応じて変更）:
// 背景: assets/images/backgrounds/<bg>.jpg
// 立ち絵: assets/images/characters/<character>.png

(function () {
  'use strict';

  // =========================
  // 設定
  // =========================
  const CONFIG = {
    storyUrl: 'data/story.json',
    bgBasePath: 'assets/images/backgrounds/',
    bgExt: '.jpg',
    characterBasePath: 'assets/images/characters/',
    characterExt: '.png',
    typeSpeed: 16, // 1文字表示の速度（ms）
    defaultPortraitClass: 'story-portrait',
    sceneFadeDuration: 180,
    autoCreateFallbackUI: false // true にすると最低限UIを自動生成
  };

  // =========================
  // ユーティリティ
  // =========================
  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function storageKey(chapter) {
    return `story_progress_chapter_${chapter}`;
  }

  function createFallbackUI() {
    if (!CONFIG.autoCreateFallbackUI) return;
    if ($('story-screen')) return;

    const style = document.createElement('style');
    style.textContent = `
      #story-screen { position: relative; width: 100%; min-height: 70vh; overflow: hidden; background: #111; color:#fff; }
      #story-bg { position:absolute; inset:0; background-size:cover; background-position:center; filter:brightness(0.7); transition:opacity .18s ease; }
      #story-characters { position:absolute; left:0; right:0; bottom:140px; height:52%; display:flex; justify-content:center; align-items:flex-end; gap:24px; z-index:2; pointer-events:none; }
      .story-portrait { max-height:100%; max-width:30%; object-fit:contain; filter: drop-shadow(0 8px 14px rgba(0,0,0,.5)); opacity:.95; }
      #story-ui { position:absolute; left:24px; right:24px; bottom:24px; z-index:3; background:rgba(0,0,0,.65); border:1px solid rgba(255,255,255,.15); border-radius:16px; padding:16px; backdrop-filter: blur(6px); }
      #story-chapter { font-size:12px; opacity:.75; margin-bottom:4px; }
      #story-title { font-size:20px; font-weight:700; margin-bottom:8px; }
      #story-name { font-size:14px; color:#ffd27a; margin-bottom:8px; min-height:20px; }
      #story-text { font-size:16px; line-height:1.8; min-height:90px; white-space:pre-wrap; }
      #story-controls { display:flex; gap:8px; justify-content:flex-end; margin-top:14px; }
      #story-controls button { background:#2d5bff; color:white; border:none; border-radius:10px; padding:10px 14px; cursor:pointer; }
      #story-controls button.secondary { background:#505050; }
    `;
    document.head.appendChild(style);

    const wrapper = document.createElement('div');
    wrapper.id = 'story-screen';
    wrapper.innerHTML = `
      <div id="story-bg"></div>
      <div id="story-characters"></div>
      <div id="story-ui">
        <div id="story-chapter"></div>
        <div id="story-title"></div>
        <div id="story-name"></div>
        <div id="story-text"></div>
        <div id="story-controls">
          <button id="story-prev" class="secondary">戻る</button>
          <button id="story-skip" class="secondary">スキップ</button>
          <button id="story-next">次へ</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrapper);
  }

  // =========================
  // Story Engine
  // =========================
  class StoryPlayer {
    constructor(options = {}) {
      this.config = { ...CONFIG, ...options };
      this.story = null;
      this.sceneIndex = 0;
      this.dialogueIndex = 0;
      this.isTyping = false;
      this.fullText = '';
      this.typeTimer = null;
      this.onBattle = options.onBattle || null;
      this.onEnd = options.onEnd || null;
      this.onSceneChange = options.onSceneChange || null;
      this.onDialogueChange = options.onDialogueChange || null;

      createFallbackUI();
      this.cacheDom();
      this.bindEvents();
    }

    cacheDom() {
      this.dom = {
        screen: $('story-screen'),
        bg: $('story-bg'),
        characters: $('story-characters'),
        chapter: $('story-chapter'),
        title: $('story-title'),
        name: $('story-name'),
        text: $('story-text'),
        prev: $('story-prev'),
        next: $('story-next'),
        skip: $('story-skip')
      };

      const missing = Object.entries(this.dom)
        .filter(([, el]) => !el)
        .map(([key]) => key);

      if (missing.length) {
        console.warn('[StoryPlayer] 必要DOMが不足しています:', missing);
      }
    }

    bindEvents() {
      if (this.dom.next) this.dom.next.addEventListener('click', () => this.next());
      if (this.dom.prev) this.dom.prev.addEventListener('click', () => this.prev());
      if (this.dom.skip) this.dom.skip.addEventListener('click', () => this.skipChapter());

      document.addEventListener('keydown', (e) => {
        if (!this.story) return;
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          this.next();
        }
        if (e.code === 'ArrowLeft') {
          e.preventDefault();
          this.prev();
        }
      });

      if (this.dom.text) {
        this.dom.text.addEventListener('click', () => this.next());
      }
    }

    async load(url = this.config.storyUrl) {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`story.json の読込に失敗: ${res.status}`);
      const data = await res.json();
      this.setStory(data);
      return data;
    }

    setStory(storyData) {
      this.story = storyData;
      this.sceneIndex = 0;
      this.dialogueIndex = 0;

      const saved = this.loadProgress();
      if (saved) {
        this.sceneIndex = saved.sceneIndex || 0;
        this.dialogueIndex = saved.dialogueIndex || 0;
      }

      this.render();
    }

    get currentScene() {
      return this.story?.scenes?.[this.sceneIndex] || null;
    }

    get currentDialogue() {
      return this.currentScene?.dialogues?.[this.dialogueIndex] || null;
    }

    async render() {
      const story = this.story;
      const scene = this.currentScene;
      const dialogue = this.currentDialogue;
      if (!story || !scene || !dialogue) return;

      if (this.dom.chapter) this.dom.chapter.textContent = `Chapter ${story.chapter}`;
      if (this.dom.title) this.dom.title.textContent = story.title || '';

      await this.renderBackground(scene.bg);
      this.renderCharacters(scene.characters || []);
      this.renderDialogue(dialogue);
      this.updateButtons();
      this.saveProgress();

      if (typeof this.onSceneChange === 'function') {
        this.onSceneChange({ story, scene, sceneIndex: this.sceneIndex });
      }
      if (typeof this.onDialogueChange === 'function') {
        this.onDialogueChange({ story, scene, dialogue, sceneIndex: this.sceneIndex, dialogueIndex: this.dialogueIndex });
      }
    }

    async renderBackground(bgKey) {
      if (!this.dom.bg) return;
      const nextUrl = `${this.config.bgBasePath}${bgKey}${this.config.bgExt}`;
      this.dom.bg.style.opacity = '0.55';
      this.dom.bg.style.backgroundImage = `url("${nextUrl}")`;
      await delay(this.config.sceneFadeDuration);
      this.dom.bg.style.opacity = '1';
    }

    renderCharacters(characterNames) {
      if (!this.dom.characters) return;
      this.dom.characters.innerHTML = '';

      characterNames.forEach((name) => {
        const img = document.createElement('img');
        img.className = this.config.defaultPortraitClass;
        img.alt = name;
        img.src = `${this.config.characterBasePath}${encodeURIComponent(name)}${this.config.characterExt}`;
        img.onerror = () => {
          img.replaceWith(this.buildCharacterFallback(name));
        };
        this.dom.characters.appendChild(img);
      });
    }

    buildCharacterFallback(name) {
      const box = document.createElement('div');
      box.className = this.config.defaultPortraitClass;
      box.style.display = 'flex';
      box.style.alignItems = 'center';
      box.style.justifyContent = 'center';
      box.style.width = '220px';
      box.style.height = '360px';
      box.style.borderRadius = '18px';
      box.style.background = 'rgba(255,255,255,0.08)';
      box.style.border = '1px solid rgba(255,255,255,0.16)';
      box.style.color = '#fff';
      box.style.fontWeight = '700';
      box.textContent = name;
      return box;
    }

    renderDialogue(dialogue) {
      if (!dialogue) return;
      if (this.dom.name) this.dom.name.textContent = dialogue.name || '';
      this.fullText = dialogue.text || '';
      this.startTyping(this.fullText);
    }

    startTyping(text) {
      if (!this.dom.text) return;
      if (this.typeTimer) clearInterval(this.typeTimer);
      this.isTyping = true;
      this.dom.text.textContent = '';
      let i = 0;
      this.typeTimer = setInterval(() => {
        this.dom.text.textContent = text.slice(0, i + 1);
        i += 1;
        if (i >= text.length) {
          clearInterval(this.typeTimer);
          this.typeTimer = null;
          this.isTyping = false;
        }
      }, this.config.typeSpeed);
    }

    completeTyping() {
      if (!this.dom.text) return;
      if (this.typeTimer) clearInterval(this.typeTimer);
      this.typeTimer = null;
      this.dom.text.textContent = this.fullText;
      this.isTyping = false;
    }

    async next() {
      if (!this.story) return;

      if (this.isTyping) {
        this.completeTyping();
        return;
      }

      const scene = this.currentScene;
      const dialogues = scene?.dialogues || [];

      // まだ同シーン内に次の台詞がある
      if (this.dialogueIndex < dialogues.length - 1) {
        this.dialogueIndex += 1;
        await this.render();
        return;
      }

      // シーン末尾。battle があればここで起動
      if (scene?.battle && !scene.__battleTriggered) {
        scene.__battleTriggered = true;
        await this.triggerBattle(scene.battle, scene);
        return;
      }

      // 最終シーンなら終了
      if (this.sceneIndex >= this.story.scenes.length - 1 || scene?.end) {
        this.finishStory();
        return;
      }

      // 次のシーンへ
      this.sceneIndex += 1;
      this.dialogueIndex = 0;
      await this.render();
    }

    async prev() {
      if (!this.story) return;

      if (this.isTyping) {
        this.completeTyping();
        return;
      }

      if (this.dialogueIndex > 0) {
        this.dialogueIndex -= 1;
        await this.render();
        return;
      }

      if (this.sceneIndex > 0) {
        this.sceneIndex -= 1;
        this.dialogueIndex = Math.max((this.currentScene?.dialogues?.length || 1) - 1, 0);
        await this.render();
      }
    }

    async triggerBattle(battleData, scene) {
      // battle 呼び出しを外部の既存 battle エンジンに委譲
      if (typeof this.onBattle === 'function') {
        await this.onBattle({ battleData, scene, story: this.story, storyPlayer: this });
      } else if (window.startBattle && typeof window.startBattle === 'function') {
        await window.startBattle(battleData);
      } else {
        // battle エンジン未接続時の暫定挙動
        alert(`バトル開始: ${battleData.enemy || '敵'}（仮）`);
      }

      // battle 終了後、次シーンへ進める
      if (this.sceneIndex < this.story.scenes.length - 1) {
        this.sceneIndex += 1;
        this.dialogueIndex = 0;
        await this.render();
      } else {
        this.finishStory();
      }
    }

    skipChapter() {
      if (!this.story) return;
      const ok = confirm('この章をスキップしますか？');
      if (!ok) return;
      this.finishStory(true);
    }

    finishStory(skipped = false) {
      this.clearProgress();
      if (typeof this.onEnd === 'function') {
        this.onEnd({ story: this.story, skipped });
      } else {
        alert(skipped ? 'ストーリーをスキップしました。' : '第1章クリア！');
      }
    }

    updateButtons() {
      if (this.dom.prev) {
        this.dom.prev.disabled = this.sceneIndex === 0 && this.dialogueIndex === 0;
      }
    }

    saveProgress() {
      if (!this.story?.chapter) return;
      const payload = {
        chapter: this.story.chapter,
        sceneIndex: this.sceneIndex,
        dialogueIndex: this.dialogueIndex,
        title: this.story.title || '',
        savedAt: Date.now()
      };
      localStorage.setItem(storageKey(this.story.chapter), JSON.stringify(payload));
    }

    loadProgress() {
      if (!this.story?.chapter) return null;
      const raw = localStorage.getItem(storageKey(this.story.chapter));
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch (e) {
        console.warn('ストーリー進行の復元に失敗:', e);
        return null;
      }
    }

    clearProgress() {
      if (!this.story?.chapter) return;
      localStorage.removeItem(storageKey(this.story.chapter));
    }
  }

  // =========================
  // 公開API
  // =========================
  window.StoryPlayer = StoryPlayer;

  // =========================
  // 起動例
  // =========================
  async function bootStory() {
    const player = new StoryPlayer({
      storyUrl: 'data/story.json',
      onBattle: async ({ battleData }) => {
        // ここを既存 battle UI に接続
        // 例: await window.startBattle(battleData);
        console.log('[StoryPlayer] battle start', battleData);
        alert(`バトル開始: ${battleData.enemy || '敵'}（仮実装）`);
      },
      onEnd: ({ skipped }) => {
        console.log('[StoryPlayer] story end', { skipped });
        alert(skipped ? '第1章をスキップしました。' : '第1章クリア！');
        // ここでメニュー画面に戻す / 第2章を解放する等
      }
    });

    try {
      await player.load();
      window.storyPlayer = player;
    } catch (err) {
      console.error(err);
      alert('story.json の読み込みに失敗しました。ファイル配置を確認してください。');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const startBtn = $('start-story');
    if (startBtn) {
      startBtn.addEventListener('click', bootStory);
    } else {
      // start-story が無い場合は自動起動したいならコメント解除
      // bootStory();
    }
  });
})();
