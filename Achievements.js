var SAMS_ACHIEVEMENT_STATUSES = {
  pending: 'Pending',
  approved: 'Verified',
  rejected: 'Rejected',
  returned: 'Returned'
};

var SAMS_MAX_ACHIEVEMENT_EVIDENCE_FILES = 3;
var SAMS_MAX_ACHIEVEMENT_EVIDENCE_FILE_BYTES = 1024 * 1024;
var SAMS_MAX_ACHIEVEMENT_EVIDENCE_TOTAL_BYTES = 3 * 1024 * 1024;
var SAMS_MAX_ACHIEVEMENT_EVIDENCE_REQUEST_CHARS = 4200000;

function getSignedInUser_() {
  var email = '';
  try {
    email = Session.getActiveUser().getEmail();
  } catch (error) {
    throw new Error('Google could not verify your signed-in identity. Ask the administrator to configure the web-app deployment.');
  }
  if (typeof email !== 'string' || !email.trim()) {
    throw new Error('Google did not provide a signed-in user identity. Configure the web app to execute as the accessing user and restrict access to signed-in users.');
  }

  var normalizedEmail = normalizeIdentityEmail_(email);
  requireHeaders_(getSheetByName_(SAMS_CONFIG.sheetNames.users), [
    'UserID', 'Name', 'Email', 'Role', 'Active'
  ]);
  var matches = getRecordsAsObjects_(SAMS_CONFIG.sheetNames.users)
    .filter(function (user) {
      return normalizeIdentityEmail_(user.Email) === normalizedEmail &&
        isActiveUser_(user.Active);
    });
  if (!matches.length) {
    throw new Error('No active SAMS user matches the signed-in Google account. Check the Users.Email and Users.Active values.');
  }
  if (matches.length > 1) {
    throw new Error('Multiple active SAMS user records match the signed-in Google account. Resolve duplicate active Users records.');
  }
  if (!String(matches[0].UserID || '').trim() || !String(matches[0].Role || '').trim()) {
    throw new Error('Your SAMS user record is missing a UserID or Role.');
  }

  return {
    userId: String(matches[0].UserID).trim(),
    name: String(matches[0].Name || '').trim(),
    email: normalizedEmail,
    role: String(matches[0].Role).trim().toLowerCase(),
    roles: parseUserRoles_(matches[0].Role)
  };
}

function parseUserRoles_(value) {
  if (typeof value !== 'string') {
    return [];
  }
  var roles = [];
  value.split(',').forEach(function (role) {
    var normalizedRole = role.trim().toLowerCase();
    if (normalizedRole && roles.indexOf(normalizedRole) === -1) {
      roles.push(normalizedRole);
    }
  });
  return roles;
}

function userHasAnyRole_(user, acceptedRoles) {
  var roles = user && Array.isArray(user.roles)
    ? user.roles
    : parseUserRoles_(user && user.role);
  return roles.some(function (role) {
    return acceptedRoles.indexOf(role) !== -1;
  });
}

function normalizeIdentityEmail_(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isActiveUser_(value) {
  var normalized = String(value).trim().toLowerCase();
  return value === true || ['true', 'active', 'yes', 'y', '1'].indexOf(normalized) !== -1;
}

function canSubmitAchievements_(user) {
  return userHasAnyRole_(user, ['mentor']);
}

function canReviewAchievements_(user) {
  return userHasAnyRole_(user, ['verifier', 'reviewer', 'admin', 'administrator']);
}

function isAchievementAdministrator_(user) {
  return userHasAnyRole_(user, ['admin', 'administrator']);
}

function getAchievementAccess() {
  try {
    var user = getSignedInUser_();
    return {
      available: true,
      displayName: user.name,
      canSubmit: canSubmitAchievements_(user),
      canReview: canReviewAchievements_(user),
      isAdministrator: isAchievementAdministrator_(user)
    };
  } catch (error) {
    return { available: false, message: error.message, canSubmit: false, canReview: false };
  }
}

function requireAchievementRole_(permission) {
  var user = getSignedInUser_();
  var allowed = permission === 'submit'
    ? canSubmitAchievements_(user)
    : canReviewAchievements_(user);
  if (!allowed) {
    var message = permission === 'submit'
      ? 'An active SAMS user with the Mentor role is required to submit achievements.'
      : 'An active SAMS user with a Verifier, Reviewer or Administrator role is required to review achievements.';
    try {
      recordActivityEvent_(user, {
        actionType: 'Access denied',
        action: permission === 'submit'
          ? 'Achievement submission access denied'
          : 'Achievement review access denied',
        outcome: 'Denied',
        details: 'The signed-in user does not have the role required for this action.',
        entityType: 'Achievement'
      });
    } catch (auditError) {
      throw new Error(message + ' The denied attempt could not be recorded in the Activity Log: ' + auditError.message);
    }
    throw new Error(message);
  }
  return user;
}

function validateAchievementSubmission_(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Achievement submission data is required.');
  }
  var textFields = [
    ['title', 'Title'],
    ['category', 'Category'],
    ['competitionEvent', 'Competition/event'],
    ['result', 'Result'],
    ['academicYear', 'Academic year'],
    ['description', 'Description']
  ];
  var values = {};
  textFields.forEach(function (field) {
    var value = payload[field[0]];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(field[1] + ' is required.');
    }
    values[field[0]] = value.trim();
  });
  if (values.title.length > 200 || values.category.length > 100 ||
      values.competitionEvent.length > 200 || values.result.length > 100 ||
      values.description.length > 5000) {
    throw new Error('One or more achievement fields exceed the allowed length.');
  }

  if (payload.type !== 'Individual' && payload.type !== 'Team') {
    throw new Error('Achievement type must be Individual or Team.');
  }
  if (!/^\d{4}-\d{4}$/.test(values.academicYear) ||
      Number(values.academicYear.slice(5)) !== Number(values.academicYear.slice(0, 4)) + 1) {
    throw new Error('Academic year must use the consecutive YYYY-YYYY format.');
  }
  if (typeof payload.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(payload.date) ||
      !isRealCalendarDate_(payload.date)) {
    throw new Error('A valid achievement date is required.');
  }
  if (!Array.isArray(payload.participantIds) || !payload.participantIds.length) {
    throw new Error('Select at least one participating student.');
  }

  var participantIds = [];
  var seenIds = {};
  payload.participantIds.forEach(function (studentId) {
    if (typeof studentId !== 'string' || !studentId.trim()) {
      throw new Error('Every participant must have a valid StudentID.');
    }
    var normalizedId = studentId.trim();
    if (seenIds[normalizedId]) {
      throw new Error('Duplicate participant IDs are not allowed.');
    }
    seenIds[normalizedId] = true;
    participantIds.push(normalizedId);
  });
  if (payload.type === 'Individual' && participantIds.length !== 1) {
    throw new Error('Individual achievements must have exactly one participating student.');
  }

  values.type = payload.type;
  values.date = payload.date;
  values.participantIds = participantIds;
  return values;
}

function validateAchievementEvidenceFiles_(evidenceFiles) {
  if (!Array.isArray(evidenceFiles) || evidenceFiles.length === 0) {
    throw new Error('Attach at least one evidence file before submitting.');
  }
  if (evidenceFiles.length > SAMS_MAX_ACHIEVEMENT_EVIDENCE_FILES) {
    throw new Error('Attach no more than ' + SAMS_MAX_ACHIEVEMENT_EVIDENCE_FILES + ' evidence files.');
  }

  var allowedTypes = {
    'application/pdf': { extension: 'pdf', type: 'PDF' },
    'image/jpeg': { extension: 'jpg', type: 'JPEG' },
    'image/png': { extension: 'png', type: 'PNG' }
  };
  var totalBytes = 0;
  var totalBase64Chars = 0;
  var evidence = evidenceFiles.map(function (item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('An evidence attachment is invalid.');
    }
    if (item.folderId !== undefined || item.destinationFolderId !== undefined ||
        item.fileId !== undefined || item.driveFileId !== undefined) {
      throw new Error('Evidence attachments cannot specify a Drive folder or file ID.');
    }
    if (typeof item.displayFileName !== 'string' || !item.displayFileName.trim() ||
        item.displayFileName.length > 255) {
      throw new Error('Each evidence file must have a valid filename.');
    }
    var fileType = allowedTypes[item.mimeType];
    if (!fileType) {
      throw new Error('Evidence files must be PDF, JPEG or PNG.');
    }
    if (typeof item.base64 !== 'string' || !item.base64) {
      throw new Error('An evidence file has malformed Base64 data.');
    }
    if (item.base64.length > Math.ceil(SAMS_MAX_ACHIEVEMENT_EVIDENCE_FILE_BYTES / 3) * 4) {
      throw new Error('Each evidence file must be larger than 0 bytes and no larger than 1 MiB.');
    }
    if (item.base64.length % 4 !== 0 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.base64)) {
      throw new Error('An evidence file has malformed Base64 data.');
    }
    totalBase64Chars += item.base64.length;
    if (totalBase64Chars > SAMS_MAX_ACHIEVEMENT_EVIDENCE_REQUEST_CHARS) {
      throw new Error('Combined evidence exceeds the maximum upload request size.');
    }

    var bytes;
    try {
      bytes = Utilities.base64Decode(item.base64);
    } catch (error) {
      throw new Error('An evidence file has malformed Base64 data.');
    }
    if (!bytes || !bytes.length || bytes.length > SAMS_MAX_ACHIEVEMENT_EVIDENCE_FILE_BYTES) {
      throw new Error('Each evidence file must be larger than 0 bytes and no larger than 1 MiB.');
    }
    totalBytes += bytes.length;
    if (totalBytes > SAMS_MAX_ACHIEVEMENT_EVIDENCE_TOTAL_BYTES) {
      throw new Error('Combined evidence files cannot exceed 3 MiB.');
    }
    if (Utilities.base64Encode(bytes) !== item.base64) {
      throw new Error('An evidence file has malformed Base64 data.');
    }

    var byteAt = function (index) { return bytes[index] & 255; };
    var signatureValid = item.mimeType === 'application/pdf'
      ? bytes.length >= 5 && byteAt(0) === 0x25 && byteAt(1) === 0x50 &&
        byteAt(2) === 0x44 && byteAt(3) === 0x46 && byteAt(4) === 0x2d
      : item.mimeType === 'image/jpeg'
        ? bytes.length >= 3 && byteAt(0) === 0xff && byteAt(1) === 0xd8 && byteAt(2) === 0xff
        : bytes.length >= 8 && byteAt(0) === 0x89 && byteAt(1) === 0x50 &&
          byteAt(2) === 0x4e && byteAt(3) === 0x47 && byteAt(4) === 0x0d &&
          byteAt(5) === 0x0a && byteAt(6) === 0x1a && byteAt(7) === 0x0a;
    if (!signatureValid) {
      throw new Error('An evidence file signature does not match its declared PDF, JPEG or PNG type.');
    }

    var displayFileName = item.displayFileName.trim()
      .replace(/^.*[\\/]/, '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .slice(0, 255);
    if (!displayFileName) {
      throw new Error('Each evidence file must have a valid filename.');
    }
    return {
      bytes: bytes,
      mimeType: item.mimeType,
      extension: fileType.extension,
      fileType: fileType.type,
      displayFileName: displayFileName
    };
  });
  return evidence;
}

function getAchievementEvidenceFolder_() {
  var folderId;
  try {
    folderId = PropertiesService.getScriptProperties().getProperty('SAMS_PROOF_FOLDER_ID');
  } catch (error) {
    throw new Error('Evidence storage is not configured or accessible. Ask an administrator to check the private evidence folder setup.');
  }
  if (typeof folderId !== 'string' || !folderId.trim()) {
    throw new Error('Evidence storage is not configured. Ask an administrator to configure the private evidence folder.');
  }
  try {
    var folder = DriveApp.getFolderById(folderId.trim());
    if (!folder || typeof folder.createFile !== 'function') {
      throw new Error('Unavailable destination.');
    }
    return folder;
  } catch (error) {
    throw new Error('The configured evidence folder is not accessible. Ask an administrator to check its setup.');
  }
}

function createAchievementEvidenceFiles_(folder, files, achievementId) {
  var createdFiles = [];
  try {
    files.forEach(function (evidence, index) {
      var safeAchievementId = String(achievementId).replace(/[^A-Za-z0-9_-]/g, '');
      var filename = 'achievement-' + safeAchievementId + '-evidence-' +
        (index + 1) + '.' + evidence.extension;
      var file = folder.createFile(
        Utilities.newBlob(evidence.bytes, evidence.mimeType, filename)
      );
      if (file) {
        createdFiles.push({ file: file, fileId: '' });
      }
      var fileId = file && typeof file.getId === 'function' ? String(file.getId()) : '';
      if (!fileId) {
        throw new Error('Drive did not confirm file creation.');
      }
      createdFiles[createdFiles.length - 1].fileId = fileId;
    });
    return createdFiles;
  } catch (error) {
    var cleanupFailed = false;
    createdFiles.forEach(function (created) {
      try {
        created.file.setTrashed(true);
      } catch (cleanupError) {
        cleanupFailed = true;
      }
    });
    throw new Error(cleanupFailed
      ? 'Evidence upload failed and cleanup was incomplete. Contact the administrator before retrying.'
      : 'Evidence upload failed. No achievement was saved.');
  }
}

function createAchievementEvidenceRows_(files, achievementId, userId, timestamp) {
  var existingIds = {};
  getRecordsAsObjects_(SAMS_CONFIG.sheetNames.achievementEvidence)
    .forEach(function (record) { existingIds[String(record.EvidenceID)] = true; });
  return files.map(function (file, index) {
    var evidenceId = '';
    for (var attempt = 0; attempt < 5; attempt++) {
      var candidate = 'EVD-' + Utilities.getUuid();
      if (!existingIds[candidate]) {
        evidenceId = candidate;
        existingIds[candidate] = true;
        break;
      }
    }
    if (!evidenceId) {
      throw new Error('A unique evidence ID could not be generated. Please try again.');
    }
    return {
      EvidenceID: evidenceId,
      AchievementID: achievementId,
      DriveFileID: file.fileId,
      FileType: file.fileType,
      DisplayFileName: file.displayFileName,
      UploadedBy: userId,
      UploadedAt: timestamp
    };
  });
}

function trashAchievementEvidenceFiles_(files) {
  var failures = [];
  files.forEach(function (file) {
    try {
      file.file.setTrashed(true);
    } catch (error) {
      failures.push(error);
    }
  });
  return failures;
}

function isRealCalendarDate_(dateValue) {
  var pieces = dateValue.split('-');
  var date = new Date(Date.UTC(Number(pieces[0]), Number(pieces[1]) - 1, Number(pieces[2])));
  return date.getUTCFullYear() === Number(pieces[0]) &&
    date.getUTCMonth() === Number(pieces[1]) - 1 &&
    date.getUTCDate() === Number(pieces[2]);
}

function requireHeaders_(sheet, requiredHeaders) {
  var headers = getHeaderRow_(sheet);
  requiredHeaders.forEach(function (header) {
    if (headers.indexOf(header) === -1) {
      throw new Error('Tab "' + sheet.getName() + '" is missing required header "' + header + '".');
    }
  });
  return headers;
}

function planAppendRows_(sheetName, records, keyHeader, keyValue) {
  var sheet = getSheetByName_(sheetName);
  var configKey = SAMS_REQUIRED_SHEET_KEYS.filter(function (key) {
    return SAMS_CONFIG.sheetNames[key] === sheetName;
  })[0];
  if (!configKey) {
    throw new Error('No schema is configured for tab "' + sheetName + '".');
  }
  var headers = requireHeaders_(sheet, SAMS_CONFIG.requiredHeaders[configKey]);
  var rows = records.map(function (record) {
    return headers.map(function (header) {
      var value = Object.prototype.hasOwnProperty.call(record, header) ? record[header] : '';
      if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(value)) {
        return "'" + value;
      }
      return value;
    });
  });
  return {
    sheet: sheet,
    headers: headers,
    firstRow: sheet.getLastRow() + 1,
    rows: rows,
    keyHeader: keyHeader,
    keyValue: keyValue,
    keyValues: records.map(function (record) {
      return Object.prototype.hasOwnProperty.call(record, keyHeader)
        ? record[keyHeader]
        : keyValue;
    })
  };
}

function writeAppendPlan_(plan) {
  if (plan.rows.length) {
    plan.sheet.getRange(plan.firstRow, 1, plan.rows.length, plan.headers.length)
      .setValues(plan.rows);
  }
}

function rollbackAppendPlan_(plan) {
  if (!plan.rows.length) {
    return;
  }
  var keyColumn = plan.headers.indexOf(plan.keyHeader) + 1;
  var existing = plan.sheet.getRange(plan.firstRow, 1, plan.rows.length, plan.headers.length).getValues();
  var blankRows = existing.map(function (row, index) {
    var isBlank = row.every(function (value) { return value === '' || value === null; });
    if (isBlank) {
      return true;
    }
    var expectedKey = plan.keyValues && plan.keyValues.length === plan.rows.length
      ? plan.keyValues[index]
      : plan.keyValue;
    if (keyColumn < 1 || String(row[keyColumn - 1]) !== String(expectedKey)) {
      throw new Error('A partially written row could not be safely identified for rollback.');
    }
    return false;
  });
  if (blankRows.some(function (isBlank) { return !isBlank; })) {
    plan.sheet.getRange(plan.firstRow, 1, plan.rows.length, plan.headers.length)
      .setValues(existing.map(function (row, index) {
        return blankRows[index] ? row : plan.headers.map(function () { return ''; });
      }));
  }
}

function makeAuditRecord_(userId, action, recordId, metadata) {
  metadata = metadata || {};
  var actor = metadata.user || {};
  return {
    LogID: 'LOG-' + Utilities.getUuid(),
    UserID: userId,
    ActorName: String(actor.name || ''),
    ActorEmail: String(actor.email || ''),
    ActionType: String(metadata.actionType || 'Administrative activity'),
    Action: action,
    Outcome: String(metadata.outcome || 'Successful'),
    Details: String(metadata.details || ''),
    EntityType: String(metadata.entityType || ''),
    RecordID: recordId,
    CorrelationID: String(metadata.correlationId || recordId || ''),
    Timestamp: new Date()
  };
}

function generateUniqueAchievementId_() {
  var existingIds = {};
  getRecordsAsObjects_(SAMS_CONFIG.sheetNames.achievements).forEach(function (record) {
    existingIds[String(record.AchievementID)] = true;
  });
  for (var attempt = 0; attempt < 5; attempt++) {
    var achievementId = 'ACH-' + Utilities.getUuid();
    if (!existingIds[achievementId]) {
      return achievementId;
    }
  }
  throw new Error('A unique AchievementID could not be generated. Please try again.');
}

function createAchievementSubmission(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var plans = [];
  var uploadedEvidence = [];
  var user = null;
  var achievementId = '';
  var evidenceUploadStarted = false;
  try {
    user = requireAchievementRole_('submit');
    var submission = validateAchievementSubmission_(payload);
    var evidenceFiles = validateAchievementEvidenceFiles_(payload.evidenceFiles);
    requireHeaders_(getSheetByName_(SAMS_CONFIG.sheetNames.achievementEvidence),
      SAMS_CONFIG.requiredHeaders.achievementEvidence);
    requireHeaders_(getSheetByName_(SAMS_CONFIG.sheetNames.students), [
      'StudentID', 'Status'
    ]);
    var studentRecords = getRecordsAsObjects_(SAMS_CONFIG.sheetNames.students);
    var studentsById = {};
    studentRecords.forEach(function (student) {
      var studentId = String(student.StudentID || '');
      if (studentId) {
        if (!studentsById[studentId]) {
          studentsById[studentId] = { count: 0, active: false };
        }
        studentsById[studentId].count++;
        studentsById[studentId].active = isActiveUser_(student.Status);
      }
    });
    submission.participantIds.forEach(function (studentId) {
      if (!studentsById[studentId] || studentsById[studentId].count !== 1 ||
          !studentsById[studentId].active) {
        throw new Error('A selected student does not exist exactly once or is not active.');
      }
    });

    var now = new Date();
    achievementId = generateUniqueAchievementId_();
    var folder = getAchievementEvidenceFolder_();
    evidenceUploadStarted = true;
    uploadedEvidence = createAchievementEvidenceFiles_(folder, evidenceFiles, achievementId);
    var evidenceRows = createAchievementEvidenceRows_(
      evidenceFiles.map(function (file, index) {
        return {
          fileId: uploadedEvidence[index].fileId,
          fileType: file.fileType,
          displayFileName: file.displayFileName
        };
      }),
      achievementId,
      user.userId,
      now
    );
    var achievement = {
      AchievementID: achievementId,
      Title: submission.title,
      Category: submission.category,
      CompetitionEvent: submission.competitionEvent,
      Result: submission.result,
      Date: new Date(submission.date + 'T12:00:00'),
      AcademicYear: submission.academicYear,
      Type: submission.type,
      Status: SAMS_ACHIEVEMENT_STATUSES.pending,
      Description: submission.description,
      SubmittedBy: user.userId,
      VerifiedBy: '',
      VerifiedAt: '',
      EvidenceFileID: uploadedEvidence[0].fileId,
      CreatedAt: now,
      UpdatedAt: now
    };
    var participantRows = submission.participantIds.map(function (studentId) {
      return {
        AchievementID: achievementId,
        StudentID: studentId,
        RoleContribution: 'Participant'
      };
    });
    var auditRecord = makeAuditRecord_(
      user.userId,
      'Achievement submitted with evidence',
      achievementId,
      {
        user: user,
        actionType: 'Achievement submission',
        outcome: 'Successful',
        details: 'Achievement details, participants, and evidence references were saved.',
        entityType: 'Achievement'
      }
    );
    var evidenceAuditRecord = makeAuditRecord_(
      user.userId,
      'Evidence files uploaded to the configured private folder',
      achievementId,
      {
        user: user,
        actionType: 'Evidence upload',
        outcome: 'Successful',
        details: uploadedEvidence.length + ' evidence file(s) stored; Drive files are not linked in this log.',
        entityType: 'Achievement'
      }
    );

    plans = [
      planAppendRows_(SAMS_CONFIG.sheetNames.achievements, [achievement], 'AchievementID', achievementId),
      planAppendRows_(SAMS_CONFIG.sheetNames.achievementParticipants, participantRows, 'AchievementID', achievementId),
      planAppendRows_(
        SAMS_CONFIG.sheetNames.achievementEvidence,
        evidenceRows,
        'EvidenceID',
        evidenceRows[0].EvidenceID
      ),
      planAppendRows_(
        SAMS_CONFIG.sheetNames.auditLog,
        [auditRecord, evidenceAuditRecord],
        'LogID',
        auditRecord.LogID
      )
    ];
    plans.forEach(writeAppendPlan_);
    plans = [];

    var taskResult = null;
    var taskErrorMessage = '';
    var taskFailureAuditRecorded = false;
    try {
      taskResult = createIncomingTaskForAchievement_(achievementId, user.userId);
    } catch (taskError) {
      taskErrorMessage = taskError.message;
      try {
        var failureAudit = makeAuditRecord_(
          user.userId,
          'Automatic social media task creation failed: ' + taskErrorMessage,
          achievementId,
          {
            user: user,
            actionType: 'Social Media task creation',
            outcome: 'Failed',
            details: 'The achievement remains saved; retry task creation from the submission page.',
            entityType: 'Achievement',
            correlationId: achievementId
          }
        );
        writeAppendPlan_(planAppendRows_(
          SAMS_CONFIG.sheetNames.auditLog,
          [failureAudit],
          'LogID',
          failureAudit.LogID
        ));
        taskFailureAuditRecorded = true;
      } catch (auditError) {
        taskErrorMessage += ' The task-creation failure could not be recorded in AuditLog: ' +
          auditError.message;
      }
    }
    return {
      achievementId: achievementId,
      status: SAMS_ACHIEVEMENT_STATUSES.pending,
      evidenceCount: uploadedEvidence.length,
      taskId: taskResult ? taskResult.taskId : '',
      taskStatus: taskResult ? taskResult.status : 'Retry required',
      taskCreated: !!taskResult,
      taskError: taskErrorMessage,
      taskFailureAuditRecorded: taskFailureAuditRecorded
    };
  } catch (error) {
    var rollbackError = null;
    plans.slice().reverse().forEach(function (plan) {
      try {
        rollbackAppendPlan_(plan);
      } catch (rollbackFailure) {
        rollbackError = rollbackFailure;
      }
    });
    if (rollbackError) {
      throw new Error(
        error.message +
        ' Partial-write recovery also failed; newly uploaded evidence was retained for safety.'
      );
    }
    if (uploadedEvidence.length) {
      var cleanupFailures = trashAchievementEvidenceFiles_(uploadedEvidence);
      if (cleanupFailures.length) {
        throw new Error(
          'Submission failed and evidence cleanup was incomplete. Contact the administrator before retrying.'
        );
      }
    }
    if (user) {
      try {
        recordActivityEvent_(user, {
          actionType: evidenceUploadStarted ? 'Evidence upload' : 'Achievement submission',
          action: evidenceUploadStarted
            ? 'Evidence upload or achievement save failed'
            : 'Achievement submission failed',
          outcome: 'Failed',
          details: 'The submission did not complete. ' +
            sanitizeActivityLogText_(error.message, 180),
          entityType: 'Achievement',
          recordId: achievementId
        });
      } catch (activityError) {
        throw new Error(error.message + ' The failed evidence/submission event could not be logged: ' + activityError.message);
      }
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function getAchievementReviewQueue() {
  var user = requireAchievementRole_('review');
  requireHeaders_(getSheetByName_(SAMS_CONFIG.sheetNames.achievements), [
    'AchievementID', 'Status', 'SubmittedBy'
  ]);
  requireHeaders_(getSheetByName_(SAMS_CONFIG.sheetNames.students), ['StudentID', 'Name']);
  requireHeaders_(getSheetByName_(SAMS_CONFIG.sheetNames.achievementParticipants), [
    'AchievementID', 'StudentID'
  ]);
  requireHeaders_(getSheetByName_(SAMS_CONFIG.sheetNames.users), ['UserID', 'Name']);
  var students = {};
  getRecordsAsObjects_(SAMS_CONFIG.sheetNames.students).forEach(function (student) {
    students[String(student.StudentID)] = String(student.Name || '');
  });
  var participants = {};
  getRecordsAsObjects_(SAMS_CONFIG.sheetNames.achievementParticipants).forEach(function (participant) {
    var achievementId = String(participant.AchievementID);
    if (!participants[achievementId]) {
      participants[achievementId] = [];
    }
    if (students[String(participant.StudentID)]) {
      participants[achievementId].push(students[String(participant.StudentID)]);
    }
  });
  var users = {};
  getRecordsAsObjects_(SAMS_CONFIG.sheetNames.users).forEach(function (record) {
    users[String(record.UserID)] = String(record.Name || '');
  });
  return getRecordsAsObjects_(SAMS_CONFIG.sheetNames.achievements)
    .filter(function (achievement) {
      return achievement.Status === SAMS_ACHIEVEMENT_STATUSES.pending;
    })
    .map(function (achievement) {
      return {
        achievementId: String(achievement.AchievementID),
        title: String(achievement.Title || ''),
        category: String(achievement.Category || ''),
        competitionEvent: String(achievement.CompetitionEvent || ''),
        result: String(achievement.Result || ''),
        date: achievement.Date instanceof Date
          ? achievement.Date.toISOString().slice(0, 10)
          : String(achievement.Date || ''),
        academicYear: String(achievement.AcademicYear || ''),
        type: String(achievement.Type || ''),
        description: String(achievement.Description || ''),
        submittedBy: users[String(achievement.SubmittedBy)] || 'SAMS user',
        participantNames: participants[String(achievement.AchievementID)] || [],
        canDecide: String(achievement.SubmittedBy) !== user.userId ||
          isAchievementAdministrator_(user)
      };
    });
}
