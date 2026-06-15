// ================================
// Star Signal App.js 完全版
// ================================

const CONFIG = {
  storyUrl: './data/story.json', // ✅ GitHub対応
  bgPath: './assets/images/backgrounds/',
  charPath: './assets/images/characters/',
};

// ================================
// ユーティリティ
// ================================
function $(id) {
  return document.getElementById(id);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ================================
// Story Player
// ================================
class StoryPlayer {
  constructor() {
    this.story = null;
    this.sceneIndex = 0;
    this.dialogueIndex = 0;
    this.isTyping = false;
    this.fullText = '';
  }

  async load() {
    try {
      const res = await fetch(CONFIG.storyUrl);

      if (!res.ok) throw new Error('404');

      this.story = await res.json();
      this.render();

    } catch (e) {
      console.error(e);

      alert(
        'story.json 読み込み失敗\n\n' +
        '原因の可能性：\n' +
        '・パス間違い\n' +
        '・GitHubでdata配置ミス\n' +
        '・URL確認してください\n\n' +
        CONFIG.storyUrl
      );
    }
  }

  get scene() {
    return this.story.scenes[this.sceneIndex];
  }

  get dialogue() {
    return this.scene.dialogues[this.dialogueIndex];
  }

  async render() {
    const scene = this.scene;
    const dialogue = this.dialogue;

    // 背景
    $('story-bg').style.backgroundImage =
      `url(${CONFIG.bgPath + scene.bg + '.jpg'})`;

    // 名前
    $('story-name').textContent = dialogue.name;

    // テキスト
    await this.typeText(dialogue.text);
  }

  async typeText(text) {
    this.isTyping = true;
    this.fullText = text;

    $('story-text').textContent = '';

    for (let i = 0; i < text.length; i++) {
      $('story-text').textContent += text[i];
      await delay(16);
    }

    this.isTyping = false;
  }

  next() {
    if (this.isTyping) {
      $('story-text').textContent = this.fullText;
      this.isTyping = false;
      return;
    }

    const scene = this.scene;

    // セリフ送り
    if (this.dialogueIndex < scene.dialogues.length - 1) {
      this.dialogueIndex++;
      this.render();
      return;
    }

    // 👇 バトル発生
    if (scene.battle && !scene._done) {
      scene._done = true;

      sessionStorage.setItem("battle", JSON.stringify({
        nextScene: this.sceneIndex + 1
      }));

      location.href = './battle.html';
      return;
    }

    // 次シーン
    if (this.sceneIndex < this.story.scenes.length - 1) {
      this.sceneIndex++;
      this.dialogueIndex = 0;
      this.render();
      return;
    }

    alert("ストーリー終了");
  }

  skip() {
    if (confirm("スキップしますか？")) {
      location.href = './index.html'; // ✅ 修正済み
    }
  }
}

// ================================
// 起動処理
// ================================
let player;

document.addEventListener('DOMContentLoaded', () => {

  player = new StoryPlayer();

  $('start-story').onclick = () => {
    $('start-story').style.display = 'none';
    player.load();
  };

  $('story-next').onclick = () => player.next();
  $('story-text').onclick = () => player.next();

  $('story-skip').onclick = () => player.skip();

});
``
