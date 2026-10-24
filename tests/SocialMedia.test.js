const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');

function loadSocialMediaApi(options) {
  options = options || {};
  const context = vm.createContext({});
  ['Config.js', 'Sheets.js', 'Code.js', 'Achievements.js', 'SocialMedia.js', 'Workflow.js', 'ActivityLog.js'].forEach(function (file) {
    vm.runInContext(fs.readFileSync(path.join(projectRoot, file), 'utf8'), context);
  });

  const sheets = {};
  let uuid = 0;
  let email = Object.prototype.hasOwnProperty.call(options, 'email')
    ? options.email
    : 'social@example.org';
  const records = Object.assign({
    achievements: [
      {
        AchievementID: 'ACH-VERIFIED',
        Title: 'Robotics champions',
        Category: 'STEM',
        CompetitionEvent: 'Regional Expo',
        Result: 'First place',
        Status: 'Verified'
      },
      {
        AchievementID: 'ACH-PENDING',
        Title: 'Pending story',
        Category: 'STEM',
        CompetitionEvent: 'School Expo',
        Result: 'Finalist',
        Status: 'Pending'
      }
    ],
    users: [
      { UserID: 'SOCIAL-1', Name: 'Social Manager', Email: 'social@example.org', Role: 'SocialMedia', Active: true },
      { UserID: 'VERIFIER-1', Name: 'Verifier', Email: 'verifier@example.org', Role: 'Verifier', Active: true },
      { UserID: 'MENTOR-1', Name: 'Mentor', Email: 'mentor@example.org', Role: 'Mentor', Active: true },
      { UserID: 'ADMIN-1', Name: 'Administrator', Email: 'admin@example.org', Role: 'Administrator', Active: true }
    ]
  }, options.records || {});

  Object.keys(context.SAMS_CONFIG.sheetNames).forEach(function (key) {
    const name = context.SAMS_CONFIG.sheetNames[key];
    const headers = options.headers && options.headers[key]
      ? options.headers[key]
      : context.SAMS_CONFIG.requiredHeaders[key];
    const rows = (records[key] || []).map(function (record) {
      return headers.map(function (header) {
        return Object.prototype.hasOwnProperty.call(record, header) ? record[header] : '';
      });
    });
    sheets[name] = {
      getName: function () { return name; },
      getLastColumn: function () { return headers.length; },
      getLastRow: function () { return rows.length + 1; },
      getRange: function (row, column, rowCount, columnCount) {
        function ensureRows() {
          while (rows.length < row - 1 + rowCount - 1) {
            rows.push(headers.map(function () { return ''; }));
          }
        }
        return {
          getDisplayValues: function () {
            return [headers.slice(column - 1, column - 1 + columnCount)];
          },
          getValues: function () {
            return Array.from({ length: rowCount }, function (_, offset) {
              const current = rows[row - 2 + offset] || headers.map(function () { return ''; });
              return current.slice(column - 1, column - 1 + columnCount);
            });
          },
          setValue: function (value) {
            ensureRows();
            rows[row - 2][column - 1] = value;
          },
          setValues: function (values) {
            ensureRows();
            values.forEach(function (valuesRow, rowOffset) {
              valuesRow.forEach(function (value, columnOffset) {
                rows[row - 2 + rowOffset][column - 1 + columnOffset] = value;
              });
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
  context.Session = {
    getActiveUser: function () { return { getEmail: function () { return email; } }; }
  };
  context.LockService = {
    getScriptLock: function () {
      return { waitLock: function () {}, releaseLock: function () {} };
    }
  };
  context.Utilities = {
    getUuid: function () {
      uuid++;
      return 'social-test-' + uuid;
    },
    formatDate: function (value, timeZone, pattern) {
      assert.equal(timeZone, 'Asia/Kolkata');
      assert.equal(pattern, 'yyyy-MM-dd');
      return value.toISOString().slice(0, 10);
    }
  };
  context.Session.getScriptTimeZone = function () { return 'Asia/Kolkata'; };
  return {
    context: context,
    records: function (key) {
      const headers = options.headers && options.headers[key]
        ? options.headers[key]
        : context.SAMS_CONFIG.requiredHeaders[key];
      const rows = sheets[context.SAMS_CONFIG.sheetNames[key]]
        .getRange(2, 1, Math.max(1, sheets[context.SAMS_CONFIG.sheetNames[key]].getLastRow() - 1), headers.length)
        .getValues();
      return rows.filter(function (row) {
        return row.some(function (value) { return value !== '' && value !== null; });
      }).map(function (row) {
        const record = {};
        headers.forEach(function (header, index) { record[header] = row[index]; });
        return record;
      });
    },
    setEmail: function (value) { email = value; }
  };
}

function task(overrides) {
  return Object.assign({
    TaskID: 'TASK-1',
    AchievementID: 'ACH-VERIFIED',
    Platform: 'Instagram',
    AssignedTo: 'SOCIAL-1',
    Priority: 'High',
    Status: 'Incoming',
    DueDate: '',
    CreatedAt: new Date('2026-10-01T00:00:00Z'),
    DesignFileID: '',
    Caption: '',
    PostURL: '',
    ScreenshotFileID: '',
    PublishedAt: '',
    CompletedAt: '',
    ReviewedBy: '',
    ReviewNotes: ''
  }, overrides || {});
}

test('returns an empty task board safely when there are no tasks', function () {
  const api = loadSocialMediaApi({ records: { socialMediaTasks: [] } });
  assert.deepEqual(JSON.parse(JSON.stringify(api.context.getSocialMediaTaskBoard())), []);
});

test('joins task records to the correct achievement without returning file IDs', function () {
  const api = loadSocialMediaApi({
    records: {
      socialMediaTasks: [task({
        DesignFileID: 'private-design-file',
        ScreenshotFileID: 'private-proof-file',
        CompletedAt: '2026-10-22T11:00:00.000Z',
        ReviewedBy: 'VERIFIER-1',
        ReviewNotes: 'Checked.'
      })]
    }
  });
  const board = api.context.getSocialMediaTaskBoard();
  assert.equal(board.length, 1);
  assert.equal(board[0].achievementTitle, 'Robotics champions');
  assert.equal(board[0].achievementId, 'ACH-VERIFIED');
  assert.equal(board[0].taskId, 'TASK-1');
  assert.equal(board[0].achievementCategory, 'STEM');
  assert.equal(board[0].assigneeName, 'Social Manager');
  assert.equal(board[0].designReferenceAvailable, true);
  assert.equal(Object.prototype.hasOwnProperty.call(board[0], 'proofAvailable'), false);
  assert.equal(board[0].completedAt, '2026-10-22T11:00:00.000Z');
  assert.equal(board[0].reviewedByName, 'Verifier');
  assert.equal(board[0].reviewNotes, 'Checked.');
  assert.equal(JSON.stringify(board).includes('private-design-file'), false);
  assert.equal(JSON.stringify(board).includes('private-proof-file'), false);
});

test('returns achievement source details and participants from original records', function () {
  const api = loadSocialMediaApi({
    records: {
      achievements: [{
        AchievementID: 'ACH-VERIFIED',
        Title: 'Robotics champions',
        Category: 'STEM',
        CompetitionEvent: 'Regional Expo',
        Result: 'First place',
        Date: '2026-10-12',
        Description: 'Built a line-following robot.',
        Status: 'Verified'
      }],
      students: [
        { StudentID: 'STU-1', Name: 'Asha Iyer', RollNumber: 'R-1' }
      ],
      achievementParticipants: [{
        AchievementID: 'ACH-VERIFIED',
        StudentID: 'STU-1',
        RoleContribution: 'Builder'
      }],
      socialMediaTasks: [task()]
    }
  });
  const linked = api.context.getSocialMediaTaskBoard()[0];
  assert.equal(linked.achievementTitle, 'Robotics champions');
  assert.equal(linked.achievementCategory, 'STEM');
  assert.equal(linked.competitionEvent, 'Regional Expo');
  assert.equal(linked.result, 'First place');
  assert.equal(linked.achievementDate, '2026-10-12');
  assert.equal(linked.achievementDescription, 'Built a line-following robot.');
  assert.equal(linked.participants[0].name, 'Asha Iyer');
  assert.equal(linked.participants[0].rollNumber, 'R-1');
  assert.equal(linked.participants[0].roleContribution, 'Builder');
});

test('rejects achievement source edits while permitting task-specific updates', function () {
  const api = loadSocialMediaApi({
    records: {
      socialMediaTasks: [task({ AssignedTo: '', Priority: '', Caption: '' })]
    }
  });
  assert.throws(function () {
    api.context.updateSocialMediaTask('TASK-1', 'updateContent', {
      caption: 'A caption',
      Title: 'Changed source title'
    });
  }, /Achievement source fields are read-only/);
  assert.equal(api.records('achievements')[0].Title, 'Robotics champions');
  assert.equal(api.records('socialMediaTasks')[0].Caption, '');

  api.context.updateSocialMediaTask('TASK-1', 'updateContent', {
    caption: 'Task-specific caption',
    designReference: 'design-reference'
  });
  assert.equal(api.records('socialMediaTasks')[0].Caption, 'Task-specific caption');
  assert.equal(api.records('socialMediaTasks')[0].DesignFileID, 'design-reference');
});

test('creates a task only for a Verified achievement and prevents duplicates', function () {
  const api = loadSocialMediaApi({
    headers: {
      socialMediaTasks: Array.from(
        vm.runInNewContext(fs.readFileSync(path.join(projectRoot, 'Config.js'), 'utf8') +
          ';SAMS_CONFIG.requiredHeaders.socialMediaTasks;')
      ).reverse(),
      auditLog: Array.from(
        vm.runInNewContext(fs.readFileSync(path.join(projectRoot, 'Config.js'), 'utf8') +
          ';SAMS_CONFIG.requiredHeaders.auditLog;')
      ).reverse()
    }
  });
  const created = api.context.createSocialMediaTask({
    achievementId: 'ACH-VERIFIED',
    platform: 'Instagram',
    priority: 'High',
    dueDate: '2026-11-01'
  });
  assert.equal(created.status, 'Incoming');
  assert.match(created.taskId, /^SMT-/);
  assert.equal(api.records('socialMediaTasks').length, 1);
  assert.equal(api.records('auditLog').length, 1);
  assert.throws(function () {
    api.context.createSocialMediaTask({
      achievementId: 'ACH-VERIFIED',
      platform: ' instagram ',
      priority: 'High',
      dueDate: ''
    });
  }, /already exists/);
  assert.throws(function () {
    api.context.createSocialMediaTask({
      achievementId: 'ACH-PENDING',
      platform: 'Instagram'
    });
  }, /Only Verified achievements are eligible/);
  assert.equal(api.records('socialMediaTasks').length, 1);
});

test('rejects invalid task status transitions', function () {
  const api = loadSocialMediaApi({ records: { socialMediaTasks: [task()] } });
  assert.throws(function () {
    api.context.updateSocialMediaTask('TASK-1', 'submitForApproval', {});
  }, /status transition is not allowed/);
  assert.equal(api.records('socialMediaTasks')[0].Status, 'Incoming');
});

test('moves tasks through design approval and manual publication to proof review', function () {
  const api = loadSocialMediaApi({ records: { socialMediaTasks: [task()] } });
  api.context.updateSocialMediaTask('TASK-1', 'startDesign', {});
  api.context.updateSocialMediaTask('TASK-1', 'updateContent', {
    caption: 'Robotics team won first place.',
    designReference: 'restricted-design-reference'
  });
  api.context.updateSocialMediaTask('TASK-1', 'submitForApproval', {});
  assert.equal(api.records('socialMediaTasks')[0].Status, 'Awaiting Approval');
  api.context.updateSocialMediaTask('TASK-1', 'approveDesign', {});
  assert.equal(api.records('socialMediaTasks')[0].Status, 'Ready to Publish');
  api.context.updateSocialMediaTask('TASK-1', 'recordPublication', {
    postUrl: 'https://example.org/post/1',
    publishedAt: '2026-10-22T10:00'
  });
  const taskRecord = api.records('socialMediaTasks')[0];
  assert.equal(taskRecord.Status, 'Awaiting Publication Proof');
  assert.equal(taskRecord.PostURL, 'https://example.org/post/1');
  assert.equal(Object.prototype.toString.call(taskRecord.PublishedAt), '[object Date]');
  assert.equal(api.records('auditLog').length, 5);
  assert.equal(api.records('auditLog')[4].Action, 'Social media publication recorded; proof review required');
});

test('requires verified social management permission for task mutations', function () {
  const api = loadSocialMediaApi({
    email: 'mentor@example.org',
    records: { socialMediaTasks: [task()] }
  });
  assert.throws(function () {
    api.context.updateSocialMediaTask('TASK-1', 'startDesign', {});
  }, /SocialMedia, Communications or Administrator role/);
  assert.equal(api.records('socialMediaTasks')[0].Status, 'Incoming');
  assert.equal(api.records('auditLog').length, 1);
  assert.equal(api.records('auditLog')[0].Outcome, 'Denied');
});

test('keeps publication-proof review and task completion blocked', function () {
  ['', 'arbitrary-unverified-id'].forEach(function (fileId) {
    const api = loadSocialMediaApi({
      email: 'verifier@example.org',
      records: {
        socialMediaTasks: [task({
          Status: 'Awaiting Publication Proof',
          ScreenshotFileID: fileId,
          PostURL: 'https://example.org/post/1',
          PublishedAt: new Date('2026-10-22T10:00:00Z')
        })]
      }
    });
    assert.throws(function () {
      api.context.updateSocialMediaTask('TASK-1', 'reviewProof', {
        accepted: true,
        notes: 'Post checked.'
      });
    }, /Publication-proof review and task completion are disabled/);
    assert.equal(api.records('socialMediaTasks')[0].Status, 'Awaiting Publication Proof');
    assert.equal(api.records('socialMediaTasks')[0].ReviewedBy, '');
    assert.equal(api.records('socialMediaTasks')[0].CompletedAt, '');
    assert.equal(api.records('auditLog').length, 1);
    assert.equal(api.records('auditLog')[0].Outcome, 'Failed');
  });
});

test('unauthorized users cannot review proof even when the task has a file reference', function () {
  const api = loadSocialMediaApi({
    email: 'mentor@example.org',
    records: {
      socialMediaTasks: [task({
        Status: 'Awaiting Publication Proof',
        ScreenshotFileID: 'arbitrary-unverified-id'
      })]
    }
  });
  assert.throws(function () {
    api.context.updateSocialMediaTask('TASK-1', 'reviewProof', {
      accepted: true,
      notes: 'Looks good.'
    });
  }, /SocialMedia manager role is required/);
  assert.equal(api.records('socialMediaTasks')[0].Status, 'Awaiting Publication Proof');
  assert.equal(api.records('auditLog').length, 1);
  assert.equal(api.records('auditLog')[0].Outcome, 'Denied');
});

test('rejects invalid date, URL and priority inputs', function () {
  const api = loadSocialMediaApi();
  assert.throws(function () {
    api.context.createSocialMediaTask({
      achievementId: 'ACH-VERIFIED',
      platform: 'Instagram',
      priority: 'Immediate',
      dueDate: ''
    });
  }, /valid task priority/);
  assert.throws(function () {
    api.context.createSocialMediaTask({
      achievementId: 'ACH-VERIFIED',
      platform: 'Instagram',
      priority: 'Normal',
      dueDate: '2026-02-30'
    });
  }, /valid YYYY-MM-DD date/);

  const publicationApi = loadSocialMediaApi({
    records: {
      socialMediaTasks: [task({ Status: 'Ready to Publish' })]
    }
  });
  assert.throws(function () {
    publicationApi.context.updateSocialMediaTask('TASK-1', 'recordPublication', {
      postUrl: 'http://example.org/post/1',
      publishedAt: '2026-10-22T10:00'
    });
  }, /HTTPS URL/);
  assert.equal(publicationApi.records('socialMediaTasks')[0].Status, 'Ready to Publish');
});

test('fails closed when Google does not provide a trusted identity', function () {
  const api = loadSocialMediaApi({ email: '' });
  assert.equal(api.context.getSocialMediaAccess().available, false);
  assert.throws(function () {
    api.context.createSocialMediaTask({
      achievementId: 'ACH-VERIFIED',
      platform: 'Instagram'
    });
  }, /Google did not provide a signed-in user identity/);
});

test('parses combined social-media roles for task manager permissions and assignees', function () {
  const api = loadSocialMediaApi({
    records: {
      users: [
        {
          UserID: 'SOCIAL-1',
          Name: 'Mentor Social Manager',
          Email: 'social@example.org',
          Role: 'Mentor, SocialMedia',
          Active: true
        },
        {
          UserID: 'MULTI-ASSIGNEE',
          Name: 'Communications Mentor',
          Email: 'other@example.org',
          Role: 'Mentor, Communications',
          Active: true
        }
      ]
    }
  });
  const access = api.context.getSocialMediaAccess();
  assert.equal(access.canManage, true);
  const options = api.context.getSocialMediaTaskOptions();
  assert.ok(options.assignees.some(function (assignee) {
    return assignee.userId === 'MULTI-ASSIGNEE';
  }));
});

test('filters the task list by status, platform, priority and assignee', function () {
  const script = fs.readFileSync(path.join(projectRoot, 'JavaScript.html'), 'utf8')
    .replace(/^\s*<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
  const filters = {
    'social-task-search': { value: '' },
    'social-task-filter-status': { value: '' },
    'social-task-filter-platform': { value: '' },
    'social-task-filter-assignee': { value: '' },
    'social-task-filter-priority': { value: '' }
  };
  const browser = vm.createContext({
    module: { exports: {} },
    document: {
      addEventListener: function () {},
      getElementById: function (id) { return filters[id]; }
    }
  });
  vm.runInContext(script, browser);
  const taskRecord = {
    taskId: 'TASK-A',
    achievementTitle: 'Robotics champions',
    achievementCategory: 'STEM',
    competitionEvent: 'Expo',
    platform: 'Instagram',
    assigneeName: 'Mira',
    assignedTo: 'USER-1',
    priority: 'High',
    status: 'In Design',
    caption: 'Robot story'
  };

  [
    ['social-task-filter-status', 'In Design'],
    ['social-task-filter-platform', 'Instagram'],
    ['social-task-filter-priority', 'High'],
    ['social-task-filter-assignee', 'USER-1'],
    ['social-task-search', 'robot story']
  ].forEach(function (filter) {
    filters[filter[0]].value = filter[1];
    assert.equal(browser.module.exports.taskMatchesFilters(taskRecord), true);
    filters[filter[0]].value = 'no-match';
    assert.equal(browser.module.exports.taskMatchesFilters(taskRecord), false);
    filters[filter[0]].value = '';
  });
});

test('renders linked task and non-evidence details without exposing Drive references', function () {
  const script = fs.readFileSync(path.join(projectRoot, 'JavaScript.html'), 'utf8')
    .replace(/^\s*<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
  const browser = vm.createContext({
    module: { exports: {} },
    document: {
      addEventListener: function () {},
      createElement: function (tagName) {
        return {
          tagName: tagName,
          children: [],
          appendChild: function (child) { this.children.push(child); }
        };
      }
    }
  });
  vm.runInContext(script, browser);
  const card = browser.module.exports.appendTaskCard({
    taskId: 'TASK-7',
    achievementId: 'ACH-7',
    achievementTitle: 'Robotics champions',
    achievementCategory: 'STEM',
    competitionEvent: 'Regional Expo',
    result: 'First place',
    achievementDate: '2026-10-12',
    achievementDescription: 'Built a robot.',
    participants: [{
      name: 'Asha Iyer',
      rollNumber: 'R-1',
      roleContribution: 'Builder'
    }],
    platform: 'Instagram',
    priority: 'High',
    status: 'Completed',
    dueDate: '2026-11-01',
    assigneeName: 'Social Manager',
    designReferenceAvailable: true,
    caption: 'A student-safe caption.',
    postUrl: 'https://example.org/post/7',
    publishedAt: '2026-10-22T10:00:00.000Z',
    completedAt: '2026-10-22T11:00:00.000Z',
    reviewedByName: 'Verifier',
    reviewNotes: 'Design approved.'
  });
  function collectText(node) {
    return (node.textContent || '') + (node.children || []).map(collectText).join(' ');
  }
  const text = collectText(card);
  [
    'Robotics champions',
    'TASK-7',
    'ACH-7',
    'Instagram',
    'Achievement date: 2026-10-12',
    'Built a robot.',
    'Participants: Asha Iyer · R-1 · Builder',
    'Social Manager',
    'Design reference: recorded',
    'Completed at 2026-10-22T11:00:00.000Z',
    'Reviewed by Verifier',
    'Design approved.'
  ].forEach(function (value) {
    assert.ok(text.includes(value), 'expected rendered details to include "' + value + '"');
  });
  assert.equal(text.includes('Publication proof reference'), false);
  assert.equal(text.includes('private-drive-id'), false);
});

test('shows loading and failure states when the task board request fails', function () {
  function makeNode() {
    const node = {
      attributes: {},
      children: [],
      value: '',
      className: '',
      setAttribute: function (name, value) { this.attributes[name] = value; },
      appendChild: function (child) { this.children.push(child); }
    };
    Object.defineProperty(node, 'textContent', {
      get: function () { return this._textContent || ''; },
      set: function (value) {
        this._textContent = value;
        if (value === '') {
          this.children = [];
        }
      }
    });
    return node;
  }
  const elements = {};
  [
    'social-task-list-message',
    'social-task-list',
    'social-task-counts',
    'social-task-search',
    'social-task-filter-status',
    'social-task-filter-platform',
    'social-task-filter-assignee',
    'social-task-filter-priority'
  ].forEach(function (id) { elements[id] = makeNode(); });
  const request = {};
  const runner = {
    withSuccessHandler: function (handler) { request.success = handler; return runner; },
    withFailureHandler: function (handler) { request.failure = handler; return runner; },
    getSocialMediaTaskBoard: function () {}
  };
  const browser = vm.createContext({
    module: { exports: {} },
    document: {
      addEventListener: function () {},
      getElementById: function (id) { return elements[id]; },
      createElement: function (tagName) {
        const node = makeNode();
        node.tagName = tagName;
        return node;
      }
    },
    google: { script: { run: runner } }
  });
  const script = fs.readFileSync(path.join(projectRoot, 'JavaScript.html'), 'utf8')
    .replace(/^\s*<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
  vm.runInContext(script, browser);

  browser.module.exports.loadSocialMediaTaskBoard();
  assert.equal(elements['social-task-list-message'].textContent, 'Loading social media tasks…');
  assert.equal(elements['social-task-list'].attributes['aria-busy'], 'true');
  request.failure(new Error('Identity could not be verified.'));
  assert.equal(elements['social-task-list-message'].textContent, 'Identity could not be verified.');
  assert.equal(elements['social-task-list'].attributes['aria-busy'], 'false');
  assert.match(elements['social-task-list'].children[0].textContent, /task list is unavailable/);
});

test('counts tasks by supported status and handles an empty queue', function () {
  const script = fs.readFileSync(path.join(projectRoot, 'JavaScript.html'), 'utf8')
    .replace(/^\s*<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
  const browser = vm.createContext({
    module: { exports: {} },
    document: { addEventListener: function () {} }
  });
  vm.runInContext(script, browser);
  assert.equal(browser.module.exports.getSocialMediaTaskCounts([])['All tasks'], 0);
  const counts = browser.module.exports.getSocialMediaTaskCounts([
    { status: 'Incoming' },
    { status: 'Incoming' },
    { status: 'Completed' },
    { status: 'Unrecognized' }
  ]);
  assert.equal(counts['All tasks'], 4);
  assert.equal(counts.Incoming, 2);
  assert.equal(counts.Completed, 1);
  assert.equal(counts.Cancelled, 0);
});

test('keeps social media mutations read-only when identity cannot be verified', function () {
  const script = fs.readFileSync(path.join(projectRoot, 'JavaScript.html'), 'utf8')
    .replace(/^\s*<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
  const browser = vm.createContext({
    module: { exports: {} },
    document: { addEventListener: function () {} }
  });
  vm.runInContext(script, browser);
  const canMutate = browser.module.exports.socialMediaMutationAllowed;
  assert.equal(canMutate({ available: false, canManage: false, canReviewProof: false }, true, 'assign'), false);
  assert.equal(canMutate({ available: true, canManage: false, canReviewProof: true }, false, 'assign'), false);
  assert.equal(canMutate({ available: true, canManage: true, canReviewProof: true }, false, 'reviewProof'), false);
  assert.equal(canMutate({ available: true, canManage: true, canReviewProof: true }, false, 'assign'), true);
});

test('provides a social media route and page independent of role-based visibility', function () {
  const html = fs.readFileSync(path.join(projectRoot, 'Index.html'), 'utf8');
  const script = fs.readFileSync(path.join(projectRoot, 'JavaScript.html'), 'utf8');
  const server = fs.readFileSync(path.join(projectRoot, 'SocialMedia.js'), 'utf8');
  assert.match(html, /href="#social-media" data-page="social-media"/);
  assert.match(html, /id="social-media-page" hidden/);
  assert.match(script, /'overview', 'students', 'submit', 'reviews', 'social-media'/);
  assert.match(script, /requestedPage === 'social-media'[\s\S]*?loadSocialMediaPage\(\)/);
  assert.doesNotMatch(html, /proof-storage-preflight|SAMS_PROOF_FOLDER_ID/);
  assert.doesNotMatch(script, /proof-storage-preflight|loadPublicationProofStoragePreflight/);
  assert.doesNotMatch(server, /getPublicationProofStoragePreflight|canConfigureProofStorage_/);
});
