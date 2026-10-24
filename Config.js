// Server-side application settings. Do not include this object in browser code.
var SAMS_CONFIG = {
  applicationName: 'Student Achievement Management System',
  // Replace this placeholder with the ID from your existing spreadsheet URL.
  spreadsheetId: '197g4SJBbccvXlvR5OW4LFY867wwXcIVEL9owJ6TuDIg',
  // Change these values if your spreadsheet uses different tab names.
  sheetNames: {
    students: 'Students',
    achievements: 'Achievements',
    achievementEvidence: 'AchievementEvidence',
    achievementParticipants: 'AchievementParticipants',
    mediaAssets: 'MediaAssets',
    socialMediaTasks: 'SocialMediaTasks',
    users: 'Users',
    auditLog: 'AuditLog'
  },
  requiredHeaders: {
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
  }
};