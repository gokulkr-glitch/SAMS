const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');

function loadAchievementApi(options) {
  options = options || {};
  const context = vm.createContext({});
  const config = fs.readFileSync(path.join(projectRoot, 'Config.js'), 'utf8');
  vm.runInContext(config, context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot, 'Sheets.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot, 'Code.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot, 'Students.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot, 'Achievements.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot, 'Workflow.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot, 'SocialMedia.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot, 'ActivityLog.js'), 'utf8'), context);

  const sheets = Object.create(null);
  const driveFiles = [];
  let uuid = 0;
  let email = Object.prototype.hasOwnProperty.call(options, 'email')
    ? options.email
    : 'mentor@example.org';
  let failedWrite = false;
  const users = options.users || [
    { UserID: 'MENTOR-1', Name: 'Mentor', Email: 'mentor@example.org', Role: 'Mentor', Active: true },
    { UserID: 'VERIFY-1', Name: 'Verifier', Email: 'verifier@example.org', Role: 'Verifier', Active: true }
  ];
  const initialRecords = Object.assign({
    students: [
      { StudentID: 'STU-1', Name: 'Asha Iyer', RollNumber: 'R-1', Grade: '10', Section: 'A', Status: 'Active' },
      { StudentID: 'STU-2', Name: 'Rohan Das', RollNumber: 'R-2', Grade: '10', Section: 'A', Status: 'Active' },
      { StudentID: 'STU-INACTIVE', Name: 'Inactive Student', RollNumber: 'R-3', Grade: '10', Section: 'A', Status: 'Inactive' }
    ],
    users: users
  }, options.records || {});

  Object.keys(context.SAMS_CONFIG.sheetNames).forEach(function (key) {
    const name = context.SAMS_CONFIG.sheetNames[key];
    const headers = options.headers && options.headers[key]
      ? options.headers[key]
      : context.SAMS_CONFIG.requiredHeaders[key];
    const records = initialRecords[key] || [];
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
            return Array.from({ length: rowCount }, function (_, rowOffset) {
              const source = rows[row - 2 + rowOffset] || headers.map(function () { return ''; });
              return source.slice(column - 1, column - 1 + columnCount);
            });
          },
          setValues: function (values) {
            ensureRows();
            values.forEach(function (valuesRow, rowOffset) {
              const target = rows[row - 2 + rowOffset];
              valuesRow.forEach(function (value, columnOffset) {
                target[column - 1 + columnOffset] = value;
              });
            });
            if (!failedWrite && options.failAfterWrite === name) {
              failedWrite = true;
              throw new Error('Simulated spreadsheet write failure.');
            }
          },
          setValue: function (value) {
            ensureRows();
            rows[row - 2][column - 1] = value;
          }
        };
      }
    };
  });

  context.SpreadsheetApp = {
    openById: function () {
      return {
        getSheetByName: function (name) { return sheets[name] || null; }
      };
    }
  };
  context.Session = {
    getActiveUser: function () {
      return { getEmail: function () { return email; } };
    }
  };
  context.LockService = {
    getScriptLock: function () {
      return { waitLock: function () {}, releaseLock: function () {} };
    }
  };
  context.Utilities = {
    getUuid: function () {
      uuid++;
      return 'test-uuid-' + uuid;
    },
    base64Decode: function (value) { return Array.from(Buffer.from(value, 'base64')); },
    base64Encode: function (value) { return Buffer.from(value).toString('base64'); },
    newBlob: function (bytes, mimeType, name) {
      return { bytes: bytes, mimeType: mimeType, name: name };
    }
  };
  context.PropertiesService = {
    getScriptProperties: function () {
      return {
        getProperty: function (name) {
          assert.equal(name, 'SAMS_PROOF_FOLDER_ID');
          return options.evidenceFolderId === undefined
            ? 'configured-private-evidence-folder'
            : options.evidenceFolderId;
        }
      };
    }
  };
  context.DriveApp = {
    getFolderById: function (folderId) {
      if (options.folderInaccessible) {
        throw new Error('Private folder access denied.');
      }
      assert.equal(folderId, options.evidenceFolderId === undefined
        ? 'configured-private-evidence-folder'
        : options.evidenceFolderId);
      return {
        createFile: function (blob) {
          if (options.failDriveAfter !== undefined && driveFiles.length >= options.failDriveAfter) {
            throw new Error('Private Drive error detail.');
          }
          const entry = {
            id: 'drive-file-' + (driveFiles.length + 1),
            name: blob.name,
            trashed: false,
            getId: function () { return entry.id; },
            setTrashed: function (value) {
              if (options.failDriveCleanup) {
                throw new Error('Cleanup error detail.');
              }
              entry.trashed = value;
            }
          };
          driveFiles.push(entry);
          return entry;
        }
      };
    }
  };

  return {
    context: context,
    setEmail: function (value) { email = value; },
    records: function (key) {
      const sheet = sheets[context.SAMS_CONFIG.sheetNames[key]];
      const headers = options.headers && options.headers[key]
        ? options.headers[key]
        : context.SAMS_CONFIG.requiredHeaders[key];
      return sheet.getRange(2, 1, Math.max(1, sheet.getLastRow() - 1), headers.length)
        .getValues()
        .filter(function (row) {
          return row.some(function (value) { return value !== '' && value !== null; });
        })
        .map(function (row) {
          const record = {};
          headers.forEach(function (header, index) { record[header] = row[index]; });
          return record;
        });
    },
    driveFiles: driveFiles
  };
}

function submission(overrides) {
  return Object.assign({
    title: 'Regional Science Fair',
    category: 'Science',
    competitionEvent: 'Regional Expo',
    result: 'First place',
    date: '2026-04-15',
    academicYear: '2025-2026',
    type: 'Individual',
    description: 'Built an accessible water quality sensor.',
    participantIds: ['STU-1'],
    evidenceFiles: [evidenceFile()]
  }, overrides || {});
}

function evidenceFile(overrides) {
  return Object.assign({
    displayFileName: 'certificate.pdf',
    mimeType: 'application/pdf',
    base64: Buffer.from('%PDF-1.7 mock evidence').toString('base64')
  }, overrides || {});
}

test('saves an individual submission with private evidence, timestamps and audit log', function () {
  const api = loadAchievementApi({
    headers: {
      achievements: contextHeaders('achievements').reverse(),
      achievementParticipants: contextHeaders('achievementParticipants').reverse(),
      auditLog: contextHeaders('auditLog').reverse()
    }
  });
  const result = api.context.createAchievementSubmission(Object.assign(submission(), {
    SubmittedBy: 'BROWSER-USER',
    userId: 'BROWSER-USER',
    role: 'Administrator',
    EvidenceFileID: 'public-drive-link'
  }));
  const achievements = api.records('achievements');
  const participants = api.records('achievementParticipants');
  const audit = api.records('auditLog');

  assert.match(result.achievementId, /^ACH-/);
  assert.equal(result.status, 'Pending');
  assert.equal(achievements.length, 1);
  assert.equal(achievements[0].AchievementID, result.achievementId);
  assert.equal(achievements[0].SubmittedBy, 'MENTOR-1');
  assert.equal(achievements[0].Status, 'Pending');
  assert.equal(achievements[0].EvidenceFileID, 'drive-file-1');
  assert.equal(result.evidenceCount, 1);
  const evidenceRows = api.records('achievementEvidence');
  assert.equal(evidenceRows.length, 1);
  assert.equal(evidenceRows[0].AchievementID, result.achievementId);
  assert.equal(evidenceRows[0].DriveFileID, 'drive-file-1');
  assert.equal(evidenceRows[0].FileType, 'PDF');
  assert.equal(evidenceRows[0].DisplayFileName, 'certificate.pdf');
  assert.equal(evidenceRows[0].UploadedBy, 'MENTOR-1');
  assert.equal(api.driveFiles.length, 1);
  assert.equal(api.driveFiles[0].trashed, false);
  assert.equal(Object.prototype.toString.call(achievements[0].CreatedAt), '[object Date]');
  assert.equal(Object.prototype.toString.call(achievements[0].UpdatedAt), '[object Date]');
  assert.equal(participants.length, 1);
  assert.equal(participants[0].StudentID, 'STU-1');
  assert.equal(audit.length, 3);
  assert.equal(audit[0].UserID, 'MENTOR-1');
  assert.equal(audit[0].Action, 'Achievement submitted with evidence');
  assert.equal(audit[1].Action, 'Evidence files uploaded to the configured private folder');
  assert.equal(audit[2].Action, 'Social Media task created automatically');
});

test('persists the achievement package and creates its linked Incoming task for the Social Media board', function () {
  const api = loadAchievementApi();
  const result = api.context.createAchievementSubmission(submission({
    type: 'Team',
    participantIds: ['STU-1', 'STU-2'],
    evidenceFiles: [evidenceFile(), evidenceFile({ displayFileName: 'second.pdf' })]
  }));
  const participants = api.records('achievementParticipants');
  const evidence = api.records('achievementEvidence');
  const tasks = api.records('socialMediaTasks');
  const board = api.context.getSocialMediaTaskBoard();

  assert.equal(result.taskCreated, true);
  assert.equal(result.taskStatus, 'Incoming');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].AchievementID, result.achievementId);
  assert.equal(tasks[0].Status, 'Incoming');
  assert.equal(tasks[0].Platform, '');
  assert.equal(tasks[0].AssignedTo, '');
  assert.equal(tasks[0].Priority, '');
  assert.equal(tasks[0].DueDate, '');
  assert.deepEqual(participants.map(function (row) { return row.StudentID; }), ['STU-1', 'STU-2']);
  assert.equal(evidence.length, 2);
  assert.ok(evidence.every(function (row) { return row.AchievementID === result.achievementId; }));
  assert.equal(board.length, 1);
  assert.equal(board[0].achievementId, result.achievementId);
  assert.equal(board[0].achievementTitle, 'Regional Science Fair');
  assert.deepEqual(JSON.parse(JSON.stringify(board[0].participants.map(function (person) {
    return person.studentId;
  }))), ['STU-1', 'STU-2']);
});

test('keeps a saved achievement when automatic task creation fails and retries idempotently', function () {
  const api = loadAchievementApi({ failAfterWrite: 'SocialMediaTasks' });
  const result = api.context.createAchievementSubmission(submission());

  assert.equal(result.taskCreated, false);
  assert.equal(result.taskStatus, 'Retry required');
  assert.match(result.taskError, /Simulated spreadsheet write failure/);
  assert.equal(result.taskFailureAuditRecorded, true);
  assert.equal(api.records('achievements').length, 1);
  assert.equal(api.records('achievementParticipants').length, 1);
  assert.equal(api.records('achievementEvidence').length, 1);
  assert.equal(api.records('socialMediaTasks').length, 0);
  assert.ok(api.records('auditLog').some(function (row) {
    return row.RecordID === result.achievementId &&
      row.Action.indexOf('Automatic social media task creation failed') === 0;
  }));

  const retried = api.context.retryAchievementSocialMediaTask(result.achievementId);
  const retriedAgain = api.context.retryAchievementSocialMediaTask(result.achievementId);
  assert.equal(retried.status, 'Incoming');
  assert.equal(retriedAgain.taskId, retried.taskId);
  assert.equal(api.records('achievements').length, 1);
  assert.equal(api.records('socialMediaTasks').length, 1);
  assert.equal(api.records('socialMediaTasks')[0].AchievementID, result.achievementId);
});

test('rejects a submission with zero evidence files', function () {
  const api = loadAchievementApi();
  assert.throws(function () {
    api.context.createAchievementSubmission(submission({ evidenceFiles: [] }));
  }, /Attach at least one evidence file/);
  assert.equal(api.records('achievements').length, 0);
  assert.equal(api.driveFiles.length, 0);
});

test('accepts one valid student photo without requiring a certificate', function () {
  const api = loadAchievementApi();
  const photo = {
    displayFileName: 'student-at-awards.jpg',
    mimeType: 'image/jpeg',
    base64: Buffer.from([0xff, 0xd8, 0xff, 0x01]).toString('base64')
  };
  const result = api.context.createAchievementSubmission(submission({
    evidenceFiles: [photo]
  }));

  assert.equal(result.evidenceCount, 1);
  assert.equal(api.records('achievementEvidence').length, 1);
  assert.equal(api.records('achievementEvidence')[0].FileType, 'JPEG');
  assert.equal(api.records('achievementEvidence')[0].DisplayFileName, photo.displayFileName);
});

test('stores multiple evidence files as separate linked records', function () {
  const api = loadAchievementApi();
  const result = api.context.createAchievementSubmission(submission({
    evidenceFiles: [
      evidenceFile({ displayFileName: 'award.pdf' }),
      evidenceFile({
        displayFileName: 'team-photo.jpg',
        mimeType: 'image/jpeg',
        base64: Buffer.from([0xff, 0xd8, 0xff, 0x01]).toString('base64')
      }),
      evidenceFile({
        displayFileName: 'supporting.png',
        mimeType: 'image/png',
        base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')
      })
    ]
  }));
  const rows = api.records('achievementEvidence');
  assert.equal(result.evidenceCount, 3);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(function (row) { return row.DisplayFileName; }),
    ['award.pdf', 'team-photo.jpg', 'supporting.png']);
  assert.ok(rows.every(function (row) { return row.AchievementID === result.achievementId; }));
  assert.deepEqual(rows.map(function (row) { return row.DriveFileID; }),
    ['drive-file-1', 'drive-file-2', 'drive-file-3']);
  assert.equal(api.records('achievements')[0].EvidenceFileID, 'drive-file-1');
});

test('rejects the whole submission when any evidence attachment is invalid', function () {
  const api = loadAchievementApi();
  assert.throws(function () {
    api.context.createAchievementSubmission(submission({
      evidenceFiles: [
        evidenceFile(),
        evidenceFile({ displayFileName: 'notes.txt', mimeType: 'text/plain' })
      ]
    }));
  }, /PDF, JPEG or PNG/);
  assert.equal(api.records('achievements').length, 0);
  assert.equal(api.records('achievementEvidence').length, 0);
  assert.equal(api.driveFiles.length, 0);
});

test('rejects oversized, empty, malformed and excessive evidence', function () {
  const invalid = [
    [[], /at least one evidence file/],
    [[evidenceFile({
      base64: Buffer.concat([
        Buffer.from('%PDF-1.7'),
        Buffer.alloc(1024 * 1024, 0x41)
      ]).toString('base64')
    })], /1 MiB/],
    [[evidenceFile({ base64: '' })], /malformed Base64/],
    [[evidenceFile({ base64: 'bad-encoding' })], /malformed Base64/],
    [[evidenceFile({ base64: Buffer.from('not a PDF file').toString('base64') })],
      /signature does not match/],
    [[evidenceFile(), evidenceFile(), evidenceFile(), evidenceFile()], /no more than 3/]
  ];
  invalid.forEach(function (scenario) {
    const api = loadAchievementApi();
    assert.throws(function () {
      api.context.createAchievementSubmission(submission({ evidenceFiles: scenario[0] }));
    }, scenario[1]);
    assert.equal(api.records('achievements').length, 0);
    assert.equal(api.driveFiles.length, 0);
  });
});

test('fails closed when the configured evidence folder is missing or inaccessible', function () {
  [
    [{ evidenceFolderId: '' }, /not configured/],
    [{ folderInaccessible: true }, /not accessible/]
  ].forEach(function (scenario) {
    const api = loadAchievementApi(scenario[0]);
    assert.throws(function () {
      api.context.createAchievementSubmission(submission());
    }, scenario[1]);
    assert.equal(api.records('achievements').length, 0);
    assert.equal(api.driveFiles.length, 0);
  });
});

test('does not upload evidence for an unauthorized user', function () {
  const api = loadAchievementApi({ email: 'verifier@example.org' });
  assert.throws(function () {
    api.context.createAchievementSubmission(submission());
  }, /Mentor role is required/);
  assert.equal(api.driveFiles.length, 0);
  assert.equal(api.records('achievements').length, 0);
});

test('rolls back sheet rows and trashes new files when a sheet write fails', function () {
  const api = loadAchievementApi({ failAfterWrite: 'AuditLog' });
  assert.throws(function () {
    api.context.createAchievementSubmission(submission({
      evidenceFiles: [evidenceFile(), evidenceFile({ displayFileName: 'second.pdf' })]
    }));
  }, /Simulated spreadsheet write failure/);
  assert.equal(api.records('achievements').length, 0);
  assert.equal(api.records('achievementParticipants').length, 0);
  assert.equal(api.records('achievementEvidence').length, 0);
  assert.equal(api.records('auditLog').length, 1);
  assert.equal(api.records('auditLog')[0].Outcome, 'Failed');
  assert.equal(api.driveFiles.length, 2);
  assert.ok(api.driveFiles.every(function (file) { return file.trashed; }));
});

test('preserves existing legacy evidence references on prior achievements', function () {
  const api = loadAchievementApi({
    records: {
      achievements: [{
        AchievementID: 'ACH-LEGACY',
        Title: 'Old record',
        Status: 'Verified',
        EvidenceFileID: 'legacy-single-file-id'
      }]
    }
  });
  const result = api.context.createAchievementSubmission(submission());
  const rows = api.records('achievements');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].AchievementID, 'ACH-LEGACY');
  assert.equal(rows[0].EvidenceFileID, 'legacy-single-file-id');
  assert.equal(rows[1].AchievementID, result.achievementId);
  assert.equal(rows[1].EvidenceFileID, 'drive-file-1');
});

test('saves a valid team submission with one participant link per selected student', function () {
  const api = loadAchievementApi();
  const result = api.context.createAchievementSubmission(submission({
    type: 'Team',
    participantIds: ['STU-1', 'STU-2']
  }));
  assert.equal(result.status, 'Pending');
  assert.equal(result.evidenceCount, 1);
  assert.deepEqual(api.records('achievementParticipants').map(function (row) {
    return row.StudentID;
  }), ['STU-1', 'STU-2']);
});

test('rejects missing required fields before writing any rows', function () {
  const api = loadAchievementApi();
  assert.throws(function () {
    api.context.createAchievementSubmission(submission({ title: '  ' }));
  }, /Title is required/);
  assert.equal(api.records('achievements').length, 0);
  assert.equal(api.records('achievementParticipants').length, 0);
  assert.equal(api.records('auditLog').length, 1);
  assert.equal(api.records('auditLog')[0].Outcome, 'Failed');
});

test('rejects invalid dates, academic years, types and individual participant counts', function () {
  [
    [{ date: '2026-02-30' }, /valid achievement date/],
    [{ academicYear: '2025-2027' }, /consecutive YYYY-YYYY/],
    [{ type: 'Group' }, /must be Individual or Team/],
    [{ participantIds: ['STU-1', 'STU-2'] }, /exactly one participating student/]
  ].forEach(function (invalid) {
    const api = loadAchievementApi();
    assert.throws(function () {
      api.context.createAchievementSubmission(submission(invalid[0]));
    }, invalid[1]);
    assert.equal(api.records('achievements').length, 0);
  });
});

test('rejects unknown and inactive student IDs', function () {
  ['UNKNOWN', 'STU-INACTIVE'].forEach(function (studentId) {
    const api = loadAchievementApi();
    assert.throws(function () {
      api.context.createAchievementSubmission(submission({ participantIds: [studentId] }));
    }, /does not exist exactly once or is not active/);
    assert.equal(api.records('achievements').length, 0);
  });
});

test('rejects duplicate participant IDs', function () {
  const api = loadAchievementApi();
  assert.throws(function () {
    api.context.createAchievementSubmission(submission({
      type: 'Team',
      participantIds: ['STU-1', 'STU-1']
    }));
  }, /Duplicate participant IDs/);
  assert.equal(api.records('achievements').length, 0);
});

test('blocks approval by a user without verifier permissions', function () {
  const api = loadAchievementApi({
    records: {
      achievements: [pendingAchievement('ACH-PENDING', 'MENTOR-1')]
    }
  });
  assert.throws(function () {
    api.context.reviewAchievement('ACH-PENDING', 'approve', 'Looks good.');
  }, /Verifier, Reviewer or Administrator role/);
  assert.equal(api.records('achievements')[0].Status, 'Pending');
  assert.equal(api.records('auditLog').length, 1);
  assert.equal(api.records('auditLog')[0].Outcome, 'Denied');
});

test('resolves one active user after trimming and case-normalizing email', function () {
  const api = loadAchievementApi({
    email: '  MENTOR@EXAMPLE.ORG ',
    users: [
      { UserID: 'MENTOR-1', Name: 'Mentor', Email: ' mentor@example.org ', Role: 'Mentor', Active: ' TRUE ' },
      { UserID: 'OLD-1', Name: 'Former Mentor', Email: 'mentor@example.org', Role: 'Mentor', Active: 'Inactive' }
    ]
  });
  assert.equal(api.context.getSignedInUser_().userId, 'MENTOR-1');
});

test('supports a single role and multiple comma-separated roles', function () {
  const singleRoleApi = loadAchievementApi();
  const singleAccess = singleRoleApi.context.getAchievementAccess();
  assert.equal(singleAccess.canSubmit, true);
  assert.equal(singleAccess.canReview, false);

  const multipleRoleApi = loadAchievementApi({
    users: [
      {
        UserID: 'MULTI-1',
        Name: 'Mentor Admin',
        Email: 'mentor@example.org',
        Role: ' Mentor , Administrator ',
        Active: true
      }
    ]
  });
  const access = multipleRoleApi.context.getAchievementAccess();
  assert.equal(access.available, true);
  assert.equal(access.canSubmit, true);
  assert.equal(access.canReview, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(multipleRoleApi.context.getSignedInUser_().roles)),
    ['mentor', 'administrator']
  );
});

test('matches comma-separated roles case-insensitively and ignores unknown roles', function () {
  const api = loadAchievementApi({
    users: [
      {
        UserID: 'MIXED-1',
        Name: 'Mixed Role User',
        Email: 'mentor@example.org',
        Role: ' UnknownRole, mEnToR ',
        Active: true
      }
    ]
  });
  const access = api.context.getAchievementAccess();
  assert.equal(access.canSubmit, true);
  assert.equal(access.canReview, false);
});

test('does not grant permissions for unknown or unauthorized roles', function () {
  const api = loadAchievementApi({
    users: [
      {
        UserID: 'UNKNOWN-1',
        Name: 'Unknown Role User',
        Email: 'mentor@example.org',
        Role: 'Observer, DataEntry',
        Active: true
      }
    ]
  });
  const access = api.context.getAchievementAccess();
  assert.equal(access.available, true);
  assert.equal(access.canSubmit, false);
  assert.equal(access.canReview, false);
  assert.throws(function () {
    api.context.createAchievementSubmission(submission());
  }, /Mentor role is required/);
});

test('denies access when Google does not provide an identity', function () {
  const api = loadAchievementApi({ email: '' });
  assert.throws(function () {
    api.context.getSignedInUser_();
  }, /Google did not provide a signed-in user identity/);
  assert.equal(api.context.getAchievementAccess().available, false);
});

test('denies access when no active Users record matches the Google account', function () {
  const api = loadAchievementApi({
    email: 'unknown@example.org',
    users: [
      { UserID: 'DISABLED-1', Name: 'Disabled', Email: 'unknown@example.org', Role: 'Mentor', Active: false }
    ]
  });
  assert.throws(function () {
    api.context.getSignedInUser_();
  }, /No active SAMS user matches/);
});

test('denies access when multiple active Users records match the Google account', function () {
  const api = loadAchievementApi({
    email: 'mentor@example.org',
    users: [
      { UserID: 'MENTOR-1', Name: 'Mentor', Email: 'mentor@example.org', Role: 'Mentor', Active: true },
      { UserID: 'MENTOR-2', Name: 'Duplicate', Email: ' MENTOR@example.org ', Role: 'Mentor', Active: 'Yes' }
    ]
  });
  assert.throws(function () {
    api.context.getSignedInUser_();
  }, /Multiple active SAMS user records match/);
});

test('prevents a submitter from approving their own achievement', function () {
  const api = loadAchievementApi({
    email: 'verifier@example.org',
    records: {
      achievements: [pendingAchievement('ACH-SELF', 'VERIFY-1')]
    }
  });
  assert.throws(function () {
    api.context.reviewAchievement('ACH-SELF', 'approve', 'Looks good.');
  }, /cannot approve or reject their own/);
  assert.equal(api.records('achievements')[0].Status, 'Pending');
  assert.equal(api.records('auditLog').length, 1);
  assert.equal(api.records('auditLog')[0].Outcome, 'Denied');
});

test('a mentor cannot approve or reject their own submission', function () {
  ['approve', 'reject'].forEach(function (decision) {
    const api = loadAchievementApi({
      users: [
        {
          UserID: 'MENTOR-1',
          Name: 'Mentor Reviewer',
          Email: 'mentor@example.org',
          Role: 'Mentor, Verifier',
          Active: true
        }
      ],
      records: {
        achievements: [pendingAchievement('ACH-MENTOR-SELF', 'MENTOR-1')]
      }
    });
    assert.throws(function () {
      api.context.reviewAchievement('ACH-MENTOR-SELF', decision, 'Decision notes.');
    }, /cannot approve or reject their own/);
    assert.equal(api.records('achievements')[0].Status, 'Pending');
    assert.equal(api.records('auditLog').length, 1);
    assert.equal(api.records('auditLog')[0].Outcome, 'Denied');
  });
});

test('a verifier can approve another user submission but not their own', function () {
  const otherSubmission = loadAchievementApi({
    email: 'verifier@example.org',
    records: {
      achievements: [pendingAchievement('ACH-OTHER', 'MENTOR-1')]
    }
  });
  assert.equal(
    otherSubmission.context.reviewAchievement('ACH-OTHER', 'approve', 'Approved.').status,
    'Verified'
  );
  assert.equal(otherSubmission.records('auditLog')[0].UserID, 'VERIFY-1');

  const ownSubmission = loadAchievementApi({
    email: 'verifier@example.org',
    records: {
      achievements: [pendingAchievement('ACH-VERIFIER-SELF', 'VERIFY-1')]
    }
  });
  assert.throws(function () {
    ownSubmission.context.reviewAchievement('ACH-VERIFIER-SELF', 'approve', 'Approved.');
  }, /cannot approve or reject their own/);
  assert.equal(ownSubmission.records('achievements')[0].Status, 'Pending');
  assert.equal(ownSubmission.records('auditLog').length, 1);
  assert.equal(ownSubmission.records('auditLog')[0].Outcome, 'Denied');
});

test('an active administrator can approve their own or another user submission', function () {
  [
    { id: 'ACH-ADMIN-SELF', submitter: 'ADMIN-1', decision: 'approve', status: 'Verified' },
    { id: 'ACH-ADMIN-OTHER', submitter: 'MENTOR-1', decision: 'approve', status: 'Verified' },
    { id: 'ACH-ADMIN-SELF-REJECT', submitter: 'ADMIN-1', decision: 'reject', status: 'Rejected' },
    { id: 'ACH-ADMIN-OTHER-REJECT', submitter: 'MENTOR-1', decision: 'reject', status: 'Rejected' }
  ].forEach(function (scenario) {
    const api = loadAchievementApi({
      email: 'admin@example.org',
      users: [
        {
          UserID: 'ADMIN-1',
          Name: 'Administrator',
          Email: 'admin@example.org',
          Role: 'Mentor, Administrator',
          Active: true
        }
      ],
      records: {
        achievements: [pendingAchievement(scenario.id, scenario.submitter)]
      }
    });
    assert.equal(
      api.context.reviewAchievement(
        scenario.id,
        scenario.decision,
        'Decision by administrator.'
      ).status,
      scenario.status
    );
    if (scenario.decision === 'approve') {
      assert.equal(api.records('achievements')[0].VerifiedBy, 'ADMIN-1');
    }
    assert.equal(api.records('auditLog')[0].UserID, 'ADMIN-1');
  });
});

test('review queue allows an administrator to decide their own item', function () {
  const api = loadAchievementApi({
    email: 'admin@example.org',
    users: [
      {
        UserID: 'ADMIN-1',
        Name: 'Administrator',
        Email: 'admin@example.org',
        Role: 'Mentor, Administrator',
        Active: true
      }
    ],
    records: {
      achievements: [pendingAchievement('ACH-ADMIN-QUEUE', 'ADMIN-1')]
    }
  });
  const queue = api.context.getAchievementReviewQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].canDecide, true);
});

test('inactive or unauthorized users cannot make achievement decisions', function () {
  const inactiveAdmin = loadAchievementApi({
    email: 'admin@example.org',
    users: [
      {
        UserID: 'ADMIN-1',
        Name: 'Inactive Administrator',
        Email: 'admin@example.org',
        Role: 'Administrator',
        Active: false
      }
    ],
    records: {
      achievements: [pendingAchievement('ACH-INACTIVE-ADMIN', 'MENTOR-1')]
    }
  });
  assert.throws(function () {
    inactiveAdmin.context.reviewAchievement('ACH-INACTIVE-ADMIN', 'approve', 'Approved.');
  }, /No active SAMS user matches/);
  assert.equal(inactiveAdmin.records('achievements')[0].Status, 'Pending');

  const unauthorized = loadAchievementApi({
    users: [
      {
        UserID: 'OBSERVER-1',
        Name: 'Observer',
        Email: 'mentor@example.org',
        Role: 'Observer',
        Active: true
      }
    ],
    records: {
      achievements: [pendingAchievement('ACH-OBSERVER', 'MENTOR-1')]
    }
  });
  assert.throws(function () {
    unauthorized.context.reviewAchievement('ACH-OBSERVER', 'reject', 'Rejected.');
  }, /Verifier, Reviewer or Administrator role/);
  assert.equal(unauthorized.records('achievements')[0].Status, 'Pending');
  assert.equal(unauthorized.records('auditLog').length, 1);
  assert.equal(unauthorized.records('auditLog')[0].Outcome, 'Denied');
});

test('browser-supplied identity or role cannot bypass review authorization', function () {
  const api = loadAchievementApi({
    email: 'verifier@example.org',
    records: {
      achievements: [pendingAchievement('ACH-SPOOFED', 'VERIFY-1')]
    }
  });
  assert.throws(function () {
    api.context.reviewAchievement('ACH-SPOOFED', 'approve', 'Forged.', {
      userId: 'ADMIN-1',
      role: 'Administrator',
      roles: ['administrator']
    });
  }, /cannot approve or reject their own/);
  assert.equal(api.records('achievements')[0].Status, 'Pending');
  assert.equal(api.records('auditLog').length, 1);
  assert.equal(api.records('auditLog')[0].Outcome, 'Denied');
});

test('rejects invalid and repeated status transitions', function () {
  const api = loadAchievementApi({
    email: 'verifier@example.org',
    records: {
      achievements: [pendingAchievement('ACH-DONE', 'MENTOR-1', 'Verified')]
    }
  });
  assert.throws(function () {
    api.context.reviewAchievement('ACH-DONE', 'reject', 'Not eligible.');
  }, /Only Pending achievements can be reviewed/);
  assert.equal(api.records('auditLog').length, 1);
  assert.equal(api.records('auditLog')[0].Outcome, 'Failed');
});

test('rolls back submission rows if an audit write fails midway', function () {
  const api = loadAchievementApi({ failAfterWrite: 'AuditLog' });
  assert.throws(function () {
    api.context.createAchievementSubmission(submission());
  }, /Simulated spreadsheet write failure/);
  assert.equal(api.records('achievements').length, 0);
  assert.equal(api.records('achievementParticipants').length, 0);
  assert.equal(api.records('auditLog').length, 1);
  assert.equal(api.records('auditLog')[0].Outcome, 'Failed');
});

test('restores review fields if writing the audit entry fails', function () {
  const api = loadAchievementApi({
    email: 'verifier@example.org',
    failAfterWrite: 'AuditLog',
    records: {
      achievements: [pendingAchievement('ACH-ROLLBACK', 'MENTOR-1')]
    }
  });
  assert.throws(function () {
    api.context.reviewAchievement('ACH-ROLLBACK', 'approve', 'Evidence checked.');
  }, /Simulated spreadsheet write failure/);
  const achievement = api.records('achievements')[0];
  assert.equal(achievement.Status, 'Pending');
  assert.equal(achievement.VerifiedBy, '');
  assert.equal(achievement.VerifiedAt, '');
  assert.equal(api.records('auditLog').length, 1);
  assert.equal(api.records('auditLog')[0].Outcome, 'Failed');
});

test('records reject and return decisions with notes and terminal statuses', function () {
  ['reject', 'return'].forEach(function (decision, index) {
    const api = loadAchievementApi({
      email: 'verifier@example.org',
      records: {
        achievements: [pendingAchievement('ACH-DECISION-' + index, 'MENTOR-1')]
      }
    });
    const result = api.context.reviewAchievement(
      'ACH-DECISION-' + index,
      decision,
      'Decision notes.'
    );
    assert.equal(result.status, decision === 'reject' ? 'Rejected' : 'Returned');
    assert.match(api.records('auditLog')[0].Details, /reviewer notes recorded/);
    assert.equal(api.records('auditLog')[0].UserID, 'VERIFY-1');
  });
});

test('records approval identity, timestamps, decision notes and audits using schema headers', function () {
  const api = loadAchievementApi({
    email: 'verifier@example.org',
    headers: {
      achievements: contextHeaders('achievements').reverse(),
      auditLog: contextHeaders('auditLog').reverse()
    },
    records: {
      achievements: [pendingAchievement('ACH-REVIEW', 'MENTOR-1')]
    }
  });
  const result = api.context.reviewAchievement('ACH-REVIEW', 'approve', 'Evidence checked.');
  const achievement = api.records('achievements')[0];
  const audit = api.records('auditLog')[0];

  assert.equal(result.status, 'Verified');
  assert.equal(achievement.Status, 'Verified');
  assert.equal(achievement.VerifiedBy, 'VERIFY-1');
  assert.equal(Object.prototype.toString.call(achievement.VerifiedAt), '[object Date]');
  assert.equal(Object.prototype.toString.call(achievement.UpdatedAt), '[object Date]');
  assert.equal(audit.UserID, 'VERIFY-1');
  assert.equal(audit.RecordID, 'ACH-REVIEW');
  assert.equal(audit.Action, 'Achievement approved');
  assert.match(audit.Details, /reviewer notes recorded/);
});

function contextHeaders(key) {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(projectRoot, 'Config.js'), 'utf8'), context);
  return Array.from(context.SAMS_CONFIG.requiredHeaders[key]);
}

function pendingAchievement(id, submittedBy, status) {
  return {
    AchievementID: id,
    Title: 'Regional Science Fair',
    Category: 'Science',
    CompetitionEvent: 'Regional Expo',
    Result: 'First place',
    Date: '2026-04-15',
    AcademicYear: '2025-2026',
    Type: 'Individual',
    Status: status || 'Pending',
    Description: 'Built an accessible water quality sensor.',
    SubmittedBy: submittedBy,
    VerifiedBy: '',
    VerifiedAt: '',
    EvidenceFileID: '',
    CreatedAt: new Date('2026-04-16T00:00:00Z'),
    UpdatedAt: new Date('2026-04-16T00:00:00Z')
  };
}
