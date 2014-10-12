/**
 * Experience Sampling event page.
 *
 * This background page handles the various events for registering participants
 * and showing new surveys in response to API events.
 *
 * Participants must fill out both a consent form and a startup survey (with
 * demographics) before they can begin to answer real survey questions.
 */

var cesp = {};  // namespace variable

cesp.readyForSurveys = false;

// Settings.
cesp.notificationTitle = "New survey available";
cesp.notificationBody = "Click here to take a survey about the screen you just"
                        + "saw";
cesp.iconFile = "icon.png";
cesp.notificationDefaultTimeout = 15000;  // milliseconds

/**
 * Retrieves the registration status from Local Storage.
 */
function getConsentStatus() {
  chrome.storage.local.get(constants.CONSENT_KEY, maybeShowConsentForm);
}

/**
 * Checks whether consent has been granted yet; if not, opens the consent form.
 * @param {object} consentLookup Object containing consent status (or empty).
 */
function maybeShowConsentForm(consentLookup) {
  if (!consentLookup || consentLookup[constants.CONSENT_KEY] == null ||
      consentLookup[constants.CONSENT_KEY] == constants.CONSENT_PENDING) {
    chrome.storage.local.set({'pending_responses': []});
    chrome.storage.onChanged.addListener(storageUpdated);
    chrome.tabs.create({'url': chrome.extension.getURL('consent.html')});
  } else if (consentLookup[constants.CONSENT_KEY] ==
             constants.CONSENT_REJECTED) {
    chrome.management.uninstallSelf();
  } else if (consentLookup[constants.CONSENT_KEY] ==
             constants.CONSENT_GRANTED) {
    // Someone might have filled out the consent form previously but not
    // filled out the setup survey. Check to see if that's the case.
    chrome.storage.local.get(constants.SETUP_KEY, maybeShowSetupSurvey);
  }
}

/**
 * Checks whether the setup survey has been completed yet. If it has been, we
 * are now ready to start showing surveys. If not, we need to listen for
 * when it's completed.
 * @param {object} setupLookup Object containing setup survey status (or empty).
 */
function maybeShowSetupSurvey(setupLookup) {
  if (!setupLookup || setupLookup[constants.SETUP_KEY] == null ||
      setupLookup[constants.SETUP_KEY] == constants.SETUP_PENDING) {
    chrome.tabs.create({'url': chrome.extension.getURL('surveys/setup.html')});
  } else if (setupLookup[constants.SETUP_KEY] == constants.SETUP_COMPLETED) {
    cesp.readyForSurveys = true;
  }
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
    cesp.readyForSurveys = true;
  }
}

// Performs consent and registration checks on startup and install.
chrome.runtime.onInstalled.addListener(getConsentStatus);
chrome.runtime.onStartup.addListener(getConsentStatus);

/**
 * Creates a new HTML5 notification to prompt the participant to take an
 * experience sampling survey.
 * @param {object} element The browser element of interest.
 * @param {object} decision The decision the participant made.
 */
function showSurveyPrompt(element, decision) {
  if (!cesp.readyForSurveys) return;
  var timePromptShown = new Date();
  var opt = {body: cesp.notificationTitle,
             icon: cesp.iconFile,
             tag: cesp.notificationTag};
  var notification = new window.Notification(cesp.notificationTitle, opt);
  notification.onshow = function() {
    setTimeout(notification.close, cesp.notificationDefaultTimeout);
  };
  notification.onclick = function() {
    var timePromptClicked = new Date();
    loadSurvey(element, decision, timePromptShown, timePromptClicked);
  };
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
  if (!cesp.readyForSurveys) return;
  var surveyURL = "survey-example.html";
  chrome.tabs.create({'url': chrome.extension.getURL("surveys/" + surveyURL)},
      function() { console.log("Opened survey."); });
}

// Trigger the new survey prompt when the participant makes a decision about an
// experience sampling element.
chrome.experienceSamplingPrivate.onDecision.addListener(showSurveyPrompt);
