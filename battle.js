// ======================================
// Star Signal - battle.js 完全版（グラフィカルUI / ダブルタップ拡大防止対応）
// ======================================

(function () {
  'use strict';

  // ---------- ダブルタップ拡大の抑制 ----------
  let lastTouchEnd = 0;
  document.addEventListener('touchend', function (e) {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      e.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });

  document.addEventListener('gesturestart', function (e) {
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('dblclick', function (e) {
    e.preventDefault();
  }, { passive: false });

  const battleContext = (() => {
    try {
      return JSON.parse(sessionStorage.getItem('battle') || 'null');
    } catch (e) {
      return null;
    }
  })();

  const party = [
    {
      id: 'hero',
      name: '主人公',
      maxHp: 180,
      hp: 180,
      atk: 26,
      def: 14,
      baseDef: 14,
      gauge: 0,
      alive: true,
      guarding: false,
      specialReady: false,
      skills: [
        { name: '疾風斬', type: 'damage', power: 1.35, gaugeGain: 10, description: '敵単体に素早い斬撃でダメージ' },
        { name: '勇気の号令', type: 'buff', gaugeGain: 5, description: '次の通常攻撃の威力を上昇', effect: 'atkUp' }
      ]
    },
    {
      id: 'member1',
      name: 'バトルメンバー①',
      maxHp: 150,
      hp: 150,
      atk: 18,
      def: 12,
      baseDef: 12,
      gauge: 0,
      alive: true,
      guarding: false,
      specialReady: false,
      skills: [
        { name: 'ヒーリング', type: 'heal', heal: 38, gaugeGain: 8, description: 'HPが最も低い味方を回復' },
        { name: 'ライトアロー', type: 'damage', power: 1.2, gaugeGain: 8, description: '敵単体に光の矢でダメージ' }
      ]
    },
    {
      id: 'member2',
      name: 'バトルメンバー②',
      maxHp: 220,
      hp: 220,
      atk: 16,
      def: 18,
      baseDef: 18,
      gauge: 0,
      alive: true,
      guarding: false,
      specialReady: false,
      skills: [
        { name: '鋼の一撃', type: 'damage', power: 1.15, gaugeGain: 10, description: '敵単体を攻撃し自分も少し回復', selfHeal: 15 },
        { name: '挑発の気配', type: 'buff', gaugeGain: 5, description: '次に受けるダメージを軽減', effect: 'guardUp' }
      ]
    },
    {
      id: 'member3',
      name: 'バトルメンバー③',
      maxHp: 140,
      hp: 140,
      atk: 30,
      def: 9,
      baseDef: 9,
      gauge: 0,
      alive: true,
      guarding: false,
      specialReady: false,
      skills: [
        { name: 'フレイムバースト', type: 'damage', power: 1.25, gaugeGain: 10, description: '敵単体に炎魔法でダメージ' },
        { name: 'サンダーフォール', type: 'damage', power: 1.5, gaugeGain: 12, description: '敵単体に強力な雷撃' }
      ]
    }
  ];

  const enemy = {
    name: (battleContext && battleContext.enemyName) || 'アビスシャドウ',
    maxHp: 360,
    hp: 360,
    atk: 24,
    def: 10,
    imageLabel: (battleContext && battleContext.enemyName) || '敵'
  };

  const state = {
    turn: 1,
    actorIndex: 0,
    phase: 'player',
    skillPanelOpen: false,
    result: null
  };

  const els = {
    enemyArea: document.getElementById('enemy-area'),
    partyArea: document.getElementById('party-area'),
    commandArea: document.getElementById('command-area'),
    log: document.getElementById('log')
  };

  if (!els.enemyArea || !els.partyArea || !els.commandArea || !els.log) {
    console.error('battle.js: 必要な要素が不足しています。#enemy-area #party-area #command-area #log を確認してください。');
    return;
  }

  ensureCommandUI();

  const ui = {
    attackBtn: document.getElementById('battle-attack-btn'),
    skillBtn: document.getElementById('battle-skill-btn'),
    defenseBtn: document.getElementById('battle-defense-btn'),
    specialBtn: document.getElementById('battle-special-btn'),
    infoRow: document.getElementById('battle-info-row'),
    skillPanel: document.getElementById('battle-skill-panel'),
    resultPanel: document.getElementById('battle-result-panel')
  };

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function aliveMembers() { return party.filter(member => member.alive); }
  function getCurrentActor() { return party[state.actorIndex]; }
  function memberPercentHp(member) { return clamp((member.hp / member.maxHp) * 100, 0, 100); }
  function memberPercentGauge(member) { return clamp((member.gauge / 100) * 100, 0, 100); }
  function enemyPercentHp() { return clamp((enemy.hp / enemy.maxHp) * 100, 0, 100); }
  function computeDamage(attackerAtk, defenderDef, multiplier) {
    const raw = Math.round(attackerAtk * multiplier - defenderDef * 0.35);
    return Math.max(1, raw);
  }
  function gainGauge(member, amount) { member.gauge = clamp(member.gauge + amount, 0, 100); }
  function lowestHpMember() {
    const alive = aliveMembers();
    if (!alive.length) return null;
    return alive.slice().sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
  }
  function randomAliveMember() {
    const alive = aliveMembers();
    if (!alive.length) return null;
    return alive[Math.floor(Math.random() * alive.length)];
  }
  function clearTemporaryFlags(member) {
    member.tempAttackBoost = false;
    member.tempGuardBoost = false;
  }

  function appendLog(text) {
    const line = document.createElement('div');
    line.textContent = text;
    els.log.appendChild(line);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function showInfo(text) {
    ui.infoRow.textContent = text;
  }

  function renderEnemy() {
    els.enemyArea.innerHTML = `
      <div class="enemy-wrap">
        <div class="enemy-name">${enemy.name}</div>
        <div class="enemy-image">${enemy.imageLabel}</div>
        <div class="enemy-bar">
          <div class="hp-fill" style="width:${enemyPercentHp()}%"></div>
        </div>
        <div class="enemy-hp-text">HP ${Math.max(0, Math.ceil(enemy.hp))} / ${enemy.maxHp}</div>
      </div>
    `;
  }

  function renderParty() {
    els.partyArea.innerHTML = '';
    party.forEach((member, index) => {
      const card = document.createElement('div');
      card.className = 'character';
      if (state.phase === 'player' && index === state.actorIndex && member.alive) card.classList.add('active');
      if (!member.alive) card.classList.add('down');
      if (member.guarding) card.classList.add('guard');

      card.innerHTML = `
        <div class="char-name">${member.name}</div>
        <div class="hp-bar"><div class="hp-fill" style="width:${memberPercentHp(member)}%"></div></div>
        <div class="mini-text">HP ${Math.max(0, Math.ceil(member.hp))}/${member.maxHp}</div>
        <div class="gauge-bar"><div class="gauge-fill" style="width:${memberPercentGauge(member)}%"></div></div>
        <div class="mini-text">必殺 ${Math.floor(member.gauge)} / 100</div>
      `;
      els.partyArea.appendChild(card);
    });
  }

  function renderSkills() {
    const actor = getCurrentActor();
    if (!state.skillPanelOpen || !actor || !actor.alive || state.phase !== 'player') {
      ui.skillPanel.style.display = 'none';
      ui.skillPanel.innerHTML = '';
      return;
    }

    ui.skillPanel.style.display = 'grid';
    ui.skillPanel.innerHTML = '';

    actor.skills.forEach((skill, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'skill-btn';
      btn.innerHTML = `${skill.name}<span class="skill-desc">${skill.description}</span>`;
      btn.addEventListener('click', () => useSkill(index));
      ui.skillPanel.appendChild(btn);
    });
  }

  function renderCommandState() {
    const actor = getCurrentActor();
    const playerTurn = state.phase === 'player' && actor && actor.alive;

    ui.attackBtn.disabled = !playerTurn;
    ui.skillBtn.disabled = !playerTurn;
    ui.defenseBtn.disabled = !playerTurn;
    ui.specialBtn.disabled = !playerTurn || actor.gauge < 100 || actor.specialReady;

    if (state.phase === 'result') {
      showInfo(state.result === 'victory' ? '勝利しました。' : '敗北しました。');
      return;
    }

    if (!playerTurn) {
      showInfo('敵のターンです。');
      return;
    }

    if (actor.specialReady) {
      showInfo(`${actor.name}：必殺技準備中。次の通常攻撃が強化されます。`);
    } else {
      showInfo(`${actor.name}のターン。スキルは何度でも使用可能 / 通常攻撃または防御で行動終了`);
    }
  }

  function render() {
    renderEnemy();
    renderParty();
    renderSkills();
    renderCommandState();
  }

  function checkBattleEnd() {
    if (enemy.hp <= 0) {
      enemy.hp = 0;
      endBattle('victory');
      return true;
    }
    if (aliveMembers().length === 0) {
      endBattle('defeat');
      return true;
    }
    return false;
  }

  function nextActor() {
    state.skillPanelOpen = false;
    do {
      state.actorIndex += 1;
    } while (state.actorIndex < party.length && !party[state.actorIndex].alive);

    if (state.actorIndex >= party.length) {
      state.phase = 'enemy';
      render();
      window.setTimeout(enemyTurn, 360);
      return;
    }

    render();
  }

  function normalAttack() {
    const actor = getCurrentActor();
    if (!actor || !actor.alive || state.phase !== 'player') return;

    const multiplier = actor.specialReady ? 2.2 : (actor.tempAttackBoost ? 1.35 : 1.0);
    const damage = computeDamage(actor.atk, enemy.def, multiplier);
    enemy.hp -= damage;

    if (!actor.specialReady) gainGauge(actor, 20);

    appendLog(`${actor.name}の${actor.specialReady ? '必殺攻撃' : '通常攻撃'}！ ${enemy.name}に${damage}ダメージ。`);

    actor.specialReady = false;
    clearTemporaryFlags(actor);
    render();
    if (checkBattleEnd()) return;
    nextActor();
  }

  function useSkill(skillIndex) {
    const actor = getCurrentActor();
    if (!actor || !actor.alive || state.phase !== 'player') return;
    const skill = actor.skills[skillIndex];
    if (!skill) return;

    if (skill.type === 'damage') {
      const damage = computeDamage(actor.atk, enemy.def, skill.power || 1.0);
      enemy.hp -= damage;
      appendLog(`${actor.name}のスキル「${skill.name}」！ ${skill.description}。 ${enemy.name}に${damage}ダメージ。`);
      if (skill.selfHeal) {
        actor.hp = clamp(actor.hp + skill.selfHeal, 0, actor.maxHp);
        appendLog(`${actor.name}は${skill.selfHeal}回復した。`);
      }
    }

    if (skill.type === 'heal') {
      const target = lowestHpMember();
      if (target) {
        target.hp = clamp(target.hp + skill.heal, 0, target.maxHp);
        appendLog(`${actor.name}のスキル「${skill.name}」！ ${skill.description}。 ${target.name}のHPが${skill.heal}回復。`);
      }
    }

    if (skill.type === 'buff') {
      if (skill.effect === 'atkUp') {
        actor.tempAttackBoost = true;
      }
      if (skill.effect === 'guardUp') {
        actor.tempGuardBoost = true;
      }
      appendLog(`${actor.name}のスキル「${skill.name}」！ ${skill.description}。`);
    }

    gainGauge(actor, skill.gaugeGain || 0);
    render();
    checkBattleEnd();
  }

  function defend() {
    const actor = getCurrentActor();
    if (!actor || !actor.alive || state.phase !== 'player') return;
    actor.guarding = true;
    actor.def = actor.baseDef * 5;
    gainGauge(actor, 10);
    appendLog(`${actor.name}は防御した！ このターンのDEFが5倍になった。`);
    render();
    nextActor();
  }

  function armSpecial() {
    const actor = getCurrentActor();
    if (!actor || !actor.alive || state.phase !== 'player') return;
    if (actor.gauge < 100 || actor.specialReady) return;
    actor.specialReady = true;
    actor.gauge = 0;
    appendLog(`${actor.name}は必殺技を発動準備！ 次の通常攻撃が変化する。`);
    render();
  }

  function enemyTurn() {
    if (state.phase !== 'enemy' || state.result) return;
    const target = randomAliveMember();
    if (!target) {
      endBattle('defeat');
      return;
    }

    let targetDef = target.def;
    if (target.tempGuardBoost) targetDef = Math.round(targetDef * 1.35);

    const damage = Math.max(1, Math.round(enemy.atk - targetDef * 0.45));
    target.hp = clamp(target.hp - damage, 0, target.maxHp);
    gainGauge(target, 10);
    appendLog(`${enemy.name}の攻撃！ ${target.name}に${damage}ダメージ。`);

    if (target.hp <= 0) {
      target.alive = false;
      appendLog(`${target.name}は戦闘不能になった。`);
    }

    party.forEach(member => {
      member.guarding = false;
      member.def = member.baseDef;
      member.tempGuardBoost = false;
    });

    render();
    if (checkBattleEnd()) return;

    state.turn += 1;
    state.phase = 'player';
    state.actorIndex = party.findIndex(member => member.alive);
    if (state.actorIndex === -1) {
      endBattle('defeat');
      return;
    }
    render();
  }

  function endBattle(result) {
    state.result = result;
    state.phase = 'result';
    render();

    ui.resultPanel.style.display = 'block';
    ui.resultPanel.innerHTML = `
      <div class="result-title">${result === 'victory' ? 'VICTORY' : 'DEFEAT'}</div>
      <div class="result-text">${result === 'victory'
        ? '敵を倒しました。ストーリーへ戻れます。'
        : '全滅しました。再挑戦またはストーリーへ戻れます。'
      }</div>
      <div class="result-buttons">
        <button type="button" id="battle-return-btn">ストーリーへ戻る</button>
        <button type="button" id="battle-retry-btn">再挑戦</button>
      </div>
    `;

    document.getElementById('battle-return-btn').addEventListener('click', returnToStory);
    document.getElementById('battle-retry-btn').addEventListener('click', retryBattle);
  }

  function returnToStory() {
    try {
      const resultPayload = {
        result: state.result,
        nextScene: battleContext && typeof battleContext.nextScene === 'number' ? battleContext.nextScene : null
      };
      sessionStorage.setItem('battleResult', JSON.stringify(resultPayload));
    } catch (e) {
      console.warn('battleResult 保存失敗', e);
    }
    window.location.href = './story.html';
  }

  function retryBattle() {
    window.location.reload();
  }

  function ensureCommandUI() {
    if (document.getElementById('battle-buttons-row')) return;
    els.commandArea.innerHTML = `
      <div id="battle-buttons-row" class="battle-buttons-row">
        <button type="button" id="battle-attack-btn">通常攻撃</button>
        <button type="button" id="battle-skill-btn">スキル</button>
        <button type="button" id="battle-defense-btn">防御</button>
        <button type="button" id="battle-special-btn">必殺技発動</button>
      </div>
      <div id="battle-info-row" class="battle-info-row"></div>
      <div id="battle-skill-panel" class="battle-skill-panel" style="display:none;"></div>
      <div id="battle-result-panel" class="battle-result-panel" style="display:none;"></div>
    `;
  }

  function bindEvents() {
    ui.attackBtn.addEventListener('click', normalAttack);
    ui.skillBtn.addEventListener('click', () => {
      if (state.phase !== 'player') return;
      state.skillPanelOpen = !state.skillPanelOpen;
      renderSkills();
      renderCommandState();
    });
    ui.defenseBtn.addEventListener('click', defend);
    ui.specialBtn.addEventListener('click', armSpecial);
  }

  window.selectAction = function (action) {
    if (action === 'attack') normalAttack();
    if (action === 'skill') {
      state.skillPanelOpen = !state.skillPanelOpen;
      renderSkills();
      renderCommandState();
    }
    if (action === 'defense') defend();
    if (action === 'special') armSpecial();
  };

  function boot() {
    bindEvents();
    appendLog('戦闘開始！ スキルは何度でも使用でき、通常攻撃または防御で行動終了します。');
    render();
  }

  boot();
})();
