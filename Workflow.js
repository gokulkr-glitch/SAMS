function recordActivityEvent_(user, event) {
  if (!user || !String(user.userId || '').trim()) {
    throw new Error('A verified SAMS user is required to record Activity Log events.');
  }
  event = event || {};
  var action = String(event.action || '').trim();
  if (!action) {
    throw new Error('A plain-language action is required for Activity Log entries.');
  }
  var recordId = String(event.recordId || '');
  var auditRecord = makeAuditRecord_(user.userId, action, recordId, {
    user: user,
    actionType: event.actionType,
    outcome: event.outcome,
    details: event.details,
    entityType: event.entityType,
    correlationId: event.correlationId
  });
  var plan = planAppendRows_(
    SAMS_CONFIG.sheetNames.auditLog,
    [auditRecord],
    'LogID',
    auditRecord.LogID
  );
  writeAppendPlan_(plan);
  return auditRecord;
}

function reviewAchievement(achievementId, decision, reviewNotes) {
  if (typeof achievementId !== 'string' || !achievementId.trim()) {
    throw new Error('A valid AchievementID is required.');
  }
  var nextStatusByDecision = {
    approve: SAMS_ACHIEVEMENT_STATUSES.approved,
    reject: SAMS_ACHIEVEMENT_STATUSES.rejected,
    return: SAMS_ACHIEVEMENT_STATUSES.returned
  };
  if (!Object.prototype.hasOwnProperty.call(nextStatusByDecision, decision)) {
    throw new Error('Choose approve, reject or return.');
  }
  if (typeof reviewNotes !== 'string' || !reviewNotes.trim() || reviewNotes.trim().length > 500) {
    throw new Error('Review notes are required and must be 500 characters or fewer.');
  }

  var normalizedId = achievementId.trim();
  var notes = reviewNotes.trim();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var updates = [];
  var auditPlan = null;
  var user = null;
  var denialRecorded = false;
  try {
    user = requireAchievementRole_('review');
    var sheet = getSheetByName_(SAMS_CONFIG.sheetNames.achievements);
    var headers = requireHeaders_(sheet, [
      'AchievementID', 'Status', 'SubmittedBy', 'VerifiedBy', 'VerifiedAt', 'UpdatedAt'
    ]);
    var records = getRecordsAsObjects_(SAMS_CONFIG.sheetNames.achievements);
    var matches = [];
    records.forEach(function (record, index) {
      if (String(record.AchievementID) === normalizedId) {
        matches.push({ record: record, row: index + 2 });
      }
    });
    if (matches.length !== 1) {
      throw new Error('The achievement does not exist or is not uniquely identified.');
    }

    var current = matches[0].record;
    var row = matches[0].row;
    if (current.Status !== SAMS_ACHIEVEMENT_STATUSES.pending) {
      throw new Error('Only Pending achievements can be reviewed. This status transition is not allowed.');
    }
    if ((decision === 'approve' || decision === 'reject') &&
        String(current.SubmittedBy) === user.userId &&
        !isAchievementAdministrator_(user)) {
      try {
        recordActivityEvent_(user, {
          actionType: 'Access denied',
          action: 'Achievement decision denied',
          outcome: 'Denied',
          details: 'A submitter attempted to approve or reject their own achievement.',
          entityType: 'Achievement',
          recordId: normalizedId
        });
        denialRecorded = true;
      } catch (auditError) {
        throw new Error('Submitters cannot approve or reject their own achievements unless they are an Administrator. The denied attempt could not be logged: ' + auditError.message);
      }
      throw new Error('Submitters cannot approve or reject their own achievements unless they are an Administrator.');
    }

    var now = new Date();
    var changedFields = {
      Status: nextStatusByDecision[decision],
      UpdatedAt: now
    };
    if (decision === 'approve') {
      changedFields.VerifiedBy = user.userId;
      changedFields.VerifiedAt = now;
    }
    Object.keys(changedFields).forEach(function (header) {
      var column = headers.indexOf(header) + 1;
      updates.push({
        range: sheet.getRange(row, column),
        previousValue: current[header],
        nextValue: changedFields[header]
      });
    });

    var auditAction = decision === 'return'
      ? 'Achievement returned for correction'
      : 'Achievement ' + (decision === 'approve' ? 'approved' : 'rejected');
    var overrideUsed = String(current.SubmittedBy) === user.userId &&
      isAchievementAdministrator_(user);
    var auditRecord = makeAuditRecord_(user.userId, auditAction, normalizedId, {
      user: user,
      actionType: 'Achievement decision',
      outcome: 'Successful',
      details: (decision === 'approve' ? 'Approved' : decision === 'reject' ? 'Rejected' : 'Returned') +
        ' with reviewer notes recorded.' + (overrideUsed ? ' Administrator self-approval override used.' : ''),
      entityType: 'Achievement'
    });
    auditPlan = planAppendRows_(
      SAMS_CONFIG.sheetNames.auditLog,
      [auditRecord],
      'LogID',
      auditRecord.LogID
    );

    updates.forEach(function (update) { update.range.setValue(update.nextValue); });
    writeAppendPlan_(auditPlan);
    return { achievementId: normalizedId, status: nextStatusByDecision[decision] };
  } catch (error) {
    var rollbackErrors = [];
    updates.slice().reverse().forEach(function (update) {
      try {
        update.range.setValue(update.previousValue);
      } catch (fieldRollbackError) {
        rollbackErrors.push(fieldRollbackError.message);
      }
    });
    if (rollbackErrors.length) {
      throw new Error(error.message + ' Partial-write recovery also failed: ' + rollbackErrors.join('; '));
    }
    if (auditPlan) {
      try {
        rollbackAppendPlan_(auditPlan);
      } catch (auditRollbackError) {
        throw new Error(error.message + ' Decision was rolled back, but the audit row could not be removed safely: ' + auditRollbackError.message);
      }
    }
    if (user && !denialRecorded) {
      try {
        recordActivityEvent_(user, {
          actionType: 'Achievement decision',
          action: 'Achievement review action failed',
          outcome: 'Failed',
          details: 'The review decision was not confirmed. ' + sanitizeActivityLogText_(error.message, 180),
          entityType: 'Achievement',
          recordId: normalizedId
        });
      } catch (activityError) {
        throw new Error(error.message + ' The failed review action could not be logged: ' + activityError.message);
      }
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}
