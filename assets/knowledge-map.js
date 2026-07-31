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

  function createKnowledgeMapService(data, options = {}) {
    const mapData = data || {};
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

    function getRelations(termId, type = '') {
      return relations.filter(relation => relation.sourceTermId === termId && (!type || relation.relationType === type));
    }

    function getIncomingRelations(termId, type = '') {
      return relations.filter(relation => relation.targetTermId === termId && (!type || relation.relationType === type));
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

    return {
      subjects,
      categories,
      terms: terms.map(resolveTerm),
      relations,
      questionTerms,
      statusMeta,
      getTerm,
      getTermsForAppTermId: appTermId => terms.map(resolveTerm).filter(term => String(term.appTermId) === String(appTermId)),
      getQuestionTermLinks: questionId => safeArray(questionTermsByQuestion.get(questionId)).map(link => Object.assign({}, link, {term: getTerm(link.termId)})).filter(link => link.term),
      getRelations,
      getIncomingRelations,
      getConnectedTerms,
      getPrerequisites,
      progressForTerm,
      weakReasons,
      termsForCategory,
      categoryProgress,
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
