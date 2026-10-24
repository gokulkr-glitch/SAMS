const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');

function loadStudentApi(overrides) {
  const context = vm.createContext({});
  const sheets = Object.create(null);
  let writeCount = 0;
  vm.runInContext(fs.readFileSync(path.join(projectRoot, 'Config.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot, 'Sheets.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot, 'Students.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot, 'Achievements.js'), 'utf8'), context);
  context.Session = {
    getActiveUser: function () {
      return { getEmail: function () { return 'mentor@example.org'; } };
    }
  };

  Object.keys(context.SAMS_CONFIG.sheetNames).forEach(function (key) {
    const name = context.SAMS_CONFIG.sheetNames[key];
    const headers = overrides.headers && overrides.headers[key]
      ? overrides.headers[key]
      : context.SAMS_CONFIG.requiredHeaders[key];
    const records = overrides.records && overrides.records[key]
      ? overrides.records[key]
      : key === 'users'
        ? [{
          UserID: 'MENTOR-1',
          Name: 'Mentor',
          Email: 'mentor@example.org',
          Role: 'Mentor',
          Active: true
        }]
        : [];
    sheets[name] = {
      getName: function () { return name; },
      getLastColumn: function () { return headers.length; },
      getLastRow: function () { return records.length + 1; },
      getRange: function (row, column, rowCount, columnCount) {
        return {
          getDisplayValues: function () {
            return row === 1 ? [headers.slice(column - 1, column - 1 + columnCount)] : [];
          },
          getValues: function () {
            return records.slice(row - 2, row - 2 + rowCount).map(function (record) {
              return headers.slice(column - 1, column - 1 + columnCount)
                .map(function (header) { return record[header] || ''; });
            });
          },
          setValue: function () { writeCount++; },
          setValues: function () { writeCount++; },
          clear: function () { writeCount++; }
        };
      },
      appendRow: function () { writeCount++; },
      deleteRow: function () { writeCount++; },
      insertRowAfter: function () { writeCount++; }
    };
  });

  context.SpreadsheetApp = {
    openById: function () {
      return {
        getSheetByName: function (name) { return sheets[name] || null; }
      };
    }
  };
  return {
    context: context,
    writeCount: function () { return writeCount; }
  };
}

function student(studentId, name, rollNumber) {
  return {
    StudentID: studentId,
    Name: name,
    RollNumber: rollNumber,
    Grade: '10',
    Section: 'A',
    Status: 'Active'
  };
}

function achievement(id, title, type) {
  return {
    AchievementID: id,
    Title: title,
    Category: 'Science',
    CompetitionEvent: 'Regional Expo',
    Result: 'Winner',
    Date: '2026-04-15',
    AcademicYear: '2025-2026',
    Type: type,
    Status: 'Verified',
    Description: 'Private internal description',
    EvidenceFileID: 'private-drive-id'
  };
}

test('searches by StudentID, name and roll number using case-insensitive partial matches', function () {
  const api = loadStudentApi({
    records: {
      students: [
        student('STU-001', 'Asha Iyer', 'ROLL-1001'),
        student('STU-002', 'Rohan Das', 'ROLL-2002')
      ]
    }
  });

  assert.deepEqual(
    api.context.searchStudents('stu-00').map(function (record) { return record.studentId; }),
    ['STU-001', 'STU-002']
  );
  assert.deepEqual(
    api.context.searchStudents('ASHA').map(function (record) { return record.studentId; }),
    ['STU-001']
  );
  assert.deepEqual(
    api.context.searchStudents('ll-200').map(function (record) { return record.studentId; }),
    ['STU-002']
  );
  assert.deepEqual(Object.keys(api.context.searchStudents('asha')[0]).sort(), [
    'grade', 'name', 'rollNumber', 'section', 'status', 'studentId'
  ]);
  assert.equal(api.writeCount(), 0);
});

test('returns an empty history for a student with no achievements', function () {
  const api = loadStudentApi({
    records: { students: [student('STU-EMPTY', 'No Records', 'R-0')] }
  });

  assert.equal(api.context.getStudentAchievementHistory('STU-EMPTY').length, 0);
  assert.equal(api.writeCount(), 0);
});

test('uses participant links for team achievements and excludes unrelated achievements', function () {
  const api = loadStudentApi({
    records: {
      students: [
        student('STU-001', 'Asha Iyer', 'R-1'),
        student('STU-002', 'Rohan Das', 'R-2'),
        student('STU-003', 'Mira Sen', 'R-3')
      ],
      achievements: [
        achievement('TEAM-1', 'Robotics Challenge', 'Team'),
        achievement('OTHER-1', 'Unrelated Award', 'Individual')
      ],
      achievementParticipants: [
        { AchievementID: 'TEAM-1', StudentID: 'STU-001', RoleContribution: 'Builder' },
        { AchievementID: 'TEAM-1', StudentID: 'STU-002', RoleContribution: 'Designer' },
        { AchievementID: 'OTHER-1', StudentID: 'STU-003', RoleContribution: 'Participant' }
      ]
    }
  });

  const ashaHistory = api.context.getStudentAchievementHistory('STU-001');
  const rohanHistory = api.context.getStudentAchievementHistory('STU-002');
  const miraHistory = api.context.getStudentAchievementHistory('STU-003');
  assert.deepEqual(ashaHistory.map(function (item) { return item.title; }), ['Robotics Challenge']);
  assert.deepEqual(rohanHistory.map(function (item) { return item.title; }), ['Robotics Challenge']);
  assert.deepEqual(miraHistory.map(function (item) { return item.title; }), ['Unrelated Award']);
  assert.deepEqual(Object.keys(ashaHistory[0]).sort(), [
    'academicYear', 'achievementId', 'canDelete', 'category', 'competitionEvent', 'date',
    'result', 'status', 'title', 'type'
  ]);
  assert.equal(JSON.stringify(ashaHistory).includes('private-drive-id'), false);
  assert.equal(JSON.stringify(ashaHistory).includes('Private internal description'), false);
  assert.equal(api.writeCount(), 0);
});

test('history marks only the authenticated Mentor submitter as eligible for deletion', function () {
  const api = loadStudentApi({
    records: {
      students: [student('STU-001', 'Asha Iyer', 'R-1')],
      achievements: [
        Object.assign(achievement('OWN-1', 'Own achievement', 'Individual'), {
          SubmittedBy: 'MENTOR-1'
        }),
        Object.assign(achievement('OTHER-1', 'Other achievement', 'Individual'), {
          SubmittedBy: 'OTHER-USER'
        })
      ],
      achievementParticipants: [
        { AchievementID: 'OWN-1', StudentID: 'STU-001' },
        { AchievementID: 'OTHER-1', StudentID: 'STU-001' }
      ]
    }
  });
  const history = api.context.getStudentAchievementHistory('STU-001');
  assert.deepEqual(history.map(function (item) {
    return [item.achievementId, item.canDelete];
  }), [['OWN-1', true], ['OTHER-1', false]]);
  assert.equal(api.writeCount(), 0);
});

test('uses legacy individual StudentID links only when that actual header exists', function () {
  const baseRecords = {
    students: [student('STU-001', 'Asha Iyer', 'R-1')],
    achievements: [achievement('LEGACY-1', 'Legacy award', 'Individual')],
    achievementParticipants: []
  };
  const withoutLegacyColumn = loadStudentApi({ records: baseRecords });
  assert.equal(withoutLegacyColumn.context.getStudentAchievementHistory('STU-001').length, 0);

  const legacyHeaders = [
    ...withoutLegacyColumn.context.SAMS_CONFIG.requiredHeaders.achievements,
    'StudentID'
  ];
  const withLegacyColumn = loadStudentApi({
    headers: { achievements: legacyHeaders },
    records: {
      ...baseRecords,
      achievements: [Object.assign(achievement('LEGACY-1', 'Legacy award', 'Individual'), {
        StudentID: 'STU-001'
      })]
    }
  });
  assert.deepEqual(
    withLegacyColumn.context.getStudentAchievementHistory('STU-001')
      .map(function (item) { return item.title; }),
    ['Legacy award']
  );
  assert.equal(withLegacyColumn.writeCount(), 0);
});

test('rejects missing and unknown student IDs safely', function () {
  const api = loadStudentApi({
    records: { students: [student('STU-001', 'Asha Iyer', 'R-1')] }
  });

  assert.throws(function () {
    api.context.getStudentAchievementHistory('');
  }, /valid StudentID/);
  assert.throws(function () {
    api.context.getStudentAchievementHistory('NOT-FOUND');
  }, /could not be found/);
  assert.equal(api.writeCount(), 0);
});
