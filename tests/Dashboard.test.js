const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');

function loadDashboardApi(recordsByKey) {
  const context = vm.createContext({});
  ['Config.js', 'Sheets.js', 'Code.js'].forEach(function (fileName) {
    vm.runInContext(fs.readFileSync(path.join(projectRoot, fileName), 'utf8'), context);
  });

  const sheets = {};
  Object.keys(context.SAMS_CONFIG.sheetNames).forEach(function (key) {
    const name = context.SAMS_CONFIG.sheetNames[key];
    const headers = context.SAMS_CONFIG.requiredHeaders[key];
    const records = recordsByKey[key] || [];
    const rows = records.map(function (record) {
      return headers.map(function (header) {
        return Object.prototype.hasOwnProperty.call(record, header) ? record[header] : '';
      });
    });
    sheets[name] = {
      getName: function () { return name; },
      getLastColumn: function () { return headers.length; },
      getLastRow: function () { return rows.length + 1; },
      getRange: function (row, column, rowCount, columnCount) {
        return {
          getDisplayValues: function () {
            return [headers.slice(column - 1, column - 1 + columnCount)];
          },
          getValues: function () {
            return rows.slice(row - 2, row - 2 + rowCount).map(function (source) {
              return source.slice(column - 1, column - 1 + columnCount);
            });
          }
        };
      }
    };
  });
  context.SpreadsheetApp = {
    openById: function () {
      return { getSheetByName: function (name) { return sheets[name] || null; } };
    }
  };
  return context;
}

test('returns only aggregate summary counts and excludes blank or unkeyed rows', function () {
  const api = loadDashboardApi({
    students: [
      { StudentID: 'S-1' },
      { StudentID: '' },
      { StudentID: '   ' }
    ],
    achievements: [
      { AchievementID: 'A-1', Status: 'Pending' },
      { AchievementID: 'A-2', Status: 'Verified' },
      { AchievementID: '', Status: 'Pending' },
      { AchievementID: 'A-3', Status: 'pending' }
    ],
    socialMediaTasks: [
      { TaskID: 'T-1' },
      { TaskID: '' },
      { TaskID: 'T-2' }
    ],
    mediaAssets: [
      { AssetID: 'M-1', AssetType: 'Story' },
      { AssetID: 'M-2', AssetType: ' image ' },
      { AssetID: '', AssetType: 'Story' },
      { AssetID: 'M-3', AssetType: 'story' }
    ]
  });

  const result = api.getDashboardSummary();
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    students: 1,
    achievements: 3,
    pendingReviews: 1,
    socialMediaTasks: 2,
    storyAssets: 2
  });
  assert.deepEqual(Object.keys(result).sort(), [
    'achievements', 'pendingReviews', 'socialMediaTasks', 'storyAssets', 'students'
  ]);
});

test('returns zero counts for empty data tabs', function () {
  const api = loadDashboardApi({});
  assert.deepEqual(JSON.parse(JSON.stringify(api.getDashboardSummary())), {
    students: 0,
    achievements: 0,
    pendingReviews: 0,
    socialMediaTasks: 0,
    storyAssets: 0
  });
});

test('keeps achievement and review navigation visible independently of identity', function () {
  const html = fs.readFileSync(path.join(projectRoot, 'Index.html'), 'utf8');
  const scriptSource = fs.readFileSync(path.join(projectRoot, 'JavaScript.html'), 'utf8');
  const script = scriptSource.replace(/^\s*<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
  const accessNotice = { textContent: '', hidden: true };
  const submitNotice = { textContent: '', hidden: true };
  const reviewsNotice = { textContent: '', hidden: true };
  const activityLink = { hidden: true };
  const studentMessage = {
    textContent: '',
    classList: { add: function () {} }
  };
  const studentResults = { setAttribute: function () {} };
  const studentSearchButton = { disabled: false };
  const refreshButton = { disabled: false };
  const formControls = [
    { id: 'student-search', disabled: false },
    { id: 'submit-achievement', disabled: false }
  ];
  const browser = vm.createContext({
    module: { exports: {} },
    window: { location: { hash: '#overview' } },
    document: {
      addEventListener: function () {},
      getElementById: function (id) {
        return {
          'access-notice': accessNotice,
          'submit-access-message': submitNotice,
          'reviews-access-message': reviewsNotice,
          'refresh-reviews': refreshButton,
          'students-page-message': studentMessage,
          'student-directory-results': studentResults,
          'student-directory-search-button': studentSearchButton
        }[id];
      },
      querySelector: function () { return activityLink; },
      querySelectorAll: function () { return formControls; }
    }
  });
  vm.runInContext(script, browser);

  assert.match(html, /href="#achievements" data-page="submit">[\s\S]*?Achievements/);
  assert.match(html, /href="#reviews" data-page="reviews">[\s\S]*?Reviews/);
  assert.doesNotMatch(html, /id="evidence-file"/);
  assert.match(html, /id="evidence-files"[^>]*multiple[^>]*required/);
  assert.match(html, /a certificate, a photo of the student receiving or participating[\s\S]*?Any one valid PDF, JPEG or PNG is sufficient/);
  assert.doesNotMatch(html, /certificate.{0,80}and.{0,80}photo.{0,80}required/i);
  assert.match(scriptSource, /Attach at least one evidence file before submitting/);
  assert.match(scriptSource, /readAsDataURL/);
  assert.doesNotMatch(html, /href="#achievements"[^>]*hidden/);
  assert.doesNotMatch(html, /href="#reviews"[^>]*hidden/);
  assert.match(html, /href="#activity-log" data-page="activity-log" hidden/);

  browser.module.exports.applyAchievementAccess({
    available: false,
    canSubmit: false,
    canReview: false,
    message: 'Identity unavailable.'
  });
  assert.equal(accessNotice.hidden, false);
  assert.match(accessNotice.textContent, /Identity unavailable/);
  assert.equal(formControls[0].disabled, true);
  assert.equal(formControls[1].disabled, true);
  assert.equal(refreshButton.disabled, true);

  browser.module.exports.applyAchievementAccess({
    available: true,
    canSubmit: true,
    canReview: false
  });
  assert.equal(formControls[1].disabled, false);
  assert.equal(activityLink.hidden, true);

  browser.module.exports.applyAchievementAccess({
    available: true,
    canSubmit: false,
    canReview: false,
    isAdministrator: true
  });
  assert.equal(activityLink.hidden, false);
});

test('renders dashboard summary values from aggregate counts', function () {
  const script = fs.readFileSync(path.join(projectRoot, 'JavaScript.html'), 'utf8')
    .replace(/^\s*<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
  const elements = {};
  const browser = vm.createContext({
    module: { exports: {} },
    document: {
      addEventListener: function () {},
      getElementById: function (id) {
        if (!elements[id]) {
          elements[id] = { textContent: '' };
        }
        return elements[id];
      }
    }
  });
  vm.runInContext(script, browser);
  browser.module.exports.renderDashboardSummary({
    students: 12,
    achievements: 4,
    pendingReviews: 2,
    socialMediaTasks: 3,
    storyAssets: 1
  });
  assert.equal(elements['summary-students'].textContent, '12');
  assert.equal(elements['summary-achievements'].textContent, '4');
  assert.equal(elements['summary-reviews'].textContent, '2');
  assert.equal(elements['summary-social-tasks'].textContent, '3');
  assert.equal(elements['summary-stories'].textContent, '1');
  assert.equal(elements['summary-message'].textContent, 'Live spreadsheet counts');
});
