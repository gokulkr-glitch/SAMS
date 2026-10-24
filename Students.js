function searchStudents(query) {
  var user = getSignedInUser_();
  if (!canSubmitAchievements_(user) && !canReviewAchievements_(user)) {
    throw new Error('An active SAMS user is required to search the student directory.');
  }
  if (typeof query !== 'string' || !query.trim()) {
    return [];
  }

  var needle = query.trim().toLowerCase();
  return getRecordsAsObjects_(SAMS_CONFIG.sheetNames.students)
    .filter(function (student) {
      return isActiveUser_(student.Status) && [
        student.StudentID, student.Name, student.RollNumber
      ].some(function (value) {
        return String(value || '').toLowerCase().indexOf(needle) !== -1;
      });
    })
    .slice(0, 25)
    .map(function (student) {
      return {
        studentId: String(student.StudentID),
        name: String(student.Name),
        rollNumber: String(student.RollNumber),
        grade: String(student.Grade),
        section: String(student.Section),
        status: String(student.Status)
      };
    });
}

function getStudentAchievementHistory(studentId) {
  var user = getSignedInUser_();
  if (!canSubmitAchievements_(user) && !canReviewAchievements_(user)) {
    throw new Error('An active SAMS user is required to view student achievement history.');
  }
  if (typeof studentId !== 'string' || !studentId.trim()) {
    throw new Error('A valid StudentID is required.');
  }

  var normalizedId = studentId.trim();
  var students = getRecordsAsObjects_(SAMS_CONFIG.sheetNames.students);
  if (!students.some(function (student) { return String(student.StudentID) === normalizedId; })) {
    throw new Error('The requested student could not be found.');
  }

  var participantLinks = getRecordsAsObjects_(SAMS_CONFIG.sheetNames.achievementParticipants)
    .filter(function (participant) { return String(participant.StudentID) === normalizedId; });
  var achievementIds = {};
  participantLinks.forEach(function (participant) {
    achievementIds[String(participant.AchievementID)] = true;
  });

  var achievementSheet = getSheetByName_(SAMS_CONFIG.sheetNames.achievements);
  var achievementHeaders = getHeaderRow_(achievementSheet);
  var canDeleteAny = isAchievementAdministrator_(user);
  return getRecordsAsObjects_(SAMS_CONFIG.sheetNames.achievements)
    .filter(function (achievement) {
      return achievementIds[String(achievement.AchievementID)] ||
        (achievementHeaders.indexOf('StudentID') !== -1 &&
          String(achievement.StudentID) === normalizedId);
    })
    .map(function (achievement) {
      return {
        achievementId: String(achievement.AchievementID || ''),
        title: String(achievement.Title || ''),
        category: String(achievement.Category || ''),
        competitionEvent: String(achievement.CompetitionEvent || ''),
        result: String(achievement.Result || ''),
        date: achievement.Date instanceof Date
          ? achievement.Date.toISOString().slice(0, 10)
          : String(achievement.Date || ''),
        academicYear: String(achievement.AcademicYear || ''),
        type: String(achievement.Type || ''),
        status: String(achievement.Status || ''),
        canDelete: canDeleteAny ||
          (canSubmitAchievements_(user) && String(achievement.SubmittedBy || '') === user.userId)
      };
    });
}