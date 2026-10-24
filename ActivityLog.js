var SAMS_ACTIVITY_LOG_PAGE_SIZE = 50;
var SAMS_ACTIVITY_LOG_SCAN_SIZE = 250;
var SAMS_ACTIVITY_LOG_MAX_SCAN_SIZE = 2500;

function requireActivityLogAdministrator_() {
  var user = getSignedInUser_();
  if (!isAchievementAdministrator_(user)) {
    try {
      recordActivityEvent_(user, {
        actionType: 'Access denied',
        action: 'Activity Log access denied',
        outcome: 'Denied',
        details: 'The signed-in user does not have permission to delete this achievement.',
        entityType: 'Activity Log'
      });
    } catch (auditError) {
      throw new Error('An active Administrator role is required. The denied attempt could not be logged: ' + auditError.message);
    }
    throw new Error('An active SAMS Administrator role is required to view the Activity Log.');
  }
  return user;
}

function sanitizeActivityLogText_(value, maxLength) {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, '[link omitted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email omitted]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[credential omitted]')
    .replace(/\bsk-[0-9A-Za-z_-]{16,}\b/g, '[credential omitted]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeActivityLogDate_(value, label) {
  if (!value) {
    return '';
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !isRealCalendarDate_(value)) {
    throw new Error(label + ' must be a valid YYYY-MM-DD date.');
  }
  return value;
}

function isActivityLogDate_(value) {
  return Object.prototype.toString.call(value) === '[object Date]' &&
    !isNaN(value.getTime());
}

function normalizeActivityLogOutcome_(value) {
  var outcome = String(value || '').trim();
  return ['Successful', 'Failed', 'Denied', 'Recorded'].indexOf(outcome) !== -1
    ? outcome
    : 'Recorded';
}

function matchesActivityLogFilters_(record, filters, timeZone) {
  var recordDate = isActivityLogDate_(record.Timestamp)
    ? Utilities.formatDate(record.Timestamp, timeZone, 'yyyy-MM-dd')
    : String(record.Timestamp || '').slice(0, 10);
  if (filters.fromDate && recordDate < filters.fromDate) {
    return false;
  }
  if (filters.toDate && recordDate > filters.toDate) {
    return false;
  }
  if (filters.actor) {
    var actor = [record.ActorName, record.ActorEmail, record.UserID].join(' ').toLowerCase();
    if (actor.indexOf(filters.actor) === -1) {
      return false;
    }
  }
  if (filters.actionType &&
      String(record.ActionType || 'Administrative activity') !== filters.actionType) {
    return false;
  }
  if (filters.outcome && normalizeActivityLogOutcome_(record.Outcome) !== filters.outcome) {
    return false;
  }
  if (filters.reference) {
    var reference = [
      record.EntityType, record.RecordID, record.CorrelationID, record.Action
    ].join(' ').toLowerCase();
    if (reference.indexOf(filters.reference) === -1) {
      return false;
    }
  }
  return true;
}

function getActivityLog(filters) {
  requireActivityLogAdministrator_();
  filters = filters && typeof filters === 'object' && !Array.isArray(filters) ? filters : {};
  var normalizedFilters = {
    fromDate: normalizeActivityLogDate_(filters.fromDate, 'Start date'),
    toDate: normalizeActivityLogDate_(filters.toDate, 'End date'),
    actor: String(filters.actor || '').trim().toLowerCase().slice(0, 100),
    actionType: String(filters.actionType || '').trim().slice(0, 80),
    outcome: String(filters.outcome || '').trim(),
    reference: String(filters.reference || '').trim().toLowerCase().slice(0, 100)
  };
  if (normalizedFilters.fromDate && normalizedFilters.toDate &&
      normalizedFilters.fromDate > normalizedFilters.toDate) {
    throw new Error('Start date must be on or before end date.');
  }
  if (normalizedFilters.outcome &&
      ['Successful', 'Failed', 'Denied', 'Recorded'].indexOf(normalizedFilters.outcome) === -1) {
    throw new Error('Choose a valid Activity Log outcome.');
  }
  var cursor = filters.cursor === undefined || filters.cursor === null || filters.cursor === ''
    ? getSheetByName_(SAMS_CONFIG.sheetNames.auditLog).getLastRow()
    : Number(filters.cursor);
  var sheet = getSheetByName_(SAMS_CONFIG.sheetNames.auditLog);
  var headers = requireHeaders_(sheet, SAMS_CONFIG.requiredHeaders.auditLog);
  if (!Number.isInteger(cursor) || cursor < 1 || cursor > sheet.getLastRow()) {
    throw new Error('The Activity Log page cursor is invalid. Refresh the log and try again.');
  }
  var timeZone = Session.getScriptTimeZone();
  var results = [];
  var nextCursor = 0;
  var rowEnd = cursor;
  var scannedRows = 0;
  while (rowEnd >= 2 && results.length < SAMS_ACTIVITY_LOG_PAGE_SIZE &&
      scannedRows < SAMS_ACTIVITY_LOG_MAX_SCAN_SIZE) {
    var rowStart = Math.max(2, rowEnd - SAMS_ACTIVITY_LOG_SCAN_SIZE + 1);
    var rows = sheet.getRange(rowStart, 1, rowEnd - rowStart + 1, headers.length).getValues();
    scannedRows += rows.length;
    for (var index = rows.length - 1; index >= 0; index--) {
      var record = {};
      headers.forEach(function (header, column) {
        record[header] = rows[index][column];
      });
      if (!hasValue_(record.LogID)) {
        continue;
      }
      if (matchesActivityLogFilters_(record, normalizedFilters, timeZone)) {
        results.push({
          logId: String(record.LogID),
          timestamp: isActivityLogDate_(record.Timestamp)
            ? Utilities.formatDate(record.Timestamp, timeZone, 'yyyy-MM-dd HH:mm:ss')
            : sanitizeActivityLogText_(record.Timestamp, 40),
          timeZone: timeZone,
          actorName: sanitizeActivityLogText_(record.ActorName || record.UserID || 'SAMS user', 100),
          actorEmail: String(record.ActorEmail || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160),
          actionType: sanitizeActivityLogText_(record.ActionType || 'Administrative activity', 80),
          action: sanitizeActivityLogText_(record.Action, 200),
          outcome: normalizeActivityLogOutcome_(record.Outcome),
          details: sanitizeActivityLogText_(record.Details, 300),
          entityType: sanitizeActivityLogText_(record.EntityType, 50),
          recordId: sanitizeActivityLogText_(record.RecordID, 100),
          correlationId: sanitizeActivityLogText_(record.CorrelationID, 100)
        });
        if (results.length === SAMS_ACTIVITY_LOG_PAGE_SIZE) {
          nextCursor = rowStart + index - 1;
          break;
        }
      }
    }
    if (nextCursor) {
      break;
    }
    rowEnd = rowStart - 1;
  }
  if (!nextCursor && rowEnd >= 2) {
    nextCursor = rowEnd;
  }
  return {
    entries: results,
    nextCursor: nextCursor,
    hasMore: nextCursor >= 2,
    timeZone: timeZone,
    pageSize: SAMS_ACTIVITY_LOG_PAGE_SIZE
  };
}

function getAchievementDeletionRows_(sheetName, achievementId, keyHeader) {
  var sheet = getSheetByName_(sheetName);
  var configKey = Object.keys(SAMS_CONFIG.sheetNames).filter(function (key) {
    return SAMS_CONFIG.sheetNames[key] === sheetName;
  })[0];
  var requiredHeaders = configKey ? SAMS_CONFIG.requiredHeaders[configKey] : [keyHeader];
  var headers = requireHeaders_(sheet, requiredHeaders);
  var keyColumn = headers.indexOf(keyHeader);
  if (keyColumn === -1) {
    throw new Error('Tab "' + sheetName + '" is missing required header "' + keyHeader + '".');
  }
  var records = getRecordsAsObjects_(sheetName);
  var rows = [];
  records.forEach(function (record, index) {
    if (String(record[keyHeader] || '').trim() === achievementId) {
      rows.push({
        sheet: sheet,
        sheetName: sheetName,
        rowNumber: index + 2,
        headers: headers,
        keyHeader: keyHeader,
        values: headers.map(function (header) { return record[header]; })
      });
    }
  });
  return rows;
}

function restoreAchievementDeletionRows_(removed) {
  var failures = [];
  removed.slice().reverse().forEach(function (item) {
    try {
      item.sheet.insertRowsBefore(item.rowNumber, 1);
      item.sheet.getRange(item.rowNumber, 1, 1, item.values.length).setValues([item.values]);
      var restoredValues = item.sheet.getRange(
        item.rowNumber, 1, 1, item.values.length
      ).getValues()[0];
      var keyColumn = item.headers.indexOf(item.keyHeader);
      var rowWasRestored = keyColumn >= 0 &&
        restoredValues.length === item.values.length &&
        item.values.every(function (value, index) {
          if (isActivityLogDate_(value) && isActivityLogDate_(restoredValues[index])) {
            return value.getTime() === restoredValues[index].getTime();
          }
          return value === restoredValues[index];
        });
      if (!rowWasRestored ||
          String(restoredValues[keyColumn]) !== String(item.values[keyColumn])) {
        throw new Error('The restored row could not be verified.');
      }
    } catch (error) {
      failures.push(item.sheetName + ' row ' + item.rowNumber);
    }
  });
  return failures;
}

function hasSocialMediaPublicationHistory_(task) {
  return ['PostURL', 'PublishedAt', 'CompletedAt', 'ScreenshotFileID'].some(function (header) {
    return hasValue_(task[header]);
  });
}

function formatDeletionTaskReferences_(taskIds) {
  if (!taskIds.length) {
    return 'none';
  }
  var listedIds = taskIds.slice(0, 20);
  var remaining = taskIds.length - listedIds.length;
  return listedIds.join(', ') + (remaining > 0 ? ' and ' + remaining + ' more' : '');
}

function deleteAchievement(achievementId) {
  var normalizedId = validateSocialMediaText_(achievementId, 'AchievementID', 100, true);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var user;
  try {
    user = getSignedInUser_();
    var isAdministrator = isAchievementAdministrator_(user);
    var isMentor = canSubmitAchievements_(user);
    if (!isAdministrator && !isMentor) {
      try {
        recordActivityEvent_(user, {
          actionType: 'Access denied',
          action: 'Achievement deletion denied',
          outcome: 'Denied',
          details: 'The signed-in user does not have the Administrator role.',
          entityType: 'Achievement',
          recordId: normalizedId
        });
      } catch (auditError) {
        throw new Error('An active SAMS Mentor or Administrator role is required. The denied attempt could not be logged: ' + auditError.message);
      }
      throw new Error('An active SAMS Mentor or Administrator role is required to delete achievements.');
    }
    var achievementRows = getAchievementDeletionRows_(
      SAMS_CONFIG.sheetNames.achievements, normalizedId, 'AchievementID'
    );
    if (achievementRows.length !== 1) {
      recordActivityEvent_(user, {
        actionType: 'Achievement deletion',
        action: 'Achievement deletion failed',
        outcome: 'Failed',
        details: 'No unique achievement record was found; no data was removed.',
        entityType: 'Achievement',
        recordId: normalizedId
      });
      throw new Error('The achievement does not exist or is not uniquely identified.');
    }
    var submittedBy = String(achievementRows[0].values[
      achievementRows[0].headers.indexOf('SubmittedBy')
    ] || '').trim();
    if (!isAdministrator && submittedBy !== user.userId) {
      try {
        recordActivityEvent_(user, {
          actionType: 'Access denied',
          action: 'Achievement deletion denied',
          outcome: 'Denied',
          details: 'A Mentor attempted to delete an achievement submitted by another user.',
          entityType: 'Achievement',
          recordId: normalizedId
        });
      } catch (auditError) {
        throw new Error('Mentors can delete only their own achievements. The denied attempt could not be logged: ' + auditError.message);
      }
      throw new Error('Mentors can delete only their own achievements.');
    }
    var sheetNames = [
      SAMS_CONFIG.sheetNames.achievementParticipants,
      SAMS_CONFIG.sheetNames.achievementEvidence,
      SAMS_CONFIG.sheetNames.mediaAssets
    ];
    var snapshots = achievementRows.slice();
    sheetNames.forEach(function (sheetName) {
      snapshots = snapshots.concat(getAchievementDeletionRows_(sheetName, normalizedId, 'AchievementID'));
    });
    var linkedTasks = getAchievementDeletionRows_(
      SAMS_CONFIG.sheetNames.socialMediaTasks, normalizedId, 'AchievementID'
    );
    var preservedTaskIds = [];
    var removedTaskIds = [];
    linkedTasks.forEach(function (taskRow) {
      var task = {};
      taskRow.headers.forEach(function (header, index) { task[header] = taskRow.values[index]; });
      var taskId = String(task.TaskID || '').trim();
      if (hasSocialMediaPublicationHistory_(task)) {
        preservedTaskIds.push(taskId);
      } else {
        removedTaskIds.push(taskId);
        snapshots.push(taskRow);
      }
    });
    recordActivityEvent_(user, {
      actionType: 'Achievement deletion',
      action: 'Achievement deletion requested',
      outcome: 'Recorded',
      details: 'Deletion request recorded; deletion is not yet complete. Evidence files in Drive will be kept. ' +
        'Tasks with publication history will be preserved: ' +
        formatDeletionTaskReferences_(preservedTaskIds) + '. Unpublished task rows planned for removal: ' +
        formatDeletionTaskReferences_(removedTaskIds) + '.',
      entityType: 'Achievement',
      recordId: normalizedId
    });

    var removed = [];
    var deletionStateUncertain = false;
    var ordered = snapshots.slice().sort(function (left, right) {
      if (left.sheetName === right.sheetName) {
        return right.rowNumber - left.rowNumber;
      }
      return left.sheetName < right.sheetName ? -1 : 1;
    });
    try {
      ordered.forEach(function (item) {
        try {
          item.sheet.deleteRow(item.rowNumber);
          removed.push(item);
        } catch (deleteError) {
          var expectedRemaining = snapshots.filter(function (snapshot) {
            return snapshot.sheetName === item.sheetName;
          }).length - removed.filter(function (snapshot) {
            return snapshot.sheetName === item.sheetName;
          }).length;
          try {
            var actualRemaining = getAchievementDeletionRows_(
              item.sheetName, normalizedId, 'AchievementID'
            ).length;
            if (actualRemaining < expectedRemaining) {
              removed.push(item);
              if (actualRemaining !== expectedRemaining - 1) {
                deletionStateUncertain = true;
              }
            } else if (actualRemaining !== expectedRemaining) {
              deletionStateUncertain = true;
            }
          } catch (verificationError) {
            deletionStateUncertain = true;
          }
          throw deleteError;
        }
      });
      var expectedRemainingTasks = preservedTaskIds.length;
      [
        SAMS_CONFIG.sheetNames.achievements,
        SAMS_CONFIG.sheetNames.achievementParticipants,
        SAMS_CONFIG.sheetNames.achievementEvidence,
        SAMS_CONFIG.sheetNames.mediaAssets,
        SAMS_CONFIG.sheetNames.socialMediaTasks
      ].forEach(function (sheetName) {
        var remainingRows = getAchievementDeletionRows_(
          sheetName, normalizedId, 'AchievementID'
        ).length;
        var expectedRows = sheetName === SAMS_CONFIG.sheetNames.socialMediaTasks
          ? expectedRemainingTasks
          : 0;
        if (remainingRows !== expectedRows) {
          throw new Error('The final deletion state could not be verified for tab "' + sheetName + '".');
        }
      });
      recordActivityEvent_(user, {
        actionType: 'Achievement deletion',
        action: 'Achievement and linked sheet records deleted',
        outcome: 'Successful',
        details: 'Linked participants, evidence references, media assets and unpublished Social Media tasks were removed. ' +
          'Drive files were kept. Preserved publication-history tasks: ' +
          formatDeletionTaskReferences_(preservedTaskIds) + '. Removed unpublished tasks: ' +
          formatDeletionTaskReferences_(removedTaskIds) + '.',
        entityType: 'Achievement',
        recordId: normalizedId
      });
      return { achievementId: normalizedId, deleted: true };
    } catch (deleteError) {
      var recoveryFailures = restoreAchievementDeletionRows_(removed);
      if (deletionStateUncertain) {
        recoveryFailures.push('a row whose deletion state could not be verified');
      }
      var failureDetails = recoveryFailures.length
        ? 'Deletion failed and automatic recovery was incomplete for ' + recoveryFailures.join(', ') +
          '. Contact the spreadsheet administrator and reconcile against the AchievementDeletion audit entries.'
        : 'Deletion failed; removed sheet rows were restored. No Drive files were deleted.';
      try {
        recordActivityEvent_(user, {
          actionType: 'Achievement deletion',
          action: recoveryFailures.length ? 'Achievement deletion recovery incomplete' : 'Achievement deletion failed and restored',
          outcome: 'Failed',
          details: failureDetails,
          entityType: 'Achievement',
          recordId: normalizedId
        });
      } catch (auditError) {
        failureDetails += ' The failure outcome could not be written to AuditLog: ' + auditError.message;
      }
      throw new Error('Achievement deletion failed. ' + failureDetails);
    }
  } finally {
    lock.releaseLock();
  }
}
