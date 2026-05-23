const STORAGE_KEY = 'kaizen-pages-studies-v1';

const state = {
  studies: [],
  currentStudyId: null,
  activeStepId: null,
  studyPage: 'details',
  route: 'workspace',
  videoUrls: new Map(),
};

const byId = (id) => document.getElementById(id);
const studyPages = ['details', 'media', 'steps', 'issues'];

function uid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatSeconds(v) {
  const total = Math.max(0, Math.floor(Number(v || 0)));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function defaultStudy() {
  const id = uid();
  return {
    id,
    title: 'Warehouse floor plan',
    owner: 'Parth',
    line: 'Plant 1',
    area: 'floor 1',
    goal: 'Observe the forklift movements',
    status: 'draft',
    duration_minutes: 1,
    snapshot_interval: 5,
    frames_target: 0,
    sampling_rule: 'systematic',
    video_filename: '',
    video_duration: 20,
    published_at: '',
    created_at: nowIso(),
    updated_at: nowIso(),
    issues: [],
    process_steps: [],
    video_url: '',
  };
}

function saveStudies() {
  const serializable = state.studies.map((study) => ({ ...study, video_url: '' }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
}

function loadLocalStudies() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    state.studies = Array.isArray(saved) && saved.length ? saved : [defaultStudy()];
  } catch {
    state.studies = [defaultStudy()];
  }
  state.currentStudyId = state.studies[0]?.id || null;
}

function currentStudy() {
  return state.studies.find((s) => s.id === state.currentStudyId) || null;
}

function mergeStudy(updatedStudy, rerender = true) {
  updatedStudy.updated_at = nowIso();
  const index = state.studies.findIndex((s) => s.id === updatedStudy.id);
  if (index >= 0) state.studies[index] = updatedStudy;
  else state.studies.unshift(updatedStudy);
  state.currentStudyId = updatedStudy.id;
  if (!updatedStudy.process_steps?.some((s) => s.id === state.activeStepId)) {
    state.activeStepId = updatedStudy.process_steps?.[0]?.id || null;
  }
  saveStudies();
  if (rerender) renderAll();
}

function showRoute(route) {
  state.route = route;
  byId('workspaceRoute').classList.toggle('hidden', route !== 'workspace');
  byId('dashboardRoute').classList.toggle('hidden', route !== 'dashboard');
  document.querySelectorAll('.nav-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.route === route));
}

function setStudyPage(page) {
  if (!studyPages.includes(page)) return;
  state.studyPage = page;
  byId('studySlideShell').dataset.activePage = page;
  document.querySelectorAll('.study-page-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.studyPageTarget === page);
  });
  byId('studyNextBtn').textContent = page === studyPages.at(-1) ? 'Submit' : 'Next';
}

function nextStudyPage() {
  const index = studyPages.indexOf(state.studyPage);
  if (index === studyPages.length - 1) {
    publishSummary();
    return;
  }
  setStudyPage(studyPages[index + 1] || studyPages[0]);
}

function renderAll() {
  renderDashboard();
  renderWorkspace();
  setStudyPage(state.studyPage);
}

function renderDashboard() {
  const mount = byId('studyCards');
  if (!state.studies.length) {
    mount.innerHTML = '<div class="empty-state">No studies yet.</div>';
    return;
  }
  mount.innerHTML = state.studies.map((study) => `
    <div class="study-list-item">
      <div>
        <strong>${escapeHtml(study.title)}</strong><br>
        <small>${escapeHtml(study.owner || 'No owner')} - ${escapeHtml(study.line || '-')} - ${escapeHtml(study.status)}</small><br>
        <small>${study.process_steps.length} steps - ${study.issues.length} issues</small>
      </div>
      <div class="tool-row wrap-end">
        <button class="btn" onclick="window.openStudy('${study.id}')">Open</button>
        <button class="btn btn-danger" onclick="window.deleteStudy('${study.id}')">Delete</button>
      </div>
    </div>`).join('');
}

function renderWorkspace() {
  const study = currentStudy();
  if (!study) return;
  byId('studyTitleInline').value = study.title || '';
  byId('studyOwnerInline').value = study.owner || '';
  byId('studyLineInline').value = study.line || '';
  byId('studyAreaInline').value = study.area || '';
  byId('studyGoalInline').value = study.goal || '';
  byId('studyDurationInline').value = study.duration_minutes || 1;
  byId('studyIntervalInline').value = study.snapshot_interval || 5;
  byId('studyFramesInline').value = study.frames_target || 0;
  byId('studySamplingRuleInline').value = study.sampling_rule || 'systematic';
  renderVideo(study);
  renderIssues(study);
  renderProcessWorkspace(study);
}

function renderVideo(study) {
  const frame = byId('mainVideoFrame');
  const meta = byId('videoMeta');
  const url = state.videoUrls.get(study.id);
  if (!url) {
    frame.innerHTML = '<div class="empty-state">Upload a video to begin. In GitHub Pages mode, video files stay in this browser session.</div>';
    meta.textContent = study.video_filename ? `${study.video_filename} - upload again after refresh to preview video` : 'No video uploaded.';
    byId('uploadBtnLabel').style.pointerEvents = 'auto';
    byId('uploadBtnLabel').style.opacity = '1';
    return;
  }
  frame.innerHTML = `<video controls preload="metadata" id="mainStudyVideo" src="${url}"></video>`;
  meta.textContent = `${study.video_filename || 'video'} - duration ${formatSeconds(study.video_duration)} - browser-only preview`;
  byId('uploadBtnLabel').style.pointerEvents = 'auto';
  byId('uploadBtnLabel').style.opacity = '1';
}

function renderIssues(study) {
  const mount = byId('issueList');
  if (!study.issues.length) {
    mount.innerHTML = '<div class="empty-state">No issues yet.</div>';
    return;
  }
  mount.innerHTML = study.issues.map((issue) => `
    <div class="issue-card">
      <div class="issue-head">
        <div>
          <h4>${escapeHtml(issue.title)}</h4>
          <p>${escapeHtml(issue.detail || '')}</p>
        </div>
        <button class="btn btn-danger icon" onclick="window.removeIssue('${issue.id}')" aria-label="Delete issue">Del</button>
      </div>
      <div class="field-grid two">
        <label><span>Priority</span>
          <select onchange="window.updateIssue('${issue.id}', 'priority', this.value)">
            <option value="high" ${issue.priority === 'high' ? 'selected' : ''}>High</option>
            <option value="medium" ${issue.priority === 'medium' ? 'selected' : ''}>Medium</option>
            <option value="low" ${issue.priority === 'low' ? 'selected' : ''}>Low</option>
          </select>
        </label>
        <label><span>Progress</span>
          <select class="select-${issue.status}" onchange="window.updateIssue('${issue.id}', 'status', this.value)">
            <option value="todo" ${issue.status === 'todo' ? 'selected' : ''}>To do</option>
            <option value="doing" ${issue.status === 'doing' ? 'selected' : ''}>Doing</option>
            <option value="done" ${issue.status === 'done' ? 'selected' : ''}>Done</option>
          </select>
        </label>
      </div>
    </div>`).join('');
}

function activeStep(study) {
  return study.process_steps.find((step) => step.id === state.activeStepId) || study.process_steps[0] || null;
}

function renderStepList(study, selectedId) {
  const list = byId('stepList');
  list.innerHTML = study.process_steps.map((item, index) => `
    <button class="step-card step-card-text ${item.id === selectedId ? 'active' : ''}" onclick="window.selectStep('${item.id}')" type="button">
      <div class="step-body">
        <div class="step-kicker">Step ${index + 1}</div>
        <div class="step-title">${escapeHtml(item.title)}</div>
        <div class="step-time">${formatSeconds(item.start_seconds)} - ${formatSeconds(item.end_seconds)}</div>
        <div class="step-type">${escapeHtml(item.classification)}</div>
      </div>
    </button>`).join('');
}

function renderEditor(study, step) {
  const editor = byId('editorPanel');
  editor.innerHTML = `
    <div class="editor-head">
      <div class="editor-title">
        <div class="step-kicker" id="activeStepNameHeading">${escapeHtml(step.name)}</div>
        <h3 id="activeStepTitleHeading">${escapeHtml(step.title)}</h3>
      </div>
      <div class="tool-row wrap-end">
        <button class="btn" onclick="window.navigateStep(-1)">Previous</button>
        <button class="btn" onclick="window.renameStepPrompt()">Rename</button>
        <button class="btn" onclick="window.navigateStep(1)">Next</button>
      </div>
    </div>
    <div class="class-row">
      ${['value-add', 'non-value-add', 'necessary non-value-add'].map((kind) => `<button class="class-chip ${step.classification === kind ? 'active' : ''}" onclick="window.selectClassification('${kind}')">${kind}</button>`).join('')}
    </div>
    <div class="editor-grid">
      <label><span>Step name</span><input id="stepNameInput" value="${escapeHtml(step.name)}"></label>
      <label><span>Step title</span><input id="stepTitleInput" value="${escapeHtml(step.title)}"></label>
      <label><span>Start (sec)</span><input id="stepStartInput" type="number" step="0.1" value="${step.start_seconds}"></label>
      <label><span>End (sec)</span><input id="stepEndInput" type="number" step="0.1" value="${step.end_seconds}"></label>
    </div>
    <label><span>Materials used in this step</span><input id="stepMaterialsInput" value="${escapeHtml(step.materials || '')}"></label>
    <label><span>Tools used in this step</span><input id="stepToolsInput" value="${escapeHtml(step.tools || '')}"></label>
    <label><span>Step key points</span><textarea id="stepKeyPointsInput">${escapeHtml(step.key_points || '')}</textarea></label>
    <div class="tag-row"><span class="badge" id="stepIntervalBadge">Interval ${formatSeconds(step.start_seconds)} - ${formatSeconds(step.end_seconds)}</span><span class="badge" id="stepTimingBadge">${step.timing_ms} ms</span></div>
    <div class="editor-actions"><button class="btn btn-danger" onclick="window.deleteActiveStep()">Delete Step</button></div>`;

  byId('stepNameInput').addEventListener('input', (e) => window.localStepInput('name', e.target.value));
  byId('stepTitleInput').addEventListener('input', (e) => window.localStepInput('title', e.target.value));
  byId('stepStartInput').addEventListener('input', (e) => window.localStepNumberInput('start_seconds', e.target.value));
  byId('stepEndInput').addEventListener('input', (e) => window.localStepNumberInput('end_seconds', e.target.value));
  byId('stepMaterialsInput').addEventListener('input', (e) => window.localStepInput('materials', e.target.value));
  byId('stepToolsInput').addEventListener('input', (e) => window.localStepInput('tools', e.target.value));
  byId('stepKeyPointsInput').addEventListener('input', (e) => window.localStepInput('key_points', e.target.value));
}

function renderClipPanel(study, step) {
  const clip = byId('clipPanel');
  const url = state.videoUrls.get(study.id);
  clip.innerHTML = `
    <div class="subhead"><h3>Step Clip</h3><p>GitHub Pages mode previews the uploaded video at the selected step time.</p></div>
    ${url ? `<div class="step-preview-player"><video controls src="${url}" onloadedmetadata="this.currentTime=${Number(step.start_seconds || 0)}"></video></div>` : '<div class="empty-state tall">Upload a video in this browser session to preview the step.</div>'}
    <div class="meta-line"><strong>${escapeHtml(step.title)}</strong><br>${formatSeconds(step.start_seconds)} - ${formatSeconds(step.end_seconds)} - Clip length ${formatSeconds((step.end_seconds || 0) - (step.start_seconds || 0))}</div>`;
}

function renderProcessWorkspace(study) {
  const status = byId('stepStatus');
  if (!study.process_steps.length) {
    status.textContent = state.videoUrls.get(study.id) ? 'No process steps yet. Click Build Steps From Video.' : 'No process steps generated yet.';
    byId('stepList').innerHTML = '<div class="empty-state">No steps yet.</div>';
    byId('editorPanel').innerHTML = '<div class="empty-state tall">Build steps from the uploaded video to open the step editor.</div>';
    byId('clipPanel').innerHTML = '<div class="subhead"><h3>Step Clip</h3><p>Large focused preview for the selected process step.</p></div><div class="empty-state tall">No step clip available yet.</div>';
    return;
  }
  const step = activeStep(study);
  state.activeStepId = step.id;
  status.textContent = `${study.process_steps.length} process steps generated.`;
  renderStepList(study, step.id);
  renderEditor(study, step);
  renderClipPanel(study, step);
}

function updateStudyField(field, value) {
  const study = currentStudy();
  if (!study) return;
  study[field] = value;
  mergeStudy(study, false);
  renderDashboard();
}

function bindStudyInputs() {
  const map = {
    studyTitleInline: 'title',
    studyOwnerInline: 'owner',
    studyLineInline: 'line',
    studyAreaInline: 'area',
    studyGoalInline: 'goal',
    studyDurationInline: 'duration_minutes',
    studyIntervalInline: 'snapshot_interval',
    studyFramesInline: 'frames_target',
    studySamplingRuleInline: 'sampling_rule',
  };
  Object.entries(map).forEach(([id, field]) => {
    const el = byId(id);
    const eventName = (el.tagName === 'SELECT') ? 'change' : 'input';
    el.addEventListener(eventName, () => {
      let value = el.value;
      if (['duration_minutes', 'snapshot_interval', 'frames_target'].includes(field)) value = Number(value || 0);
      updateStudyField(field, value);
    });
  });
}

function createStudy(event) {
  event.preventDefault();
  const study = {
    ...defaultStudy(),
    title: byId('newTitle').value || 'Untitled Study',
    owner: byId('newOwner').value,
    line: byId('newLine').value,
    area: byId('newArea').value,
    goal: byId('newGoal').value,
    duration_minutes: Number(byId('newDuration').value || 1),
    snapshot_interval: Number(byId('newInterval').value || 5),
    frames_target: Number(byId('newFrames').value || 0),
  };
  mergeStudy(study);
  byId('studyDialog').close();
  byId('studyForm').reset();
  showRoute('workspace');
}

function readVideoDuration(file, fallbackSeconds) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : fallbackSeconds;
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(fallbackSeconds);
    };
    video.src = url;
  });
}

async function uploadVideo(file) {
  const study = currentStudy();
  if (!study || !file) return;
  if (state.videoUrls.has(study.id)) URL.revokeObjectURL(state.videoUrls.get(study.id));
  const fallback = Number(study.duration_minutes || 1) * 60;
  study.video_duration = await readVideoDuration(file, fallback);
  study.video_filename = file.name;
  state.videoUrls.set(study.id, URL.createObjectURL(file));
  study.process_steps = [];
  study.frames_target = 0;
  state.activeStepId = null;
  mergeStudy(study);
  setStudyPage('media');
}

function buildSteps() {
  const study = currentStudy();
  if (!study) return;
  const interval = Math.max(1, Number(study.snapshot_interval || 5));
  const duration = Math.max(interval, Number(study.video_duration || study.duration_minutes * 60 || 20));
  const steps = [];
  let start = 0;
  let index = 0;
  while (start < duration && index < 50) {
    const end = Math.min(duration, start + interval);
    const id = uid();
    steps.push({
      id,
      sort_order: index,
      name: `Step ${index + 1}`,
      title: `Observed action ${index + 1}`,
      start_seconds: Number(start.toFixed(1)),
      end_seconds: Number(end.toFixed(1)),
      timing_ms: Math.max(100, Math.round((end - start) * 1000)),
      classification: 'non-value-add',
      materials: '',
      tools: '',
      key_points: '',
      notes: '',
    });
    index += 1;
    start = end;
  }
  study.process_steps = steps;
  study.frames_target = steps.length;
  state.activeStepId = steps[0]?.id || null;
  mergeStudy(study);
  setStudyPage('steps');
}

function addManualStep() {
  const study = currentStudy();
  if (!study) return;
  const last = study.process_steps.at(-1);
  const interval = Math.max(1, Number(study.snapshot_interval || 5));
  const start = last ? Number(last.end_seconds || 0) : 0;
  const end = start + interval;
  const id = uid();
  study.process_steps.push({
    id,
    sort_order: study.process_steps.length,
    name: `Step ${study.process_steps.length + 1}`,
    title: `Observed action ${study.process_steps.length + 1}`,
    start_seconds: start,
    end_seconds: end,
    timing_ms: Math.round((end - start) * 1000),
    classification: 'non-value-add',
    materials: '',
    tools: '',
    key_points: '',
    notes: '',
  });
  study.frames_target = study.process_steps.length;
  state.activeStepId = id;
  mergeStudy(study);
}

function addIssue(event) {
  event.preventDefault();
  const study = currentStudy();
  if (!study) return;
  study.issues.push({
    id: uid(),
    title: byId('issueTitle').value || 'New Issue',
    detail: byId('issueDetail').value,
    priority: byId('issuePriority').value,
    status: byId('issueStatus').value,
  });
  mergeStudy(study);
  byId('issueDialog').close();
  byId('issueForm').reset();
}

function studySummary(study) {
  const issueCounts = { todo: 0, doing: 0, done: 0 };
  study.issues.forEach((issue) => {
    issueCounts[issue.status] = (issueCounts[issue.status] || 0) + 1;
  });
  return [
    `${study.title} is currently marked as ${study.status}.`,
    `Sampling uses ${study.sampling_rule || 'systematic'} review over ${study.duration_minutes || 0} minutes with ${study.snapshot_interval || 0} second intervals.`,
    `${study.process_steps.length} process steps are available for detailed editing.`,
    `${issueCounts.todo} open issues, ${issueCounts.doing} in progress issues, and ${issueCounts.done} completed issues are tracked.`,
    `Study owner: ${study.owner || 'Not assigned'}. Line/area: ${study.line || '-'} / ${study.area || '-'}.`,
  ];
}

function publishSummary() {
  const study = currentStudy();
  if (!study) return;
  study.status = 'published';
  study.published_at = nowIso();
  mergeStudy(study, false);
  byId('publishBody').innerHTML = `
    <div class="summary-header">
      <div><strong>${escapeHtml(study.title)}</strong></div>
      <div class="publish-meta"><span class="publish-chip">Status: ${escapeHtml(study.status)}</span><span class="publish-chip">Published: ${escapeHtml(study.published_at)}</span></div>
    </div>
    <ul>${studySummary(study).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  byId('publishDialog').showModal();
  renderAll();
}

function mutateActiveStep(mutator) {
  const study = currentStudy();
  const step = study?.process_steps.find((item) => item.id === state.activeStepId);
  if (!study || !step) return null;
  mutator(step, study);
  mergeStudy(study, false);
  renderProcessWorkspace(study);
  renderDashboard();
  return { study, step };
}

window.localStepInput = (field, value) => mutateActiveStep((step) => { step[field] = value; });

window.localStepNumberInput = (field, value) => mutateActiveStep((step) => {
  step[field] = Number(value || 0);
  step.timing_ms = Math.max(100, Math.round((Number(step.end_seconds || 0) - Number(step.start_seconds || 0)) * 1000));
});

window.selectClassification = (value) => mutateActiveStep((step) => { step.classification = value; });

window.updateIssue = (issueId, field, value) => {
  const study = currentStudy();
  const issue = study?.issues.find((item) => item.id === issueId);
  if (!study || !issue) return;
  issue[field] = value;
  mergeStudy(study);
};

window.removeIssue = (issueId) => {
  const study = currentStudy();
  if (!study) return;
  study.issues = study.issues.filter((issue) => issue.id !== issueId);
  mergeStudy(study);
};

window.selectStep = (stepId) => {
  state.activeStepId = stepId;
  renderProcessWorkspace(currentStudy());
};

window.navigateStep = (delta) => {
  const study = currentStudy();
  if (!study?.process_steps?.length) return;
  const idx = study.process_steps.findIndex((s) => s.id === state.activeStepId);
  const next = Math.max(0, Math.min(study.process_steps.length - 1, idx + delta));
  state.activeStepId = study.process_steps[next].id;
  renderProcessWorkspace(study);
};

window.renameStepPrompt = () => {
  const study = currentStudy();
  const step = activeStep(study);
  if (!step) return;
  const title = prompt('Enter a new step title:', step.title);
  if (title === null) return;
  mutateActiveStep((active) => { active.title = title; });
};

window.deleteActiveStep = () => {
  const study = currentStudy();
  if (!study || !state.activeStepId) return;
  if (!confirm('Delete this process step?')) return;
  study.process_steps = study.process_steps.filter((step) => step.id !== state.activeStepId);
  study.process_steps.forEach((step, index) => { step.sort_order = index; });
  study.frames_target = study.process_steps.length;
  state.activeStepId = study.process_steps[0]?.id || null;
  mergeStudy(study);
};

window.openStudy = (studyId) => {
  state.currentStudyId = studyId;
  state.activeStepId = currentStudy()?.process_steps?.[0]?.id || null;
  setStudyPage('details');
  showRoute('workspace');
  renderAll();
};

window.deleteStudy = (studyId) => {
  if (!confirm('Delete this study from this browser?')) return;
  if (state.videoUrls.has(studyId)) URL.revokeObjectURL(state.videoUrls.get(studyId));
  state.studies = state.studies.filter((study) => study.id !== studyId);
  if (!state.studies.length) state.studies = [defaultStudy()];
  state.currentStudyId = state.studies[0].id;
  state.activeStepId = null;
  saveStudies();
  renderAll();
};

function initDialogs() {
  byId('newStudyBtn').addEventListener('click', () => byId('studyDialog').showModal());
  byId('closeStudyDialog').addEventListener('click', () => byId('studyDialog').close());
  byId('cancelStudyDialog').addEventListener('click', () => byId('studyDialog').close());
  byId('studyForm').addEventListener('submit', createStudy);
  byId('addIssueBtn').addEventListener('click', () => byId('issueDialog').showModal());
  byId('closeIssueDialog').addEventListener('click', () => byId('issueDialog').close());
  byId('cancelIssueDialog').addEventListener('click', () => byId('issueDialog').close());
  byId('issueForm').addEventListener('submit', addIssue);
  byId('closePublishDialog').addEventListener('click', () => byId('publishDialog').close());
}

function initSidebar() {
  byId('sidebarToggle').addEventListener('click', () => byId('appShell').classList.toggle('sidebar-collapsed'));
  byId('brandLogoButton').addEventListener('click', () => byId('appShell').classList.remove('sidebar-collapsed'));
  document.querySelectorAll('.nav-btn').forEach((btn) => btn.addEventListener('click', () => showRoute(btn.dataset.route)));
}

function initActions() {
  document.querySelectorAll('.study-page-tab').forEach((btn) => btn.addEventListener('click', () => setStudyPage(btn.dataset.studyPageTarget)));
  byId('studyNextBtn').addEventListener('click', nextStudyPage);
  byId('videoInput').addEventListener('change', (e) => uploadVideo(e.target.files[0]));
  byId('deleteVideoBtn').addEventListener('click', () => {
    const study = currentStudy();
    if (!study) return;
    if (state.videoUrls.has(study.id)) URL.revokeObjectURL(state.videoUrls.get(study.id));
    state.videoUrls.delete(study.id);
    study.video_filename = '';
    study.video_duration = Number(study.duration_minutes || 1) * 60;
    study.process_steps = [];
    study.frames_target = 0;
    mergeStudy(study);
  });
  byId('buildStepsBtn').addEventListener('click', buildSteps);
  byId('addStepBtn').addEventListener('click', addManualStep);
  byId('publishBtnInline').addEventListener('click', publishSummary);
}

window.addEventListener('DOMContentLoaded', () => {
  loadLocalStudies();
  initSidebar();
  initDialogs();
  initActions();
  bindStudyInputs();
  showRoute('workspace');
  setStudyPage('details');
  renderAll();
});
