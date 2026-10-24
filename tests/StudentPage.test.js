const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');

function loadBrowserPage(elements, runner) {
  const source = fs.readFileSync(path.join(projectRoot, 'JavaScript.html'), 'utf8')
    .replace(/^\s*<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
  const context = vm.createContext({
    module: { exports: {} },
    document: {
      addEventListener: function () {},
      getElementById: function (id) {
        return elements[id];
      },
      createElement: function (tagName) {
        return makeNode(tagName);
      }
    },
    window: { confirm: function () { return true; } },
    google: { script: { run: runner } },
    console: { warn: function () {} }
  });
  vm.runInContext(source, context);
  return context.module.exports;
}

function makeNode(tagName) {
  return {
    tagName: tagName,
    textContent: '',
    className: '',
    children: [],
    attributes: {},
    dataset: {},
    disabled: false,
    hidden: false,
    value: '',
    listenerRegistrations: Object.create(null),
    classList: {
      add: function () {},
      remove: function () {},
      toggle: function () {}
    },
    appendChild: function (child) { this.children.push(child); },
    setAttribute: function (name, value) { this.attributes[name] = value; },
    removeAttribute: function (name) { delete this.attributes[name]; },
    addEventListener: function (name, handler) {
      this.handlers[name] = handler;
      this.listenerRegistrations[name] = (this.listenerRegistrations[name] || 0) + 1;
    },
    focus: function () {},
    handlers: Object.create(null)
  };
}

function makeRunner() {
  const request = {};
  const runner = {
    withSuccessHandler: function (handler) { request.success = handler; return runner; },
    withFailureHandler: function (handler) { request.failure = handler; return runner; },
    searchStudents: function (query) { request.query = query; }
  };
  return { runner: runner, request: request };
}

function loadPageInitializer() {
  const elements = Object.create(null);
  const requests = Object.create(null);
  let pendingHandlers = {};
  const runner = {
    withSuccessHandler: function (handler) {
      pendingHandlers.success = handler;
      return runner;
    },
    withFailureHandler: function (handler) {
      pendingHandlers.failure = handler;
      return runner;
    },
    getSpreadsheetDiagnostic: function () { saveRequest('diagnostic'); },
    getDashboardSummary: function () { saveRequest('summary'); },
    getAchievementAccess: function () { saveRequest('achievementAccess'); },
    retryAchievementSocialMediaTask: function (achievementId) {
      saveRequest('retry', achievementId);
    },
    getSocialMediaTaskBoard: function () { saveRequest('taskBoard'); }
  };

  function saveRequest(name, argument) {
    requests[name] = Object.assign({ argument: argument }, pendingHandlers);
    pendingHandlers = {};
  }

  function getElement(id) {
    if (!elements[id]) {
      elements[id] = makeNode(id);
    }
    return elements[id];
  }

  const browser = vm.createContext({
    module: { exports: {} },
    document: {
      addEventListener: function () {},
      getElementById: function (id) {
        return getElement(id);
      },
      querySelectorAll: function () { return []; },
      querySelector: function () {
        if (!elements.breadcrumb) {
          elements.breadcrumb = makeNode('nav');
        }
        return elements.breadcrumb;
      },
      createTextNode: function (text) { return { textContent: text }; },
      createElement: function (tagName) { return makeNode(tagName); }
    },
    window: { location: { hash: '#overview' } },
    google: { script: { run: runner } },
    console: { warn: function () {} }
  });
  const source = fs.readFileSync(path.join(projectRoot, 'JavaScript.html'), 'utf8')
    .replace(/^\s*<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
  vm.runInContext(source, browser);
  return {
    elements: elements,
    getElement: getElement,
    requests: requests,
    initialize: browser.module.exports.initializeAchievementPages
  };
}

test('student history deletion reports success and failure for authorized entries', function () {
  const container = makeNode('container');
  const viewButton = makeNode('button');
  let handlers = {};
  const requests = [];
  const runner = {
    withSuccessHandler: function (handler) { handlers.success = handler; return runner; },
    withFailureHandler: function (handler) { handlers.failure = handler; return runner; },
    getStudentAchievementHistory: function (studentId) {
      requests.push({ type: 'history', studentId: studentId, handlers: handlers });
      handlers = {};
    },
    deleteAchievement: function (achievementId) {
      requests.push({ type: 'delete', achievementId: achievementId, handlers: handlers });
      handlers = {};
    }
  };
  const exports = loadBrowserPage({}, runner);
  exports.renderStudentHistory(container, 'STU-001', viewButton);
  requests[0].handlers.success([{
    achievementId: 'ACH-OWN',
    title: 'My achievement',
    canDelete: true
  }]);
  const card = container.children[0].children[1];
  const deleteButton = card.children[1];
  deleteButton.handlers.click();
  assert.equal(requests[1].type, 'delete');
  assert.equal(requests[1].achievementId, 'ACH-OWN');
  requests[1].handlers.success({ deleted: true });
  assert.match(card.textContent, /Achievement deleted/);

  const failedContainer = makeNode('container');
  exports.renderStudentHistory(failedContainer, 'STU-001', viewButton);
  requests[2].handlers.success([{
    achievementId: 'ACH-OWN',
    title: 'My achievement',
    canDelete: true
  }]);
  const failedCard = failedContainer.children[0].children[1];
  const failedButton = failedCard.children[1];
  failedButton.handlers.click();
  requests[3].handlers.failure({ message: 'Deletion was denied.' });
  assert.equal(failedButton.disabled, false);
  assert.match(failedCard.children[2].textContent, /Deletion was denied/);
});

test('routes all workspace fragments to existing page containers', function () {
  const exports = loadBrowserPage({}, makeRunner().runner);
  const html = fs.readFileSync(path.join(projectRoot, 'Index.html'), 'utf8');
  [
    ['#overview', 'overview'],
    ['#students', 'students'],
    ['#achievements', 'submit'],
    ['#reviews', 'reviews'],
    ['#social-media', 'social-media'],
    ['#activity-log', 'activity-log']
  ].forEach(function (route) {
    assert.equal(exports.pageForHash(route[0]), route[1]);
    assert.match(html, new RegExp('id="' + route[1] + '-page"'));
  });
  assert.match(html, /href="#students" data-page="students"/);
});

test('initializes the student-directory search form handler', function () {
  const form = makeNode('form');
  const exports = loadBrowserPage({ 'student-directory-search-form': form }, makeRunner().runner);
  exports.initializeStudentsPage();
  assert.equal(typeof form.handlers.submit, 'function');
});

test('initializes page events with the retry handler available and without duplicate listeners', function () {
  const page = loadPageInitializer();
  assert.doesNotThrow(function () { page.initialize(); });
  page.initialize();

  const retryButton = page.getElement('retry-achievement-task');
  assert.equal(typeof retryButton.handlers.click, 'function');
  assert.equal(retryButton.listenerRegistrations.click, 1);
  assert.equal(page.getElement('student-directory-search-form').listenerRegistrations.submit, 1);
});

test('retry button reports successful and failed task retries', function () {
  const successfulPage = loadPageInitializer();
  successfulPage.initialize();
  const successButton = successfulPage.getElement('retry-achievement-task');
  const successMessage = successfulPage.getElement('submission-message');
  successButton.dataset.achievementId = 'ACH-RETRY';
  successButton.handlers.click();

  assert.equal(successButton.disabled, true);
  assert.equal(successfulPage.requests.retry.argument, 'ACH-RETRY');
  successfulPage.requests.retry.success({ taskId: 'SMT-RETRY', status: 'Incoming' });
  assert.equal(successButton.disabled, false);
  assert.equal(successButton.hidden, true);
  assert.match(successMessage.textContent, /SMT-RETRY.*Incoming.*ACH-RETRY/);
  assert.ok(successfulPage.requests.taskBoard);

  const failedPage = loadPageInitializer();
  failedPage.initialize();
  const failedButton = failedPage.getElement('retry-achievement-task');
  const failureMessage = failedPage.getElement('submission-message');
  failedButton.dataset.achievementId = 'ACH-FAILED';
  failedButton.handlers.click();
  failedPage.requests.retry.failure(new Error('Task retry denied.'));

  assert.equal(failedButton.disabled, false);
  assert.equal(failedButton.hidden, false);
  assert.match(failureMessage.textContent, /Task retry denied/);
});

test('shows loading and a useful empty state after a successful empty search', function () {
  const elements = {
    'student-directory-query': { value: 'No Match' },
    'students-page-message': makeNode('p'),
    'student-directory-results': makeNode('section'),
    'student-directory-search-button': { disabled: false }
  };
  const api = makeRunner();
  const exports = loadBrowserPage(elements, api.runner);
  exports.searchStudentsFromPage({ preventDefault: function () {} });
  assert.equal(elements['students-page-message'].textContent, 'Searching active student records…');
  assert.equal(elements['student-directory-results'].attributes['aria-busy'], 'true');
  assert.equal(api.request.query, 'No Match');

  api.request.success([]);
  assert.equal(elements['students-page-message'].textContent, 'Search complete.');
  assert.equal(elements['student-directory-results'].attributes['aria-busy'], 'false');
  assert.equal(elements['student-directory-results'].children[0].textContent,
    'No active students matched that search.');
  assert.equal(elements['student-directory-search-button'].disabled, false);
});

test('shows a useful error and recovers the page when the search server call fails', function () {
  const elements = {
    'student-directory-query': { value: 'Asha' },
    'students-page-message': makeNode('p'),
    'student-directory-results': makeNode('section'),
    'student-directory-search-button': { disabled: false }
  };
  const api = makeRunner();
  const exports = loadBrowserPage(elements, api.runner);
  exports.searchStudentsFromPage({ preventDefault: function () {} });
  assert.equal(elements['student-directory-search-button'].disabled, true);

  api.request.failure(new Error('An active SAMS user is required.'));
  assert.match(elements['students-page-message'].textContent, /active SAMS user is required/);
  assert.equal(elements['students-page-message'].classList.add instanceof Function, true);
  assert.equal(elements['student-directory-results'].attributes['aria-busy'], 'false');
  assert.equal(elements['student-directory-search-button'].disabled, false);
});
