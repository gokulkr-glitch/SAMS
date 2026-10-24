var SAMS_SOCIAL_MEDIA_STATUSES = [
  'Incoming',
  'In Design',
  'Awaiting Approval',
  'Ready to Publish',
  'Awaiting Publication Proof',
  'Completed',
  'Needs Correction',
  'On Hold',
  'Cancelled'
];

var SAMS_SOCIAL_MEDIA_PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];

function canManageSocialMedia_(user) {
  return userHasAnyRole_(user, [
    'socialmedia', 'social media', 'communications', 'admin', 'administrator'
  ]);
}

function canReviewSocialMediaProof_(user) {
  return canManageSocialMedia_(user) || canReviewAchievements_(user);
}

function getSocialMediaAccess() {
  try {
    var user = getSignedInUser_();
    return {
      available: true,
      canManage: canManageSocialMedia_(user),
      canReviewProof: canReviewSocialMediaProof_(user)
    };
  } catch (error) {
    return {
      available: false,
      canManage: false,
      canReviewProof: false,
      message: error.message
    };
  }
}

function requireSocialMediaPermission_(permission) {
  var user = getSignedInUser_();
  var allowed = permission === 'manage'
    ? canManageSocialMedia_(user)
    : canReviewSocialMediaProof_(user);
  if (!allowed) {
    var message = permission === 'manage'
      ? 'An active SAMS user with a SocialMedia, Communications or Administrator role is required.'
      : 'An active SAMS proof reviewer or SocialMedia manager role is required.';
    try {
      recordActivityEvent_(user, {
        actionType: 'Access denied',
        action: 'Social Media task action denied',
        outcome: 'Denied',
        details: 'The signed-in user does not have permission for this task action.',
        entityType: 'Social Media task'
      });
    } catch (auditError) {
      throw new Error(message + ' The denied attempt could not be logged: ' + auditError.message);
    }
    throw new Error(message);
  }
  return user;
}

function requireSocialMediaHeaders_() {
  return requireHeaders_(
    getSheetByName_(SAMS_CONFIG.sheetNames.socialMediaTasks),
    SAMS_CONFIG.requiredHeaders.socialMediaTasks
  );
}

function requirePublicationProofWorkflow_() {
  throw new Error(
    'Publication-proof review and task completion are disabled in this build.'
  );
}

function getSocialMediaTaskBoard() {
  getSignedInUser_();
  requireSocialMediaHeaders_();
  requireHeaders_(getSheetByName_(SAMS_CONFIG.sheetNames.achievements), [
    'AchievementID', 'Title', 'Category', 'CompetitionEvent', 'Result', 'Date',
    'Description', 'Status'
  ]);
  requireHeaders_(getSheetByName_(SAMS_CONFIG.sheetNames.achievementParticipants), [
    'AchievementID', 'StudentID', 'RoleContribution'
  ]);
  requireHeaders_(getSheetByName_(SAMS_CONFIG.sheetNames.students), [
    'StudentID', 'Name', 'RollNumber'
  ]);
  requireHeaders_(getSheetByName_(SAMS_CONFIG.sheetNames.users), ['UserID', 'Name']);

  var studentsById = {};
  getRecordsAsObjects_(SAMS_CONFIG.sheetNames.students).forEach(function (student) {
    if (hasValue_(student.StudentID)) {
      studentsById[String(student.StudentID)] = {
        studentId: String(student.StudentID),
        name: String(student.Name || ''),
        rollNumber: String(student.RollNumber || '')
      };
    }
  });
  var participantsByAchievement = {};
  getRecordsAsObjects_(SAMS_CONFIG.sheetNames.achievementParticipants)
    .forEach(function (participant) {
      var achievementId = String(participant.AchievementID || '');
      var student = studentsById[String(participant.StudentID)] || {};
      if (!achievementId) {
        return;
      }
      if (!participantsByAchievement[achievementId]) {
        participantsByAchievement[achievementId] = [];
      }
      participantsByAchievement[achievementId].push({
        studentId: String(participant.StudentID || ''),
        name: student.name || '',
        rollNumber: student.rollNumber || '',
        roleContribution: String(participant.RoleContribution || '')
      });
    });
  var achievements = {};
  getRecordsAsObjects_(SAMS_CONFIG.sheetNames.achievements).forEach(function (achievement) {
    if (hasValue_(achievement.AchievementID)) {
      achievements[String(achievement.AchievementID)] = {
        title: String(achievement.Title || ''),
        category: String(achievement.Category || ''),
        competitionEvent: String(achievement.CompetitionEvent || ''),
        result: String(achievement.Result || ''),
        date: achievement.Date instanceof Date
          ? achievement.Date.toISOString().slice(0, 10)
          : String(achievement.Date || ''),
        description: String(achievement.Description || ''),
        participants: participantsByAchievement[String(achievement.AchievementID)] || [],
        status: String(achievement.Status || '')
      };
    }
  });
  var userNames = {};
  getRecordsAsObjects_(SAMS_CONFIG.sheetNames.users).forEach(function (user) {
    if (hasValue_(user.UserID)) {
      userNames[String(user.UserID)] = String(user.Name || '');
    }
  });

  return getRecordsAsObjects_(SAMS_CONFIG.sheetNames.socialMediaTasks)
    .filter(function (task) { return hasValue_(task.TaskID); })
    .map(function (task) {
      var achievement = achievements[String(task.AchievementID)] || {};
      return {
        taskId: String(task.TaskID),
        achievementId: String(task.AchievementID || ''),
        achievementTitle: achievement.title || 'Achievement unavailable',
        achievementCategory: achievement.category || '',
        competitionEvent: achievement.competitionEvent || '',
        result: achievement.result || '',
        achievementDate: achievement.date || '',
        achievementDescription: achievement.description || '',
        participants: achievement.participants || [],
        achievementStatus: achievement.status || '',
        platform: String(task.Platform || ''),
        assignedTo: String(task.AssignedTo || ''),
        assigneeName: userNames[String(task.AssignedTo)] || '',
        priority: String(task.Priority || ''),
        status: String(task.Status || ''),
        dueDate: task.DueDate instanceof Date
          ? task.DueDate.toISOString().slice(0, 10)
          : String(task.DueDate || ''),
        designReferenceAvailable: hasValue_(task.DesignFileID),
        caption: String(task.Caption || ''),
        postUrl: String(task.PostURL || ''),
        publishedAt: task.PublishedAt instanceof Date
          ? task.PublishedAt.toISOString()
          : String(task.PublishedAt || ''),
        completedAt: task.CompletedAt instanceof Date
          ? task.CompletedAt.toISOString()
          : String(task.CompletedAt || ''),
        reviewedByName: userNames[String(task.ReviewedBy)] || '',
        reviewNotes: String(task.ReviewNotes || '')
      };
    });
}

function getSocialMediaTaskOptions() {
  requireSocialMediaPermission_('manage');
  requireHeaders_(getSheetByName_(SAMS_CONFIG.sheetNames.achievements), [
    'AchievementID', 'Title', 'Category', 'CompetitionEvent', 'Result', 'Status'
  ]);
  requireHeaders_(getSheetByName_(SAMS_CONFIG.sheetNames.users), [
    'UserID', 'Name', 'Role', 'Active'
  ]);

  var achievements = getRecordsAsObjects_(SAMS_CONFIG.sheetNames.achievements)
    .filter(function (achievement) {
      return hasValue_(achievement.AchievementID) &&
        String(achievement.Status || '').trim() === SAMS_ACHIEVEMENT_STATUSES.approved;
    })
    .map(function (achievement) {
      return {
        achievementId: String(achievement.AchievementID),
        title: String(achievement.Title || ''),
        category: String(achievement.Category || ''),
        competitionEvent: String(achievement.CompetitionEvent || ''),
        result: String(achievement.Result || '')
      };
    });
  var assignees = getRecordsAsObjects_(SAMS_CONFIG.sheetNames.users)
    .filter(function (user) {
      return hasValue_(user.UserID) && isActiveUser_(user.Active) &&
        userHasAnyRole_({ role: user.Role }, [
          'socialmedia', 'social media', 'communications', 'admin', 'administrator'
        ]);
    })
    .map(function (user) {
      return { userId: String(user.UserID), name: String(user.Name || '') };
    });

  return { achievements: achievements, assignees: assignees };
}

function normalizeSocialMediaDate_(value, label) {
  if (value === '' || value === null || value === undefined) {
    return '';
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !isRealCalendarDate_(value)) {
    throw new Error(label + ' must be a valid YYYY-MM-DD date.');
  }
  return new Date(value + 'T12:00:00');
}

function normalizeSocialMediaDateTime_(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ||
      !isRealCalendarDate_(value.slice(0, 10)) ||
      Number(value.slice(11, 13)) > 23 ||
      Number(value.slice(14, 16)) > 59) {
    throw new Error('Enter a valid publication date and time.');
  }
  return new Date(value);
}

function safeSocialMediaCellValue_(value) {
  if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(value)) {
    return "'" + value;
  }
  return value;
}

function validateSocialMediaText_(value, label, maxLength, required) {
  if (typeof value !== 'string') {
    if (required) {
      throw new Error(label + ' is required.');
    }
    return '';
  }
  var normalized = value.trim();
  if (required && !normalized) {
    throw new Error(label + ' is required.');
  }
  if (normalized.length > maxLength) {
    throw new Error(label + ' must be ' + maxLength + ' characters or fewer.');
  }
  return normalized;
}

function createSocialMediaTask(payload) {
  var user = requireSocialMediaPermission_('manage');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Task details are required.');
  }
  var achievementId = validateSocialMediaText_(payload.achievementId, 'Achievement', 100, true);
  var platform = validateSocialMediaText_(payload.platform, 'Platform', 40, true);
  var priority = payload.priority || 'Normal';
  if (SAMS_SOCIAL_MEDIA_PRIORITIES.indexOf(priority) === -1) {
    throw new Error('Choose a valid task priority.');
  }
  var dueDate = normalizeSocialMediaDate_(payload.dueDate, 'Due date');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var plans = [];
  try {
    requireSocialMediaPermission_('manage');
    requireHeaders_(getSheetByName_(SAMS_CONFIG.sheetNames.achievements), [
      'AchievementID', 'Status'
    ]);
    var eligible = getRecordsAsObjects_(SAMS_CONFIG.sheetNames.achievements)
      .filter(function (achievement) {
        return String(achievement.AchievementID) === achievementId &&
          String(achievement.Status || '').trim() === SAMS_ACHIEVEMENT_STATUSES.approved;
      });
    if (eligible.length !== 1) {
      throw new Error('Choose one approved achievement. Only Verified achievements are eligible for task creation.');
    }

    var tasks = getRecordsAsObjects_(SAMS_CONFIG.sheetNames.socialMediaTasks);
    var duplicate = tasks.some(function (task) {
      return hasValue_(task.TaskID) &&
        String(task.AchievementID || '').trim() === achievementId &&
        String(task.Platform || '').trim().toLowerCase() === platform.toLowerCase();
    });
    if (duplicate) {
      throw new Error('A social media task already exists for this achievement and platform.');
    }

    var existingTaskIds = {};
    tasks.forEach(function (task) {
      existingTaskIds[String(task.TaskID)] = true;
    });
    var taskId = '';
    for (var attempt = 0; attempt < 5; attempt++) {
      var candidateId = 'SMT-' + Utilities.getUuid();
      if (!existingTaskIds[candidateId]) {
        taskId = candidateId;
        break;
      }
    }

    if (!taskId) {
      throw new Error('A unique social media TaskID could not be generated. Please try again.');
    }
    var now = new Date();
    var taskRecord = {
      TaskID: taskId,
      AchievementID: achievementId,
      Platform: platform,
      AssignedTo: '',
      Priority: priority,
      Status: 'Incoming',
      DueDate: dueDate,
      CreatedAt: now,
      DesignFileID: '',
      Caption: '',
      PostURL: '',
      ScreenshotFileID: '',
      PublishedAt: '',
      CompletedAt: '',
      ReviewedBy: '',
      ReviewNotes: ''
    };
    var auditRecord = makeAuditRecord_(user.userId, 'Social Media task created manually', taskId, {
      user: user,
      actionType: 'Social Media task creation',
      outcome: 'Successful',
      details: 'A task was created for a Verified achievement.',
      entityType: 'Social Media task',
      correlationId: achievementId
    });
    plans = [
      planAppendRows_(SAMS_CONFIG.sheetNames.socialMediaTasks, [taskRecord], 'TaskID', taskId),
      planAppendRows_(SAMS_CONFIG.sheetNames.auditLog, [auditRecord], 'LogID', auditRecord.LogID)
    ];
    plans.forEach(writeAppendPlan_);
    return { taskId: taskId, status: 'Incoming' };
  } catch (error) {
    var rollbackError = null;
    plans.slice().reverse().forEach(function (plan) {
      try {
        rollbackAppendPlan_(plan);
      } catch (failure) {
        rollbackError = failure;
      }
    });
    if (rollbackError) {
      error = new Error(error.message + ' Partial-write recovery also failed: ' + rollbackError.message);
    }
    try {
      recordActivityEvent_(user, {
        actionType: 'Social Media task creation',
        action: 'Manual Social Media task creation failed',
        outcome: 'Failed',
        details: 'The task was not confirmed as created. ' + sanitizeActivityLogText_(error.message, 180),
        entityType: 'Achievement',
        recordId: achievementId,
        correlationId: achievementId
      });
    } catch (auditError) {
      throw new Error(error.message + ' The failure could not be recorded in the Activity Log: ' + auditError.message);
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function createIncomingTaskForAchievement_(achievementId, userId) {
  var eligible = getRecordsAsObjects_(SAMS_CONFIG.sheetNames.achievements)
    .filter(function (achievement) {
      return String(achievement.AchievementID || '').trim() === achievementId;
    });
  if (eligible.length !== 1) {
    throw new Error('The linked achievement does not exist or is not uniquely identified.');
  }

  var tasks = getRecordsAsObjects_(SAMS_CONFIG.sheetNames.socialMediaTasks);
  var existing = tasks.filter(function (task) {
    return hasValue_(task.TaskID) &&
      String(task.AchievementID || '').trim() === achievementId;
  });
  if (existing.length) {
    return {
      taskId: String(existing[0].TaskID),
      status: String(existing[0].Status || ''),
      created: false
    };
  }

  var taskId = '';
  var existingTaskIds = {};
  tasks.forEach(function (task) { existingTaskIds[String(task.TaskID)] = true; });
  for (var attempt = 0; attempt < 5; attempt++) {
    var candidateId = 'SMT-' + Utilities.getUuid();
    if (!existingTaskIds[candidateId]) {
      taskId = candidateId;
      break;
    }
  }
  if (!taskId) {
    throw new Error('A unique social media TaskID could not be generated. Please retry task creation.');
  }

  var taskRecord = {
    TaskID: taskId,
    AchievementID: achievementId,
    Platform: '',
    AssignedTo: '',
    Priority: '',
    Status: SAMS_SOCIAL_MEDIA_STATUSES[0],
    DueDate: '',
    CreatedAt: new Date(),
    DesignFileID: '',
    Caption: '',
    PostURL: '',
    ScreenshotFileID: '',
    PublishedAt: '',
    CompletedAt: '',
    ReviewedBy: '',
    ReviewNotes: ''
  };
  var actor = getSignedInUser_();
  if (actor.userId !== userId) {
    throw new Error('The authenticated user changed during automatic task creation.');
  }
  var auditRecord = makeAuditRecord_(userId, 'Social Media task created automatically', taskId, {
    user: actor,
    actionType: 'Social Media task creation',
    outcome: 'Successful',
    details: 'An Incoming task was linked to the achievement.',
    entityType: 'Social Media task',
    correlationId: achievementId
  });
  var plans = [
    planAppendRows_(SAMS_CONFIG.sheetNames.socialMediaTasks, [taskRecord], 'TaskID', taskId),
    planAppendRows_(SAMS_CONFIG.sheetNames.auditLog, [auditRecord], 'LogID', auditRecord.LogID)
  ];
  try {
    plans.forEach(writeAppendPlan_);
  } catch (error) {
    var rollbackErrors = [];
    plans.slice().reverse().forEach(function (plan) {
      try {
        rollbackAppendPlan_(plan);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    });
    if (rollbackErrors.length) {
      throw new Error(error.message + ' Partial task-write recovery also failed: ' + rollbackErrors.join('; '));
    }
    throw error;
  }
  return { taskId: taskId, status: taskRecord.Status, created: true };
}

function rejectAchievementSourceChanges_(payload, user, taskId) {
  var sourceFields = {
    achievementid: true,
    title: true,
    achievementtitle: true,
    category: true,
    achievementcategory: true,
    competitionevent: true,
    result: true,
    date: true,
    achievementdate: true,
    academicyear: true,
    type: true,
    description: true,
    achievementdescription: true,
    submittedby: true,
    verifiedby: true,
    verifiedat: true,
    evidencefileid: true,
    participantids: true,
    participants: true,
    studentid: true
  };
  Object.keys(payload).forEach(function (key) {
    if (sourceFields[key.toLowerCase()]) {
      try {
        recordActivityEvent_(user, {
          actionType: 'Protected-field modification denied',
          action: 'Social Media source achievement edit denied',
          outcome: 'Denied',
          details: 'A task update included a read-only achievement source field.',
          entityType: 'Social Media task',
          recordId: taskId
        });
      } catch (auditError) {
        throw new Error('Achievement source fields are read-only on the Social Media task board. The denied attempt could not be logged: ' + auditError.message);
      }
      throw new Error('Achievement source fields are read-only on the Social Media task board.');
    }
  });
}

function retryAchievementSocialMediaTask(achievementId) {
  var normalizedId = validateSocialMediaText_(achievementId, 'AchievementID', 100, true);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var user = requireAchievementRole_('submit');
    requireSocialMediaHeaders_();
    recordActivityEvent_(user, {
      actionType: 'Social Media task retry',
      action: 'Automatic task retry requested',
      outcome: 'Recorded',
      details: 'A retry was requested for the linked achievement task.',
      entityType: 'Achievement',
      recordId: normalizedId,
      correlationId: normalizedId
    });
    try {
      var result = createIncomingTaskForAchievement_(normalizedId, user.userId);
      recordActivityEvent_(user, {
        actionType: 'Social Media task retry',
        action: result.created ? 'Automatic task retry succeeded' : 'Automatic task already exists',
        outcome: 'Successful',
        details: result.created
          ? 'The missing Incoming task was created.'
          : 'The existing linked task was reused; no duplicate was created.',
        entityType: 'Social Media task',
        recordId: result.taskId,
        correlationId: normalizedId
      });
      return result;
    } catch (retryError) {
      try {
        recordActivityEvent_(user, {
          actionType: 'Social Media task retry',
          action: 'Automatic task retry failed',
          outcome: 'Failed',
          details: 'The achievement remains saved. ' + sanitizeActivityLogText_(retryError.message, 200),
          entityType: 'Achievement',
          recordId: normalizedId,
          correlationId: normalizedId
        });
      } catch (auditError) {
        throw new Error(retryError.message + ' The retry failure could not be logged: ' + auditError.message);
      }
      throw retryError;
    }
  } finally {
    lock.releaseLock();
  }
}

function getSocialMediaTaskForUpdate_(taskId) {
  var sheet = getSheetByName_(SAMS_CONFIG.sheetNames.socialMediaTasks);
  var headers = requireSocialMediaHeaders_();
  var records = getRecordsAsObjects_(SAMS_CONFIG.sheetNames.socialMediaTasks);
  var matches = [];
  records.forEach(function (record, index) {
    if (String(record.TaskID) === taskId) {
      matches.push({ record: record, row: index + 2 });
    }
  });
  if (matches.length !== 1) {
    throw new Error('The task does not exist or is not uniquely identified.');
  }
  return { sheet: sheet, headers: headers, record: matches[0].record, row: matches[0].row };
}

function transitionSocialMediaTask_(currentStatus, nextStatus) {
  var allowed = {
    'Incoming': ['In Design', 'On Hold', 'Cancelled'],
    'In Design': ['Awaiting Approval', 'Needs Correction', 'On Hold', 'Cancelled'],
    'Awaiting Approval': ['Ready to Publish', 'Needs Correction', 'On Hold', 'Cancelled'],
    'Ready to Publish': ['Awaiting Publication Proof', 'Needs Correction', 'On Hold', 'Cancelled'],
    'Awaiting Publication Proof': ['Completed', 'Needs Correction', 'On Hold'],
    'Needs Correction': ['In Design', 'On Hold', 'Cancelled'],
    'On Hold': ['Incoming', 'Cancelled']
  };
  if (!SAMS_SOCIAL_MEDIA_STATUSES.includes(currentStatus) ||
      !allowed[currentStatus] || allowed[currentStatus].indexOf(nextStatus) === -1) {
    throw new Error('This social media task status transition is not allowed.');
  }
}

function updateSocialMediaTask(taskId, action, payload) {
  var normalizedTaskId = validateSocialMediaText_(taskId, 'TaskID', 100, true);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    payload = {};
  }
  var permission = action === 'reviewProof' ? 'reviewProof' : 'manage';
  var user = requireSocialMediaPermission_(permission);
  rejectAchievementSourceChanges_(payload, user, normalizedTaskId);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var changes = null;
  var oldValues = {};
  var auditPlan = null;
  try {
    user = requireSocialMediaPermission_(permission);
    var task = getSocialMediaTaskForUpdate_(normalizedTaskId);
    var current = task.record;
    var nextStatus = current.Status;
    var actionLabel = '';
    changes = {};

    if (action === 'assign') {
      if (['Incoming', 'In Design', 'Needs Correction', 'On Hold'].indexOf(current.Status) === -1) {
        throw new Error('Tasks can only be assigned before publication.');
      }
      var assigneeId = validateSocialMediaText_(payload.assignedTo, 'Assignee', 100, true);
      var assignees = getRecordsAsObjects_(SAMS_CONFIG.sheetNames.users).filter(function (record) {
        return String(record.UserID) === assigneeId && isActiveUser_(record.Active) &&
          userHasAnyRole_({ role: record.Role }, [
            'socialmedia', 'social media', 'communications', 'admin', 'administrator'
          ]);
      });
      if (assignees.length !== 1) {
        throw new Error('Choose one active social media assignee.');
      }
      var priority = payload.priority;
      if (priority !== undefined && priority !== '' &&
          SAMS_SOCIAL_MEDIA_PRIORITIES.indexOf(priority) === -1) {
        throw new Error('Choose a valid task priority.');
      }
      var dueDate = payload.dueDate === undefined
        ? current.DueDate
        : normalizeSocialMediaDate_(payload.dueDate, 'Due date');
      var platform = payload.platform === undefined
        ? current.Platform
        : validateSocialMediaText_(payload.platform, 'Platform', 40, false);
      changes.AssignedTo = assigneeId;
      changes.Platform = platform;
      if (priority !== undefined && priority !== '') {
        changes.Priority = priority;
      }
      changes.DueDate = dueDate;
      actionLabel = 'Social media task assigned and scheduled';
    } else if (action === 'updateContent') {
      if (['Incoming', 'In Design', 'Needs Correction', 'On Hold'].indexOf(current.Status) === -1) {
        throw new Error('Task details cannot be edited at this workflow stage.');
      }
      changes.Caption = validateSocialMediaText_(payload.caption, 'Caption', 2200, false);
      var designReference = validateSocialMediaText_(payload.designReference, 'Design reference', 200, false);
      if (designReference) {
        changes.DesignFileID = designReference;
      }
      actionLabel = 'Social media task content updated';
    } else if (action === 'startDesign') {
      transitionSocialMediaTask_(current.Status, 'In Design');
      nextStatus = 'In Design';
      actionLabel = 'Social media task moved to In Design';
    } else if (action === 'submitForApproval') {
      transitionSocialMediaTask_(current.Status, 'Awaiting Approval');
      if (!hasValue_(current.Caption) || !hasValue_(current.DesignFileID)) {
        throw new Error('Add a caption and design reference before requesting approval.');
      }
      nextStatus = 'Awaiting Approval';
      actionLabel = 'Social media design submitted for approval';
    } else if (action === 'approveDesign') {
      requireSocialMediaPermission_('reviewProof');
      transitionSocialMediaTask_(current.Status, 'Ready to Publish');
      nextStatus = 'Ready to Publish';
      actionLabel = 'Social media design approved for publication';
    } else if (action === 'requestCorrection') {
      var designNote = validateSocialMediaText_(payload.notes, 'Correction notes', 500, true);
      transitionSocialMediaTask_(current.Status, 'Needs Correction');
      nextStatus = 'Needs Correction';
      changes.ReviewNotes = designNote;
      changes.ReviewedBy = user.userId;
      actionLabel = 'Social media task returned for correction: ' + designNote;
    } else if (action === 'hold') {
      transitionSocialMediaTask_(current.Status, 'On Hold');
      nextStatus = 'On Hold';
      actionLabel = 'Social media task put On Hold';
    } else if (action === 'cancel') {
      transitionSocialMediaTask_(current.Status, 'Cancelled');
      nextStatus = 'Cancelled';
      actionLabel = 'Social media task cancelled';
    } else if (action === 'resume') {
      if (current.Status !== 'On Hold') {
        throw new Error('Only On Hold tasks can be resumed.');
      }
      nextStatus = payload.resumeStatus || 'Incoming';
      transitionSocialMediaTask_(current.Status, nextStatus);
      actionLabel = 'Social media task resumed as ' + nextStatus;
    } else if (action === 'recordPublication') {
      transitionSocialMediaTask_(current.Status, 'Awaiting Publication Proof');
      var postUrl = validateSocialMediaText_(payload.postUrl, 'Post URL', 500, true);
      if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:[/?#][^\s]*)?$/i.test(postUrl)) {
        throw new Error('Post URL must be an HTTPS URL.');
      }
      var publishedAt = normalizeSocialMediaDateTime_(payload.publishedAt);
      changes.PostURL = postUrl;
      changes.PublishedAt = publishedAt;
      nextStatus = 'Awaiting Publication Proof';
      actionLabel = 'Social media publication recorded; proof review required';
    } else if (action === 'reviewProof') {
      if (current.Status !== 'Awaiting Publication Proof') {
        throw new Error('Only tasks awaiting publication proof can be reviewed.');
      }
      var accepted = payload.accepted === true;
      var reviewNotes = validateSocialMediaText_(payload.notes, 'Proof review notes', 500, true);
      requirePublicationProofWorkflow_();
      nextStatus = accepted ? 'Completed' : 'Needs Correction';
      changes.ReviewedBy = user.userId;
      changes.ReviewNotes = reviewNotes;
      if (accepted) {
        changes.CompletedAt = new Date();
      }
      actionLabel = accepted
        ? 'Social media publication proof accepted; task completed: ' + reviewNotes
        : 'Social media publication proof rejected: ' + reviewNotes;
    } else {
      throw new Error('Choose a supported social media task action.');
    }

    if (nextStatus !== current.Status) {
      changes.Status = nextStatus;
    }
    var updateHeaders = task.headers;
    Object.keys(changes).forEach(function (header) {
      var column = updateHeaders.indexOf(header) + 1;
      if (column < 1) {
        throw new Error('Social media task schema is missing required header "' + header + '".');
      }
      oldValues[header] = current[header];
    });
    var auditType = action === 'assign'
      ? 'Social Media task assignment'
      : action === 'updateContent'
        ? 'Social Media task details'
        : action === 'recordPublication'
          ? 'Social Media publication'
          : 'Social Media task status';
    var auditRecord = makeAuditRecord_(user.userId, actionLabel, normalizedTaskId, {
      user: user,
      actionType: auditType,
      outcome: 'Successful',
      details: action === 'assign'
        ? 'Task assignment and schedule were updated.'
        : action === 'updateContent'
          ? 'Task caption or design reference was updated.'
          : action === 'recordPublication'
            ? 'Manual publication details were recorded; proof review remains disabled.'
            : 'Task workflow status was changed.',
      entityType: 'Social Media task'
    });
    auditPlan = planAppendRows_(
      SAMS_CONFIG.sheetNames.auditLog,
      [auditRecord],
      'LogID',
      auditRecord.LogID
    );

    Object.keys(changes).forEach(function (header) {
      task.sheet.getRange(task.row, updateHeaders.indexOf(header) + 1)
        .setValue(safeSocialMediaCellValue_(changes[header]));
    });
    writeAppendPlan_(auditPlan);
    return { taskId: normalizedTaskId, status: nextStatus };
  } catch (error) {
    var rollbackErrors = [];
    if (auditPlan) {
      try {
        rollbackAppendPlan_(auditPlan);
      } catch (auditFailure) {
        rollbackErrors.push(auditFailure.message);
      }
    }
    if (changes) {
      Object.keys(oldValues).reverse().forEach(function (header) {
        try {
          var task = getSocialMediaTaskForUpdate_(normalizedTaskId);
          task.sheet.getRange(task.row, task.headers.indexOf(header) + 1)
            .setValue(safeSocialMediaCellValue_(oldValues[header]));
        } catch (rollbackFailure) {
          rollbackErrors.push(rollbackFailure.message);
        }
      });
    }
    if (rollbackErrors.length) {
      error = new Error(error.message + ' Partial-write recovery also failed: ' + rollbackErrors.join('; '));
    }
    try {
      recordActivityEvent_(user, {
        actionType: 'Social Media task update',
        action: 'Social Media task change failed',
        outcome: 'Failed',
        details: 'The task change was not confirmed. ' + sanitizeActivityLogText_(error.message, 180),
        entityType: 'Social Media task',
        recordId: normalizedTaskId
      });
    } catch (auditError) {
      throw new Error(error.message + ' The failure could not be recorded in the Activity Log: ' + auditError.message);
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}
