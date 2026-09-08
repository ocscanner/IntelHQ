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
  const CHANNEL_LABELS = { website: 'Public Site', email: 'The Signal', x: 'X / Thread', instagram: 'Instagram' };
  const CHANNEL_STATUS_LABELS = { draft: 'Draft', scheduled: 'Scheduled', published: 'Published', failed: 'Failed', held: 'Held', corrected: 'Corrected' };

  let state = loadState();
  let initialized = false;
  let focusTimer = null;
  let discoveryClustersCache = new Map();
  let currentDigestStoryIds = [];
  let currentDistributionChannel = 'website';

  function emptyState() {
    return {
      version: 2,
      stories: [],
      tasks: [],
      candidates: [],
      dismissedCandidateIds: [],
      focus: '',
      reviews: {},
      selectedStoryId: null,
      briefings: [],
      publicationLog: [],
      selectedBriefingId: null
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
    const normalized = Object.assign(emptyState(), incoming, { version: 2 });
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
    normalized.briefings = (Array.isArray(incoming.briefings) ? incoming.briefings : []).map(briefing => {
      const channels = briefing && briefing.channels ? briefing.channels : {};
      const normalizedChannels = {};
      Object.keys(CHANNEL_LABELS).forEach(channel => {
        normalizedChannels[channel] = Object.assign({ content: '', status: 'draft', scheduleAt: '', url: '', updatedAt: '' }, channels[channel]);
      });
      return Object.assign({ title: 'Untitled briefing', format: 'daily', body: '', storyIds: [], createdAt: new Date().toISOString(), approvedAt: new Date().toISOString() }, briefing, {
        id: safeId(briefing && briefing.id),
        publicationId: String(briefing && briefing.publicationId || '').slice(0, 80),
        storyIds: Array.isArray(briefing && briefing.storyIds) ? briefing.storyIds.map(safeId) : [],
        channels: normalizedChannels
      });
    });
    normalized.publicationLog = (Array.isArray(incoming.publicationLog) ? incoming.publicationLog : []).map(entry => Object.assign({ channel: 'website', action: 'updated', result: 'recorded', timestamp: new Date().toISOString(), url: '', note: '' }, entry, { id: safeId(entry && entry.id), briefingId: safeId(entry && entry.briefingId) })).slice(-1000);
    normalized.selectedBriefingId = normalized.briefings.some(briefing => briefing.id === incoming.selectedBriefingId) ? incoming.selectedBriefingId : normalized.briefings[0]?.id || null;
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

  function fullTimestamp(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function toLocalDateTimeValue(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function safeExternalUrl(value) {
    try {
      const parsed = new URL(String(value || ''));
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
    } catch (error) {
      return '';
    }
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
    setText('nr-kpi-packages', state.briefings.length);
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
    renderDistribution();
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

  function cleanSentence(value) {
    const text = String(value || '').replace(/^[-•]\s*/, '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return /[.!?]["')\]]?$/.test(text) ? text : text + '.';
  }

  function paragraphFromLines(value) {
    return lines(value).map(cleanSentence).filter(Boolean).join(' ');
  }

  function paragraphsFromText(value) {
    return String(value || '').split(/\n\s*\n/).map(cleanSentence).filter(Boolean);
  }

  function frontMatterValue(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ').trim();
  }

  function sourceMarkdown(story) {
    const entries = sourceLinesForStory(story).map(line => {
      const raw = String(line || '').trim();
      const match = raw.match(/https?:\/\/[^\s|]+/i);
      const url = match ? safeExternalUrl(match[0]) : safeExternalUrl(raw);
      let name = raw.split('|')[0].trim();
      if (!name || name === raw || /^https?:\/\//i.test(name)) {
        try { name = new URL(url).hostname.replace(/^www\./, ''); } catch (error) { name = 'Primary source'; }
      }
      return url ? '[' + name.replace(/[\[\]]/g, '') + '](' + url + ')' : name;
    }).filter(Boolean);
    return [...new Set(entries)];
  }

  function storyArticleParagraphs(story) {
    const research = story.research || {};
    const paragraphs = [];
    const thesis = cleanSentence(research.thesis);
    const notes = paragraphsFromText(story.notes);
    const known = paragraphFromLines(research.known);
    const analysis = paragraphsFromText(research.analysis);
    const unknown = paragraphFromLines(research.unknown);

    if (thesis) paragraphs.push(thesis);
    notes.forEach(paragraph => { if (paragraph !== thesis) paragraphs.push(paragraph); });
    if (known && known !== thesis && !notes.includes(known)) paragraphs.push(known);
    analysis.forEach(paragraph => { if (paragraph !== thesis && !notes.includes(paragraph)) paragraphs.push(paragraph); });
    if (unknown) paragraphs.push('As this story develops, several details remain unresolved. ' + unknown);
    if (!paragraphs.length) {
      paragraphs.push('OC Scanner is monitoring ' + cleanSentence(story.title).replace(/^./, char => char.toLowerCase()));
      paragraphs.push('The source is saved in the newsroom Queue, but additional confirmed details are needed before this draft is publication-ready.');
    }
    return paragraphs;
  }

  function hasSubstantiveStoryContent(story) {
    const research = story.research || {};
    return Boolean(String(story.notes || '').trim() || String(research.thesis || '').trim() || lines(research.known).length || String(research.analysis || '').trim());
  }

  function digestStorySection(story) {
    const sources = sourceMarkdown(story);
    const verification = CONFIDENCE_LABELS[story.confidence] || story.confidence;
    return [
      '## ' + story.title,
      '',
      ...storyArticleParagraphs(story).flatMap(paragraph => [paragraph, '']),
      sources.length ? '*Sources: ' + sources.join('; ') + '. Reporting status: ' + verification + '.*' : '*Reporting status: ' + verification + '. Source link pending.*',
      ''
    ].join('\n');
  }

  function articleExcerpt(stories) {
    const lead = stories[0];
    if (!lead) return 'Independent reporting and analysis from the OC Scanner desk.';
    return clipText((lead.research && lead.research.thesis) || lead.notes || lead.title, 165);
  }

  function roundupOpening(stories, formatLabel) {
    if (!stories.length) return '';
    const lead = stories[0];
    const leadContext = cleanSentence((lead.research && lead.research.thesis) || lead.notes || lead.title);
    const remaining = stories.slice(1, 4).map(story => story.title);
    const second = remaining.length ? ' Also in this ' + formatLabel.toLowerCase() + ': ' + remaining.join('; ') + (stories.length > 4 ? '; and additional developments.' : '.') : '';
    return leadContext + second;
  }

  function buildPublishReadyArticle(title, format, opening, stories) {
    const formatLabel = { daily: 'Daily Intelligence Roundup', weekly: 'Weekly News Roundup', incident: 'Incident Report' }[format] || 'Intelligence Digest';
    const selected = format === 'incident' ? stories.slice(0, 1) : stories;
    const finalTitle = format === 'incident' && title === 'The Signal — Intelligence Brief' && selected[0] ? selected[0].title : title;
    const tag = format === 'incident' && selected[0] ? selected[0].topic : 'The Signal';
    const publishedDate = new Date().toISOString().slice(0, 10);
    const displayDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const introduction = cleanSentence(opening) || roundupOpening(selected, formatLabel);
    const watchItems = selected.flatMap(story => lines(story.research && story.research.unknown)).map(cleanSentence).filter(Boolean);
    const closing = watchItems.length
      ? 'OC Scanner will continue watching for ' + watchItems.slice(0, 4).map(item => item.replace(/[.]$/, '').replace(/^./, char => char.toLowerCase())).join('; ') + '.'
      : 'OC Scanner will continue monitoring official updates and independently corroborated reporting as these stories develop.';
    const body = format === 'incident' && selected[0]
      ? [introduction, '', ...storyArticleParagraphs(selected[0]).filter(paragraph => paragraph !== introduction).flatMap(paragraph => [paragraph, '']), sourceMarkdown(selected[0]).length ? '*Sources: ' + sourceMarkdown(selected[0]).join('; ') + '. Reporting status: ' + (CONFIDENCE_LABELS[selected[0].confidence] || selected[0].confidence) + '.*' : '', '', '## What happens next', '', closing]
      : [introduction, '', ...selected.map(digestStorySection), '## What we’re watching next', '', closing];
    return {
      title: finalTitle,
      stories: selected,
      formatLabel,
      markdown: [
        '---',
        'title: "' + frontMatterValue(finalTitle) + '"',
        'date: ' + publishedDate,
        'tag: "' + frontMatterValue(tag) + '"',
        'author: "OC Scanner"',
        'excerpt: "' + frontMatterValue(articleExcerpt(selected)) + '"',
        '---',
        '',
        '# ' + finalTitle,
        '',
        '*' + formatLabel + ' · ' + displayDate + ' · By OC Scanner*',
        '',
        ...body,
        '',
        '---',
        '',
        '*OC Scanner is independent and unaffiliated. Information may change as events develop. In an emergency, call 911.*'
      ].filter((line, index, array) => !(line === '' && array[index - 1] === '')).join('\n')
    };
  }

  function renderInlineMarkdown(value) {
    let text = escapeHTML(value);
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (match, label, url) => {
      const safe = safeExternalUrl(url.replace(/&amp;/g, '&'));
      return safe ? '<a href="' + escapeHTML(safe) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>' : label;
    });
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return text;
  }

  function renderArticlePreview() {
    const container = document.getElementById('nr-digest-formatted');
    const output = document.getElementById('nr-digest-output');
    if (!container || !output) return;
    let markdown = output.value.trim();
    if (!markdown) {
      container.innerHTML = emptyMessage('Your article preview will appear here.', 'Generate from the stories already saved in your Queue.');
      return;
    }
    let meta = {};
    const frontMatter = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    if (frontMatter) {
      frontMatter[1].split('\n').forEach(line => {
        const split = line.indexOf(':');
        if (split > 0) meta[line.slice(0, split).trim()] = line.slice(split + 1).trim().replace(/^"|"$/g, '');
      });
      markdown = markdown.slice(frontMatter[0].length);
    }
    const blocks = markdown.split(/\n\s*\n/).map(block => block.trim()).filter(Boolean);
    const html = blocks.map(block => {
      if (/^#\s+/.test(block)) return '<h1>' + renderInlineMarkdown(block.replace(/^#\s+/, '')) + '</h1>';
      if (/^##\s+/.test(block)) return '<h2>' + renderInlineMarkdown(block.replace(/^##\s+/, '')) + '</h2>';
      if (/^---$/.test(block)) return '<hr>';
      if (/^\*[^*]+\*$/.test(block) && block.includes('· By OC Scanner')) return '<div class="nr-article-byline">' + renderInlineMarkdown(block) + '</div>';
      return '<p>' + renderInlineMarkdown(block.replace(/\n/g, ' ')) + '</p>';
    }).join('');
    const metaLine = [meta.tag, meta.date, meta.author ? 'By ' + meta.author : ''].filter(Boolean).map(escapeHTML).join(' · ');
    container.innerHTML = (metaLine ? '<div class="nr-article-meta">' + metaLine + '</div>' : '') + html;
  }

  function selectDigestStories(scope) {
    let stories;
    if (scope === 'ready') stories = state.stories.filter(story => story.status === 'ready');
    else if (scope === 'active') stories = state.stories.filter(story => story.status !== 'published');
    else stories = state.stories.filter(story => ['corroborated', 'verified'].includes(story.confidence));
    return sortStories(stories);
  }

  function clipText(value, length) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= length) return text;
    return text.slice(0, Math.max(0, length - 1)).trimEnd() + '…';
  }

  function storySummary(story) {
    return clipText((story.research && story.research.thesis) || story.notes || (CONFIDENCE_LABELS[story.confidence] + ' reporting file.'), 220);
  }

  function storySourceUrls(story) {
    const values = sourceLinesForStory(story).map(line => {
      const match = String(line).match(/https?:\/\/[^\s|]+/i);
      return match ? match[0] : safeExternalUrl(line);
    }).filter(Boolean);
    return [...new Set(values)];
  }

  function createPublicationId() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return 'OCS-' + date + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  }

  function buildChannelEditions(title, body, stories, publicationId) {
    const generated = fullTimestamp(new Date().toISOString());
    const sourceUrls = [...new Set(stories.flatMap(storySourceUrls))];
    const verificationLine = stories.map(story => story.title + ': ' + (CONFIDENCE_LABELS[story.confidence] || story.confidence)).join('; ');
    const articleBody = body.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').replace(/^# .+\n+/, '');
    const site = [
      body,
      '',
      '---',
      '**Publication ID:** ' + publicationId,
      '**Published:** Add final publication time',
      '**Verification:** ' + verificationLine,
      '',
      '*Updates and corrections will be logged against this publication ID.*'
    ].join('\n');
    const email = [
      'SUBJECT: ' + title,
      'PREHEADER: ' + clipText(stories.map(storySummary).join(' • '), 140),
      '',
      'THE SIGNAL | OC SCANNER',
      generated,
      '',
      articleBody,
      '',
      'READ / SHARE',
      'Add the canonical public-site URL before sending.',
      '',
      'Publication ID: ' + publicationId
    ].join('\n');
    const xPosts = [
      clipText(title + ' 🧵\n\n' + (stories.length + ' developments the OC Scanner desk is tracking. Sources and verification status follow.'), 275),
      ...stories.map((story, index) => clipText((index + 2) + '/' + (stories.length + 2) + ' ' + story.title + '\n\n' + storySummary(story) + '\n\nStatus: ' + (CONFIDENCE_LABELS[story.confidence] || story.confidence), 275)),
      clipText((stories.length + 2) + '/' + (stories.length + 2) + ' Sources:\n' + (sourceUrls.length ? sourceUrls.slice(0, 4).join('\n') : 'Source links are listed in the full briefing.') + '\n\n' + publicationId, 275)
    ];
    const x = xPosts.map((post, index) => 'POST ' + (index + 1) + '\n' + post).join('\n\n---\n\n');
    const caption = clipText(title + '\n\n' + stories.map(story => '• ' + story.title + ' — ' + storySummary(story)).join('\n\n') + '\n\nVerification: ' + verificationLine + '\n\nFull sourcing and updates: link in bio.\n\n#OCScanner #OrangeCounty #TheSignal', 2100);
    const slides = [
      'SLIDE 1 — COVER\n' + title,
      ...stories.slice(0, 7).map((story, index) => 'SLIDE ' + (index + 2) + ' — ' + story.title.toUpperCase() + '\n' + clipText(storySummary(story), 180) + '\nStatus: ' + (CONFIDENCE_LABELS[story.confidence] || story.confidence)),
      'FINAL SLIDE — WHAT TO WATCH\nFollow @OC_Scanner for updates. Full sources and corrections are linked in the briefing.\n' + publicationId
    ];
    const instagram = ['CAPTION', caption, '', 'CAROUSEL OUTLINE', slides.join('\n\n')].join('\n');

    return {
      website: { content: site, status: 'draft', scheduleAt: '', url: '', updatedAt: new Date().toISOString() },
      email: { content: email, status: 'draft', scheduleAt: '', url: '', updatedAt: new Date().toISOString() },
      x: { content: x, status: 'draft', scheduleAt: '', url: '', updatedAt: new Date().toISOString() },
      instagram: { content: instagram, status: 'draft', scheduleAt: '', url: '', updatedAt: new Date().toISOString() }
    };
  }

  function selectedBriefing() {
    return state.briefings.find(briefing => briefing.id === state.selectedBriefingId) || null;
  }

  function packageStatus(briefing) {
    const statuses = Object.values(briefing.channels || {}).map(channel => channel.status);
    if (statuses.length && statuses.every(status => status === 'published')) return 'published';
    if (statuses.includes('failed')) return 'attention';
    if (statuses.includes('scheduled')) return 'scheduled';
    if (statuses.includes('held')) return 'held';
    if (statuses.includes('corrected')) return 'corrected';
    return 'approved';
  }

  function packageStatusLabel(status) {
    return { approved: 'Approved', scheduled: 'Scheduled', published: 'Published', attention: 'Needs attention', held: 'On hold', corrected: 'Correction logged' }[status] || status;
  }

  function addPublicationEvent(briefing, channel, action, result, note) {
    const channelData = briefing.channels[channel] || {};
    state.publicationLog.push({
      id: id(),
      briefingId: briefing.id,
      publicationId: briefing.publicationId,
      channel,
      action,
      result,
      url: channelData.url || '',
      note: note || '',
      timestamp: new Date().toISOString()
    });
    state.publicationLog = state.publicationLog.slice(-1000);
  }

  function renderPublicationLog() {
    const container = document.getElementById('nr-publication-log');
    if (!container) return;
    const entries = [...state.publicationLog].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    setText('nr-publication-count', entries.length + (entries.length === 1 ? ' event' : ' events'));
    if (!entries.length) {
      container.innerHTML = emptyMessage('No publication activity yet', 'Scheduling, publishing, failures, holds, and corrections will be recorded here.');
      return;
    }
    container.innerHTML = entries.map(entry => {
      const url = safeExternalUrl(entry.url);
      return `<article class="nr-log-row" data-result="${escapeHTML(entry.result)}">
        <span class="nr-log-time">${escapeHTML(fullTimestamp(entry.timestamp))}</span>
        <div><strong>${escapeHTML(CHANNEL_LABELS[entry.channel] || entry.channel)} · ${escapeHTML(entry.action)}</strong><small>${escapeHTML(entry.publicationId || '')}${entry.note ? ' · ' + escapeHTML(entry.note) : ''}</small></div>
        <span class="nr-log-result">${escapeHTML(entry.result)}</span>
        ${url ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">Open ↗</a>` : ''}
      </article>`;
    }).join('');
  }

  function renderDistribution() {
    const list = document.getElementById('nr-package-list');
    if (!list) return;
    const briefings = [...state.briefings].sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt));
    if (!state.selectedBriefingId && briefings.length) state.selectedBriefingId = briefings[0].id;
    setText('nr-package-count', briefings.length + (briefings.length === 1 ? ' package' : ' packages'));
    setText('nr-dist-approved', briefings.length);
    const channels = briefings.flatMap(briefing => Object.values(briefing.channels || {}));
    setText('nr-dist-ready', channels.filter(channel => ['draft', 'corrected'].includes(channel.status)).length);
    setText('nr-dist-scheduled', channels.filter(channel => channel.status === 'scheduled').length);
    setText('nr-dist-published', channels.filter(channel => channel.status === 'published').length);
    setText('nr-dist-attention', channels.filter(channel => ['failed', 'held'].includes(channel.status)).length);

    list.innerHTML = briefings.length ? briefings.map(briefing => {
      const status = packageStatus(briefing);
      return `<button class="nr-package-card${briefing.id === state.selectedBriefingId ? ' active' : ''}" type="button" onclick="selectDistributionPackage('${briefing.id}')">
        <span>${escapeHTML(briefing.publicationId)}</span><strong>${escapeHTML(briefing.title)}</strong><small>${escapeHTML(fullTimestamp(briefing.approvedAt))} · ${briefing.storyIds.length} stor${briefing.storyIds.length === 1 ? 'y' : 'ies'}</small><em data-status="${escapeHTML(status)}">${escapeHTML(packageStatusLabel(status))}</em>
      </button>`;
    }).join('') : emptyMessage('No release packages', 'Generate a ready-only digest, complete the human approval gate, and create your first package.');

    const briefing = selectedBriefing();
    const empty = document.getElementById('nr-distribution-empty');
    const fields = document.getElementById('nr-distribution-fields');
    if (!empty || !fields) return;
    empty.hidden = Boolean(briefing);
    fields.hidden = !briefing;
    if (!briefing) {
      renderPublicationLog();
      return;
    }

    if (!briefing.channels[currentDistributionChannel]) currentDistributionChannel = 'website';
    const channelData = briefing.channels[currentDistributionChannel];
    setText('nr-package-id', briefing.publicationId);
    setText('nr-package-title', briefing.title);
    setText('nr-package-meta', 'Approved ' + fullTimestamp(briefing.approvedAt) + ' · ' + briefing.storyIds.length + ' stories · ' + (briefing.sourceCount || 0) + ' sources');
    const status = packageStatus(briefing);
    const statusElement = document.getElementById('nr-package-status');
    if (statusElement) {
      statusElement.textContent = packageStatusLabel(status);
      statusElement.dataset.status = status;
    }
    document.querySelectorAll('#nr-channel-tabs button').forEach(button => button.classList.toggle('active', button.dataset.channel === currentDistributionChannel));
    Object.entries(briefing.channels).forEach(([channel, data]) => setText('nr-state-' + channel, CHANNEL_STATUS_LABELS[data.status] || data.status));
    document.getElementById('nr-channel-output').value = channelData.content || '';
    document.getElementById('nr-channel-schedule').value = toLocalDateTimeValue(channelData.scheduleAt);
    document.getElementById('nr-channel-url').value = channelData.url || '';
    setText('nr-distribution-state', (CHANNEL_LABELS[currentDistributionChannel] || currentDistributionChannel) + ' · ' + (CHANNEL_STATUS_LABELS[channelData.status] || channelData.status) + ' · Updated ' + fullTimestamp(channelData.updatedAt));
    renderPublicationLog();
  }

  function persistDistributionEditor(showMessage) {
    const briefing = selectedBriefing();
    if (!briefing || !briefing.channels[currentDistributionChannel]) return null;
    const channelData = briefing.channels[currentDistributionChannel];
    channelData.content = document.getElementById('nr-channel-output').value;
    channelData.url = document.getElementById('nr-channel-url').value.trim();
    channelData.updatedAt = new Date().toISOString();
    if (showMessage) setText('nr-distribution-state', 'Edits saved locally at ' + fullTimestamp(channelData.updatedAt) + '.');
    return { briefing, channelData };
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
    const article = buildPublishReadyArticle(title, format, opening, stories);
    currentDigestStoryIds = article.stories.map(story => story.id);
    document.getElementById('nr-digest-output').value = article.markdown;
    if (article.title !== title) document.getElementById('nr-digest-title').value = article.title;
    renderArticlePreview();
    window.setArticlePreviewMode('formatted');
    const wordCount = article.markdown.replace(/^---[\s\S]*?---/, '').trim().split(/\s+/).filter(Boolean).length;
    const thinStories = article.stories.filter(story => !hasSubstantiveStoryContent(story));
    setText('nr-digest-meta', article.stories.length + (article.stories.length === 1 ? ' story' : ' stories') + ' · ' + wordCount + ' words · ' + Math.max(1, Math.ceil(wordCount / 220)) + ' min read');
    setText('nr-copy-state', article.stories.length
      ? thinStories.length
        ? 'Article formatted. ' + thinStories.length + ' stor' + (thinStories.length === 1 ? 'y needs' : 'ies need') + ' more notes or confirmed facts for a complete draft.'
        : 'Publish-ready article generated from your Queue reporting.'
      : 'No matching stories. Change the Queue filter or update story status.');
    const releaseReady = article.stories.length > 0 && article.stories.every(story => story.status === 'ready' && ['corroborated', 'verified'].includes(story.confidence) && sourceLinesForStory(story).length > 0) && !thinStories.length;
    setText('nr-digest-readiness', releaseReady
      ? article.stories.length + ' ready stor' + (article.stories.length === 1 ? 'y' : 'ies') + ' passed the release gate. Review the formatted article, then complete the human confirmation.'
      : article.stories.length
        ? 'Working draft only: each story needs substantive notes or confirmed facts, a source, Ready status, and corroborated or verified reporting.'
        : 'No eligible stories are included. Move a sourced, corroborated or verified story to Ready first.');
    const approval = document.getElementById('nr-digest-approval');
    if (approval) approval.checked = false;
  };

  window.setArticlePreviewMode = function (mode) {
    const formatted = mode !== 'markdown';
    const preview = document.getElementById('nr-digest-formatted');
    const markdown = document.getElementById('nr-digest-output');
    if (!preview || !markdown) return;
    if (formatted) renderArticlePreview();
    preview.hidden = !formatted;
    markdown.hidden = formatted;
    document.getElementById('nr-preview-formatted-button')?.classList.toggle('active', formatted);
    document.getElementById('nr-preview-markdown-button')?.classList.toggle('active', !formatted);
  };

  window.approveNewsroomDigest = function () {
    const output = document.getElementById('nr-digest-output').value.trim();
    const stories = currentDigestStoryIds.map(getStory).filter(Boolean);
    const confirmed = document.getElementById('nr-digest-approval').checked;
    const eligible = stories.length > 0 && stories.every(story => story.status === 'ready' && ['corroborated', 'verified'].includes(story.confidence) && sourceLinesForStory(story).length > 0 && hasSubstantiveStoryContent(story));
    if (!output) {
      setText('nr-copy-state', 'Generate and review a briefing before approval.');
      return;
    }
    if (!eligible) {
      setText('nr-copy-state', 'Approval blocked: use a ready-only briefing with sourced, corroborated or verified stories.');
      return;
    }
    if (!confirmed) {
      setText('nr-copy-state', 'Complete the human approval confirmation before creating a release package.');
      return;
    }
    const now = new Date().toISOString();
    const title = document.getElementById('nr-digest-title').value.trim() || 'The Signal — Intelligence Brief';
    const publicationId = createPublicationId();
    const briefing = {
      id: id(),
      publicationId,
      title,
      format: document.getElementById('nr-digest-format').value,
      body: output,
      storyIds: stories.map(story => story.id),
      sourceCount: new Set(stories.flatMap(sourceLinesForStory)).size,
      createdAt: now,
      approvedAt: now,
      channels: buildChannelEditions(title, output, stories, publicationId)
    };
    state.briefings.unshift(briefing);
    state.selectedBriefingId = briefing.id;
    addPublicationEvent(briefing, 'website', 'package approved', 'recorded', stories.length + ' stories cleared for distribution');
    saveState();
    currentDistributionChannel = 'website';
    document.getElementById('nr-digest-approval').checked = false;
    window.setNewsroomView('distribution');
    renderDistribution();
  };

  window.copyNewsroomDigest = async function () {
    const output = document.getElementById('nr-digest-output');
    if (!output.value.trim()) window.generateNewsroomDigest();
    try {
      await navigator.clipboard.writeText(output.value);
      setText('nr-copy-state', 'Copied to clipboard.');
    } catch (error) {
      window.setArticlePreviewMode('markdown');
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
    const title = document.getElementById('nr-digest-title').value.trim() || 'oc-scanner-story';
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'oc-scanner-story';
    link.download = slug + '.md';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setText('nr-copy-state', 'Public-site Markdown article downloaded. Add it to the PublicSiteTest posts folder to publish.');
  };

  window.selectDistributionPackage = function (briefingId) {
    persistDistributionEditor(false);
    if (!state.briefings.some(briefing => briefing.id === briefingId)) return;
    state.selectedBriefingId = briefingId;
    currentDistributionChannel = 'website';
    saveState();
    renderDistribution();
  };

  window.selectDistributionChannel = function (channel) {
    if (!CHANNEL_LABELS[channel]) return;
    persistDistributionEditor(false);
    currentDistributionChannel = channel;
    saveState();
    renderDistribution();
  };

  window.saveDistributionDraft = function () {
    const saved = persistDistributionEditor(true);
    if (!saved) return;
    if (['failed', 'held'].includes(saved.channelData.status)) saved.channelData.status = 'draft';
    addPublicationEvent(saved.briefing, currentDistributionChannel, 'draft updated', 'recorded', 'Final edits saved');
    saveState();
    renderDistribution();
  };

  window.copyDistributionDraft = async function () {
    const saved = persistDistributionEditor(false);
    if (!saved) return;
    try {
      await navigator.clipboard.writeText(saved.channelData.content);
    } catch (error) {
      const output = document.getElementById('nr-channel-output');
      output.focus();
      output.select();
      document.execCommand('copy');
    }
    setText('nr-distribution-state', (CHANNEL_LABELS[currentDistributionChannel] || currentDistributionChannel) + ' edition copied.');
    saveState();
  };

  window.downloadDistributionDraft = function () {
    const saved = persistDistributionEditor(false);
    if (!saved) return;
    const extension = currentDistributionChannel === 'website' ? 'md' : 'txt';
    const filename = saved.briefing.publicationId.toLowerCase() + '-' + currentDistributionChannel + '.' + extension;
    const blob = new Blob([saved.channelData.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setText('nr-distribution-state', filename + ' downloaded.');
    saveState();
  };

  window.scheduleDistributionChannel = function () {
    const saved = persistDistributionEditor(false);
    if (!saved) return;
    const value = document.getElementById('nr-channel-schedule').value;
    const scheduled = value ? new Date(value) : null;
    if (!scheduled || Number.isNaN(scheduled.getTime())) {
      setText('nr-distribution-state', 'Choose a valid schedule date and time first.');
      return;
    }
    saved.channelData.scheduleAt = scheduled.toISOString();
    saved.channelData.status = 'scheduled';
    saved.channelData.updatedAt = new Date().toISOString();
    addPublicationEvent(saved.briefing, currentDistributionChannel, 'scheduled', 'success', fullTimestamp(saved.channelData.scheduleAt));
    saveState();
    renderAll();
  };

  window.recordDistributionPublished = function () {
    const saved = persistDistributionEditor(false);
    if (!saved) return;
    saved.channelData.status = 'published';
    saved.channelData.publishedAt = new Date().toISOString();
    saved.channelData.updatedAt = saved.channelData.publishedAt;
    addPublicationEvent(saved.briefing, currentDistributionChannel, 'published', 'success', saved.channelData.url ? 'Canonical URL recorded' : 'Published manually; URL pending');
    const allPublished = Object.values(saved.briefing.channels).every(channel => channel.status === 'published');
    if (allPublished) {
      saved.briefing.storyIds.forEach(storyId => {
        const story = getStory(storyId);
        if (story) {
          story.status = 'published';
          story.updatedAt = new Date().toISOString();
        }
      });
    }
    saveState();
    renderAll();
  };

  window.recordDistributionFailure = function () {
    const saved = persistDistributionEditor(false);
    if (!saved || saved.channelData.status === 'published') {
      setText('nr-distribution-state', 'A published channel is preserved. Record a correction instead of replacing its result.');
      return;
    }
    saved.channelData.status = 'failed';
    saved.channelData.updatedAt = new Date().toISOString();
    addPublicationEvent(saved.briefing, currentDistributionChannel, 'publish attempt', 'failed', 'Retry only this channel; successful channels remain unchanged');
    saveState();
    renderAll();
  };

  window.holdDistributionChannel = function () {
    const saved = persistDistributionEditor(false);
    if (!saved || saved.channelData.status === 'published') {
      setText('nr-distribution-state', 'Published records cannot be put on hold. Use a correction or update.');
      return;
    }
    saved.channelData.status = 'held';
    saved.channelData.updatedAt = new Date().toISOString();
    addPublicationEvent(saved.briefing, currentDistributionChannel, 'held', 'recorded', 'Operator paused release');
    saveState();
    renderAll();
  };

  window.logDistributionCorrection = function () {
    const saved = persistDistributionEditor(false);
    const note = document.getElementById('nr-correction-note').value.trim();
    if (!saved || !note) {
      setText('nr-distribution-state', 'Describe the correction or update before logging it.');
      return;
    }
    const correctionTime = fullTimestamp(new Date().toISOString());
    saved.channelData.content = saved.channelData.content.trimEnd() + '\n\nCORRECTION / UPDATE — ' + correctionTime + '\n' + note;
    saved.channelData.status = 'corrected';
    saved.channelData.updatedAt = new Date().toISOString();
    addPublicationEvent(saved.briefing, currentDistributionChannel, 'correction logged', 'recorded', note);
    document.getElementById('nr-correction-note').value = '';
    saveState();
    renderAll();
  };

  window.setNewsroomView = function (view) {
    const valid = ['overview', 'discovery', 'queue', 'research', 'reviews', 'planner', 'digest', 'distribution'];
    const target = valid.includes(view) ? view : 'overview';
    document.querySelectorAll('.nr-view').forEach(element => element.classList.toggle('active', element.id === 'nr-view-' + target));
    document.querySelectorAll('.nr-tab').forEach(element => element.classList.toggle('active', element.dataset.nrView === target));
    if (target === 'queue') renderStoryQueue();
    if (target === 'discovery') renderDiscovery();
    if (target === 'research') renderDossiers();
    if (target === 'reviews') renderReviewQueue();
    if (target === 'planner') { renderTasks(); renderReview(); }
    if (target === 'digest') renderArticlePreview();
    if (target === 'distribution') renderDistribution();
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
    document.getElementById('nr-digest-output')?.addEventListener('input', renderArticlePreview);
    document.querySelectorAll('#nr-channel-tabs button').forEach(button => button.addEventListener('click', () => window.selectDistributionChannel(button.dataset.channel)));
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
