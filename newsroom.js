(function () {
  'use strict';

  const STORAGE_KEY = 'intelHQ-newsroom-v1';
  const TOPICS = ['Orange County', 'Public Safety', 'Weather', 'Aviation', 'Space', 'National Security', 'Politics', 'Markets', 'Other'];
  const STATUS_LABELS = {
    inbox: 'Inbox', researching: 'Researching', drafting: 'Drafting',
    review: 'Review', ready: 'Ready', published: 'Published'
  };
  const CONFIDENCE_LABELS = {
    reported: 'Reported', corroborated: 'Corroborated', verified: 'Verified', developing: 'Developing'
  };
  const PRIORITY_WEIGHT = { urgent: 0, watch: 1, routine: 2 };
  const STATUS_WEIGHT = { ready: 0, review: 1, drafting: 2, researching: 3, inbox: 4, published: 5 };

  let state = loadState();
  let initialized = false;
  let focusTimer = null;
  let discoveryClustersCache = new Map();

  function emptyState() {
    return {
      version: 1,
      stories: [],
      tasks: [],
      candidates: [],
      dismissedCandidateIds: [],
      focus: '',
      reviews: {},
      selectedStoryId: null
    };
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!parsed || !Array.isArray(parsed.stories) || !Array.isArray(parsed.tasks)) return emptyState();
      return normalizeState(parsed);
    } catch (error) {
      console.warn('[Newsroom] Could not read saved workspace:', error);
      return emptyState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn('[Newsroom] Could not save workspace:', error);
      setText('nr-copy-state', 'Workspace could not be saved. Export a backup before leaving.');
    }
    renderNewsroomMetrics();
  }

  function id() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'nr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function safeId(value) {
    const candidate = String(value || '');
    return /^[A-Za-z0-9-]{1,100}$/.test(candidate) ? candidate : id();
  }

  function normalizeState(incoming) {
    const normalized = Object.assign(emptyState(), incoming, { version: 1 });
    normalized.stories = incoming.stories.map(story => Object.assign({
      title: 'Untitled story', topic: 'Other', priority: 'routine', confidence: 'reported',
      status: 'inbox', source: '', notes: '', createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), research: {}
    }, story, { id: safeId(story && story.id), research: Object.assign({}, story && story.research) }));
    normalized.tasks = incoming.tasks.map(task => Object.assign({
      title: 'Untitled task', due: '', type: 'Reporting', done: false, createdAt: new Date().toISOString()
    }, task, { id: safeId(task && task.id) }));
    normalized.candidates = (Array.isArray(incoming.candidates) ? incoming.candidates : []).map(candidate => Object.assign({
      title: '', url: '', source: 'Unknown source', topic: 'Other', publishedAt: '', discoveredAt: new Date().toISOString()
    }, candidate, { id: safeId(candidate && candidate.id) })).filter(candidate => candidate.title);
    normalized.dismissedCandidateIds = (Array.isArray(incoming.dismissedCandidateIds) ? incoming.dismissedCandidateIds : []).map(safeId);
    normalized.selectedStoryId = normalized.stories.some(story => story.id === incoming.selectedStoryId) ? incoming.selectedStoryId : null;
    return normalized;
  }

  function escapeHTML(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function lines(value) {
    return String(value || '').split('\n').map(item => item.trim()).filter(Boolean);
  }

  function shortDate(value) {
    if (!value) return 'No deadline';
    const date = new Date(value + (value.length === 10 ? 'T12:00:00' : ''));
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function timestamp(value) {
    if (!value) return 'Not updated';
    const date = new Date(value);
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function isoOrEmpty(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  function weekKey() {
    const now = new Date();
    const day = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setHours(12, 0, 0, 0);
    monday.setDate(now.getDate() - day);
    return monday.toISOString().slice(0, 10);
  }

  function getStory(storyId) {
    return state.stories.find(story => story.id === storyId);
  }

  function sourceCount() {
    const sources = new Set();
    state.stories.forEach(story => {
      if (story.source) sources.add(story.source.trim());
      lines(story.research && story.research.sources).forEach(source => sources.add(source));
    });
    return sources.size;
  }

  function sortStories(stories) {
    return [...stories].sort((a, b) => {
      const priority = (PRIORITY_WEIGHT[a.priority] ?? 9) - (PRIORITY_WEIGHT[b.priority] ?? 9);
      if (priority) return priority;
      const status = (STATUS_WEIGHT[a.status] ?? 9) - (STATUS_WEIGHT[b.status] ?? 9);
      if (status) return status;
      return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
    });
  }

  function hashText(value) {
    let hash = 5381;
    const text = String(value || '');
    for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
    return (hash >>> 0).toString(36);
  }

  function titleTokens(title) {
    const stop = new Set(['the','a','an','and','or','to','of','in','on','for','with','at','by','from','is','are','as','after','amid','over','new','says']);
    return [...new Set(String(title || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(token => token.length > 2 && !stop.has(token)))];
  }

  function titleSimilarity(a, b) {
    const one = titleTokens(a);
    const two = titleTokens(b);
    if (!one.length || !two.length) return 0;
    const right = new Set(two);
    const overlap = one.filter(token => right.has(token)).length;
    return overlap / Math.max(3, Math.min(one.length, two.length));
  }

  function candidateScore(cluster) {
    const combined = cluster.items.map(item => item.title).join(' ').toLowerCase();
    const sources = new Set(cluster.items.map(item => item.source)).size;
    const newest = Math.max(...cluster.items.map(item => new Date(item.publishedAt || item.discoveredAt).getTime() || 0));
    const ageHours = Math.max(0, (Date.now() - newest) / 3600000);
    const localTerms = ['orange county','anaheim','santa ana','irvine','huntington beach','newport beach','costa mesa','fullerton','garden grove','laguna','yorba linda','tustin','mission viejo','san clemente','ocfa','ocsd'];
    const urgentTerms = ['breaking','evacuation','evacuate','warning','wildfire','fire','shooting','explosion','earthquake','crash','closure','missing','emergency','tornado','flood','officer involved'];
    let score = 20;
    if (localTerms.some(term => combined.includes(term))) score += 30;
    if (urgentTerms.some(term => combined.includes(term))) score += 22;
    if (ageHours <= 3) score += 18;
    else if (ageHours <= 12) score += 11;
    else if (ageHours <= 24) score += 6;
    score += Math.min(20, Math.max(0, sources - 1) * 8);
    return Math.min(100, score);
  }

  function discoveryClusters() {
    const dismissed = new Set(state.dismissedCandidateIds);
    const candidates = [...state.candidates]
      .filter(candidate => !dismissed.has(candidate.id))
      .sort((a, b) => new Date(b.publishedAt || b.discoveredAt) - new Date(a.publishedAt || a.discoveredAt));
    const clusters = [];
    candidates.forEach(candidate => {
      let cluster = clusters.find(item => titleSimilarity(item.items[0].title, candidate.title) >= .55);
      if (!cluster) {
        cluster = { items: [] };
        clusters.push(cluster);
      }
      cluster.items.push(candidate);
    });
    clusters.forEach(cluster => {
      cluster.key = 'cluster-' + hashText(cluster.items.map(item => item.id).sort().join('|'));
      cluster.sources = [...new Set(cluster.items.map(item => item.source))];
      cluster.topics = [...new Set(cluster.items.map(item => item.topic))];
      cluster.representative = cluster.items[0];
      cluster.score = candidateScore(cluster);
      cluster.trackedStory = state.stories.find(story => Array.isArray(story.discoveryIds) && story.discoveryIds.some(candidateId => cluster.items.some(item => item.id === candidateId))) || null;
    });
    return clusters.sort((a, b) => b.score - a.score || new Date(b.representative.publishedAt || b.representative.discoveredAt) - new Date(a.representative.publishedAt || a.representative.discoveredAt));
  }

  function emptyMessage(title, detail) {
    return '<div class="nr-empty-state"><strong>' + escapeHTML(title) + '</strong><span>' + escapeHTML(detail) + '</span></div>';
  }

  function setText(idName, value) {
    const element = document.getElementById(idName);
    if (element) element.textContent = value;
  }

  function renderNewsroomMetrics() {
    const active = state.stories.filter(story => story.status !== 'published').length;
    const clusters = discoveryClusters();
    const candidates = clusters.filter(cluster => !cluster.trackedStory).length;
    const needsReview = reviewQueueStories().length;
    const verified = state.stories.filter(story => story.confidence === 'verified').length;
    const ready = state.stories.filter(story => story.status === 'ready').length;
    const openTasks = state.tasks.filter(task => !task.done).length;
    setText('nr-kpi-active', active);
    setText('nr-kpi-candidates', candidates);
    setText('nr-kpi-review', needsReview);
    setText('nr-kpi-verified', verified);
    setText('nr-kpi-ready', ready);
    setText('nr-kpi-tasks', openTasks);
    setText('nr-kpi-sources', sourceCount());
    setText('nr-task-count', openTasks + ' open');
  }

  function reviewQueueStories() {
    return sortStories(state.stories.filter(story => {
      if (story.status === 'published') return false;
      if (story.status === 'review') return true;
      if (['ready', 'drafting'].includes(story.status) && !['corroborated', 'verified'].includes(story.confidence)) return true;
      return ['reported', 'developing'].includes(story.confidence) && story.status !== 'inbox';
    }));
  }

  function renderOverview() {
    renderNewsroomMetrics();
    const priorityList = document.getElementById('nr-priority-list');
    const priority = sortStories(state.stories.filter(story => story.status !== 'published')).slice(0, 6);
    if (priorityList) {
      priorityList.innerHTML = priority.length ? priority.map(story => `
        <article class="nr-priority-card" data-priority="${escapeHTML(story.priority)}">
          <div><strong>${escapeHTML(story.title)}</strong><span>${escapeHTML(story.topic)} · ${escapeHTML(STATUS_LABELS[story.status] || story.status)} · ${escapeHTML(CONFIDENCE_LABELS[story.confidence] || story.confidence)}</span></div>
          <button type="button" onclick="openNewsroomResearch('${story.id}')">Open file →</button>
        </article>`).join('') : emptyMessage('Desk is clear', 'Capture a developing story to begin the reporting workflow.');
    }

    const upcomingList = document.getElementById('nr-upcoming-list');
    const upcoming = [...state.tasks].filter(task => !task.done).sort((a, b) => {
      if (!a.due && !b.due) return new Date(b.createdAt) - new Date(a.createdAt);
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due.localeCompare(b.due);
    }).slice(0, 7);
    if (upcomingList) {
      upcomingList.innerHTML = upcoming.length ? upcoming.map(task => `
        <article class="nr-priority-card">
          <div><strong>${escapeHTML(task.title)}</strong><span>${escapeHTML(task.type)} · ${escapeHTML(shortDate(task.due))}</span></div>
          <button type="button" onclick="setNewsroomView('planner')">Review →</button>
        </article>`).join('') : emptyMessage('No open actions', 'Add reporting, verification, publishing, or business tasks in the planner.');
    }
  }

  function renderDiscovery() {
    const list = document.getElementById('nr-discovery-list');
    if (!list) return;
    const clusters = discoveryClusters();
    discoveryClustersCache = new Map(clusters.map(cluster => [cluster.key, cluster]));
    const allSources = new Set(clusters.flatMap(cluster => cluster.sources));
    setText('nr-discovery-total', clusters.length);
    setText('nr-discovery-sources', allSources.size);
    setText('nr-discovery-high', clusters.filter(cluster => cluster.score >= 70 && !cluster.trackedStory).length);
    setText('nr-discovery-tracked', clusters.filter(cluster => cluster.trackedStory).length);
    setText('nr-discovery-status', state.candidates.length ? 'Last intake ' + timestamp(state.candidates[0]?.discoveredAt) : 'Waiting for IntelHQ feeds…');
    const restoreDismissed = document.getElementById('nr-restore-dismissed');
    if (restoreDismissed) restoreDismissed.hidden = !state.dismissedCandidateIds.length;

    const topicSelect = document.getElementById('nr-discovery-topic');
    const selectedTopic = topicSelect?.value || 'all';
    const topics = [...new Set(clusters.flatMap(cluster => cluster.topics))].sort();
    if (topicSelect) {
      topicSelect.innerHTML = '<option value="all">All desks</option>' + topics.map(topic => '<option value="' + escapeHTML(topic) + '">' + escapeHTML(topic) + '</option>').join('');
      topicSelect.value = topics.includes(selectedTopic) ? selectedTopic : 'all';
    }

    const query = (document.getElementById('nr-discovery-search')?.value || '').trim().toLowerCase();
    const topic = topicSelect?.value || 'all';
    const minimum = Number(document.getElementById('nr-discovery-score')?.value || 0);
    const tracking = document.getElementById('nr-discovery-state')?.value || 'untracked';
    const filtered = clusters.filter(cluster => {
      const haystack = cluster.items.map(item => [item.title, item.source, item.topic].join(' ')).join(' ').toLowerCase();
      const trackMatch = tracking === 'all' || (tracking === 'tracked' ? Boolean(cluster.trackedStory) : !cluster.trackedStory);
      return (!query || haystack.includes(query)) && (topic === 'all' || cluster.topics.includes(topic)) && cluster.score >= minimum && trackMatch;
    });

    if (!filtered.length) {
      list.innerHTML = emptyMessage(state.candidates.length ? 'No matching candidates' : 'Scanning live feeds', state.candidates.length ? 'Change the discovery filters or wait for the next feed refresh.' : 'Candidates will appear as IntelHQ finishes loading its existing news feeds.');
      return;
    }

    list.innerHTML = filtered.map(cluster => {
      const item = cluster.representative;
      const scoreBand = cluster.score >= 70 ? 'high' : cluster.score >= 50 ? 'medium' : 'normal';
      const sourceChips = cluster.sources.slice(0, 4).map(source => '<span>' + escapeHTML(source) + '</span>').join('');
      const primaryUrl = item.url && item.url !== '#' ? item.url : '';
      return `
        <article class="nr-discovery-card${cluster.trackedStory ? ' tracked' : ''}" data-score="${scoreBand}">
          <div class="nr-discovery-head">
            <div><div class="nr-story-meta">${escapeHTML(cluster.topics.join(' · '))} · ${cluster.items.length} signal${cluster.items.length === 1 ? '' : 's'} · ${escapeHTML(timestamp(item.publishedAt || item.discoveredAt))}</div><h4>${escapeHTML(item.title)}</h4></div>
            <span class="nr-score" title="Discovery priority score">${cluster.score}</span>
          </div>
          <div class="nr-source-chips">${sourceChips}</div>
          <div class="nr-discovery-actions">
            ${cluster.trackedStory
              ? `<button class="nr-btn nr-btn-primary" type="button" onclick="openNewsroomResearch('${cluster.trackedStory.id}')">Open tracked file</button>`
              : `<button class="nr-btn nr-btn-primary" type="button" onclick="trackNewsroomCandidate('${cluster.key}')">Track story</button>`}
            ${primaryUrl ? `<a class="nr-btn nr-btn-quiet" href="${escapeHTML(primaryUrl)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>` : ''}
            <button class="nr-btn nr-btn-quiet" type="button" onclick="dismissNewsroomCandidate('${cluster.key}')">Dismiss</button>
          </div>
        </article>`;
    }).join('');
  }

  function reviewCompletion(story) {
    const research = story.research || {};
    const checks = [
      sourceLinesForStory(story).length > 0,
      lines(research.known).length > 0,
      ['corroborated', 'verified'].includes(story.confidence),
      Boolean(research.analysis),
      Boolean(story.title && story.title.length > 12)
    ];
    return { complete: checks.filter(Boolean).length, total: checks.length };
  }

  function renderReviewQueue() {
    const list = document.getElementById('nr-review-queue');
    if (!list) return;
    const stories = reviewQueueStories();
    setText('nr-review-queue-count', stories.length + (stories.length === 1 ? ' story' : ' stories'));
    list.innerHTML = stories.length ? stories.map(story => {
      const progress = reviewCompletion(story);
      const mayApprove = sourceLinesForStory(story).length > 0 && ['corroborated', 'verified'].includes(story.confidence);
      return `
        <article class="nr-story-card" data-priority="${escapeHTML(story.priority)}">
          <div class="nr-story-head">
            <div><div class="nr-story-meta">${escapeHTML(story.topic)} · ${escapeHTML(STATUS_LABELS[story.status] || story.status)}</div><h4>${escapeHTML(story.title)}</h4></div>
            <span class="nr-badge" data-confidence="${escapeHTML(story.confidence)}">${escapeHTML(CONFIDENCE_LABELS[story.confidence] || story.confidence)}</span>
          </div>
          <p class="nr-story-notes">Review readiness: ${progress.complete}/${progress.total} core checks complete. ${sourceLinesForStory(story).length} source${sourceLinesForStory(story).length === 1 ? '' : 's'} logged.</p>
          <div class="nr-story-footer">
            <span class="nr-story-meta">${mayApprove ? 'Eligible to move to Ready' : 'Add evidence or corroboration before approval'}</span>
            <div class="nr-story-actions"><button type="button" onclick="openNewsroomResearch('${story.id}')">Open research</button>${mayApprove ? `<button type="button" onclick="markNewsroomReady('${story.id}')">Mark ready</button>` : ''}</div>
          </div>
        </article>`;
    }).join('') : emptyMessage('Review queue is clear', 'Stories enter this queue when they reach review or need corroboration before publishing.');
  }

  function renderReviewHistory() {
    const list = document.getElementById('nr-review-history');
    if (!list) return;
    const reviews = Object.entries(state.reviews).sort(([a], [b]) => b.localeCompare(a));
    setText('nr-review-history-count', reviews.length + ' saved');
    list.innerHTML = reviews.length ? reviews.map(([key, review]) => `
      <article class="nr-review-card">
        <h4>Week of ${escapeHTML(shortDate(key))}</h4>
        <strong>Wins</strong><p>${escapeHTML(review.wins || '—')}</p>
        <strong>Misses and risks</strong><p>${escapeHTML(review.risks || '—')}</p>
        <strong>Next focus</strong><p>${escapeHTML(review.next || '—')}</p>
      </article>`).join('') : emptyMessage('No previous reviews', 'Save the current weekly review and it will appear here as a dated record.');
  }

  function populateTopicFilter() {
    const select = document.getElementById('nr-topic-filter');
    if (!select) return;
    const selected = select.value || 'all';
    const topics = [...new Set(TOPICS.concat(state.stories.map(story => story.topic).filter(Boolean)))];
    select.innerHTML = '<option value="all">All desks</option>' + topics.map(topic => '<option value="' + escapeHTML(topic) + '">' + escapeHTML(topic) + '</option>').join('');
    select.value = topics.includes(selected) ? selected : 'all';
  }

  function renderStoryQueue() {
    populateTopicFilter();
    const list = document.getElementById('nr-story-list');
    if (!list) return;
    const query = (document.getElementById('nr-story-search')?.value || '').trim().toLowerCase();
    const status = document.getElementById('nr-status-filter')?.value || 'all';
    const topic = document.getElementById('nr-topic-filter')?.value || 'all';
    const stories = sortStories(state.stories.filter(story => {
      const haystack = [story.title, story.topic, story.notes, story.source].join(' ').toLowerCase();
      return (!query || haystack.includes(query)) && (status === 'all' || story.status === status) && (topic === 'all' || story.topic === topic);
    }));
    setText('nr-queue-count', stories.length + (stories.length === 1 ? ' item' : ' items'));
    if (!stories.length) {
      list.innerHTML = emptyMessage(state.stories.length ? 'No matching stories' : 'Your story queue is empty', state.stories.length ? 'Change the filters or search term.' : 'Use Quick Capture to start a developing story.');
      return;
    }
    list.innerHTML = stories.map(story => `
      <article class="nr-story-card" data-priority="${escapeHTML(story.priority)}">
        <div class="nr-story-head">
          <div>
            <div class="nr-story-meta">${escapeHTML(story.topic)} · ${escapeHTML(story.priority.toUpperCase())} · Updated ${escapeHTML(timestamp(story.updatedAt))}</div>
            <h4>${escapeHTML(story.title)}</h4>
          </div>
          <span class="nr-badge" data-confidence="${escapeHTML(story.confidence)}">${escapeHTML(CONFIDENCE_LABELS[story.confidence] || story.confidence)}</span>
        </div>
        ${story.notes ? '<p class="nr-story-notes">' + escapeHTML(story.notes) + '</p>' : ''}
        <div class="nr-story-footer">
          <span class="nr-story-meta">${story.source ? 'Primary source logged' : 'No primary source yet'} · ${sourceLinesForStory(story).length} sources</span>
          <div class="nr-story-actions">
            <select aria-label="Pipeline stage for ${escapeHTML(story.title)}" onchange="updateNewsroomStoryStatus('${story.id}',this.value)">${Object.entries(STATUS_LABELS).map(([value, label]) => '<option value="' + value + '"' + (story.status === value ? ' selected' : '') + '>' + label + '</option>').join('')}</select>
            <button type="button" onclick="openNewsroomResearch('${story.id}')">Research</button>
            <button type="button" onclick="sendStoryToDigest('${story.id}')">Digest</button>
            <button type="button" class="nr-delete" onclick="deleteNewsroomStory('${story.id}')">Delete</button>
          </div>
        </div>
      </article>`).join('');
  }

  function sourceLinesForStory(story) {
    const values = [];
    if (story.source) values.push(story.source.trim());
    lines(story.research && story.research.sources).forEach(value => values.push(value));
    return [...new Set(values.filter(Boolean))];
  }

  function renderDossiers() {
    const list = document.getElementById('nr-dossier-list');
    if (!list) return;
    const stories = sortStories(state.stories);
    list.innerHTML = stories.length ? stories.map(story => `
      <button class="nr-dossier-item${state.selectedStoryId === story.id ? ' active' : ''}" type="button" onclick="selectNewsroomDossier('${story.id}')">
        <strong>${escapeHTML(story.title)}</strong>
        <span>${escapeHTML(story.topic)} · ${escapeHTML(STATUS_LABELS[story.status] || story.status)} · ${sourceLinesForStory(story).length} sources</span>
      </button>`).join('') : emptyMessage('No dossiers yet', 'Capture a story to create its research file automatically.');
    renderDossierEditor();
  }

  function renderDossierEditor() {
    const story = getStory(state.selectedStoryId);
    const empty = document.getElementById('nr-dossier-empty');
    const fields = document.getElementById('nr-dossier-fields');
    if (!empty || !fields) return;
    if (!story) {
      empty.hidden = false;
      fields.hidden = true;
      setText('nr-dossier-heading', 'Select a story');
      setText('nr-dossier-updated', '');
      return;
    }
    const research = story.research || {};
    empty.hidden = true;
    fields.hidden = false;
    setText('nr-dossier-heading', story.title);
    setText('nr-dossier-updated', 'Updated ' + timestamp(story.updatedAt));
    document.getElementById('nr-dossier-id').value = story.id;
    document.getElementById('nr-dossier-title').value = story.title || '';
    document.getElementById('nr-dossier-topic').value = story.topic || 'Other';
    document.getElementById('nr-dossier-priority').value = story.priority || 'routine';
    document.getElementById('nr-dossier-confidence').value = story.confidence || 'reported';
    document.getElementById('nr-dossier-status').value = story.status || 'inbox';
    document.getElementById('nr-dossier-source').value = story.source || '';
    document.getElementById('nr-dossier-thesis').value = research.thesis || '';
    document.getElementById('nr-dossier-known').value = research.known || '';
    document.getElementById('nr-dossier-unknown').value = research.unknown || '';
    document.getElementById('nr-dossier-claims').value = research.claims || '';
    document.getElementById('nr-dossier-sources').value = research.sources || '';
    document.getElementById('nr-dossier-analysis').value = research.analysis || '';
  }

  function renderTasks() {
    const list = document.getElementById('nr-task-list');
    if (!list) return;
    const tasks = [...state.tasks].sort((a, b) => Number(a.done) - Number(b.done) || (a.due || '9999').localeCompare(b.due || '9999') || new Date(b.createdAt) - new Date(a.createdAt));
    setText('nr-task-count', state.tasks.filter(task => !task.done).length + ' open');
    list.innerHTML = tasks.length ? tasks.map(task => `
      <article class="nr-task-row${task.done ? ' done' : ''}">
        <div class="nr-task-main">
          <input type="checkbox" ${task.done ? 'checked' : ''} aria-label="Complete ${escapeHTML(task.title)}" onchange="toggleNewsroomTask('${task.id}')">
          <div><div class="nr-task-title">${escapeHTML(task.title)}</div><small>${escapeHTML(task.type)} · ${escapeHTML(shortDate(task.due))}</small></div>
        </div>
        <button type="button" aria-label="Delete ${escapeHTML(task.title)}" onclick="deleteNewsroomTask('${task.id}')">×</button>
      </article>`).join('') : emptyMessage('No tasks yet', 'Add your next reporting, verification, publishing, or business action.');
  }

  function renderReview() {
    const key = weekKey();
    const review = state.reviews[key] || { wins: '', risks: '', next: '' };
    setText('nr-review-week', 'Week of ' + shortDate(key));
    document.getElementById('nr-review-wins').value = review.wins || '';
    document.getElementById('nr-review-risks').value = review.risks || '';
    document.getElementById('nr-review-next').value = review.next || '';
    renderReviewHistory();
  }

  function renderAll() {
    renderOverview();
    renderDiscovery();
    renderStoryQueue();
    renderDossiers();
    renderReviewQueue();
    renderTasks();
    renderReview();
    const focus = document.getElementById('nr-week-focus');
    if (focus && document.activeElement !== focus) focus.value = state.focus || '';
  }

  function captureStory(event) {
    event.preventDefault();
    const title = document.getElementById('nr-story-title').value.trim();
    if (!title) return;
    const now = new Date().toISOString();
    const story = {
      id: id(),
      title,
      topic: document.getElementById('nr-story-topic').value,
      priority: document.getElementById('nr-story-priority').value,
      confidence: document.getElementById('nr-story-confidence').value,
      status: document.getElementById('nr-story-status').value,
      source: document.getElementById('nr-story-source').value.trim(),
      notes: document.getElementById('nr-story-notes').value.trim(),
      research: { thesis: '', known: '', unknown: '', claims: '', sources: '', analysis: '' },
      createdAt: now,
      updatedAt: now
    };
    state.stories.unshift(story);
    state.selectedStoryId = story.id;
    saveState();
    event.target.reset();
    document.getElementById('nr-story-topic').value = 'Orange County';
    document.getElementById('nr-story-priority').value = 'routine';
    document.getElementById('nr-story-confidence').value = 'reported';
    document.getElementById('nr-story-status').value = 'inbox';
    renderAll();
  }

  function saveDossier(event) {
    event.preventDefault();
    const story = getStory(document.getElementById('nr-dossier-id').value);
    if (!story) return;
    story.title = document.getElementById('nr-dossier-title').value.trim() || story.title;
    story.topic = document.getElementById('nr-dossier-topic').value;
    story.priority = document.getElementById('nr-dossier-priority').value;
    story.confidence = document.getElementById('nr-dossier-confidence').value;
    story.status = document.getElementById('nr-dossier-status').value;
    story.source = document.getElementById('nr-dossier-source').value.trim();
    story.research = {
      thesis: document.getElementById('nr-dossier-thesis').value.trim(),
      known: document.getElementById('nr-dossier-known').value.trim(),
      unknown: document.getElementById('nr-dossier-unknown').value.trim(),
      claims: document.getElementById('nr-dossier-claims').value.trim(),
      sources: document.getElementById('nr-dossier-sources').value.trim(),
      analysis: document.getElementById('nr-dossier-analysis').value.trim()
    };
    story.updatedAt = new Date().toISOString();
    saveState();
    renderAll();
    setText('nr-dossier-updated', 'Saved ' + timestamp(story.updatedAt));
  }

  function addTask(event) {
    event.preventDefault();
    const title = document.getElementById('nr-task-title').value.trim();
    if (!title) return;
    state.tasks.push({
      id: id(), title,
      due: document.getElementById('nr-task-date').value,
      type: document.getElementById('nr-task-type').value,
      done: false,
      createdAt: new Date().toISOString()
    });
    saveState();
    event.target.reset();
    document.getElementById('nr-task-date').value = new Date().toISOString().slice(0, 10);
    renderAll();
  }

  function saveReview(event) {
    event.preventDefault();
    state.reviews[weekKey()] = {
      wins: document.getElementById('nr-review-wins').value.trim(),
      risks: document.getElementById('nr-review-risks').value.trim(),
      next: document.getElementById('nr-review-next').value.trim(),
      updatedAt: new Date().toISOString()
    };
    saveState();
    setText('nr-review-week', 'Saved · Week of ' + shortDate(weekKey()));
    renderReviewHistory();
  }

  function digestStorySection(story, index) {
    const research = story.research || {};
    const known = lines(research.known);
    const unknown = lines(research.unknown);
    const sources = sourceLinesForStory(story);
    const situation = research.thesis || story.notes || 'Reporting file opened; summary pending.';
    const analysis = research.analysis || 'Context and local impact analysis pending.';
    const claims = lines(research.claims);
    const whatToWatch = unknown.length ? unknown : ['Monitor official updates and additional independent confirmation.'];
    return [
      '## ' + (index + 1) + '. ' + story.title,
      '',
      '**Desk:** ' + story.topic + '  ',
      '**Verification:** ' + (CONFIDENCE_LABELS[story.confidence] || story.confidence) + '  ',
      '**Pipeline:** ' + (STATUS_LABELS[story.status] || story.status),
      '',
      '**Situation**',
      situation,
      '',
      '**What we know**',
      ...(known.length ? known.map(item => '- ' + item) : ['- Initial reporting is logged; confirmed-fact notes have not been completed.']),
      '',
      '**What remains unclear**',
      ...(whatToWatch.map(item => '- ' + item)),
      '',
      '**Why it matters**',
      analysis,
      ...(claims.length ? ['', '**Claims under review**', ...claims.map(item => '- ' + item)] : []),
      '',
      '**Sources**',
      ...(sources.length ? sources.map(source => '- ' + source) : ['- Source list pending.']),
      ''
    ].join('\n');
  }

  function selectDigestStories(scope) {
    let stories;
    if (scope === 'ready') stories = state.stories.filter(story => story.status === 'ready');
    else if (scope === 'active') stories = state.stories.filter(story => story.status !== 'published');
    else stories = state.stories.filter(story => ['corroborated', 'verified'].includes(story.confidence));
    return sortStories(stories);
  }

  window.ingestNewsroomCandidates = function (items) {
    if (!Array.isArray(items) || !items.length) return;
    const existing = new Map(state.candidates.map(candidate => [candidate.id, candidate]));
    const now = new Date().toISOString();
    items.forEach(item => {
      const title = String(item.title || '').trim();
      if (title.length < 8) return;
      const url = String(item.url || item.link || '').trim();
      const candidateId = 'candidate-' + hashText(title.toLowerCase() + '|' + url);
      const candidate = {
        id: candidateId,
        title,
        url,
        source: String(item.source || item.src || 'Unknown source').trim(),
        topic: String(item.topic || 'Other').trim(),
        publishedAt: isoOrEmpty(item.publishedAt),
        discoveredAt: now
      };
      if (existing.has(candidateId)) candidate.discoveredAt = existing.get(candidateId).discoveredAt || now;
      existing.set(candidateId, candidate);
    });
    state.candidates = [...existing.values()]
      .sort((a, b) => new Date(b.publishedAt || b.discoveredAt) - new Date(a.publishedAt || a.discoveredAt))
      .slice(0, 300);
    saveState();
    renderDiscovery();
    renderNewsroomMetrics();
  };

  window.trackNewsroomFeedItem = function (item) {
    if (!item || !item.title) return;
    window.ingestNewsroomCandidates([item]);
    const candidateId = 'candidate-' + hashText(String(item.title).trim().toLowerCase() + '|' + String(item.url || item.link || '').trim());
    const cluster = discoveryClusters().find(entry => entry.items.some(candidate => candidate.id === candidateId));
    if (!cluster) return;
    discoveryClustersCache.set(cluster.key, cluster);
    if (cluster.trackedStory) {
      state.selectedStoryId = cluster.trackedStory.id;
      saveState();
      return;
    }
    window.trackNewsroomCandidate(cluster.key);
  };

  window.trackNewsroomCandidate = function (clusterKey) {
    const cluster = discoveryClustersCache.get(clusterKey) || discoveryClusters().find(item => item.key === clusterKey);
    if (!cluster || cluster.trackedStory) return;
    const primary = cluster.representative;
    const now = new Date().toISOString();
    const sourceLines = cluster.items.map(item => [item.source, item.url, item.publishedAt ? timestamp(item.publishedAt) : 'time unavailable'].filter(Boolean).join(' | '));
    const story = {
      id: id(),
      title: primary.title,
      topic: primary.topic || cluster.topics[0] || 'Other',
      priority: cluster.score >= 80 ? 'urgent' : cluster.score >= 55 ? 'watch' : 'routine',
      confidence: cluster.sources.length >= 2 ? 'corroborated' : 'reported',
      status: 'researching',
      source: primary.url || '',
      notes: 'Discovered by IntelHQ from ' + cluster.items.length + ' signal' + (cluster.items.length === 1 ? '' : 's') + ' across ' + cluster.sources.length + ' source' + (cluster.sources.length === 1 ? '' : 's') + '. Discovery score: ' + cluster.score + '/100.',
      research: {
        thesis: '', known: '',
        unknown: 'Confirm the primary facts and identify any conflicting reporting.\nDetermine the Orange County or Southern California relevance.',
        claims: '',
        sources: sourceLines.join('\n'),
        analysis: ''
      },
      discoveryIds: cluster.items.map(item => item.id),
      createdAt: now,
      updatedAt: now
    };
    state.stories.unshift(story);
    state.selectedStoryId = story.id;
    saveState();
    renderAll();
  };

  window.dismissNewsroomCandidate = function (clusterKey) {
    const cluster = discoveryClustersCache.get(clusterKey) || discoveryClusters().find(item => item.key === clusterKey);
    if (!cluster) return;
    state.dismissedCandidateIds = [...new Set(state.dismissedCandidateIds.concat(cluster.items.map(item => item.id)))].slice(-500);
    saveState();
    renderDiscovery();
  };

  window.restoreDismissedNewsroomCandidates = function () {
    state.dismissedCandidateIds = [];
    saveState();
    renderDiscovery();
  };

  window.markNewsroomReady = function (storyId) {
    const story = getStory(storyId);
    if (!story || !sourceLinesForStory(story).length || !['corroborated', 'verified'].includes(story.confidence)) return;
    story.status = 'ready';
    story.updatedAt = new Date().toISOString();
    saveState();
    renderAll();
  };

  window.generateNewsroomDigest = function () {
    const title = document.getElementById('nr-digest-title').value.trim() || 'The Signal — Intelligence Brief';
    const format = document.getElementById('nr-digest-format').value;
    const scope = document.getElementById('nr-digest-scope').value;
    const opening = document.getElementById('nr-digest-opening').value.trim();
    const stories = selectDigestStories(scope);
    const formatLabel = { daily: 'Daily Signal', weekly: 'Weekly Roundup', incident: 'Incident Brief' }[format];
    const generated = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
    const output = [
      '# ' + title,
      '',
      '**' + formatLabel + ' · ' + generated + ' PT**',
      '',
      opening ? opening : 'Here are the developments the OC Scanner desk is monitoring and why they matter.',
      '',
      '## Executive Summary',
      ...(stories.length ? stories.map(story => '- **' + story.title + '** — ' + ((story.research && story.research.thesis) || story.notes || (CONFIDENCE_LABELS[story.confidence] + ' reporting file.'))) : ['- No stories currently match this briefing scope.']),
      '',
      ...(stories.length ? stories.map(digestStorySection) : []),
      '---',
      '*OC Scanner is independent and unaffiliated. Information may change as events develop. In an emergency, call 911.*',
      '*Prepared in IntelHQ. Human review required before publication.*'
    ].join('\n');
    document.getElementById('nr-digest-output').value = output;
    setText('nr-digest-meta', stories.length + (stories.length === 1 ? ' story' : ' stories') + ' · ' + formatLabel);
    setText('nr-copy-state', stories.length ? 'Draft generated from saved research files.' : 'No matching stories. Change the inclusion scope or update the queue.');
  };

  window.copyNewsroomDigest = async function () {
    const output = document.getElementById('nr-digest-output');
    if (!output.value.trim()) window.generateNewsroomDigest();
    try {
      await navigator.clipboard.writeText(output.value);
      setText('nr-copy-state', 'Copied to clipboard.');
    } catch (error) {
      output.focus();
      output.select();
      document.execCommand('copy');
      setText('nr-copy-state', 'Copied to clipboard.');
    }
  };

  window.downloadNewsroomDigest = function () {
    const output = document.getElementById('nr-digest-output');
    if (!output.value.trim()) window.generateNewsroomDigest();
    const blob = new Blob([output.value], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'intelHQ-brief-' + new Date().toISOString().slice(0, 10) + '.md';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setText('nr-copy-state', 'Markdown briefing downloaded.');
  };

  window.setNewsroomView = function (view) {
    const valid = ['overview', 'discovery', 'queue', 'research', 'reviews', 'planner', 'digest'];
    const target = valid.includes(view) ? view : 'overview';
    document.querySelectorAll('.nr-view').forEach(element => element.classList.toggle('active', element.id === 'nr-view-' + target));
    document.querySelectorAll('.nr-tab').forEach(element => element.classList.toggle('active', element.dataset.nrView === target));
    if (target === 'queue') renderStoryQueue();
    if (target === 'discovery') renderDiscovery();
    if (target === 'research') renderDossiers();
    if (target === 'reviews') renderReviewQueue();
    if (target === 'planner') { renderTasks(); renderReview(); }
    if (target === 'overview') renderOverview();
  };

  window.focusNewsroomCapture = function () {
    window.setTimeout(() => document.getElementById('nr-story-title')?.focus(), 0);
  };

  window.openNewsroomResearch = function (storyId) {
    state.selectedStoryId = storyId;
    saveState();
    window.setNewsroomView('research');
    renderDossiers();
  };

  window.selectNewsroomDossier = function (storyId) {
    state.selectedStoryId = storyId;
    saveState();
    renderDossiers();
  };

  window.updateNewsroomStoryStatus = function (storyId, status) {
    const story = getStory(storyId);
    if (!story || !STATUS_LABELS[status]) return;
    story.status = status;
    story.updatedAt = new Date().toISOString();
    saveState();
    renderAll();
  };

  window.deleteNewsroomStory = function (storyId) {
    const story = getStory(storyId);
    if (!story || !window.confirm('Delete this story and its research file?')) return;
    state.stories = state.stories.filter(item => item.id !== storyId);
    if (state.selectedStoryId === storyId) state.selectedStoryId = state.stories[0]?.id || null;
    saveState();
    renderAll();
  };

  window.sendStoryToDigest = function (storyId) {
    const story = getStory(storyId);
    if (!story) return;
    state.selectedStoryId = storyId;
    saveState();
    window.setNewsroomView('digest');
    document.getElementById('nr-digest-scope').value = 'active';
    document.getElementById('nr-digest-opening').value = 'Lead item: ' + story.title;
    window.generateNewsroomDigest();
  };

  window.openSelectedInDigest = function () {
    if (state.selectedStoryId) window.sendStoryToDigest(state.selectedStoryId);
  };

  window.toggleNewsroomTask = function (taskId) {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task) return;
    task.done = !task.done;
    task.completedAt = task.done ? new Date().toISOString() : null;
    saveState();
    renderTasks();
    renderOverview();
  };

  window.deleteNewsroomTask = function (taskId) {
    state.tasks = state.tasks.filter(item => item.id !== taskId);
    saveState();
    renderTasks();
    renderOverview();
  };

  window.exportNewsroomData = function () {
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), product: 'IntelHQ Newsroom', data: state }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'intelHQ-newsroom-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  window.importNewsroomData = function (event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const parsed = JSON.parse(reader.result);
        const incoming = parsed.data || parsed;
        if (!incoming || !Array.isArray(incoming.stories) || !Array.isArray(incoming.tasks)) throw new Error('Invalid IntelHQ backup');
        if (!window.confirm('Replace this device\'s newsroom workspace with the selected backup?')) return;
        state = normalizeState(incoming);
        saveState();
        renderAll();
      } catch (error) {
        window.alert('That file is not a valid IntelHQ newsroom backup.');
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  window.initNewsroom = function () {
    if (initialized) {
      renderAll();
      return;
    }
    initialized = true;
    document.querySelectorAll('.nr-tab').forEach(tab => tab.addEventListener('click', () => window.setNewsroomView(tab.dataset.nrView)));
    document.getElementById('nr-capture-form')?.addEventListener('submit', captureStory);
    document.getElementById('nr-dossier-form')?.addEventListener('submit', saveDossier);
    document.getElementById('nr-task-form')?.addEventListener('submit', addTask);
    document.getElementById('nr-review-form')?.addEventListener('submit', saveReview);
    document.getElementById('nr-story-search')?.addEventListener('input', renderStoryQueue);
    document.getElementById('nr-status-filter')?.addEventListener('change', renderStoryQueue);
    document.getElementById('nr-topic-filter')?.addEventListener('change', renderStoryQueue);
    document.getElementById('nr-discovery-search')?.addEventListener('input', renderDiscovery);
    document.getElementById('nr-discovery-topic')?.addEventListener('change', renderDiscovery);
    document.getElementById('nr-discovery-score')?.addEventListener('change', renderDiscovery);
    document.getElementById('nr-discovery-state')?.addEventListener('change', renderDiscovery);
    document.getElementById('nr-week-focus')?.addEventListener('input', event => {
      state.focus = event.target.value;
      clearTimeout(focusTimer);
      focusTimer = setTimeout(() => {
        saveState();
        setText('nr-focus-saved', 'Saved just now');
      }, 350);
    });
    document.getElementById('nr-task-date').value = new Date().toISOString().slice(0, 10);
    renderAll();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', window.initNewsroom);
  else window.initNewsroom();
})();
