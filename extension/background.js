/**
 * Experience Sampling event page.
 *
 * This background page handles the various events for registering participants
 * and showing new surveys in response to API events.
 *
 * Participants must fill out both a consent form and a startup survey (with
 * demographics) before they can begin to answer real survey questions.
 */


/**
 * cesp namespace.
 */
var cesp = cesp || {};

cesp.openTabId = -1;

// Settings.
cesp.NOTIFICATION_TITLE = 'Take a Chrome user experience survey!';
cesp.NOTIFICATION_BODY = 'Your feedback makes Chrome better.';
cesp.NOTIFICATION_BUTTON = 'Take survey!';
cesp.NOTIFICATION_CONSENT_LINK = 'What is this?';
cesp.MAX_SURVEYS_PER_DAY = 2;
cesp.MAX_SURVEYS_PER_WEEK = 4;
cesp.ICON_FILE = 'icons/cues_85.png';
cesp.NOTIFICATION_DEFAULT_TIMEOUT = 10;  // minutes
cesp.NOTIFICATION_TAG = 'chromeSurvey';
cesp.SURVEY_THROTTLE_DAILY_RESET_ALARM = 'dailySurveyCountReset';
cesp.SURVEY_THROTTLE_WEEKLY_RESET_ALARM = 'weeklySurveyCountReset';
cesp.NOTIFICATION_ALARM_NAME = 'notificationTimeout';
cesp.UNINSTALL_ALARM_NAME = 'uninstallAlarm';
cesp.READY_FOR_SURVEYS = 'readyForSurveys';
cesp.PARTICIPANT_ID_LOOKUP = 'participantId';
cesp.LAST_NOTIFICATION_TIME = 'lastNotificationTime';
cesp.MINIMUM_SURVEY_DELAY = 300000;  // 5 minutes in ms.

// SETUP

/**
 * A helper method for updating the value in local storage.
 * @param {bool} newState The desired new state for the ready for surveys flag.
 */
function setReadyForSurveysStorageValue(newState) {
  var items = {};
  items[cesp.READY_FOR_SURVEYS] = newState;
  chrome.storage.local.set(items);
}

/**
 * A helper method for updating the value in local storage.
 * @param {int} newCount The desired new survey count value.
 */
function setSurveysShownDaily(newCount) {
  var items = {};
  items[cesp.SURVEYS_SHOWN_TODAY] = newCount;
  chrome.storage.local.set(items);
}

/**
 * A helper method for updating the value in local storage.
 * @param {int} newCount The desired new survey count value.
 */
function setSurveysShownWeekly(newCount) {
  var items = {};
  items[cesp.SURVEYS_SHOWN_THIS_WEEK] = newCount;
  chrome.storage.local.set(items);
}

/**
 * Resets the last notification time value in local storage to the current time.
 */
function resetLastNotificationTimeStorageValue() {
  var items = {};
  items[cesp.LAST_NOTIFICATION_TIME] = Date.now();
  chrome.storage.local.set(items);
}

/**
 * Sets up basic state for the extension. Called when extension is installed.
 * @param {object} details The details of the chrome.runtime.onInstalled event.
 */
function setupState(details) {
  // We check the event reason because onInstalled can trigger for other
  // reasons (extension or browser update).
  if (details.reason !== 'install') return;

  setReadyForSurveysStorageValue(false);
  // Automatically uninstall the extension after 120 days.
  chrome.alarms.create(cesp.UNINSTALL_ALARM_NAME, {delayInMinutes: 172800});
  // Set the count of surveys shown to 0. Reset it each day/week at midnight.
  setSurveysShownDaily(0);
  setSurveysShownWeekly(0);
  var midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  chrome.alarms.create(cesp.SURVEY_THROTTLE_DAILY_RESET_ALARM,
      {when: midnight.getTime(), periodInMinutes: 1440});
  chrome.alarms.create(cesp.SURVEY_THROTTLE_WEEKLY_RESET_ALARM,
      {when: midnight.getTime(), periodInMinutes: 10080});

  // Process the pending survey submission queue every 20 minutes.
  chrome.alarms.create(SurveySubmission.QUEUE_ALARM_NAME,
      {delayInMinutes: 1, periodInMinutes: 20});
}

/**
 * Handles the uninstall alarm.
 * @param {Alarm} alarm The alarm object from the onAlarm event.
*/
function handleUninstallAlarm(alarm) {
  if (alarm.name === cesp.UNINSTALL_ALARM_NAME)
    chrome.management.uninstallSelf();
}
chrome.alarms.onAlarm.addListener(handleUninstallAlarm);

/**
 * Resets the count of surveys shown today to 0.
 * @param {Alarm} alarm The alarm object from the onAlarm event.
 */
function resetSurveyDailyCount(alarm) {
  if (alarm.name === cesp.SURVEY_THROTTLE_DAILY_RESET_ALARM)
    setSurveysShownDaily(0);
}
chrome.alarms.onAlarm.addListener(resetSurveyDailyCount);

/**
 * Resets the count of surveys shown this week to 0.
 * @param {Alarm} alarm The alarm object from the onAlarm event.
 */
function resetSurveyWeeklyCount(alarm) {
  if (alarm.name === cesp.SURVEY_THROTTLE_WEEKLY_RESET_ALARM)
    setSurveysShownWeekly(0);
}
chrome.alarms.onAlarm.addListener(resetSurveyWeeklyCount);

/**
 * Checks whether participant has granted consent and/or completed the
 * demographic survey. If not, get the participant started.
 */
function maybeShowConsentOrSetupSurvey() {
  var setupCallback = function(lookup) {
    if (!lookup || !lookup[constants.SETUP_KEY] ||
        lookup[constants.SETUP_KEY] === constants.SETUP_PENDING) {
      getOperatingSystem().then(function(os) {
        chrome.tabs.create(
            {'url': chrome.extension.getURL('surveys/setup.html?os=' + os)});
      });
    } else if (lookup[constants.SETUP_KEY] === constants.SETUP_COMPLETED) {
      setReadyForSurveysStorageValue(true);
    }
  };
  var consentCallback = function(lookup) {
    if (!lookup || !lookup[constants.CONSENT_KEY] ||
        lookup[constants.CONSENT_KEY] === constants.CONSENT_PENDING) {
      chrome.storage.onChanged.addListener(storageUpdated);
      getOperatingSystem().then(function(os) {
        chrome.tabs.create(
            {'url': chrome.extension.getURL('consent.html?os=' + os)});
      });
    } else if (lookup[constants.CONSENT_KEY] === constants.CONSENT_REJECTED) {
      chrome.management.uninstallSelf();
    } else if (lookup[constants.CONSENT_KEY] === constants.CONSENT_GRANTED) {
      // Someone might have filled out the consent form previously but not
      // filled out the setup survey. Check to see if that's the case.
      chrome.storage.local.get(constants.SETUP_KEY, setupCallback);
    }
  };
  chrome.storage.local.get(constants.CONSENT_KEY, consentCallback);
}

/**
 * Listens for the setup survey submission. When that happens, signals that
 * the experience sampling is now ready to begin.
 * @param {object} changes The changed portions of the database.
 * @param {string} areaName The name of the storage area.
 */
function storageUpdated(changes, areaName) {
  if (changes && changes[constants.SETUP_KEY] &&
      changes[constants.SETUP_KEY].newValue == constants.SETUP_COMPLETED) {
    setReadyForSurveysStorageValue(true);
  }
}

// Performs consent and registration checks on startup and install.
chrome.runtime.onInstalled.addListener(maybeShowConsentOrSetupSurvey);
chrome.runtime.onStartup.addListener(maybeShowConsentOrSetupSurvey);
chrome.runtime.onInstalled.addListener(setupState);

// GETTERS

/**
 * A helper method for getting (or, if necessary, setting) the participant ID.
 * @returns {Promise} A promise that resolves with the participant ID.
 */
function getParticipantId() {
  return new Promise(function(resolve, reject) {
    chrome.storage.local.get(cesp.PARTICIPANT_ID_LOOKUP, function(lookup) {
      if (lookup && lookup[cesp.PARTICIPANT_ID_LOOKUP])
        resolve(lookup[cesp.PARTICIPANT_ID_LOOKUP]);

      var charset = 
          "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz";
      var participantId = '';
      for (var i = 0; i < 100; i++) {
        var rand = Math.floor(Math.random() * charset.length);
        participantId += charset.charAt(rand);
      }
      var items = {};
      items[cesp.PARTICIPANT_ID_LOOKUP] = participantId;
      chrome.storage.local.set(items);
      resolve(participantId);
    });
  });
}

/**
 * A helper method for getting the operating system.
 * @returns {Promise} A promise that resolves with the operating system.
 */
function getOperatingSystem() {
  return new Promise(function(resolve, reject) {
    chrome.runtime.getPlatformInfo(function(platformInfo) {
      resolve(platformInfo.os);
    });
  });
}

// SURVEY HANDLING

/**
 * Clears our existing notification(s).
 * @param {Alarm} alarm The alarm object from the onAlarm event (optional).
 */
function clearNotifications(alarm) {
  if (alarm && alarm.name !== cesp.NOTIFICATION_ALARM_NAME)
    return;
  chrome.notifications.clear(cesp.NOTIFICATION_TAG, function(unused) {});
  chrome.alarms.clear(cesp.NOTIFICATION_ALARM_NAME);
}
// Clear the notification state when the survey times out.
chrome.alarms.onAlarm.addListener(clearNotifications);

/**
 * Creates a new notification to prompt the participant to take an experience
 * sampling survey.
 * @param {object} element The browser element of interest.
 * @param {object} decision The decision the participant made.
 */
function showSurveyNotification(element, decision) {
  var eventType = constants.FindEventType(element['name']);
  switch (eventType) {
    case constants.EventType.SSL_OVERRIDABLE:
    case constants.EventType.SSL_NONOVERRIDABLE:
    case constants.EventType.MALWARE:
    case constants.EventType.PHISHING:
    case constants.EventType.EXTENSION_INSTALL:
    case constants.EventType.EXTENSION_INLINE_INSTALL:
    case constants.EventType.EXTENSION_BUNDLE:
      // Supported events.
      break;
    case constants.EventType.HARMFUL:
    case constants.EventType.SB_OTHER:
    case constants.EventType.DOWNLOAD_MALICIOUS:
    case constants.EventType.DOWNLOAD_DANGEROUS:
    case constants.EventType.DOWNLOAD_DANGER_PROMPT:
    case constants.EventType.EXTENSION_OTHER:
    case constants.EventType.UNKNOWN:
    default:
      // Unsupported events.
      return;
  }
  chrome.storage.local.get([cesp.READY_FOR_SURVEYS,
                            cesp.LAST_NOTIFICATION_TIME], function(items) {
    if (!items[cesp.READY_FOR_SURVEYS]) return;

    // If we've shown a notification less than MINIMUM_SURVEY_DELAY ago, stop.
    if (items[cesp.LAST_NOTIFICATION_TIME] &&
        Date.now() - items[cesp.LAST_NOTIFICATION_TIME] <
        cesp.MINIMUM_SURVEY_DELAY) return;

    chrome.storage.local.get([cesp.SURVEYS_SHOWN_TODAY,
                              cesp.SURVEYS_SHOWN_THIS_WEEK], function(items) {
      if (items[cesp.SURVEYS_SHOWN_TODAY] >= cesp.MAX_SURVEYS_PER_DAY ||
          items[cesp.SURVEYS_SHOWN_THIS_WEEK] >= cesp.MAX_SURVEYS_PER_WEEK) {
        return;
      }

      clearNotifications();

      var timePromptShown = new Date();
      var clickHandler = function(notificationId, buttonIndex) {
        if (buttonIndex === 1) {
          chrome.tabs.create({'url': chrome.extension.getURL('consent.html')});
        } else {
          var timePromptClicked = new Date();
          loadSurvey(element, decision, timePromptShown, timePromptClicked);
          clearNotifications();
        }
      };
      var opt = {
        type: 'basic',
        iconUrl: cesp.ICON_FILE,
        title: cesp.NOTIFICATION_TITLE,
        message: cesp.NOTIFICATION_BODY,
        eventTime: Date.now(),
        buttons: [
          {title: cesp.NOTIFICATION_BUTTON},
          {title: cesp.NOTIFICATION_CONSENT_LINK}
        ],
        isClickable: true
      };
      chrome.notifications.create(
          cesp.NOTIFICATION_TAG,
          opt,
          function(id) {
            chrome.alarms.create(
                cesp.NOTIFICATION_ALARM_NAME,
                {delayInMinutes: cesp.NOTIFICATION_DEFAULT_TIMEOUT});
          });
      chrome.notifications.onClicked.addListener(clickHandler);
      chrome.notifications.onButtonClicked.addListener(clickHandler);
      setSurveysShownDaily(items[cesp.SURVEYS_SHOWN_TODAY] + 1);
      setSurveysShownWeekly(items[cesp.SURVEYS_SHOWN_THIS_WEEK] + 1);
      resetLastNotificationTimeStorageValue();
    });
  });
}

/**
 * Creates a new tab with the experience sampling survey page.
 * @param {object} element The browser element of interest.
 * @param {object} decision The decision the participant made.
 * @param {object} timePromptShown Date object of when the survey prompt
 *     notification was shown to the participant.
 * @param {object} timePromptClicked Date object of when the participant
 *     clicked the survey prompt notification.
 */
function loadSurvey(element, decision, timePromptShown, timePromptClicked) {
  chrome.storage.local.get(cesp.READY_FOR_SURVEYS, function(items) {
    if (!items[cesp.READY_FOR_SURVEYS]) return;
    var userDecision = decision['name'];
    if (userDecision !== constants.DecisionType.PROCEED &&
        userDecision !== constants.DecisionType.DENY) {
      return;
    }

    var surveyUrl, visitUrl;
    var eventType = constants.FindEventType(element['name']);
    switch (eventType) {
      case constants.EventType.SSL_OVERRIDABLE:
        surveyUrl = userDecision === constants.DecisionType.PROCEED ?
            constants.SurveyLocation.SSL_OVERRIDABLE_PROCEED :
            constants.SurveyLocation.SSL_OVERRIDABLE_NOPROCEED;
        visitUrl = urlHandler.GetMinimalUrl(element['destination']);
        break;
      case constants.EventType.SSL_NONOVERRIDABLE:
        surveyUrl = constants.SurveyLocation.SSL_NONOVERRIDABLE;
        visitUrl = urlHandler.GetMinimalUrl(element['destination']);
        break;
      case constants.EventType.MALWARE:
        surveyUrl = userDecision === constants.DecisionType.PROCEED ?
            constants.SurveyLocation.MALWARE_PROCEED :
            constants.SurveyLocation.MALWARE_NOPROCEED;
        visitUrl = urlHandler.GetMinimalUrl(element['destination']);
        break;
      case constants.EventType.PHISHING:
        surveyUrl = userDecision === constants.DecisionType.PROCEED ?
            constants.SurveyLocation.PHISHING_PROCEED :
            constants.SurveyLocation.PHISHING_NOPROCEED;
        visitUrl = urlHandler.GetMinimalUrl(element['destination']);
        break;
      case constants.EventType.EXTENSION_INSTALL:
      case constants.EventType.EXTENSION_INLINE_INSTALL:
      case constants.EventType.EXTENSION_BUNDLE:
        surveyUrl = userDecision === constants.DecisionType.PROCEED ?
            constants.SurveyLocation.EXTENSION_PROCEED :
            constants.SurveyLocation.EXTENSION_NOPROCEED;
        break;
      case constants.EventType.HARMFUL:
      case constants.EventType.SB_OTHER:
      case constants.EventType.DOWNLOAD_MALICIOUS:
      case constants.EventType.DOWNLOAD_DANGEROUS:
      case constants.EventType.DOWNLOAD_DANGER_PROMPT:
      case constants.EventType.EXTENSION_OTHER:
        // Don't survey about these.
        return;
      case constants.EventType.UNKNOWN:
        throw new Error('Unknown event type: ' + element['name']);
        return;
    }
    getOperatingSystem().then(function(os) {
      visitUrl = encodeURIComponent(visitUrl);
      var openUrl = 'surveys/survey.html?js=' + surveyUrl + '&url=' + visitUrl
          + '&os=' + os;
      chrome.tabs.create(
          {'url': chrome.extension.getURL(openUrl)},
          function(tab) {
            try {
              chrome.tabs.remove(cesp.openTabId);
            } catch (err) { }
            cesp.openTabId = tab.id;
      });
    });
  });
}

// Trigger the new survey prompt when the participant makes a decision about an
// experience sampling element.
chrome.experienceSamplingPrivate.onDecision.addListener(showSurveyNotification);

/**
 * Handle the submission of a completed survey.
 */
function handleCompletedSurvey(message) {
  getParticipantId().then(function(participantId) {
    var record = new SurveySubmission.SurveyRecord(
        message['survey_type'],
        participantId,
        (new Date),
        message['responses']);
    SurveySubmission.saveSurveyRecord(record);
  });
}
chrome.runtime.onMessage.addListener(handleCompletedSurvey);
