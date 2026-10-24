const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');

function loadActivityApi(options) {
  options = options || {};
  const context = vm.createContext({});
  [
    'Config.js', 'Sheets.js', 'Code.js', 'Achievements.js', 'SocialMedia.js',
    'Workflow.js', 'ActivityLog.js'
  ].forEach(function (file) {
    vm.runInContext(fs.readFileSync(path.join(projectRoot, file), 'utf8'), context);
  });

  const sheets = Object.create(null);
  let uuid = 0;
  let email = options.email || 'admin@example.org';
  const records = Object.assign({
    users: [
      { UserID: 'ADMIN-1', Name: 'School Administrator', Email: 'admin@example.org', Role: 'Administrator', Active: true },
      { UserID: 'SOCIAL-1', Name: 'Social Manager', Email: 'social@example.org', Role: 'SocialMedia', Active: true },
      { UserID: 'MENTOR-1', Name: 'Achievement Mentor', Email: 'mentor@example.org', Role: 'Mentor', Active: true }
    ]
  }, options.records || {});

  Object.keys(context.SAMS_CONFIG.sheetNames).forEach(function (key) {
    const name = context.SAMS_CONFIG.sheetNames[key];
    const headers = context.SAMS_CONFIG.requiredHeaders[key];
    const rows = [headers].concat((records[key] || []).map(function (record) {
      return headers.map(function (header) {
        return Object.prototype.hasOwnProperty.call(record, header) ? record[header] : '';
      });
    }));
    sheets[name] = {
      getName: function () { return name; },
      getLastColumn: function () { return headers.length; },
      getLastRow: function () { return rows.length; },
      getRange: function (row, column, rowCount, columnCount) {
        return {
          getDisplayValues: function () {
            return [rows[0].slice(column - 1, column - 1 + columnCount)];
          },
          getValues: function () {
            return Array.from({ length: rowCount }, function (_, offset) {
              const source = rows[row - 1 + offset] || headers.map(function () { return ''; });
              return source.slice(column - 1, column - 1 + columnCount);
            });
          },
          setValues: function (values) {
            if (options.failAuditWrite && name === context.SAMS_CONFIG.sheetNames.auditLog) {
              throw new Error('Simulated audit write failure.');
            }
            if (options.failRestoreWrite === name) {
              return;
            }
            values.forEach(function (valuesRow, rowOffset) {
              const targetIndex = row - 1 + rowOffset;
              while (rows.length <= targetIndex) {
                rows.push(headers.map(function () { return ''; }));
              }
              valuesRow.forEach(function (value, columnOffset) {
                rows[targetIndex][column - 1 + columnOffset] = value;
              });
            });
          },
          setValue: function (value) {
            while (rows.length < row) {
              rows.push(headers.map(function () { return ''; }));
            }
            rows[row - 1][column - 1] = value;
          }
        };
      },
      deleteRow: function (rowNumber) {
        if (options.failDeleteSheet === name) {
          throw new Error('Simulated row deletion failure.');
        }
        rows.splice(rowNumber - 1, 1);
        if (options.failAfterDeleteSheet === name) {
          throw new Error('Simulated failure after deleting a row.');
        }
      },
      insertRowsBefore: function (rowNumber, count) {
        if (options.failRestoreSheet === name) {
          throw new Error('Simulated row restoration failure.');
        }
        for (let index = 0; index < count; index++) {
          rows.splice(rowNumber - 1, 0, headers.map(function () { return ''; }));
        }
      }
    };
  });

  context.SpreadsheetApp = {
    openById: function () {
      return { getSheetByName: function (name) { return sheets[name] || null; } };
    }
  };
  context.Session = {
    getActiveUser: function () { return { getEmail: function () { return email; } }; },
    getScriptTimeZone: function () { return 'Asia/Kolkata'; }
  };
  context.LockService = {
    getScriptLock: function () {
      return { waitLock: function () {}, releaseLock: function () {} };
    }
  };
  context.Utilities = {
    getUuid: function () { uuid++; return 'activity-test-' + uuid; },
    formatDate: function (date, timeZone, pattern) {
      assert.equal(timeZone, 'Asia/Kolkata');
      const day = date.toISOString().slice(0, 10);
      return pattern === 'yyyy-MM-dd' ? day : day + ' 08:30:00';
    }
  };

  return {
    context: context,
    records: function (key) {
      const headers = context.SAMS_CONFIG.requiredHeaders[key];
      const rows = sheets[context.SAMS_CONFIG.sheetNames[key]].getRange(
        2, 1, Math.max(0, sheets[context.SAMS_CONFIG.sheetNames[key]].getLastRow() - 1), headers.length
      ).getValues();
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

function auditEntry(id, overrides) {
  return Object.assign({
    LogID: 'LOG-' + id,
    UserID: 'ADMIN-1',
    ActorName: 'School Administrator',
    ActorEmail: 'admin@example.org',
    ActionType: 'Achievement submission',
    Action: 'Achievement submitted',
    Outcome: 'Successful',
    Details: 'Saved.',
    EntityType: 'Achievement',
    RecordID: 'ACH-' + id,
    CorrelationID: 'ACH-' + id,
    Timestamp: new Date('2026-10-01T03:00:00.000Z')
  }, overrides || {});
}

test('authorizes Administrators, filters records safely, and returns newest bounded pages', function () {
  const entries = Array.from({ length: 55 }, function (_, index) {
    return auditEntry(index + 1, {
      ActionType: index === 54 ? 'Evidence upload' : 'Achievement submission',
      Outcome: index === 54 ? 'Failed' : 'Successful',
      RecordID: index === 54 ? 'ACH-55' : 'ACH-' + (index + 1),
      CorrelationID: 'ACH-' + (index + 1),
      Timestamp: new Date(Date.UTC(2026, 9, 1, 3, index))
    });
  });
  entries[54].Details = 'Failure at https://drive.google.com/file/d/private and secret@example.org';
  const api = loadActivityApi({ records: { auditLog: entries } });

  const first = api.context.getActivityLog({});
  assert.equal(first.entries.length, 50);
  assert.equal(first.hasMore, true);
  assert.equal(first.entries[0].logId, 'LOG-55');
  assert.equal(first.timeZone, 'Asia/Kolkata');
  assert.equal(first.entries[0].actorName, 'School Administrator');
  assert.equal(first.entries[0].actorEmail, 'admin@example.org');
  assert.doesNotMatch(first.entries[0].details, /drive\.google|secret@example/);

  const second = api.context.getActivityLog({ cursor: first.nextCursor });
  assert.equal(second.entries.length, 5);
  assert.equal(second.hasMore, false);

  const filtered = api.context.getActivityLog({
    fromDate: '2026-10-01',
    toDate: '2026-10-01',
    actor: 'administrator',
    actionType: 'Evidence upload',
    outcome: 'Failed',
    reference: 'ACH-55'
  });
  assert.equal(filtered.entries.length, 1);
  assert.equal(filtered.entries[0].recordId, 'ACH-55');
});

test('normalizes blank legacy outcomes consistently for display and filtering', function () {
  const api = loadActivityApi({
    records: {
      auditLog: [
        auditEntry(1, { Outcome: '' }),
        auditEntry(2, { Outcome: 'Successful' }),
        auditEntry(3, { Outcome: 'Failed' }),
        auditEntry(4, { Outcome: 'Denied' }),
        auditEntry(5, { Outcome: 'Recorded' }),
        auditEntry(6, { Outcome: 'Legacy unknown' })
      ]
    }
  });

  const recorded = api.context.getActivityLog({ outcome: 'Recorded' });
  assert.deepEqual(JSON.parse(JSON.stringify(recorded.entries.map(function (entry) {
    return entry.logId;
  }))), ['LOG-6', 'LOG-5', 'LOG-1']);
  assert.deepEqual(JSON.parse(JSON.stringify(recorded.entries.map(function (entry) {
    return entry.outcome;
  }))), ['Recorded', 'Recorded', 'Recorded']);

  const successful = api.context.getActivityLog({ outcome: 'Successful' });
  assert.deepEqual(JSON.parse(JSON.stringify(successful.entries.map(function (entry) {
    return entry.logId;
  }))), ['LOG-2']);
  assert.equal(successful.entries[0].outcome, 'Successful');

  ['Failed', 'Denied'].forEach(function (outcome, index) {
    const result = api.context.getActivityLog({ outcome: outcome });
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].logId, 'LOG-' + (3 + index));
    assert.equal(result.entries[0].outcome, outcome);
  });
});

test('bounds filtered scans and continues to older rows on the next page', function () {
  const entries = Array.from({ length: 2601 }, function (_, index) {
    return auditEntry(index + 1, {
      ActorName: index === 0 ? 'Rare matching actor' : 'School Administrator',
      Timestamp: new Date(Date.UTC(2026, 9, 1, 3, index % 60))
    });
  });
  const api = loadActivityApi({ records: { auditLog: entries } });
  const first = api.context.getActivityLog({ actor: 'rare matching actor' });

  assert.equal(first.entries.length, 0);
  assert.equal(first.hasMore, true);
  const second = api.context.getActivityLog({
    actor: 'rare matching actor',
    cursor: first.nextCursor
  });
  assert.equal(second.entries.length, 1);
  assert.equal(second.entries[0].actorName, 'Rare matching actor');
  assert.equal(second.hasMore, false);
});

test('denies non-Administrators and records the denied access attempt', function () {
  const api = loadActivityApi({ email: 'social@example.org' });
  assert.throws(function () {
    api.context.getActivityLog({});
  }, /Administrator role is required/);
  const log = api.records('auditLog');
  assert.equal(log.length, 1);
  assert.equal(log[0].ActionType, 'Access denied');
  assert.equal(log[0].Outcome, 'Denied');
  assert.equal(log[0].UserID, 'SOCIAL-1');
});

test('reports when a denied Activity Log access attempt cannot be audited', function () {
  const api = loadActivityApi({ email: 'social@example.org', failAuditWrite: true });
  assert.throws(function () {
    api.context.getActivityLog({});
  }, /denied attempt could not be logged: Simulated audit write failure/);
});

test('Administrator deletion preserves publication-history tasks and records their references', function () {
  const api = loadActivityApi({
    records: {
      achievements: [{
        AchievementID: 'ACH-DELETE',
        Title: 'Old achievement',
        SubmittedBy: 'MENTOR-1'
      }],
      achievementParticipants: [{ AchievementID: 'ACH-DELETE', StudentID: 'STU-1' }],
      achievementEvidence: [{ EvidenceID: 'EVD-1', AchievementID: 'ACH-DELETE', DriveFileID: 'private-file-id' }],
      mediaAssets: [{ AssetID: 'MEDIA-1', AchievementID: 'ACH-DELETE' }],
      socialMediaTasks: [
        { TaskID: 'SMT-UNPUBLISHED', AchievementID: 'ACH-DELETE' },
        { TaskID: 'SMT-URL', AchievementID: 'ACH-DELETE', PostURL: 'https://example.org/post' },
        { TaskID: 'SMT-PUBLISHED', AchievementID: 'ACH-DELETE', PublishedAt: new Date() },
        { TaskID: 'SMT-COMPLETED', AchievementID: 'ACH-DELETE', CompletedAt: new Date() },
        { TaskID: 'SMT-SCREENSHOT', AchievementID: 'ACH-DELETE', ScreenshotFileID: 'proof-reference' }
      ],
      auditLog: [auditEntry('SMT-URL', {
        EntityType: 'Social Media task',
        RecordID: 'SMT-URL',
        Action: 'Historical task action'
      })]
    }
  });
  const result = api.context.deleteAchievement('ACH-DELETE', {
    userId: 'SPOOFED-USER',
    role: 'Mentor'
  });
  assert.equal(result.deleted, true);
  ['achievements', 'achievementParticipants', 'achievementEvidence', 'mediaAssets']
    .forEach(function (key) { assert.equal(api.records(key).length, 0); });
  assert.deepEqual(JSON.parse(JSON.stringify(api.records('socialMediaTasks').map(function (task) {
    return task.TaskID;
  }))), ['SMT-URL', 'SMT-PUBLISHED', 'SMT-COMPLETED', 'SMT-SCREENSHOT']);
  const log = api.records('auditLog');
  assert.equal(log[0].Action, 'Historical task action');
  assert.equal(log[1].Action, 'Achievement deletion requested');
  assert.equal(log[1].Outcome, 'Recorded');
  assert.match(log[1].Details, /SMT-URL/);
  const successLog = log[2];
  assert.equal(successLog.Action, 'Achievement and linked sheet records deleted');
  assert.equal(successLog.RecordID, 'ACH-DELETE');
  assert.equal(successLog.Outcome, 'Successful');
  assert.match(successLog.Details, /SMT-UNPUBLISHED/);
  assert.match(successLog.Details, /SMT-SCREENSHOT/);
  assert.equal(successLog.UserID, 'ADMIN-1');
  assert.equal(successLog.ActorEmail, 'admin@example.org');
});

test('Mentor can delete an own achievement but cannot delete another user achievement', function () {
  const ownAchievementApi = loadActivityApi({
    email: 'mentor@example.org',
    records: {
      achievements: [{ AchievementID: 'ACH-OWN', SubmittedBy: 'MENTOR-1' }]
    }
  });
  assert.equal(ownAchievementApi.context.deleteAchievement('ACH-OWN').deleted, true);
  assert.equal(ownAchievementApi.records('achievements').length, 0);
  const ownOutcome = ownAchievementApi.records('auditLog').slice(-1)[0];
  assert.equal(ownOutcome.UserID, 'MENTOR-1');
  assert.equal(ownOutcome.Outcome, 'Successful');

  const otherAchievementApi = loadActivityApi({
    email: 'mentor@example.org',
    records: {
      achievements: [{ AchievementID: 'ACH-OTHER', SubmittedBy: 'OTHER-USER' }]
    }
  });
  assert.throws(function () {
    otherAchievementApi.context.deleteAchievement('ACH-OTHER');
  }, /Mentors can delete only their own achievements/);
  assert.equal(otherAchievementApi.records('achievements').length, 1);
  const denial = otherAchievementApi.records('auditLog')[0];
  assert.equal(denial.UserID, 'MENTOR-1');
  assert.equal(denial.Outcome, 'Denied');
});

test('deleted achievements cannot be recreated by automatic retry or manual task creation', function () {
  const api = loadActivityApi({
    records: {
      achievements: [{
        AchievementID: 'ACH-DELETE',
        Title: 'Removed achievement',
        Status: 'Verified',
        SubmittedBy: 'MENTOR-1'
      }],
      socialMediaTasks: [{
        TaskID: 'SMT-PUBLISHED',
        AchievementID: 'ACH-DELETE',
        PostURL: 'https://example.org/post'
      }],
      auditLog: [auditEntry('SMT-PUBLISHED', {
        EntityType: 'Social Media task',
        RecordID: 'SMT-PUBLISHED',
        Action: 'Task publication history'
      })]
    }
  });
  api.context.deleteAchievement('ACH-DELETE');
  const taskCountAfterDeletion = api.records('socialMediaTasks').length;

  api.setEmail('mentor@example.org');
  assert.throws(function () {
    api.context.retryAchievementSocialMediaTask('ACH-DELETE');
  }, /linked achievement does not exist/);
  assert.equal(api.records('socialMediaTasks').length, taskCountAfterDeletion);

  api.setEmail('social@example.org');
  assert.throws(function () {
    api.context.createSocialMediaTask({
      achievementId: 'ACH-DELETE',
      platform: 'Instagram'
    });
  }, /Only Verified achievements are eligible/);
  assert.equal(api.records('socialMediaTasks').length, taskCountAfterDeletion);
  assert.ok(api.records('auditLog').some(function (entry) {
    return entry.Action === 'Task publication history';
  }));
});

test('restores removed sheet rows and records failure when deletion is partial', function () {
  const api = loadActivityApi({
    failDeleteSheet: 'AchievementParticipants',
    records: {
      achievements: [{ AchievementID: 'ACH-DELETE', Title: 'Old achievement' }],
      achievementParticipants: [{ AchievementID: 'ACH-DELETE', StudentID: 'STU-1' }],
      achievementEvidence: [{ EvidenceID: 'EVD-1', AchievementID: 'ACH-DELETE', DriveFileID: 'private-file-id' }]
    }
  });
  assert.throws(function () {
    api.context.deleteAchievement('ACH-DELETE');
  }, /Deletion failed; removed sheet rows were restored/);
  assert.equal(api.records('achievements').length, 1);
  assert.equal(api.records('achievementParticipants').length, 1);
  assert.equal(api.records('achievementEvidence').length, 1);
  const log = api.records('auditLog');
  assert.equal(log[log.length - 1].Outcome, 'Failed');
  assert.match(log[log.length - 1].Action, /deletion failed and restored/);
});

test('reports and logs incomplete deletion recovery', function () {
  const api = loadActivityApi({
    failDeleteSheet: 'AchievementParticipants',
    failRestoreSheet: 'AchievementEvidence',
    records: {
      achievements: [{ AchievementID: 'ACH-DELETE' }],
      achievementEvidence: [{
        EvidenceID: 'EVD-1',
        AchievementID: 'ACH-DELETE',
        DriveFileID: 'private-file-id'
      }],
      achievementParticipants: [{ AchievementID: 'ACH-DELETE', StudentID: 'STU-1' }]
    }
  });
  assert.throws(function () {
    api.context.deleteAchievement('ACH-DELETE');
  }, /automatic recovery was incomplete/);
  assert.equal(api.records('achievements').length, 1);
  assert.equal(api.records('achievementEvidence').length, 0);
  const failure = api.records('auditLog').slice(-1)[0];
  assert.equal(failure.Outcome, 'Failed');
  assert.match(failure.Action, /recovery incomplete/);
  assert.match(failure.Details, /AchievementEvidence/);
});

test('verifies restored row contents before reporting recovery success', function () {
  const api = loadActivityApi({
    failDeleteSheet: 'AchievementParticipants',
    failRestoreWrite: 'AchievementEvidence',
    records: {
      achievements: [{ AchievementID: 'ACH-DELETE' }],
      achievementEvidence: [{
        EvidenceID: 'EVD-1',
        AchievementID: 'ACH-DELETE',
        DriveFileID: 'private-file-id'
      }],
      achievementParticipants: [{ AchievementID: 'ACH-DELETE', StudentID: 'STU-1' }]
    }
  });
  assert.throws(function () {
    api.context.deleteAchievement('ACH-DELETE');
  }, /automatic recovery was incomplete/);
  const failure = api.records('auditLog').slice(-1)[0];
  assert.equal(failure.Outcome, 'Failed');
  assert.match(failure.Action, /recovery incomplete/);
});

test('does not delete achievement rows when the request audit cannot be written', function () {
  const api = loadActivityApi({
    failAuditWrite: true,
    records: { achievements: [{ AchievementID: 'ACH-DELETE' }] }
  });
  assert.throws(function () {
    api.context.deleteAchievement('ACH-DELETE');
  }, /Simulated audit write failure/);
  assert.equal(api.records('achievements').length, 1);
});

test('detects and restores a row deleted before the sheet operation reports failure', function () {
  const api = loadActivityApi({
    failAfterDeleteSheet: 'AchievementParticipants',
    records: {
      achievements: [{ AchievementID: 'ACH-DELETE', Title: 'Old achievement' }],
      achievementParticipants: [{ AchievementID: 'ACH-DELETE', StudentID: 'STU-1' }]
    }
  });
  assert.throws(function () {
    api.context.deleteAchievement('ACH-DELETE');
  }, /Deletion failed; removed sheet rows were restored/);
  assert.equal(api.records('achievements').length, 1);
  assert.equal(api.records('achievementParticipants').length, 1);
  const log = api.records('auditLog');
  assert.equal(log[log.length - 1].Outcome, 'Failed');
  assert.match(log[log.length - 1].Action, /deletion failed and restored/);
});

test('rejects deletion by non-Administrators and records the attempt', function () {
  const api = loadActivityApi({
    email: 'social@example.org',
    records: { achievements: [{ AchievementID: 'ACH-KEEP' }] }
  });
  assert.throws(function () {
    api.context.deleteAchievement('ACH-KEEP');
  }, /Mentor or Administrator role is required/);
  assert.equal(api.records('achievements').length, 1);
  assert.equal(api.records('auditLog')[0].Outcome, 'Denied');
});

test('inactive Administrators cannot retrieve the Activity Log', function () {
  const api = loadActivityApi({
    records: {
      users: [
        { UserID: 'ADMIN-1', Name: 'School Administrator', Email: 'admin@example.org', Role: 'Administrator', Active: false }
      ]
    }
  });
  assert.throws(function () {
    api.context.getActivityLog({});
  }, /No active SAMS user matches/);
});
