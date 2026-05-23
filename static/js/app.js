const state = {
  studies: [],
  currentStudyId: null,
  activeStepId: null,
  studyPage: 'details',
  route: 'workspace',
};

const byId = (id) => document.getElementById(id);
const studyPatchTimers = new Map();
const stepPatchTimers = new Map();
const studyPages = ['details', 'media', 'steps', 'issues'];

function currentStudy() {
  return state.studies.find((s) => s.id === state.currentStudyId) || null;
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
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

function showRoute(route) {
  state.route = route;
  byId('workspaceRoute').classList.toggle('hidden', route !== 'workspace');
  byId('dashboardRoute').classList.toggle('hidden', route !== 'dashboard');
  document.querySelectorAll('.nav-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.route === route));
}

function setStudyPage(page) {
  if (!studyPages.includes(page)) return;
  state.studyPage = page;
  const shell = byId('studySlideShell');
  if (shell) shell.dataset.activePage = page;
  document.querySelectorAll('.study-page-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.studyPageTarget === page);
  });
  const nextBtn = byId('studyNextBtn');
  if (nextBtn) nextBtn.textContent = page === studyPages.at(-1) ? 'Submit' : 'Next';
}

function nextStudyPage() {
  const index = studyPages.indexOf(state.studyPage);
  if (index === studyPages.length - 1) {
    publishSummary();
    return;
  }
  setStudyPage(studyPages[index + 1] || studyPages[0]);
}

function setSelectClass(select) {
  if (!select) return;
  select.classList.remove('select-todo', 'select-doing', 'select-done');
  select.classList.add(`select-${select.value}`);
}

async function loadStudies() {
  state.studies = await api('/api/studies');
  if (!state.currentStudyId && state.studies.length) state.currentStudyId = state.studies[0].id;
  if (state.currentStudyId && !state.studies.some((s) => s.id === state.currentStudyId)) state.currentStudyId = state.studies[0]?.id || null;
  const study = currentStudy();
  state.activeStepId = study?.process_steps?.[0]?.id || null;
  renderAll();
}

function mergeStudy(updatedStudy, rerender = true) {
  const index = state.studies.findIndex((s) => s.id === updatedStudy.id);
  if (index >= 0) state.studies[index] = updatedStudy;
  else state.studies.unshift(updatedStudy);
  state.currentStudyId = updatedStudy.id;
  if (!updatedStudy.process_steps?.some((s) => s.id === state.activeStepId)) state.activeStepId = updatedStudy.process_steps?.[0]?.id || null;
  if (rerender) renderAll();
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
        <small>${escapeHtml(study.owner || 'No owner')} · ${escapeHtml(study.line || '-')} · ${escapeHtml(study.status)}</small><br>
        <small>${study.process_steps.length} steps · ${study.issues.length} issues</small>
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
  byId('studyDurationInline').value = study.duration_minutes || 2;
  byId('studyIntervalInline').value = study.snapshot_interval || 15;
  byId('studyFramesInline').value = study.frames_target || 0;
  byId('studySamplingRuleInline').value = study.sampling_rule || 'systematic';
  renderVideo(study);
  renderIssues(study);
  renderProcessWorkspace(study);
}

function renderVideo(study) {
  const frame = byId('mainVideoFrame');
  const meta = byId('videoMeta');
  const uploadLabel = byId('uploadBtnLabel');
  if (!study.video_url) {
    frame.innerHTML = '<div class="empty-state">Upload a video to begin.</div>';
    meta.textContent = 'No video uploaded.';
    uploadLabel.style.pointerEvents = 'auto';
    uploadLabel.style.opacity = '1';
    return;
  }
  frame.innerHTML = `<video controls preload="metadata" id="mainStudyVideo" src="${study.video_url}"></video>`;
  meta.textContent = `${study.video_filename || 'video'} · duration ${formatSeconds(study.video_duration)} · saved in study folder`;
  uploadLabel.style.pointerEvents = 'none';
  uploadLabel.style.opacity = '.55';
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
        <button class="btn btn-danger icon" onclick="window.removeIssue('${issue.id}')">🗑</button>
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
          <select class="select-${issue.status}" onchange="window.updateIssue('${issue.id}', 'status', this.value); setSelectClass(this)">
            <option value="todo" ${issue.status === 'todo' ? 'selected' : ''}>To do</option>
            <option value="doing" ${issue.status === 'doing' ? 'selected' : ''}>Doing</option>
            <option value="done" ${issue.status === 'done' ? 'selected' : ''}>Done</option>
          </select>
        </label>
      </div>
    </div>`).join('');
  mount.querySelectorAll('select').forEach(setSelectClass);
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
        <button class="btn" onclick="window.navigateStep(-1)">◀</button>
        <button class="btn" onclick="window.renameStepPrompt()">Rename</button>
        <button class="btn" onclick="window.navigateStep(1)">▶</button>
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
  clip.innerHTML = `
    ${step.clip_url ? `<div class="step-preview-player"><video controls src="${step.clip_url}"></video></div>` : '<div class="empty-state tall">No step clip available yet.</div>'}
    <div class="meta-line"><strong id="clipTitleText">${escapeHtml(step.title)}</strong><br><span id="clipIntervalText">${formatSeconds(step.start_seconds)} - ${formatSeconds(step.end_seconds)}</span> · Clip length ${formatSeconds((step.end_seconds || 0) - (step.start_seconds || 0))}</div>
    <div class="clip-actions"></div>`;
}

function renderProcessWorkspace(study) {
  const status = byId('stepStatus');
  if (!study.process_steps.length) {
    status.textContent = study.video_url ? 'No process steps yet. Click Build Steps From Video.' : 'No process steps generated yet.';
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

function scheduleStudyPatch(studyId, field, value) {
  const key = `${studyId}:${field}`;
  clearTimeout(studyPatchTimers.get(key));
  const timer = setTimeout(async () => {
    try {
      mergeStudy(await api(`/api/studies/${studyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      }));
    } catch (error) {
      console.error(error);
      alert(error.message);
    }
  }, 450);
  studyPatchTimers.set(key, timer);
}

function scheduleStepPatch(studyId, stepId, payload) {
  const key = `${studyId}:${stepId}`;
  const existing = stepPatchTimers.get(key) || { timer: null, data: {} };
  existing.data = { ...existing.data, ...payload };
  clearTimeout(existing.timer);
  existing.timer = setTimeout(async () => {
    const toSend = { ...existing.data };
    existing.data = {};
    try {
      mergeStudy(await api(`/api/studies/${studyId}/steps/${stepId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toSend),
      }));
    } catch (error) {
      console.error(error);
      alert(error.message);
    }
  }, 700);
  stepPatchTimers.set(key, existing);
}

function mutateActiveStep(mutator) {
  const study = currentStudy();
  if (!study) return null;
  const step = study.process_steps.find((item) => item.id === state.activeStepId);
  if (!step) return null;
  mutator(step, study);
  renderStepList(study, step.id);
  const headingName = byId('activeStepNameHeading');
  const headingTitle = byId('activeStepTitleHeading');
  const clipTitle = byId('clipTitleText');
  const clipInterval = byId('clipIntervalText');
  const intervalBadge = byId('stepIntervalBadge');
  const timingBadge = byId('stepTimingBadge');
  const timingInput = byId('stepTimingInput');
  if (headingName) headingName.textContent = step.name;
  if (headingTitle) headingTitle.textContent = step.title;
  if (clipTitle) clipTitle.textContent = step.title;
  if (clipInterval) clipInterval.textContent = `${formatSeconds(step.start_seconds)} - ${formatSeconds(step.end_seconds)}`;
  if (intervalBadge) intervalBadge.textContent = `Interval ${formatSeconds(step.start_seconds)} - ${formatSeconds(step.end_seconds)}`;
  if (timingBadge) timingBadge.textContent = `${step.timing_ms} ms`;
  if (timingInput) timingInput.value = `${step.timing_ms} ms`;
  return { study, step };
}

window.localStepInput = (field, value) => {
  const result = mutateActiveStep((step) => {
    step[field] = value;
  });
  if (!result) return;
  scheduleStepPatch(result.study.id, result.step.id, { [field]: value });
};

window.localStepNumberInput = (field, value) => {
  const num = Number(value || 0);
  const result = mutateActiveStep((step) => {
    step[field] = num;
    const start = Number(step.start_seconds || 0);
    const end = Number(step.end_seconds || start);
    step.timing_ms = Math.max(100, Math.round((end - start) * 1000));
  });
  if (!result) return;
  scheduleStepPatch(result.study.id, result.step.id, { [field]: num });
};

window.selectClassification = (value) => {
  const result = mutateActiveStep((step) => {
    step.classification = value;
  });
  if (!result) return;
  renderEditor(result.study, result.step);
  scheduleStepPatch(result.study.id, result.step.id, { classification: value });
};

function bindStudyInputs() {
  const map = {
    studyTitleInline: 'title', studyOwnerInline: 'owner', studyLineInline: 'line', studyAreaInline: 'area',
    studyGoalInline: 'goal', studyDurationInline: 'duration_minutes', studyIntervalInline: 'snapshot_interval',
    studyFramesInline: 'frames_target', studySamplingRuleInline: 'sampling_rule',
  };
  Object.entries(map).forEach(([id, field]) => {
    const el = byId(id);
    const eventName = (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') ? 'input' : 'change';
    el.addEventListener(eventName, () => {
      const study = currentStudy();
      if (!study) return;
      let value = el.value;
      if (['duration_minutes', 'snapshot_interval', 'frames_target'].includes(field)) value = Number(value || 0);
      study[field] = value;
      scheduleStudyPatch(study.id, field, value);
    });
  });
}

async function createStudy(event) {
  event.preventDefault();
  const payload = {
    title: byId('newTitle').value,
    owner: byId('newOwner').value,
    line: byId('newLine').value,
    area: byId('newArea').value,
    goal: byId('newGoal').value,
    duration_minutes: Number(byId('newDuration').value || 2),
    snapshot_interval: Number(byId('newInterval').value || 15),
    frames_target: Number(byId('newFrames').value || 0),
    sampling_rule: 'systematic',
    status: 'draft',
  };
  try {
    mergeStudy(await api('/api/studies', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }));
    byId('studyDialog').close();
    byId('studyForm').reset();
    showRoute('workspace');
  } catch (error) {
    alert(error.message);
  }
}

async function uploadVideo(file) {
  const study = currentStudy();
  if (!study || !file) return;
  const body = new FormData();
  body.append('video', file);
  const label = byId('uploadBtnLabel');
  const previous = label.textContent;
  label.textContent = 'Uploading...';
  label.style.pointerEvents = 'none';
  try {
    mergeStudy(await api(`/api/studies/${study.id}/video`, { method: 'POST', body }));
  } catch (error) {
    alert(error.message);
  } finally {
    label.textContent = previous;
  }
}

async function buildSteps() {
  const study = currentStudy();
  if (!study) return;
  const btn = byId('buildStepsBtn');
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Building clips...';
  try {
    mergeStudy(await api(`/api/studies/${study.id}/build_steps`, { method: 'POST' }));
    state.activeStepId = currentStudy()?.process_steps?.[0]?.id || null;
    renderAll();
  } catch (error) {
    alert(error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

async function addIssue(event) {
  event.preventDefault();
  const study = currentStudy();
  if (!study) return;
  try {
    mergeStudy(await api(`/api/studies/${study.id}/issues`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: byId('issueTitle').value,
        detail: byId('issueDetail').value,
        priority: byId('issuePriority').value,
        status: byId('issueStatus').value,
      }),
    }));
    byId('issueDialog').close();
    byId('issueForm').reset();
  } catch (error) {
    alert(error.message);
  }
}

async function publishSummary() {
  const study = currentStudy();
  if (!study) return;
  try {
    const data = await api(`/api/studies/${study.id}/publish`, { method: 'POST' });
    mergeStudy(data.study, false);
    const body = byId('publishBody');
    body.innerHTML = `
      <div class="summary-header">
        <div><strong>${escapeHtml(data.study.title)}</strong></div>
        <div class="publish-meta"><span class="publish-chip">Status: ${escapeHtml(data.study.status)}</span><span class="publish-chip">Published: ${escapeHtml(data.study.published_at || '')}</span></div>
      </div>
      <ul>${data.summary.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
    byId('publishDialog').showModal();
    renderAll();
  } catch (error) {
    alert(error.message);
  }
}

window.updateIssue = async (issueId, field, value) => {
  const study = currentStudy();
  if (!study) return;
  mergeStudy(await api(`/api/studies/${study.id}/issues/${issueId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: value }),
  }));
};

window.removeIssue = async (issueId) => {
  const study = currentStudy();
  if (!study) return;
  mergeStudy(await api(`/api/studies/${study.id}/issues/${issueId}`, { method: 'DELETE' }));
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

window.focusTiming = () => byId('stepStartInput')?.focus();

window.renameStepPrompt = () => {
  const study = currentStudy();
  const step = activeStep(study);
  if (!step) return;
  const title = prompt('Enter a new step title:', step.title);
  if (title === null) return;
  byId('stepTitleInput').value = title;
  window.localStepInput('title', title);
};

window.deleteActiveStep = async () => {
  const study = currentStudy();
  const step = activeStep(study);
  if (!study || !step) return;
  if (!confirm('Delete this process step and its saved clip?')) return;
  mergeStudy(await api(`/api/studies/${study.id}/steps/${step.id}`, { method: 'DELETE' }));
};

window.openMainVideo = () => {
  const study = currentStudy();
  const step = activeStep(study);
  const video = byId('mainStudyVideo');
  if (!video || !step) return;
  video.scrollIntoView({ behavior: 'smooth', block: 'center' });
  video.currentTime = Number(step.start_seconds || 0);
  video.play().catch(() => {});
};

window.playClip = () => {
  const clipVideo = byId('clipPanel').querySelector('video');
  if (clipVideo) clipVideo.play().catch(() => {});
};

window.openStudy = (studyId) => {
  state.currentStudyId = studyId;
  const study = currentStudy();
  state.activeStepId = study?.process_steps?.[0]?.id || null;
  setStudyPage('details');
  showRoute('workspace');
  renderAll();
};

window.deleteStudy = async (studyId) => {
  if (!confirm('Delete this study and its saved files?')) return;
  await api(`/api/studies/${studyId}`, { method: 'DELETE' });
  await loadStudies();
};

async function addManualStep() {
  const study = currentStudy();
  if (!study) return;
  const last = study.process_steps.at(-1);
  const interval = Number(study.snapshot_interval || 15);
  const payload = {
    name: `Step ${study.process_steps.length + 1}`,
    title: `Observed action ${study.process_steps.length + 1}`,
    start_seconds: last ? Number(last.end_seconds || 0) : 0,
    end_seconds: last ? Number(last.end_seconds || 0) + interval : interval,
    classification: 'non-value-add',
  };
  try {
    const updated = await api(`/api/studies/${study.id}/steps`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    mergeStudy(updated);
    state.activeStepId = currentStudy()?.process_steps?.at(-1)?.id || null;
    renderAll();
  } catch (error) {
    alert(error.message);
  }
}

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
  byId('sidebarToggle').addEventListener('click', () => {
    byId('appShell').classList.toggle('sidebar-collapsed');
  });
  byId('brandLogoButton').addEventListener('click', () => {
    byId('appShell').classList.remove('sidebar-collapsed');
  });
  document.querySelectorAll('.nav-btn').forEach((btn) => btn.addEventListener('click', () => showRoute(btn.dataset.route)));
}

function initActions() {
  document.querySelectorAll('.study-page-tab').forEach((btn) => {
    btn.addEventListener('click', () => setStudyPage(btn.dataset.studyPageTarget));
  });
  byId('studyNextBtn').addEventListener('click', nextStudyPage);
  byId('videoInput').addEventListener('change', (e) => uploadVideo(e.target.files[0]));
  byId('deleteVideoBtn').addEventListener('click', async () => {
    const study = currentStudy();
    if (!study?.video_url) return;
    if (!confirm('Delete the current study video and all generated clips?')) return;
    try {
      mergeStudy(await api(`/api/studies/${study.id}/video`, { method: 'DELETE' }));
    } catch (error) {
      alert(error.message);
    }
  });
  byId('buildStepsBtn').addEventListener('click', buildSteps);
  byId('addStepBtn').addEventListener('click', addManualStep);
  byId('publishBtnInline').addEventListener('click', publishSummary);
}

window.addEventListener('DOMContentLoaded', async () => {
  initSidebar();
  initDialogs();
  initActions();
  bindStudyInputs();
  showRoute('workspace');
  setStudyPage('details');
  await loadStudies();
});
