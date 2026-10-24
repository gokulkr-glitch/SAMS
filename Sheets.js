// Spreadsheet and header helpers. The trailing underscore keeps these helpers
// private to Apps Script and unavailable to google.script.run in the browser.
var SAMS_REQUIRED_SHEET_KEYS = [
  'students',
  'achievements',
  'achievementEvidence',
  'achievementParticipants',
  'mediaAssets',
  'socialMediaTasks',
  'users',
  'auditLog'
];

function validateSheetsConfiguration_() {
  if (!SAMS_CONFIG || typeof SAMS_CONFIG !== 'object') {
    throw new Error('Spreadsheet configuration is missing or invalid.');
  }

  var spreadsheetId = SAMS_CONFIG.spreadsheetId;
  if (typeof spreadsheetId !== 'string' || !spreadsheetId.trim() ||
      spreadsheetId === 'PASTE_YOUR_EXISTING_SPREADSHEET_ID_HERE') {
    throw new Error('Spreadsheet ID is not configured. Enter your existing spreadsheet ID in Config.js.');
  }

  if (!SAMS_CONFIG.sheetNames || typeof SAMS_CONFIG.sheetNames !== 'object') {
    throw new Error('Sheet names are not configured correctly in Config.js.');
  }

  var usedNames = {};
  SAMS_REQUIRED_SHEET_KEYS.forEach(function (key) {
    var sheetName = SAMS_CONFIG.sheetNames[key];
    if (typeof sheetName !== 'string' || !sheetName.trim()) {
      throw new Error('The configured tab name for "' + key + '" is missing or invalid.');
    }

    var normalizedName = sheetName.trim().toLowerCase();
    if (usedNames[normalizedName]) {
      throw new Error('Configured tab names must be unique. Check the name for "' + key + '".');
    }
    usedNames[normalizedName] = true;
  });

  if (!SAMS_CONFIG.requiredHeaders || typeof SAMS_CONFIG.requiredHeaders !== 'object') {
    throw new Error('Required headers must be configured as lists in Config.js.');
  }

  SAMS_REQUIRED_SHEET_KEYS.forEach(function (key) {
    var headers = SAMS_CONFIG.requiredHeaders[key];
    if (!Array.isArray(headers)) {
      throw new Error('Required headers for "' + key + '" must be a list.');
    }

    var usedHeaders = {};
    headers.forEach(function (header) {
      if (typeof header !== 'string' || !header.trim()) {
        throw new Error('Required headers for "' + key + '" contain an empty or invalid name.');
      }
      var normalizedHeader = header.trim().toLowerCase();
      if (usedHeaders[normalizedHeader]) {
        throw new Error('Required headers for "' + key + '" contain a duplicate name.');
      }
      usedHeaders[normalizedHeader] = true;
    });
  });
}

function getConfiguredSpreadsheet_() {
  validateSheetsConfiguration_();

  try {
    return SpreadsheetApp.openById(SAMS_CONFIG.spreadsheetId.trim());
  } catch (error) {
    throw new Error('Unable to open the configured spreadsheet. Check that the ID is correct and the Apps Script account has access.');
  }
}

function getSheetByName_(sheetName) {
  if (typeof sheetName !== 'string' || !sheetName.trim()) {
    throw new Error('A valid tab name is required.');
  }

  var sheet = getConfiguredSpreadsheet_().getSheetByName(sheetName.trim());
  if (!sheet) {
    throw new Error('Required tab "' + sheetName.trim() + '" was not found. Check its configured name in Config.js.');
  }
  return sheet;
}

function getHeaderRow_(sheet) {
  var lastColumn = sheet.getLastColumn();
  var sheetName = sheet.getName();
  if (sheet.getLastRow() === 0 || lastColumn === 0) {
    throw new Error('Tab "' + sheetName + '" is empty and has no header row.');
  }

  var headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
    .map(function (header) { return String(header).trim(); });
  var seenHeaders = {};
  var duplicateHeaders = {};

  headers.forEach(function (header, index) {
    if (!header) {
      throw new Error('Tab "' + sheetName + '" has a blank header in column ' + (index + 1) + '.');
    }
    var normalizedHeader = header.toLowerCase();
    if (seenHeaders[normalizedHeader]) {
      duplicateHeaders[normalizedHeader] = header;
    }
    seenHeaders[normalizedHeader] = true;
  });
  var duplicates = Object.keys(duplicateHeaders).map(function (key) {
    return '"' + duplicateHeaders[key] + '"';
  });
  if (duplicates.length) {
    throw new Error('Tab "' + sheetName + '" has duplicate headers: ' + duplicates.join(', ') + '.');
  }

  return headers;
}

function getRecordsAsObjects_(sheetName) {
  var sheet = getSheetByName_(sheetName);
  var headers = getHeaderRow_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }

  return sheet.getRange(2, 1, lastRow - 1, headers.length).getValues()
    .map(function (row) {
      var record = {};
      headers.forEach(function (header, index) {
        record[header] = row[index];
      });
      return record;
    });
}

function getSheetDiagnostic_(spreadsheet, key) {
  var name = SAMS_CONFIG.sheetNames[key].trim();
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    return {
      name: name,
      present: false,
      headers: [],
      valid: false,
      error: 'Required tab was not found.'
    };
  }

  try {
    var headers = getHeaderRow_(sheet);
    var availableHeaders = {};
    headers.forEach(function (header) {
      availableHeaders[header.toLowerCase()] = true;
    });

    var requiredHeaders = SAMS_CONFIG.requiredHeaders[key];
    if (!requiredHeaders.length) {
      return {
        name: name,
        present: true,
        headers: headers,
        valid: false,
        error: 'Required headers are not configured for this tab.'
      };
    }

    var missingHeaders = requiredHeaders
      .filter(function (header) { return !availableHeaders[header.trim().toLowerCase()]; });
    if (missingHeaders.length) {
      return {
        name: name,
        present: true,
        headers: headers,
        valid: false,
        error: 'Missing required headers: ' + missingHeaders.join(', ')
      };
    }

    return { name: name, present: true, headers: headers, valid: true, error: '' };
  } catch (error) {
    return {
      name: name,
      present: true,
      headers: [],
      valid: false,
      error: error.message
    };
  }
}

// Browser-safe diagnostic: returns schema metadata only, never records or IDs.
function getSpreadsheetDiagnostic() {
  try {
    validateSheetsConfiguration_();
  } catch (error) {
    return {
      status: 'not_configured',
      schemaValid: false,
      message: error.message,
      tabs: []
    };
  }

  var spreadsheet;
  try {
    spreadsheet = getConfiguredSpreadsheet_();
  } catch (error) {
    return {
      status: 'error',
      schemaValid: false,
      message: error.message,
      tabs: []
    };
  }

  var tabs = SAMS_REQUIRED_SHEET_KEYS.map(function (key) {
    return getSheetDiagnostic_(spreadsheet, key);
  });
  var schemaValid = tabs.every(function (tab) { return tab.valid; });

  return {
    status: 'connected',
    schemaValid: schemaValid,
    message: schemaValid
      ? 'Spreadsheet connected and required tabs are valid.'
      : 'Spreadsheet connected, but one or more tabs need attention.',
    tabs: tabs
  };
}