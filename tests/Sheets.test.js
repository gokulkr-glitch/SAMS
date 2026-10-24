const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const expectedHeaders = {
  students: ['StudentID', 'Name', 'RollNumber', 'Grade', 'Section', 'Status'],
  achievements: [
    'AchievementID', 'Title', 'Category', 'CompetitionEvent', 'Result', 'Date',
    'AcademicYear', 'Type', 'Status', 'Description', 'SubmittedBy', 'VerifiedBy',
    'VerifiedAt', 'EvidenceFileID', 'CreatedAt', 'UpdatedAt'
  ],
  achievementEvidence: [
    'EvidenceID', 'AchievementID', 'DriveFileID', 'FileType',
    'DisplayFileName', 'UploadedBy', 'UploadedAt'
  ],
  achievementParticipants: ['AchievementID', 'StudentID', 'RoleContribution'],
  mediaAssets: ['AssetID', 'AchievementID', 'FileID', 'AssetType', 'PublicationApproved'],
  socialMediaTasks: [
    'TaskID', 'AchievementID', 'Platform', 'AssignedTo', 'Priority', 'Status',
    'DueDate', 'CreatedAt', 'DesignFileID', 'Caption', 'PostURL', 'ScreenshotFileID',
    'PublishedAt', 'CompletedAt', 'ReviewedBy', 'ReviewNotes'
  ],
  users: ['UserID', 'Name', 'Email', 'Role', 'Active'],
  auditLog: [
    'LogID', 'UserID', 'ActorName', 'ActorEmail', 'ActionType', 'Action',
    'Outcome', 'Details', 'EntityType', 'RecordID', 'CorrelationID', 'Timestamp'
  ]
};

function loadProject(sheetOverrides) {
  const context = vm.createContext({});
  const sheets = {};

  vm.runInContext(
    fs.readFileSync(path.join(projectRoot, 'Config.js'), 'utf8'),
    context,
    { filename: 'Config.js' }
  );
  vm.runInContext(
    fs.readFileSync(path.join(projectRoot, 'Sheets.js'), 'utf8'),
    context,
    { filename: 'Sheets.js' }
  );

  context.SpreadsheetApp = {
    openById: function () {
      return {
        getSheetByName: function (name) {
          return sheets[name] || null;
        }
      };
    }
  };

  const requiredHeaders = JSON.parse(JSON.stringify(context.SAMS_CONFIG.requiredHeaders));
  Object.keys(requiredHeaders).forEach(function (key) {
    const name = context.SAMS_CONFIG.sheetNames[key];
    const headers = sheetOverrides && sheetOverrides[key]
      ? sheetOverrides[key]
      : requiredHeaders[key];
    const rows = [];
    sheets[name] = {
      getName: function () { return name; },
      getLastColumn: function () { return headers.length; },
      getLastRow: function () { return rows.length + 1; },
      getRange: function (row, column, rowCount, columnCount) {
        return {
          getDisplayValues: function () {
            return row === 1 ? [headers.slice(column - 1, column - 1 + columnCount)] : [];
          },
          getValues: function () {
            return rows.slice(row - 2, row - 2 + rowCount);
          }
        };
      }
    };
  });

  return { context: context, requiredHeaders: requiredHeaders };
}

function getTab(diagnostic, name) {
  return diagnostic.tabs.find(function (tab) { return tab.name === name; });
}

test('accepts the configured headers for all eight tabs', function () {
  const project = loadProject();
  const diagnostic = project.context.getSpreadsheetDiagnostic();

  assert.deepEqual(project.requiredHeaders, expectedHeaders);
  assert.equal(diagnostic.schemaValid, true);
  assert.equal(diagnostic.tabs.length, 8);
  diagnostic.tabs.forEach(function (tab) {
    assert.equal(tab.valid, true, tab.name + ': ' + tab.error);
    assert.deepEqual(Array.from(tab.headers), project.requiredHeaders[
      Object.keys(project.context.SAMS_CONFIG.sheetNames).find(function (key) {
        return project.context.SAMS_CONFIG.sheetNames[key] === tab.name;
      })
    ]);
  });
});

test('reports only the genuinely missing required header names', function () {
  const project = loadProject({ students: ['StudentID', 'RollNumber', 'Grade', 'Section', 'Status'] });
  const diagnostic = project.context.getSpreadsheetDiagnostic();
  const students = getTab(diagnostic, 'Students');

  assert.equal(students.valid, false);
  assert.equal(students.error, 'Missing required headers: Name');
});

test('reports duplicate headers clearly', function () {
  const project = loadProject({
    students: ['StudentID', 'Name', 'RollNumber', 'Grade', 'Section', 'Status', 'StudentID']
  });
  const diagnostic = project.context.getSpreadsheetDiagnostic();
  const students = getTab(diagnostic, 'Students');

  assert.equal(students.valid, false);
  assert.equal(students.error, 'Tab "Students" has duplicate headers: "StudentID".');
});

test('accepts a valid header row with no data rows', function () {
  const project = loadProject();
  const sheet = {
    getName: function () { return 'Students'; },
    getLastColumn: function () { return project.requiredHeaders.students.length; },
    getLastRow: function () { return 1; },
    getRange: function (row, column, rowCount, columnCount) {
      return {
        getDisplayValues: function () {
          return [project.requiredHeaders.students.slice(column - 1, column - 1 + columnCount)];
        },
        getValues: function () { return []; }
      };
    }
  };

  assert.equal(project.context.getRecordsAsObjects_('Students').length, 0);
  assert.equal(project.context.getSheetDiagnostic_({
    getSheetByName: function () { return sheet; }
  }, 'students').valid, true);
});
