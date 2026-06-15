// app.js
// Star Signal Story Engine + Battle Integration
(function () {
  'use strict';

  const CONFIG = {
    storyUrl: 'data/story.json',
    bgBasePath: 'assets/images/backgrounds/',
    bgExt: '.jpg',
    characterBasePath: 'assets/images/characters/',
    characterExt: '.png',
    typeSpeed: 16,
    sceneFadeDuration: 180,
    autoCreateFallbackUI: false
  };

  const STORAGE_KEYS = {
    progressPrefix: 'story_progress_chapter_',
    battleContext: 'star_signal_battle_context',
    battleResolution: 'star_signal_battle_resolution'
  };

  function $(id) { return document.getElementById(id); }
  function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function progressKey(chapter) { return `${STORAGE_KEYS.progressPrefix}${chapter}`; }

  function createFallbackUI() {
    if (!CONFIG.autoCreateFallbackUI || $('story-screen')) return;
    const style = document.createElement('style');
    style.textContent = `
      #story-screen { position: relative; width:100%; min-height:100vh; overflow:hidden; background:#111; color:#fff; }
      #story-bg { position:absolute; inset:0; background-size:cover; background-position:center; filter:brightness(.6); transition:opacity .18s ease; }
      #story-characters { position:absolute; left:0; right:0; bottom:160px; height:52%; display:flex; justify-content:center; align-items:flex-end; gap:24px; z-index:2; pointer-events:none; }
      .story-portrait { max-height:100%; max-width:30%; object-fit:contain; filter:drop-shadow(0 8px 14px rgba(0,0,0,.5)); }
      #story-ui { position:absolute; left:24px; right:24px; bottom:24px; z-index:3; background:rgba(0,0,0,.65); border-radius:16px; padding:16px; }
      #story-controls { display:flex; gap:8px; justify-content:flex-end; margin-top:12px; }
      #story-controls button { background:#2d5bff; color:#fff; border:none; border-radius:10px; padding:10px 14px; cursor:pointer; }
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
      </div>`;
    document.body.appendChild(wrapper);
  }

  class StoryPlayer {
    constructor(options = {}) {
      this.config = { ...CONFIG, ...options };
      this.story = null;
      this.sceneIndex = 0;
      this.dialogueIndex = 0;
      this.isTyping = false;
      this.fullText = '';
      this.typeTimer = null;
      this.hasAppliedBattleResolution = false;
      createFallbackUI();
      this.cacheDom();
      this.bindEvents();
    }

    cacheDom() {
      this.dom = {
        bg: $('story-bg'),
        characters: $('story-characters'),
        chapter: $('story-chapter'),
        title: $('story-title'),
        name: $('story-name'),
        text: $('story-text'),
        prev: $('story-prev'),
        next: $('story-next'),
        skip: $('story-skip'),
        launcher: $('start-story')
      };
    }

    bindEvents() {
      this.dom.next?.addEventListener('click', () => this.next());
      this.dom.prev?.addEventListener('click', () => this.prev());
      this.dom.skip?.addEventListener('click', () => this.skipChapter());
      this.dom.text?.addEventListener('click', () => this.next());

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

      const battleResolution = this.readBattleResolution();
      if (battleResolution && battleResolution.chapter === storyData.chapter) {
        this.applyBattleResolution(battleResolution);
        this.clearBattleResolution();
        this.hasAppliedBattleResolution = true;
      } else {
        const saved = this.loadProgress();
        if (saved) {
          this.sceneIndex = saved.sceneIndex || 0;
          this.dialogueIndex = saved.dialogueIndex || 0;
        }
      }

      this.render();
    }

    readBattleResolution() {
      const raw = sessionStorage.getItem(STORAGE_KEYS.battleResolution);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    }

    clearBattleResolution() {
      sessionStorage.removeItem(STORAGE_KEYS.battleResolution);
    }

    applyBattleResolution(resolution) {
      if (resolution.outcome === 'victory') {
        this.sceneIndex = Math.min((resolution.nextSceneIndex ?? 0), (this.story?.scenes?.length || 1) - 1);
        this.dialogueIndex = 0;
        localStorage.setItem(
          progressKey(this.story.chapter),
          JSON.stringify({ chapter: this.story.chapter, sceneIndex: this.sceneIndex, dialogueIndex: 0, title: this.story.title || '', savedAt: Date.now() })
        );
        alert('戦闘に勝利！ ストーリーへ戻ります。');
      } else if (resolution.outcome === 'defeat') {
        this.sceneIndex = resolution.sceneIndex ?? 0;
        this.dialogueIndex = 0;
        alert('敗北しました。戦闘前のシーンから再開します。');
      }
    }

    get currentScene() { return this.story?.scenes?.[this.sceneIndex] || null; }
    get currentDialogue() { return this.currentScene?.dialogues?.[this.dialogueIndex] || null; }

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
    }

    async renderBackground(bgKey) {
      if (!this.dom.bg) return;
      this.dom.bg.style.opacity = '0.55';
      this.dom.bg.style.backgroundImage = `url("${this.config.bgBasePath}${bgKey}${this.config.bgExt}")`;
      await delay(this.config.sceneFadeDuration);
      this.dom.bg.style.opacity = '1';
    }

    renderCharacters(characterNames) {
      if (!this.dom.characters) return;
      this.dom.characters.innerHTML = '';
      characterNames.forEach((name) => {
        const img = document.createElement('img');
        img.className = 'story-portrait';
        img.alt = name;
        img.src = `${this.config.characterBasePath}${encodeURIComponent(name)}${this.config.characterExt}`;
        img.onerror = () => {
          const fallback = document.createElement('div');
          fallback.className = 'story-portrait story-fallback';
          fallback.textContent = name;
          img.replaceWith(fallback);
        };
        this.dom.characters.appendChild(img);
      });
    }

    renderDialogue(dialogue) {
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
      if (this.dialogueIndex < dialogues.length - 1) {
        this.dialogueIndex += 1;
        await this.render();
        return;
      }

      if (scene?.battle && !scene.__battleTriggered) {
        scene.__battleTriggered = true;
        this.launchBattle(scene);
        return;
      }

      if (this.sceneIndex >= this.story.scenes.length - 1 || scene?.end) {
        this.finishStory();
        return;
      }

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

    launchBattle(scene) {
      const payload = {
        chapter: this.story.chapter,
        title: this.story.title || '',
        sceneId: scene.id,
        sceneIndex: this.sceneIndex,
        dialogueIndex: this.dialogueIndex,
        nextSceneIndex: Math.min(this.sceneIndex + 1, this.story.scenes.length - 1),
        battleData: scene.battle
      };
      sessionStorage.setItem(STORAGE_KEYS.battleContext, JSON.stringify(payload));
      this.saveProgress();
      window.location.href = 'battle.html';
    }

    skipChapter() {
      const ok = confirm('この章をスキップしますか？');
      if (!ok) return;
      this.finishStory(true);
    }

    finishStory(skipped = false) {
      this.clearProgress();
      alert(skipped ? 'ストーリーをスキップしました。' : '第1章クリア！');
    }

    updateButtons() {
      if (this.dom.prev) this.dom.prev.disabled = this.sceneIndex === 0 && this.dialogueIndex === 0;
    }

    saveProgress() {
      if (!this.story?.chapter) return;
      localStorage.setItem(
        progressKey(this.story.chapter),
        JSON.stringify({ chapter: this.story.chapter, sceneIndex: this.sceneIndex, dialogueIndex: this.dialogueIndex, title: this.story.title || '', savedAt: Date.now() })
      );
    }

    loadProgress() {
      if (!this.story?.chapter) return null;
      const raw = localStorage.getItem(progressKey(this.story.chapter));
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    }

    clearProgress() {
      if (!this.story?.chapter) return;
      localStorage.removeItem(progressKey(this.story.chapter));
    }
  }

  window.StoryPlayer = StoryPlayer;

  async function bootStory() {
    const startBtn = $('start-story');
    if (startBtn) startBtn.style.display = 'none';
    const player = new StoryPlayer({ storyUrl: 'data/story.json' });
    try {
      await player.load();
      window.storyPlayer = player;
    } catch (err) {
      console.error(err);
      alert('story.json の読み込みに失敗しました。');
      if (startBtn) startBtn.style.display = 'inline-flex';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const startBtn = $('start-story');
    startBtn?.addEventListener('click', bootStory);

    if (sessionStorage.getItem(STORAGE_KEYS.battleResolution)) {
      bootStory();
    }
  });
})();
