// Serve the dashboard through Apps Script HTML Service.
function doGet() {
	return HtmlService.createTemplateFromFile('Index')
		.evaluate()
		.setTitle(SAMS_CONFIG.applicationName)
		.addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Confirm that the browser can reach this Apps Script project.
function getSystemHealth() {
	return {
		status: 'connected',
		message: 'Server connection established.',
		checkedAt: new Date().toISOString()
	};
}

function getDashboardSummary() {
  var students = getRecordsAsObjects_(SAMS_CONFIG.sheetNames.students);
  var achievements = getRecordsAsObjects_(SAMS_CONFIG.sheetNames.achievements);
  var tasks = getRecordsAsObjects_(SAMS_CONFIG.sheetNames.socialMediaTasks);
  var assets = getRecordsAsObjects_(SAMS_CONFIG.sheetNames.mediaAssets);

  return {
    students: countRecordsWithValues_(students, ['StudentID']),
    achievements: countRecordsWithValues_(achievements, ['AchievementID']),
    pendingReviews: achievements.filter(function (achievement) {
      return hasValue_(achievement.AchievementID) &&
        String(achievement.Status || '').trim() === 'Pending';
    }).length,
    socialMediaTasks: countRecordsWithValues_(tasks, ['TaskID']),
    storyAssets: assets.filter(function (asset) {
      return hasValue_(asset.AssetID) &&
        String(asset.AssetType || '').trim().toLowerCase() === 'story';
    }).length
  };
}

function countRecordsWithValues_(records, headers) {
  return records.filter(function (record) {
    return headers.every(function (header) {
      return hasValue_(record[header]);
    });
  }).length;
}

function hasValue_(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}
