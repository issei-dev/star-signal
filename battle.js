const STORAGE_KEYS = {
  battleContext: 'star_signal_battle_context',
  battleResolution: 'star_signal_battle_resolution'
};

const context = (() => {
  const raw = sessionStorage.getItem(STORAGE_KEYS.battleContext);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
})();

const battleData = context?.battleData || { enemy: 'シャドウ', tutorial: true };

const party = [
  {
    id: 'hero',
    name: '主人公',
    role: 'バランス',
    maxHp: 180,
    hp: 180,
    atk: 26,
    def: 14,
    baseDef: 14,
    gauge: 0,
    guarding: false,
    specialArmed: false,
    alive: true,
    skills: [
      { name: '疾風斬', type: 'damage', power: 1.35, gauge: 10, text: '単体に素早い斬撃' },
      { name: '勇気の号令', type: 'buff', amount: 0.15, gauge: 5, text: 'このターンの通常攻撃ダメージ上昇' }
    ]
  },
  {
    id: 'liana',
    name: 'リアナ',
    role: 'ヒーラー',
    maxHp: 150,
    hp: 150,
    atk: 18,
    def: 11,
    baseDef: 11,
    gauge: 0,
    guarding: false,
    specialArmed: false,
    alive: true,
    skills: [
      { name: 'ヒーリング', type: 'heal', amount: 42, gauge: 8, text: '味方単体を回復' },
      { name: 'ライトアロー', type: 'damage', power: 1.2, gauge: 8, text: '単体へ光属性攻撃' }
    ]
  },
  {
    id: 'fiene',
    name: 'フィーネ',
    role: 'タンク',
    maxHp: 220,
    hp: 220,
    atk: 16,
    def: 18,
    baseDef: 18,
    gauge: 0,
    guarding: false,
    specialArmed: false,
    alive: true,
    skills: [
      { name: '鋼の一撃', type: 'damage', power: 1.15, gauge: 10, text: '単体攻撃＋少し自己回復', selfHeal: 16 },
      { name: '守護の咆哮', type: 'buff', amount: 0.25, gauge: 5, text: '防御姿勢中の軽減をさらに高める' }
    ]
  },
  {
    id: 'celes',
    name: 'セレス',
    role: '魔法火力',
    maxHp: 140,
    hp: 140,
    atk: 30,
    def: 9,
    baseDef: 9,
    gauge: 0,
    guarding: false,
    specialArmed: false,
    alive: true,
    skills: [
      { name: 'フレイムバースト', type: 'damage', power: 1.25, gauge: 10, text: '炎の単体魔法' },
      { name: 'サンダーフォール', type: 'damage', power: 1.5, gauge: 12, text: '高火力の雷撃' }
    ]
  }
];

const enemy = {
  name: battleData.enemy || 'シャドウ',
  maxHp: 360,
  hp: 360,
  atk: 24,
  def: 10,
  specialName: '深淵の爪'
};

const state = {
  turn: 1,
  actorIndex: 0,
  phase: 'player',
  result: null,
  skillPanelOpen: false
};

const els = {
  turn: document.getElementById('turn-indicator'),
  phase: document.getElementById('phase-indicator'),
  enemyName: document.getElementById('enemy-name'),
  enemyHpFill: document.getElementById('enemy-hp-fill'),
  enemyHpText: document.getElementById('enemy-hp-text'),
  enemyPanel: document.getElementById('enemy-panel'),
  partyPanel: document.getElementById('party-panel'),
  currentActorName: document.getElementById('current-actor-name'),
  currentActorState: document.getElementById('current-actor-state'),
  btnAttack: document.getElementById('btn-attack'),
  btnSkill: document.getElementById('btn-skill'),
  btnDefense: document.getElementById('btn-defense'),
  btnSpecial: document.getElementById('btn-special'),
  skillPanel: document.getElementById('skill-panel'),
  log: document.getElementById('battle-log'),
  resultOverlay: document.getElementById('result-overlay'),
  resultTitle: document.getElementById('result-title'),
  resultText: document.getElementById('result-text'),
  btnReturnStory: document.getElementById('btn-return-story'),
  btnRetry: document.getElementById('btn-retry')
};

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function aliveParty() { return party.filter(p => p.alive); }
function currentActor() { return party[state.actorIndex]; }
function randomAlivePartyMember() { const list = aliveParty(); return list[Math.floor(Math.random() * list.length)]; }

function logLine(text) {
  const row = document.createElement('div');
  row.textContent = text;
  els.log.appendChild(row);
  els.log.scrollTop = els.log.scrollHeight;
}

function updateEnemyPanel() {
  els.enemyName.textContent = enemy.name;
  els.enemyHpFill.style.width = `${clamp(enemy.hp / enemy.maxHp, 0, 1) * 100}%`;
  els.enemyHpText.textContent = `${Math.max(0, Math.ceil(enemy.hp))} / ${enemy.maxHp}`;
  els.enemyPanel.innerHTML = `<div class="enemy-avatar">${enemy.name}</div>`;
}

function renderParty() {
  els.partyPanel.innerHTML = '';
  party.forEach((actor, index) => {
    const card = document.createElement('div');
    card.className = 'actor-card';
    if (state.phase === 'player' && index === state.actorIndex && actor.alive) card.classList.add('active');
    if (actor.guarding) card.classList.add('guard');
    const hpRate = clamp(actor.hp / actor.maxHp, 0, 1) * 100;
    const gaugeRate = clamp(actor.gauge / 100, 0, 1) * 100;
    card.innerHTML = `
      <div class="actor-header">
        <div class="actor-name">${actor.name}</div>
        <div class="actor-role">${actor.role}</div>
      </div>
      <div class="hp-bar"><span style="width:${hpRate}%"></span></div>
      <div class="hp-text">HP ${Math.max(0, Math.ceil(actor.hp))} / ${actor.maxHp}</div>
      <div class="gauge-bar"><span style="width:${gaugeRate}%"></span></div>
      <div class="gauge-text">必殺ゲージ ${Math.floor(actor.gauge)} / 100</div>
      <div class="stat-line"><span>ATK ${actor.atk}</span><span>DEF ${actor.guarding ? actor.baseDef * 5 : actor.baseDef}</span></div>
      <div class="stat-line"><span>${actor.specialArmed ? '必殺準備中' : actor.guarding ? '防御中' : actor.alive ? '行動可能' : '戦闘不能'}</span></div>
    `;
    els.partyPanel.appendChild(card);
  });
}

function renderSkills() {
  const actor = currentActor();
  if (!actor || !actor.alive || state.phase !== 'player') {
    els.skillPanel.classList.remove('open');
    els.skillPanel.innerHTML = '';
    return;
  }

  els.skillPanel.innerHTML = actor.skills.map((skill, idx) => `
    <button class="skill-btn" data-skill-index="${idx}">
      ${skill.name}
      <span class="skill-meta">${skill.text} / ゲージ+${skill.gauge}</span>
    </button>
  `).join('');

  els.skillPanel.querySelectorAll('.skill-btn').forEach(btn => {
    btn.addEventListener('click', () => useSkill(Number(btn.dataset.skillIndex)));
  });

  if (state.skillPanelOpen) els.skillPanel.classList.add('open');
  else els.skillPanel.classList.remove('open');
}

function updateCommandState() {
  if (state.result) {
    [els.btnAttack, els.btnSkill, els.btnDefense, els.btnSpecial].forEach(btn => btn.disabled = true);
    return;
  }
  const actor = currentActor();
  const enabled = state.phase === 'player' && actor && actor.alive;
  els.btnAttack.disabled = !enabled;
  els.btnSkill.disabled = !enabled;
  els.btnDefense.disabled = !enabled;
  els.btnSpecial.disabled = !enabled || actor.gauge < 100 || actor.specialArmed;
  els.currentActorName.textContent = enabled ? actor.name : '敵のターン';
  if (enabled) {
    els.currentActorState.textContent = actor.specialArmed
      ? '必殺技発動中：次の通常攻撃が必殺攻撃になります。'
      : 'スキルは何度でも使用可能 / 通常攻撃か防御を選ぶと行動終了';
  } else {
    els.currentActorState.textContent = '敵が行動中です。';
  }
}

function render() {
  const pArea = document.getElementById('party-area');
  pArea.innerHTML = '';

  party.forEach(c => {
    pArea.innerHTML += `
      <div class="character">
        ${c.name}<br>
        
        <div class="hp-bar">
          <div class="hp-fill" style="width:${c.hp}%"></div>
        </div>

        <div class="gauge" style="width:${c.gauge || 0}%"></div>
      </div>
    `;
  });

  document.getElementById('enemy-area').innerHTML = `
    <div class="enemy">${enemy.name}</div>
    <div class="hp-bar">
      <div class="hp-fill" style="width:${enemy.hp}%"></div>
    </div>
  `;
}

function computeDamage(attacker, defender, multiplier = 1) {
  const raw = Math.round(attacker.atk * multiplier - defender.def * 0.35);
  return Math.max(1, raw);
}

function gainGauge(actor, amount) {
  actor.gauge = clamp(actor.gauge + amount, 0, 100);
}

function checkBattleEnd() {
  if (enemy.hp <= 0) {
    enemy.hp = 0;
    showResult('victory');
    return true;
  }
  if (aliveParty().length === 0) {
    showResult('defeat');
    return true;
  }
  return false;
}

function proceedToNextActor() {
  state.skillPanelOpen = false;
  do {
    state.actorIndex += 1;
  } while (state.actorIndex < party.length && !party[state.actorIndex].alive);

  if (state.actorIndex >= party.length) {
    state.phase = 'enemy';
    setTimeout(enemyTurn, 550);
    render();
    return;
  }
  render();
}

function normalAttack() {
  const actor = currentActor();
  if (!actor || !actor.alive || state.phase !== 'player') return;
  const isSpecial = actor.specialArmed;
  const multiplier = isSpecial ? 2.2 : actor.tempAttackBoost ? 1.35 : 1.0;
  const dmg = computeDamage(actor, enemy, multiplier);
  enemy.hp -= dmg;
  gainGauge(actor, isSpecial ? 0 : 20);
  logLine(`${actor.name}の${isSpecial ? '必殺攻撃' : '通常攻撃'}！ ${enemy.name}に${dmg}ダメージ。`);
  actor.specialArmed = false;
  actor.tempAttackBoost = false;
  if (checkBattleEnd()) return;
  proceedToNextActor();
}

function useSkill(skillIndex) {
  const actor = currentActor();
  if (!actor || !actor.alive || state.phase !== 'player') return;
  const skill = actor.skills[skillIndex];
  if (!skill) return;

  if (skill.type === 'damage') {
    const dmg = computeDamage(actor, enemy, skill.power);
    enemy.hp -= dmg;
    logLine(`${actor.name}のスキル「${skill.name}」！ ${enemy.name}に${dmg}ダメージ。`);
    if (skill.selfHeal) {
      actor.hp = clamp(actor.hp + skill.selfHeal, 0, actor.maxHp);
      logLine(`${actor.name}は${skill.selfHeal}回復した。`);
    }
  } else if (skill.type === 'heal') {
    const target = aliveParty().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0] || actor;
    target.hp = clamp(target.hp + skill.amount, 0, target.maxHp);
    logLine(`${actor.name}のスキル「${skill.name}」！ ${target.name}のHPが${skill.amount}回復。`);
  } else if (skill.type === 'buff') {
    actor.tempAttackBoost = true;
    actor.guardBoost = skill.amount;
    logLine(`${actor.name}のスキル「${skill.name}」！ 次の行動に力が宿る。`);
  }

  gainGauge(actor, skill.gauge);
  if (checkBattleEnd()) return;
  render();
}

function defend() {
  const actor = currentActor();
  if (!actor || !actor.alive || state.phase !== 'player') return;
  actor.guarding = true;
  actor.def = actor.baseDef * 5;
  gainGauge(actor, 10);
  logLine(`${actor.name}は防御！ このターンのDEFが5倍になった。`);
  proceedToNextActor();
}

function armSpecial() {
  const actor = currentActor();
  if (!actor || !actor.alive || state.phase !== 'player') return;
  if (actor.gauge < 100 || actor.specialArmed) return;
  actor.specialArmed = true;
  actor.gauge = 0;
  logLine(`${actor.name}は必殺技を発動準備！ 次の通常攻撃が強化される。`);
  render();
}

function enemyTurn() {
  if (state.result) return;
  const target = randomAlivePartyMember();
  if (!target) {
    showResult('defeat');
    return;
  }
  const dmg = Math.max(1, Math.round(enemy.atk - target.def * 0.45));
  target.hp = clamp(target.hp - dmg, 0, target.maxHp);
  if (target.hp <= 0) target.alive = false;
  gainGauge(target, 10);
  logLine(`${enemy.name}の${enemy.specialName}！ ${target.name}に${dmg}ダメージ。`);
  if (!target.alive) logLine(`${target.name}は戦闘不能になった。`);

  party.forEach(member => {
    member.guarding = false;
    member.def = member.baseDef;
    member.guardBoost = false;
  });

  if (checkBattleEnd()) return;

  state.turn += 1;
  state.phase = 'player';
  state.actorIndex = party.findIndex(p => p.alive);
  if (state.actorIndex === -1) {
    showResult('defeat');
    return;
  }
  render();
}

function showResult(outcome) {
  state.result = outcome;
  render();
  els.resultOverlay.classList.remove('hidden');
  if (outcome === 'victory') {
    els.resultTitle.textContent = 'VICTORY';
    els.resultText.textContent = `${enemy.name}を撃破！ ストーリーの続きを再生できます。`;
  } else {
    els.resultTitle.textContent = 'DEFEAT';
    els.resultText.textContent = 'パーティが全滅しました。戦闘前のシーンに戻って再挑戦できます。';
  }
}

function returnToStory() {
  if (!context) {
    window.location.href = 'story.html';
    return;
  }
  const resolution = {
    chapter: context.chapter,
    sceneIndex: context.sceneIndex,
    nextSceneIndex: context.nextSceneIndex,
    outcome: state.result || 'victory'
  };
  sessionStorage.setItem(STORAGE_KEYS.battleResolution, JSON.stringify(resolution));
  window.location.href = 'story.html';
}

function retryBattle() {
  window.location.reload();
}

els.btnAttack.addEventListener('click', normalAttack);
els.btnSkill.addEventListener('click', () => {
  state.skillPanelOpen = !state.skillPanelOpen;
  renderSkills();
  updateCommandState();
  els.skillPanel.classList.toggle('open', state.skillPanelOpen);
});
els.btnDefense.addEventListener('click', defend);
els.btnSpecial.addEventListener('click', armSpecial);
els.btnReturnStory.addEventListener('click', returnToStory);
els.btnRetry.addEventListener('click', retryBattle);

function boot() {
  els.enemyName.textContent = enemy.name;
  if (context?.battleData?.tutorial) {
    logLine('チュートリアル戦闘：スキルは何度でも使えます。通常攻撃か防御で行動終了です。');
  }
  if (!context) {
    logLine('戦闘コンテキストが見つからないため、単体テストモードで起動しています。');
  } else {
    logLine(`戦闘開始！ ${enemy.name} が現れた。`);
  }
  state.actorIndex = party.findIndex(p => p.alive);
  render();
}

boot();
