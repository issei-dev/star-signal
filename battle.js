// ======================================
// Star Signal - battle.js
// CT実装版（スキルクールタイム対応）
// - 状態異常（ATKダウン / DEFダウン / スタン）
// - 敵行動予告 / ダメージ演出 / 必殺演出込み
// - スキル別CTは将来的に変更しやすいよう skill.cooldown に集約
// ======================================

(function () {
  'use strict';

  // ---------- ダブルタップ拡大の抑制 ----------
  let lastTouchEnd = 0;
  document.addEventListener('touchend', function (e) {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });

  const battleContext = (() => {
    try { return JSON.parse(sessionStorage.getItem('battle') || 'null'); } catch { return null; }
  })();

  // ---------- 固定段階制ステータス ----------
  // 小=15% / 中=25% / 大=40%
  // 小(1) + 小(1) = 中(2) のように段階昇格
  const DOWN_STAGE_TO_PERCENT = { 0: 0, 1: 15, 2: 25, 3: 40 };
  const PERCENT_TO_STAGE = { 15: 1, 25: 2, 40: 3 };
  const STAGE_ICON = { 1: '🔽', 2: '⏬', 3: '⇊' };

  function createStatusState() {
    return {
      atkDown: { stage: 0, turns: 0 },
      defDown: { stage: 0, turns: 0 },
      stun: { turns: 0 }
    };
  }

  function createSkill(config) {
    return Object.assign({
      cooldown: 1,
      currentCooldown: 0,
      gaugeGain: 0,
      description: ''
    }, config);
  }

  const party = [
    {
      id: 'hero', name: '主人公', maxHp: 180, hp: 180, atk: 26, def: 14, baseDef: 14, gauge: 0,
      alive: true, guarding: false, specialReady: false, tempAttackBoost: false, tempGuardBoost: false,
      statuses: createStatusState(),
      skills: [
        createSkill({ name: '疾風斬', type: 'damage', power: 1.35, gaugeGain: 10, description: '敵単体に素早い斬撃でダメージ', cooldown: 1 }),
        createSkill({ name: '勇気の号令', type: 'buff', gaugeGain: 5, description: '次の通常攻撃の威力を上昇', effect: 'atkUp', cooldown: 2 })
      ],
      specialLabel: '星光一閃'
    },
    {
      id: 'member1', name: 'バトルメンバー①', maxHp: 150, hp: 150, atk: 18, def: 12, baseDef: 12, gauge: 0,
      alive: true, guarding: false, specialReady: false, tempAttackBoost: false, tempGuardBoost: false,
      statuses: createStatusState(),
      skills: [
        createSkill({ name: 'ヒーリング', type: 'heal', heal: 38, gaugeGain: 8, description: 'HPが最も低い味方を回復', cooldown: 2 }),
        createSkill({ name: 'ライトアロー', type: 'damage', power: 1.2, gaugeGain: 8, description: '敵単体に光の矢でダメージ', cooldown: 1 })
      ],
      specialLabel: '聖光解放'
    },
    {
      id: 'member2', name: 'バトルメンバー②', maxHp: 220, hp: 220, atk: 16, def: 18, baseDef: 18, gauge: 0,
      alive: true, guarding: false, specialReady: false, tempAttackBoost: false, tempGuardBoost: false,
      statuses: createStatusState(),
      skills: [
        createSkill({ name: '鋼の一撃', type: 'damage', power: 1.15, gaugeGain: 10, description: '敵単体を攻撃し自分も少し回復', selfHeal: 15, cooldown: 1 }),
        createSkill({ name: '挑発の気配', type: 'buff', gaugeGain: 5, description: '次に受けるダメージを軽減', effect: 'guardUp', cooldown: 2 })
      ],
      specialLabel: '守護轟壁'
    },
    {
      id: 'member3', name: 'バトルメンバー③', maxHp: 140, hp: 140, atk: 30, def: 9, baseDef: 9, gauge: 0,
      alive: true, guarding: false, specialReady: false, tempAttackBoost: false, tempGuardBoost: false,
      statuses: createStatusState(),
      skills: [
        createSkill({ name: 'フレイムバースト', type: 'damage', power: 1.25, gaugeGain: 10, description: '敵単体に炎魔法でダメージ', cooldown: 1 }),
        createSkill({ name: 'サンダーフォール', type: 'damage', power: 1.5, gaugeGain: 12, description: '敵単体に強力な雷撃', cooldown: 2 })
      ],
      specialLabel: '天雷焼滅'
    }
  ];

  const enemy = {
    id: 'enemy',
    name: (battleContext && battleContext.enemyName) || 'アビスシャドウ',
    maxHp: 360,
    hp: 360,
    atk: 24,
    def: 10,
    baseDef: 10,
    imageLabel: (battleContext && battleContext.enemyName) || '敵',
    intents: ['通常攻撃', '強撃', '危険攻撃'],
    nextIntent: '通常攻撃',
    statuses: createStatusState()
  };

  const state = {
    turn: 1,
    actorIndex: 0,
    phase: 'player',
    skillPanelOpen: false,
    result: null,
    lastIntentLogged: null,
    actorTurnKey: null
  };

  const els = {
    screen: document.getElementById('battle-screen'),
    enemyArea: document.getElementById('enemy-area'),
    partyArea: document.getElementById('party-area'),
    commandArea: document.getElementById('command-area'),
    log: document.getElementById('log')
  };

  if (!els.enemyArea || !els.partyArea || !els.commandArea || !els.log || !els.screen) {
    console.error('battle.js: 必要な要素が不足しています。#battle-screen #enemy-area #party-area #command-area #log を確認してください。');
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
    resultPanel: document.getElementById('battle-result-panel'),
    specialOverlay: document.getElementById('battle-special-overlay')
  };

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function aliveMembers() { return party.filter(member => member.alive); }
  function getCurrentActor() { return party[state.actorIndex]; }
  function memberPercentHp(member) { return clamp((member.hp / member.maxHp) * 100, 0, 100); }
  function memberPercentGauge(member) { return clamp((member.gauge / 100) * 100, 0, 100); }
  function enemyPercentHp() { return clamp((enemy.hp / enemy.maxHp) * 100, 0, 100); }
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
  function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function getDownPercent(target, type) {
    return DOWN_STAGE_TO_PERCENT[target.statuses[type].stage] || 0;
  }

  function getEffectiveAtk(target) {
    const downRate = getDownPercent(target, 'atkDown') / 100;
    const base = target.atk * (1 - downRate);
    return Math.max(1, Math.round(base));
  }

  function getEffectiveDef(target) {
    const downRate = getDownPercent(target, 'defDown') / 100;
    const baseDefValue = typeof target.baseDef === 'number' ? target.baseDef : target.def;
    const defAfterDown = baseDefValue * (1 - downRate);
    let value = Math.max(1, Math.round(defAfterDown));
    if (target.guarding) value *= 5;
    if (target.tempGuardBoost) value = Math.round(value * 1.35);
    return value;
  }

  function stageFromPercent(percent) {
    return PERCENT_TO_STAGE[percent] || 0;
  }

  function applyDownStatus(target, type, percent, turns, sourceName) {
    const stageGain = stageFromPercent(percent);
    if (!stageGain) return;
    const status = target.statuses[type];
    const oldStage = status.stage;
    status.stage = clamp(status.stage + stageGain, 0, 3);
    status.turns = Math.max(status.turns, turns);
    const nowPercent = DOWN_STAGE_TO_PERCENT[status.stage];
    const label = type === 'atkDown' ? 'ATKダウン' : 'DEFダウン';
    if (oldStage !== status.stage) {
      appendLog(`${sourceName}の効果！ ${target.name}に${label} ${nowPercent}%（${status.turns}T）。`);
    } else {
      appendLog(`${sourceName}の効果！ ${target.name}の${label}を更新（${nowPercent}% / ${status.turns}T）。`);
    }
  }

  function applyStun(target, turns, sourceName) {
    target.statuses.stun.turns = Math.max(target.statuses.stun.turns, turns);
    appendLog(`${sourceName}の効果！ ${target.name}はスタン（${target.statuses.stun.turns}T）。`);
  }

  function tickStatuses(target) {
    ['atkDown', 'defDown'].forEach((type) => {
      const status = target.statuses[type];
      if (status.turns > 0) {
        status.turns -= 1;
        if (status.turns <= 0) {
          status.turns = 0;
          status.stage = 0;
          appendLog(`${target.name}の${type === 'atkDown' ? 'ATKダウン' : 'DEFダウン'}が解除された。`);
        }
      }
    });

    if (target.statuses.stun.turns > 0) {
      target.statuses.stun.turns -= 1;
      if (target.statuses.stun.turns <= 0) {
        target.statuses.stun.turns = 0;
        appendLog(`${target.name}のスタンが解除された。`);
      }
    }
  }

  function hasStun(target) {
    return target.statuses.stun.turns > 0;
  }

  // ---------- CT処理 ----------
  function tickSkillCooldowns(actor) {
    if (!actor || !Array.isArray(actor.skills)) return;
    actor.skills.forEach((skill) => {
      if (skill.currentCooldown > 0) skill.currentCooldown -= 1;
    });
  }

  function startSkillCooldown(skill) {
    if (!skill) return;
    skill.currentCooldown = Math.max(0, skill.cooldown || 0);
  }

  function actorTurnKey(actor) {
    return `${state.turn}:${actor ? actor.id : 'none'}:${state.phase}`;
  }

  function handleActorTurnStart(actor) {
    if (!actor || state.phase !== 'player') return;
    const key = actorTurnKey(actor);
    if (state.actorTurnKey === key) return;
    state.actorTurnKey = key;
    tickSkillCooldowns(actor);
  }

  function appendLog(text) {
    const line = document.createElement('div');
    line.textContent = text;
    els.log.appendChild(line);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function showInfo(text) { ui.infoRow.textContent = text; }

  function computeAttack(attacker, defender, multiplier) {
    const crit = Math.random() < 0.18;
    const attackerAtk = getEffectiveAtk(attacker);
    const defenderDef = getEffectiveDef(defender);
    const base = Math.round(attackerAtk * multiplier - defenderDef * 0.35);
    const damage = Math.max(1, crit ? Math.round(base * 1.6) : base);
    return { damage, crit };
  }

  function computeEnemyDamage(defender, intent) {
    const enemyAtk = getEffectiveAtk(enemy);
    const effectiveDef = getEffectiveDef(defender);
    let mult = 1.0;
    if (intent === '強撃') mult = 1.45;
    if (intent === '危険攻撃') mult = 1.9;
    const base = Math.max(1, Math.round(enemyAtk * mult - effectiveDef * 0.45));
    const guarded = !!defender.guarding || !!defender.tempGuardBoost;
    return { damage: base, guarded };
  }

  function rollNextEnemyIntent() {
    const pool = enemy.intents;
    enemy.nextIntent = pool[Math.floor(Math.random() * pool.length)];
    state.lastIntentLogged = null;
  }

  function createPopup(targetElement, value, popupClass) {
    if (!targetElement) return;
    const popup = document.createElement('div');
    popup.className = `damage-popup ${popupClass || ''}`.trim();
    popup.textContent = value;
    targetElement.appendChild(popup);
    window.setTimeout(() => popup.remove(), 950);
  }

  function flashHit(targetElement, className) {
    if (!targetElement) return;
    targetElement.classList.remove('hit-enemy', 'hit-ally');
    void targetElement.offsetWidth;
    targetElement.classList.add(className);
    window.setTimeout(() => targetElement.classList.remove(className), 220);
  }

  function getEnemyVisualElement() {
    return els.enemyArea.querySelector('.enemy-image') || els.enemyArea.querySelector('.enemy-wrap');
  }

  function getPartyCardByIndex(index) { return els.partyArea.children[index] || null; }

  function intentClass(intent) {
    if (intent === '危険攻撃') return 'danger';
    if (intent === '強撃') return 'heavy';
    return 'normal';
  }

  function statusBadgesHtml(target) {
    const badges = [];
    const atkStage = target.statuses.atkDown.stage;
    const defStage = target.statuses.defDown.stage;
    const stunTurns = target.statuses.stun.turns;

    if (atkStage > 0) {
      badges.push(`<span class="status-badge atk-down">ATK${STAGE_ICON[atkStage]}${DOWN_STAGE_TO_PERCENT[atkStage]}%<span class="status-turn">${target.statuses.atkDown.turns}T</span></span>`);
    }
    if (defStage > 0) {
      badges.push(`<span class="status-badge def-down">DEF${STAGE_ICON[defStage]}${DOWN_STAGE_TO_PERCENT[defStage]}%<span class="status-turn">${target.statuses.defDown.turns}T</span></span>`);
    }
    if (stunTurns > 0) {
      badges.push(`<span class="status-badge stun">💫STUN<span class="status-turn">${stunTurns}T</span></span>`);
    }

    if (!badges.length) return '<div class="status-row empty"></div>';
    return `<div class="status-row">${badges.join('')}</div>`;
  }

  function skillCooldownSummaryHtml(actor) {
    if (!actor || !actor.skills) return '';
    const labels = actor.skills
      .filter((skill) => skill.currentCooldown > 0)
      .map((skill) => `<span class="cooldown-chip">${skill.name} CT${skill.currentCooldown}</span>`);
    if (!labels.length) return '<div class="cooldown-row empty"></div>';
    return `<div class="cooldown-row">${labels.join('')}</div>`;
  }

  function updateDangerState() {
    els.screen.classList.remove('intent-danger-screen', 'intent-heavy-screen');
    els.enemyArea.classList.remove('danger-state', 'heavy-state');
    if (enemy.nextIntent === '危険攻撃') {
      els.screen.classList.add('intent-danger-screen');
      els.enemyArea.classList.add('danger-state');
      if (state.lastIntentLogged !== enemy.nextIntent) {
        appendLog('⚠ 危険攻撃予告！ 防御推奨。');
        state.lastIntentLogged = enemy.nextIntent;
      }
    } else if (enemy.nextIntent === '強撃') {
      els.screen.classList.add('intent-heavy-screen');
      els.enemyArea.classList.add('heavy-state');
      if (state.lastIntentLogged !== enemy.nextIntent) {
        appendLog('強撃の構え… 次の敵の一撃が重くなりそうだ。');
        state.lastIntentLogged = enemy.nextIntent;
      }
    } else {
      state.lastIntentLogged = enemy.nextIntent;
    }
  }

  function renderEnemy() {
    els.enemyArea.innerHTML = `
      <div class="enemy-wrap">
        <div class="enemy-name">${enemy.name}</div>
        <div class="enemy-image ${intentClass(enemy.nextIntent)}">${enemy.imageLabel}</div>
        ${statusBadgesHtml(enemy)}
        <div class="enemy-intent ${intentClass(enemy.nextIntent)}">次の行動：${enemy.nextIntent}</div>
        <div class="enemy-bar"><div class="hp-fill" style="width:${enemyPercentHp()}%"></div></div>
        <div class="enemy-hp-text">HP ${Math.max(0, Math.ceil(enemy.hp))} / ${enemy.maxHp}</div>
      </div>
    `;
  }

  function renderParty() {
    els.partyArea.innerHTML = '';
    party.forEach((member, index) => {
      const card = document.createElement('div');
      card.className = 'character';
      card.dataset.memberId = member.id;
      if (state.phase === 'player' && index === state.actorIndex && member.alive) card.classList.add('active');
      if (!member.alive) card.classList.add('down');
      if (member.guarding) card.classList.add('guard');
      card.innerHTML = `
        <div class="char-name">${member.name}</div>
        ${statusBadgesHtml(member)}
        ${skillCooldownSummaryHtml(member)}
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
      if (skill.currentCooldown > 0) btn.classList.add('cooldown');
      btn.disabled = skill.currentCooldown > 0;
      btn.innerHTML = `${skill.name}<span class="skill-desc">${skill.description}</span><span class="skill-meta">${skill.currentCooldown > 0 ? `CT中 ${skill.currentCooldown}` : `CT ${skill.cooldown}`}</span>`;
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
      if (enemy.nextIntent === '危険攻撃') showInfo('敵のターンです。危険攻撃が発動します！');
      else showInfo(`敵のターンです。予告：${enemy.nextIntent}`);
      return;
    }
    if (hasStun(actor)) {
      showInfo(`${actor.name}はスタン中です。行動できません。`);
      return;
    }
    const coolingCount = actor.skills.filter((skill) => skill.currentCooldown > 0).length;
    if (enemy.nextIntent === '危険攻撃') {
      if (actor.specialReady) showInfo(`${actor.name}：必殺技準備中。危険攻撃予告中、防御も有効です。`);
      else showInfo(`${actor.name}のターン。⚠ 危険攻撃予告中：防御推奨${coolingCount ? ` / CT中スキル ${coolingCount}` : ''}`);
      return;
    }
    if (actor.specialReady) showInfo(`${actor.name}：必殺技準備中。次の通常攻撃が強化されます。`);
    else showInfo(`${actor.name}のターン。${coolingCount ? `CT中スキル ${coolingCount} / ` : ''}スキルはCT管理です。通常攻撃または防御で行動終了`);
  }

  function render() {
    renderEnemy();
    renderParty();
    renderSkills();
    renderCommandState();
    updateDangerState();
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

  function advanceToNextAvailableActor() {
    do { state.actorIndex += 1; } while (state.actorIndex < party.length && !party[state.actorIndex].alive);
    if (state.actorIndex >= party.length) {
      state.phase = 'enemy';
      state.actorTurnKey = null;
      render();
      window.setTimeout(enemyTurn, 420);
      return;
    }

    const actor = getCurrentActor();
    handleActorTurnStart(actor);

    if (actor && hasStun(actor)) {
      appendLog(`${actor.name}はスタンで行動できない！`);
      createPopup(getPartyCardByIndex(party.indexOf(actor)), 'STUN', 'stun');
      tickStatuses(actor);
      clearTemporaryFlags(actor);
      render();
      advanceToNextAvailableActor();
      return;
    }

    render();
  }

  function nextActor() {
    state.skillPanelOpen = false;
    advanceToNextAvailableActor();
  }

  async function playSpecialCutin(actor) {
    if (!ui.specialOverlay) return;
    ui.specialOverlay.innerHTML = `
      <div class="special-flash"></div>
      <div class="special-cutin-card">
        <div class="special-mini">SPECIAL</div>
        <div class="special-name">${actor.name}</div>
        <div class="special-title">${actor.specialLabel || '必殺技'}</div>
      </div>
    `;
    ui.specialOverlay.classList.add('show');
    els.screen.classList.add('special-screen');
    await wait(780);
    ui.specialOverlay.classList.remove('show');
    els.screen.classList.remove('special-screen');
    await wait(120);
  }

  async function normalAttack() {
    const actor = getCurrentActor();
    if (!actor || !actor.alive || state.phase !== 'player' || hasStun(actor)) return;

    const isSpecial = actor.specialReady;
    if (isSpecial) await playSpecialCutin(actor);

    const multiplier = isSpecial ? 2.35 : (actor.tempAttackBoost ? 1.35 : 1.0);
    const { damage, crit } = computeAttack(actor, enemy, multiplier);
    enemy.hp -= damage;
    if (!isSpecial) gainGauge(actor, 20);

    appendLog(`${actor.name}の${isSpecial ? '必殺攻撃' : '通常攻撃'}！ ${enemy.name}に${damage}ダメージ${crit ? '（クリティカル）' : ''}。`);
    render();
    createPopup(getEnemyVisualElement(), damage, isSpecial ? 'special-hit' : (crit ? 'critical' : 'normal'));
    flashHit(getEnemyVisualElement(), 'hit-enemy');

    actor.specialReady = false;
    clearTemporaryFlags(actor);
    tickStatuses(actor);

    if (checkBattleEnd()) return;
    nextActor();
  }

  function useSkill(skillIndex) {
    const actor = getCurrentActor();
    if (!actor || !actor.alive || state.phase !== 'player' || hasStun(actor)) return;
    const skill = actor.skills[skillIndex];
    if (!skill || skill.currentCooldown > 0) return;

    if (skill.type === 'damage') {
      const { damage, crit } = computeAttack(actor, enemy, skill.power || 1.0);
      enemy.hp -= damage;
      appendLog(`${actor.name}のスキル「${skill.name}」！ ${skill.description}。 ${enemy.name}に${damage}ダメージ${crit ? '（クリティカル）' : ''}。`);
      render();
      createPopup(getEnemyVisualElement(), damage, crit ? 'critical' : 'skill');
      flashHit(getEnemyVisualElement(), 'hit-enemy');

      // サンプル状態異常付与
      if (skill.name === 'ライトアロー') {
        applyDownStatus(enemy, 'atkDown', 15, 2, skill.name);
        render();
      }
      if (skill.name === 'サンダーフォール') {
        applyDownStatus(enemy, 'defDown', 15, 2, skill.name);
        render();
      }

      if (skill.selfHeal) {
        actor.hp = clamp(actor.hp + skill.selfHeal, 0, actor.maxHp);
        appendLog(`${actor.name}は${skill.selfHeal}回復した。`);
        render();
        createPopup(getPartyCardByIndex(party.indexOf(actor)), `+${skill.selfHeal}`, 'heal');
      }
    }

    if (skill.type === 'heal') {
      const target = lowestHpMember();
      if (target) {
        target.hp = clamp(target.hp + skill.heal, 0, target.maxHp);
        appendLog(`${actor.name}のスキル「${skill.name}」！ ${skill.description}。 ${target.name}のHPが${skill.heal}回復。`);
        render();
        createPopup(getPartyCardByIndex(party.indexOf(target)), `+${skill.heal}`, 'heal');
      }
    }

    if (skill.type === 'buff') {
      if (skill.effect === 'atkUp') actor.tempAttackBoost = true;
      if (skill.effect === 'guardUp') actor.tempGuardBoost = true;
      appendLog(`${actor.name}のスキル「${skill.name}」！ ${skill.description}。`);
      render();
      createPopup(getPartyCardByIndex(party.indexOf(actor)), 'UP', 'buff');
    }

    startSkillCooldown(skill);
    gainGauge(actor, skill.gaugeGain || 0);
    render();
    if (checkBattleEnd()) return;
  }

  function defend() {
    const actor = getCurrentActor();
    if (!actor || !actor.alive || state.phase !== 'player' || hasStun(actor)) return;
    actor.guarding = true;
    gainGauge(actor, 10);
    appendLog(`${actor.name}は防御した！ このターンのDEFが5倍になった。`);
    render();
    createPopup(getPartyCardByIndex(party.indexOf(actor)), 'GUARD', 'guard');
    tickStatuses(actor);
    nextActor();
  }

  async function armSpecial() {
    const actor = getCurrentActor();
    if (!actor || !actor.alive || state.phase !== 'player' || hasStun(actor)) return;
    if (actor.gauge < 100 || actor.specialReady) return;
    actor.specialReady = true;
    actor.gauge = 0;
    appendLog(`${actor.name}は必殺技を発動準備！ 次の通常攻撃が変化する。`);
    render();
    createPopup(getPartyCardByIndex(party.indexOf(actor)), '必殺', 'special');
    await playSpecialCutin(actor);
    render();
  }

  function enemyTurn() {
    if (state.phase !== 'enemy' || state.result) return;

    if (hasStun(enemy)) {
      appendLog(`${enemy.name}はスタンで行動できない！`);
      createPopup(getEnemyVisualElement(), 'STUN', 'stun');
      tickStatuses(enemy);
      state.turn += 1;
      state.phase = 'player';
      state.actorIndex = party.findIndex(member => member.alive);
      state.actorTurnKey = null;
      rollNextEnemyIntent();
      handleActorTurnStart(getCurrentActor());
      render();
      return;
    }

    const intent = enemy.nextIntent;
    const target = randomAliveMember();
    if (!target) {
      endBattle('defeat');
      return;
    }
    const index = party.indexOf(target);
    const { damage, guarded } = computeEnemyDamage(target, intent);
    if (intent === '危険攻撃') appendLog('⚠ 危険攻撃発動！');

    target.hp = clamp(target.hp - damage, 0, target.maxHp);
    gainGauge(target, 10);
    appendLog(`${enemy.name}の${intent}！ ${target.name}に${damage}ダメージ${guarded ? '（防御軽減）' : ''}。`);
    render();
    createPopup(getPartyCardByIndex(index), damage, guarded ? 'guard-damage' : (intent === '危険攻撃' ? 'critical' : 'damage'));
    flashHit(getPartyCardByIndex(index), 'hit-ally');

    // 敵攻撃に状態異常を付与（サンプル）
    if (intent === '強撃') {
      applyDownStatus(target, 'defDown', 15, 2, `${enemy.name}の強撃`);
      render();
    }
    if (intent === '危険攻撃') {
      applyStun(target, 1, `${enemy.name}の危険攻撃`);
      render();
    }
    if (intent === '通常攻撃') {
      applyDownStatus(target, 'atkDown', 15, 2, `${enemy.name}の通常攻撃`);
      render();
    }

    if (target.hp <= 0) {
      target.alive = false;
      appendLog(`${target.name}は戦闘不能になった。`);
      render();
    }

    party.forEach(member => {
      member.guarding = false;
      member.tempGuardBoost = false;
    });
    enemy.guarding = false;
    enemy.tempGuardBoost = false;

    tickStatuses(enemy);

    if (checkBattleEnd()) return;
    state.turn += 1;
    state.phase = 'player';
    state.actorIndex = party.findIndex(member => member.alive);
    state.actorTurnKey = null;
    rollNextEnemyIntent();
    if (state.actorIndex === -1) {
      endBattle('defeat');
      return;
    }
    handleActorTurnStart(getCurrentActor());
    render();
    if (getCurrentActor() && hasStun(getCurrentActor())) {
      advanceToNextAvailableActor();
    }
  }

  function endBattle(result) {
    state.result = result;
    state.phase = 'result';
    render();
    ui.resultPanel.style.display = 'block';
    ui.resultPanel.innerHTML = `
      <div class="result-title">${result === 'victory' ? 'VICTORY' : 'DEFEAT'}</div>
      <div class="result-text">${result === 'victory' ? '敵を倒しました。ストーリーへ戻れます。' : '全滅しました。再挑戦またはストーリーへ戻れます。'}</div>
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

  function retryBattle() { window.location.reload(); }

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
      <div id="battle-special-overlay" class="battle-special-overlay"></div>
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
    rollNextEnemyIntent();
    bindEvents();
    handleActorTurnStart(getCurrentActor());
    appendLog('戦闘開始！ スキルはCT管理です。将来的なCT変更は skill.cooldown を編集すれば対応できます。');
    render();
  }

  boot();
})();
