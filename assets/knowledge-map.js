window.FEKnowledgeMap = (() => {
  'use strict';

  const KNOWLEDGE_THRESHOLDS = {
    weakMastery: 40,
    masteredMastery: 80,
    masteredAttempts: 3,
    masteredConsecutiveCorrect: 2,
    recentWindow: 3,
    recentIncorrect: 2,
    prerequisiteMastery: 35
  };

  const REVIEW_INTERVALS = [1, 3, 7, 14, 30];
  const STATUS_META = {
    locked: {label: '前提未達', marker: 'LOCK'},
    unlearned: {label: '未学習', marker: '未'},
    learning: {label: '学習中', marker: '学'},
    review: {label: '要復習', marker: '復'},
    weak: {label: '苦手', marker: '苦'},
    mastered: {label: '習得済み', marker: '済'}
  };

  const normalize = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const localDate = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };
  const diffDays = (from, to = localDate()) => {
    if (!from) return 0;
    const a = new Date(`${from}T12:00:00`);
    const b = new Date(`${to}T12:00:00`);
    return Math.round((b - a) / 86400000);
  };
  const safeArray = value => Array.isArray(value) ? value : [];
  const uniqueBy = (items, getKey) => {
    const seen = new Set();
    return items.filter(item => {
      const key = getKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const compactText = (text, limit = 96) => {
    const value = String(text || '').trim();
    if (!value) return '';
    const end = value.search(/[。．.!?]/);
    const sentence = end >= 0 ? value.slice(0, end + 1) : value;
    return sentence.length > limit ? `${sentence.slice(0, limit - 1)}...` : sentence;
  };
  const splitRelated = value => String(value || '').split(/[\/、,，]/).map(item => item.trim()).filter(Boolean);

  function hashString(value) {
    const text = String(value || '');
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    return Math.abs(hash).toString(36);
  }

  function stableId(prefix, value) {
    const ascii = String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return `${prefix}-${ascii || hashString(value)}`;
  }

  function uniqueId(base, used) {
    let id = base;
    let index = 2;
    while (used.has(id)) id = `${base}-${index++}`;
    used.add(id);
    return id;
  }

  function buildCompleteMapData(data, appTerms = []) {
    const now = (data && data.generatedAt) || new Date().toISOString();
    const subjects = safeArray(data && data.subjects).map(subject => Object.assign({}, subject));
    const categories = safeArray(data && data.categories).map(category => Object.assign({}, category));
    const terms = safeArray(data && data.terms).map(term => Object.assign({}, term));
    const relations = safeArray(data && data.relations).map(relation => Object.assign({}, relation));
    const questionTerms = safeArray(data && data.questionTerms).map(link => Object.assign({}, link));
    const settings = Object.assign({}, data && data.settings);
    const usedSubjectIds = new Set(subjects.map(subject => subject.id));
    const usedCategoryIds = new Set(categories.map(category => category.id));
    const usedTermIds = new Set(terms.map(term => term.id));
    const usedRelationIds = new Set(relations.map(relation => relation.id));
    const relationKeys = new Set(relations.map(relation => `${relation.sourceTermId}|${relation.targetTermId}|${relation.relationType}`));
    const subjectByName = new Map();
    const categoryByKey = new Map();
    const termPrimaryByName = new Map();
    const termByName = new Map();
    const appTermByName = new Map();

    subjects.forEach(subject => subjectByName.set(normalize(subject.name), subject));
    categories.forEach(category => categoryByKey.set(`${category.subjectId}|${category.parentCategoryId || ''}|${normalize(category.name)}`, category));
    terms.forEach(term => {
      const primaryKey = normalize(term.name);
      if (primaryKey && !termPrimaryByName.has(primaryKey)) termPrimaryByName.set(primaryKey, term);
      [term.name, ...safeArray(term.aliases)].forEach(name => {
        const key = normalize(name);
        if (key && !termByName.has(key)) termByName.set(key, term);
      });
    });
    safeArray(appTerms).forEach(term => {
      const key = normalize(term && term['用語']);
      if (key && !appTermByName.has(key)) appTermByName.set(key, term);
    });

    function ensureSubject(name) {
      const subjectName = String(name || '未分類').trim();
      const key = normalize(subjectName);
      if (subjectByName.has(key)) return subjectByName.get(key);
      const subject = {
        id: uniqueId(stableId('subj', subjectName), usedSubjectIds),
        name: subjectName,
        description: `${subjectName}の学習分野。`,
        displayOrder: subjects.length + 1,
        createdAt: now,
        updatedAt: now
      };
      subjects.push(subject);
      subjectByName.set(key, subject);
      return subject;
    }

    function ensureCategory(subjectId, parentCategoryId, name, description = '') {
      const categoryName = String(name || '未分類').trim();
      const key = `${subjectId}|${parentCategoryId || ''}|${normalize(categoryName)}`;
      if (categoryByKey.has(key)) return categoryByKey.get(key);
      const category = {
        id: uniqueId(stableId('cat', `${subjectId}-${parentCategoryId || 'root'}-${categoryName}`), usedCategoryIds),
        subjectId,
        parentCategoryId: parentCategoryId || null,
        name: categoryName,
        description: description || `${categoryName}に含まれる用語。`,
        displayOrder: categories.length + 1,
        createdAt: now,
        updatedAt: now
      };
      categories.push(category);
      categoryByKey.set(key, category);
      return category;
    }

    function inferImportance(term) {
      const source = String(term['出典'] || '');
      if (!source) return 4;
      if (source.includes('知識マップ')) return 5;
      if (source.includes('シラバス')) return 3;
      return 4;
    }

    function inferDifficulty(term) {
      const text = `${term['用語'] || ''} ${term['基本解説'] || ''} ${term['試験での着眼点'] || ''}`;
      if (/[計算|公式|アルゴリズム|仮想|暗号|正規化|複雑|性能|制御]/.test(text)) return 4;
      if (String(term['基本解説'] || '').length > 80) return 3;
      return 2;
    }

    safeArray(appTerms).forEach((appTerm, index) => {
      const name = String(appTerm && appTerm['用語'] || '').trim();
      const key = normalize(name);
      if (!key || termPrimaryByName.has(key)) return;

      const subject = ensureSubject(appTerm['系']);
      const majorName = appTerm['大分類'] || subject.name;
      const middleName = appTerm['中分類'] || majorName;
      const minorName = appTerm['小分類'] || middleName;
      const major = ensureCategory(subject.id, null, majorName, `${subject.name} / ${majorName}`);
      const middle = normalize(middleName) === normalize(major.name) ? major : ensureCategory(subject.id, major.id, middleName, `${major.name} / ${middleName}`);
      const leaf = normalize(minorName) === normalize(middle.name) ? middle : ensureCategory(subject.id, middle.id, minorName, `${middle.name} / ${minorName}`);
      const aliases = [appTerm['英語']].filter(Boolean);
      const term = {
        id: uniqueId(stableId('auto', appTerm.id || name), usedTermIds),
        categoryId: leaf.id,
        name,
        reading: '',
        shortDescription: compactText(appTerm['基本解説'] || appTerm['試験での着眼点'] || `${name}に関する用語。`, 92),
        detailedDescription: appTerm['基本解説'] || appTerm['試験での着眼点'] || `${name}に関するFE学習用語。`,
        example: appTerm['試験での着眼点'] || appTerm['関連語'] || `${name}の定義、目的、使われる場面を確認する。`,
        importance: inferImportance(appTerm),
        difficulty: inferDifficulty(appTerm),
        displayOrder: index + 1,
        aliases,
        source: appTerm['出典'] || '用語データ',
        createdAt: now,
        updatedAt: now
      };
      terms.push(term);
      termPrimaryByName.set(key, term);
      [term.name, ...aliases].forEach(alias => {
        const aliasKey = normalize(alias);
        if (aliasKey && !termByName.has(aliasKey)) termByName.set(aliasKey, term);
      });
    });

    terms.forEach(term => {
      const appTerm = appTermByName.get(normalize(term.name));
      if (!appTerm) return;
      splitRelated(appTerm['関連語']).slice(0, 8).forEach(name => {
        const target = termByName.get(normalize(name));
        if (!target || target.id === term.id) return;
        const key = `${term.id}|${target.id}|related`;
        if (relationKeys.has(key)) return;
        relationKeys.add(key);
        relations.push({
          id: uniqueId(stableId('rel', `${term.id}-related-${target.id}`), usedRelationIds),
          sourceTermId: term.id,
          targetTermId: target.id,
          relationType: 'related',
          createdAt: now
        });
      });
    });

    return {subjects, categories, terms, relations, questionTerms, settings};
  }

  function createKnowledgeMapService(data, options = {}) {
    const mapData = buildCompleteMapData(data || {}, safeArray(options.terms));
    const subjects = safeArray(mapData.subjects);
    const categories = safeArray(mapData.categories);
    const terms = safeArray(mapData.terms);
    const relations = safeArray(mapData.relations);
    const questionTerms = safeArray(mapData.questionTerms);
    const thresholds = Object.assign({}, KNOWLEDGE_THRESHOLDS, mapData.settings || {});
    const statusMeta = STATUS_META;

    const subjectById = new Map(subjects.map(subject => [subject.id, subject]));
    const categoryById = new Map(categories.map(category => [category.id, category]));
    const termById = new Map(terms.map(term => [term.id, term]));
    const appTerms = safeArray(options.terms);
    const appTermByName = new Map();

    appTerms.forEach(term => {
      const name = term && term['用語'];
      if (name) appTermByName.set(normalize(name), term);
    });

    const categoryChildren = new Map();
    categories.forEach(category => {
      const parentId = category.parentCategoryId || '';
      if (!categoryChildren.has(parentId)) categoryChildren.set(parentId, []);
      categoryChildren.get(parentId).push(category);
    });
    categoryChildren.forEach(list => list.sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name, 'ja')));

    const termsByCategory = new Map();
    terms.forEach(term => {
      if (!termsByCategory.has(term.categoryId)) termsByCategory.set(term.categoryId, []);
      termsByCategory.get(term.categoryId).push(resolveTerm(term));
    });
    termsByCategory.forEach(list => list.sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name, 'ja')));

    const questionTermsByQuestion = new Map();
    questionTerms.forEach(link => {
      if (!questionTermsByQuestion.has(link.questionId)) questionTermsByQuestion.set(link.questionId, []);
      questionTermsByQuestion.get(link.questionId).push(link);
    });

    function resolveTerm(term) {
      const names = [term.name, ...safeArray(term.aliases)];
      const appTerm = names.map(name => appTermByName.get(normalize(name))).find(Boolean) || null;
      return Object.assign({}, term, {appTerm, appTermId: appTerm ? String(appTerm.id) : null});
    }

    function readState(term) {
      if (!term || !term.appTermId || typeof options.readTermState !== 'function') return {};
      return options.readTermState(term.appTermId) || {};
    }

    function attemptsForTerm(term) {
      if (!term || !term.appTermId || typeof options.attemptsFor !== 'function') return [];
      return safeArray(options.attemptsFor(term.appTermId));
    }

    function reviewDate(state) {
      if (typeof options.reviewDate === 'function') return options.reviewDate(state || {});
      return state && (state.due || state.nextReview || null);
    }

    function daysSince(date) {
      if (typeof options.daysSince === 'function') return options.daysSince(date);
      return date ? Math.max(0, diffDays(date)) : 999;
    }

    function getTerm(termId) {
      const term = termById.get(String(termId));
      return term ? resolveTerm(term) : null;
    }

    const outgoingRelations = new Map();
    const incomingRelations = new Map();
    relations.forEach(relation => {
      if (!outgoingRelations.has(relation.sourceTermId)) outgoingRelations.set(relation.sourceTermId, []);
      if (!incomingRelations.has(relation.targetTermId)) incomingRelations.set(relation.targetTermId, []);
      outgoingRelations.get(relation.sourceTermId).push(relation);
      incomingRelations.get(relation.targetTermId).push(relation);
    });

    function getRelations(termId, type = '') {
      return safeArray(outgoingRelations.get(termId)).filter(relation => !type || relation.relationType === type);
    }

    function getIncomingRelations(termId, type = '') {
      return safeArray(incomingRelations.get(termId)).filter(relation => !type || relation.relationType === type);
    }

    function getConnectedTerms(termId, type = '') {
      const ids = [
        ...getRelations(termId, type).map(relation => relation.targetTermId),
        ...getIncomingRelations(termId, type).map(relation => relation.sourceTermId)
      ];
      return uniqueBy(ids.map(getTerm).filter(Boolean), term => term.id);
    }

    function getPrerequisites(termId) {
      return getRelations(termId, 'prerequisite').map(relation => getTerm(relation.targetTermId)).filter(Boolean);
    }

    function masteryScore(term) {
      const state = readState(term);
      const totalAttempts = Number(state.correct || 0) + Number(state.wrong || 0) + Number(state.knowledgeCorrect || 0) + Number(state.knowledgeWrong || 0);
      if (!totalAttempts && !Number(state.mastery || 0) && !state.learnedAt) return 0;

      const weightedCorrect = Number(state.correct || 0) + Number(state.knowledgeCorrect || 0);
      const weightedWrong = Number(state.wrong || 0) + Number(state.knowledgeWrong || 0);
      const accuracyScore = totalAttempts ? (weightedCorrect / totalAttempts) * 32 : 0;
      const baseMastery = Number(state.mastery || 0) / 5 * 42;
      const attemptScore = Math.min(totalAttempts, 5) * 4;
      const streakScore = Math.min(Number(state.streak || 0), 5) * 4;
      const wrongPenalty = Math.min(weightedWrong * 4, 18);
      const due = reviewDate(state);
      const duePenalty = due && due <= localDate() ? 10 : 0;
      const stalePenalty = state.last && daysSince(state.last) > Math.max(7, Number(state.interval || 3) * 2) ? 8 : 0;
      return Math.round(clamp(baseMastery + accuracyScore + attemptScore + streakScore - wrongPenalty - duePenalty - stalePenalty, 0, 100));
    }

    function recentIncorrectCount(term) {
      return attemptsForTerm(term).slice(-thresholds.recentWindow).filter(attempt => !attempt.correct).length;
    }

    function progressForTerm(termId) {
      const term = typeof termId === 'string' ? getTerm(termId) : termId;
      if (!term) return null;

      const state = readState(term);
      const attempts = attemptsForTerm(term);
      const totalAttempts = Number(state.correct || 0) + Number(state.wrong || 0) + Number(state.knowledgeCorrect || 0) + Number(state.knowledgeWrong || 0);
      const correctAttempts = Number(state.correct || 0) + Number(state.knowledgeCorrect || 0);
      const wrongAttempts = Number(state.wrong || 0) + Number(state.knowledgeWrong || 0);
      const score = masteryScore(term);
      const due = reviewDate(state);
      const prerequisites = getPrerequisites(term.id);
      const unmetPrerequisites = prerequisites.filter(prerequisite => masteryScore(prerequisite) < thresholds.prerequisiteMastery);
      const recentIncorrect = Math.max(recentIncorrectCount(term), Number(state.consecutiveIncorrect || 0));
      let status = 'learning';

      if (unmetPrerequisites.length && !totalAttempts && !Number(state.mastery || 0)) status = 'locked';
      else if (!totalAttempts && !Number(state.mastery || 0)) status = 'unlearned';
      else if (recentIncorrect >= thresholds.recentIncorrect || score < thresholds.weakMastery) status = 'weak';
      else if (due && due <= localDate()) status = 'review';
      else if (score >= thresholds.masteredMastery && totalAttempts >= thresholds.masteredAttempts && Number(state.streak || 0) >= thresholds.masteredConsecutiveCorrect) status = 'mastered';

      return {
        termId: term.id,
        appTermId: term.appTermId,
        status,
        statusLabel: statusMeta[status].label,
        statusMarker: statusMeta[status].marker,
        masteryScore: score,
        totalAttempts,
        correctAttempts,
        wrongAttempts,
        consecutiveCorrect: Number(state.streak || 0),
        consecutiveIncorrect: Math.max(consecutiveIncorrect(attempts), Number(state.consecutiveIncorrect || 0)),
        hintCount: Number(state.hintCount || 0),
        totalResponseTime: Number(state.totalResponseTime || 0),
        lastStudiedAt: state.learnedAt || state.last || null,
        lastAnsweredAt: state.last || null,
        nextReviewAt: due || null,
        unmetPrerequisites
      };
    }

    function consecutiveIncorrect(attempts) {
      let count = 0;
      for (let i = attempts.length - 1; i >= 0; i--) {
        if (attempts[i].correct) break;
        count++;
      }
      return count;
    }

    function weakReasons(termId) {
      const term = getTerm(termId);
      if (!term) return [];
      const progress = progressForTerm(term.id);
      const state = readState(term);
      const reasons = [];
      if (progress.totalAttempts && progress.correctAttempts / progress.totalAttempts < 0.6) reasons.push('正答率が低い');
      if (progress.consecutiveIncorrect >= 2) reasons.push('直近で連続不正解');
      if (progress.masteryScore < thresholds.weakMastery) reasons.push('習熟度が低い');
      if (progress.unmetPrerequisites.length) reasons.push('前提用語の理解不足');
      if (state.last && daysSince(state.last) >= 14) reasons.push('長期間復習していない');
      if (progress.nextReviewAt && progress.nextReviewAt <= localDate()) reasons.push('復習期限を過ぎている');
      safeArray(state.weakReasons).forEach(reason => {
        if (reason && !reasons.includes(reason)) reasons.push(reason);
      });
      return reasons;
    }

    function descendantCategoryIds(categoryId) {
      const ids = [];
      const walk = id => {
        ids.push(id);
        safeArray(categoryChildren.get(id)).forEach(child => walk(child.id));
      };
      walk(categoryId);
      return ids;
    }

    function termsForCategory(categoryId) {
      const categoryIds = new Set(descendantCategoryIds(categoryId));
      return terms.filter(term => categoryIds.has(term.categoryId)).map(resolveTerm);
    }

    function termsForSubject(subjectId) {
      const categoryIds = new Set(categories.filter(category => category.subjectId === subjectId).map(category => category.id));
      return terms.filter(term => categoryIds.has(term.categoryId)).map(resolveTerm);
    }

    function categoryProgress(categoryId) {
      const categoryTerms = termsForCategory(categoryId);
      const weightTotal = categoryTerms.reduce((sum, term) => sum + Math.max(1, Number(term.importance || 1)), 0);
      const scoreTotal = categoryTerms.reduce((sum, term) => sum + masteryScore(term) * Math.max(1, Number(term.importance || 1)), 0);
      const counts = statusCounts(categoryTerms);
      return {
        categoryId,
        termCount: categoryTerms.length,
        masteryScore: weightTotal ? Math.round(scoreTotal / weightTotal) : 0,
        statusCounts: counts
      };
    }

    function subjectProgress(subjectId) {
      const subjectTerms = termsForSubject(subjectId);
      const weightTotal = subjectTerms.reduce((sum, term) => sum + Math.max(1, Number(term.importance || 1)), 0);
      const scoreTotal = subjectTerms.reduce((sum, term) => sum + masteryScore(term) * Math.max(1, Number(term.importance || 1)), 0);
      return {
        subjectId,
        termCount: subjectTerms.length,
        masteryScore: weightTotal ? Math.round(scoreTotal / weightTotal) : 0,
        statusCounts: statusCounts(subjectTerms)
      };
    }

    function statusCounts(list = terms.map(resolveTerm)) {
      const counts = {locked: 0, unlearned: 0, learning: 0, review: 0, weak: 0, mastered: 0};
      list.forEach(term => {
        const progress = progressForTerm(term.id);
        if (progress) counts[progress.status]++;
      });
      return counts;
    }

    function mapSummary() {
      const allTerms = terms.map(resolveTerm);
      const weightTotal = allTerms.reduce((sum, term) => sum + Math.max(1, Number(term.importance || 1)), 0);
      const scoreTotal = allTerms.reduce((sum, term) => sum + masteryScore(term) * Math.max(1, Number(term.importance || 1)), 0);
      return {
        subjectCount: subjects.length,
        categoryCount: categories.length,
        termCount: allTerms.length,
        relationCount: relations.length,
        masteryScore: weightTotal ? Math.round(scoreTotal / weightTotal) : 0,
        statusCounts: statusCounts(allTerms)
      };
    }

    function recommendNext(limit = 3) {
      const weakPrereqIds = new Set();
      terms.map(resolveTerm).forEach(term => {
        const progress = progressForTerm(term.id);
        if (progress.status === 'weak') progress.unmetPrerequisites.forEach(prerequisite => weakPrereqIds.add(prerequisite.id));
      });

      return terms.map(resolveTerm).map(term => {
        const progress = progressForTerm(term.id);
        const importance = Number(term.importance || 1);
        let score = importance * 8;
        let reason = '試験上の重要度が高い用語です';

        if (progress.status === 'review') {
          score += 120;
          reason = '本日までが復習予定日です';
        } else if (weakPrereqIds.has(term.id)) {
          score += 105;
          reason = '苦手用語の前提知識です';
        } else if (progress.status === 'weak') {
          score += 90;
          reason = '誤答または低い習熟度が残っています';
        } else if (progress.status === 'learning') {
          score += 58;
          reason = '学習中なので定着させやすい状態です';
        } else if (progress.status === 'unlearned') {
          score += 40;
          reason = '前提条件を満たした未学習用語です';
        } else if (progress.status === 'locked') {
          score -= 80;
          reason = '先に前提用語を学ぶ必要があります';
        } else {
          score -= 20;
          reason = '習得済みの確認対象です';
        }

        return {term, progress, score, reason};
      }).sort((a, b) => b.score - a.score || b.term.importance - a.term.importance).slice(0, limit);
    }

    function validateData() {
      const errors = [];
      const seenRelations = new Set();
      const duplicateRelations = relations.filter(relation => {
        const key = `${relation.sourceTermId}|${relation.targetTermId}|${relation.relationType}`;
        const duplicated = seenRelations.has(key);
        seenRelations.add(key);
        return duplicated;
      });
      duplicateRelations.forEach(relation => errors.push(`duplicate relation: ${relation.id}`));
      relations.forEach(relation => {
        if (!termById.has(relation.sourceTermId)) errors.push(`missing source term: ${relation.sourceTermId}`);
        if (!termById.has(relation.targetTermId)) errors.push(`missing target term: ${relation.targetTermId}`);
      });
      questionTerms.forEach(link => {
        if (!termById.has(link.termId)) errors.push(`missing question term: ${link.questionId} -> ${link.termId}`);
        if (!['primary', 'related', 'prerequisite'].includes(link.role)) errors.push(`invalid question term role: ${link.id}`);
        if (!(Number(link.weight) > 0 && Number(link.weight) <= 1)) errors.push(`invalid question term weight: ${link.id}`);
      });
      const cycle = detectPrerequisiteCycle(relations);
      if (cycle.length) errors.push(`prerequisite cycle: ${cycle.join(' -> ')}`);
      return {ok: errors.length === 0, errors};
    }

    function getSubjectTree() {
      return subjects.slice().sort((a, b) => a.displayOrder - b.displayOrder).map(subject => ({
        subject,
        categories: safeArray(categoryChildren.get('')).filter(category => category.subjectId === subject.id)
      }));
    }

    function getCategory(categoryId) {
      return categoryById.get(String(categoryId)) || null;
    }

    function getCategoryPath(categoryId) {
      const path = [];
      let current = getCategory(categoryId);
      while (current) {
        path.unshift(current);
        current = current.parentCategoryId ? getCategory(current.parentCategoryId) : null;
      }
      return path;
    }

    return {
      subjects,
      categories,
      terms: terms.map(resolveTerm),
      relations,
      questionTerms,
      statusMeta,
      getTerm,
      getCategory,
      getCategoryPath,
      getTermsForAppTermId: appTermId => terms.map(resolveTerm).filter(term => String(term.appTermId) === String(appTermId)),
      getQuestionTermLinks: questionId => safeArray(questionTermsByQuestion.get(questionId)).map(link => Object.assign({}, link, {term: getTerm(link.termId)})).filter(link => link.term),
      getRelations,
      getIncomingRelations,
      getConnectedTerms,
      getPrerequisites,
      progressForTerm,
      weakReasons,
      termsForCategory,
      termsForSubject,
      categoryProgress,
      subjectProgress,
      mapSummary,
      recommendNext,
      detectPrerequisiteCycle: () => detectPrerequisiteCycle(relations),
      validateData,
      getSubjectTree,
      getChildCategories: categoryId => safeArray(categoryChildren.get(categoryId || '')),
      getTermsByCategory: categoryId => safeArray(termsByCategory.get(categoryId))
    };
  }

  function detectPrerequisiteCycle(relations) {
    const graph = new Map();
    safeArray(relations).filter(relation => relation.relationType === 'prerequisite').forEach(relation => {
      if (!graph.has(relation.sourceTermId)) graph.set(relation.sourceTermId, []);
      graph.get(relation.sourceTermId).push(relation.targetTermId);
    });

    const visiting = new Set();
    const visited = new Set();
    const stack = [];

    function visit(id) {
      if (visited.has(id)) return [];
      if (visiting.has(id)) {
        const start = stack.indexOf(id);
        return stack.slice(start).concat(id);
      }
      visiting.add(id);
      stack.push(id);
      const next = graph.get(id) || [];
      for (const target of next) {
        const cycle = visit(target);
        if (cycle.length) return cycle;
      }
      stack.pop();
      visiting.delete(id);
      visited.add(id);
      return [];
    }

    for (const id of graph.keys()) {
      const cycle = visit(id);
      if (cycle.length) return cycle;
    }
    return [];
  }

  return {
    KNOWLEDGE_THRESHOLDS,
    REVIEW_INTERVALS,
    STATUS_META,
    createKnowledgeMapService,
    detectPrerequisiteCycle
  };
})();
