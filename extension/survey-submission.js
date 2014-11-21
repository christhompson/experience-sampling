/**
 * Experience Sampling submission functionality.
 *
 * This file contains classes and functions for saving and processing completed
 * surveys and sending them to the backend server.
 */

/**
 * SurveySubmission namespace.
 */
var SurveySubmission = SurveySubmission || {};

// Submission settings.
SurveySubmission.SERVER_URL = 'https://chrome-experience-sampling.appspot.com';
SurveySubmission.SUBMIT_SURVEY_ACTION = '/_ah/api/cesp/v1/submitsurvey';
SurveySubmission.XHR_TIMEOUT = 4000;  // milliseconds
SurveySubmission.DB_NAME = 'pendingResponsesDB';
SurveySubmission.DB_VERSION = 1;
SurveySubmission.QUEUE_ALARM_NAME = 'surveySubmissionAlarm';

/**
 * A question and response.
 * @constructor
 * @param {string} question The question being answered.
 * @param {string} answer The answer to that question.
 */
SurveySubmission.Response = function(question, answer) {
  this.question = question;
  this.answer = answer;
}

/**
 * A completed survey.
 * @constructor
 * @param {string} type The type of survey.
 * @param {int} participantId The participant ID.
 * @param {Date} dateTaken The date and time when the survey was taken.
 * @param {Array.Response} responses An array of Response objects.
*/
SurveySubmission.SurveyRecord = function(type, participantId, dateTaken,
    responses) {
  this.type = type;
  this.participantId = participantId;
  this.dateTaken = dateTaken;
  this.responses = responses;
}

/**
 * A completed survey pending submission to the backend.
 * @constructor
 * @param {SurveyRecord} surveyRecord The completed survey that is pending.
 * @param {int} timeToSend The time when we want the survey to be sent, in ms
 *     since epoch. The survey will not be sent before this time, but may be 
 *     delayed arbitrarily.
 * @param {int} tries The number of attempts made to send this survey so far.
 */
SurveySubmission.PendingSurveyRecord = function(surveyRecord, timeToSend,
    tries) {
  this.surveyRecord = surveyRecord;
  this.timeToSend = timeToSend;
  this.tries = tries;
}

/**
 * Saves a completed survey into the database of pending completed surveys.
 * Applies an exponential backoff based on the number of attempts made to
 * submit the survey so far.
 * @param {SurveyRecord} surveyRecord The completed survey to add to the
 *     queue.
 * @param {int=} tries The number of tries so far (optional, defaults to 0).
 */
SurveySubmission.saveSurveyRecord = function(surveyRecord, tries) {
  tries = tries || 0;
  return SurveySubmission.withObjectStore('PendingSurveyRecords', 'readwrite',
      function(store) {
    return new Promise(function(resolve, reject) {
      var timeToSend = Date.now() + SurveySubmission.calculateSendingDelay(tries);
      var pendingSurveyRecord = new SurveySubmission.PendingSurveyRecord(
          surveyRecord, timeToSend, tries);
      var request = store.add(pendingSurveyRecord);
      request.onsuccess = function(event) {
        resolve(true);
      };
      request.onerror = function(event) {
        reject(Error("Failed to save record"));
      };
    });
  });
}

/**
 * Compute the sending delay, in ms. This is an exponential backoff.
 * @param {int} tries The number of tries to send so far.
 * @returns {int} The delay in ms.
 */
SurveySubmission.calculateSendingDelay = function(tries) {
  return (Math.pow(2, tries) - 1) * 60000;
}

/**
 * Triggers processing the submission queue if the alarm is for processing the 
 * queue.
 */
SurveySubmission.processQueueAlarm = function(alarm) {
  if (alarm.name != SurveySubmission.QUEUE_ALARM_NAME) return;
  processQueue();
}
chrome.alarms.onAlarm.addListener(SurveySubmission.processQueueAlarm);

/**
 * Get all pending surveyRecords with timeToSend less than the current time,
 * and try to send them. If sending succeeds, delete them from the database. If
 * sending fails, update the timeToSend so we try again later.
 * @return {Promise} A promise that fulfills after every item processed has been
 *     updated or deleted.
 */ 
SurveySubmission.processQueue = function() {
  return SurveySubmission.withObjectStore('PendingSurveyRecords', 'readonly',
      function(store) {
    var surveysToSubmit = [];

    var index = store.index('timeToSend');
    var keyRange = IDBKeyRange.upperBound(Date.now());
    index.openCursor(keyRange).onsuccess = function(event) {
      var cursor = event.target.result;
      if (cursor) {
        surveysToSubmit.push({
          id: cursor.value.id,
          surveyRecord: cursor.value.surveyRecord
        });
        cursor.continue();
      } else {
        // Gather submissions into a single promise that fulfills when all of
        // the individual submission promises fulfill.
        return Promise.all(
          // Map array of surveys to sendSurveyRecord promises
          surveysToSubmit.map(SurveySubmission.sendSurveyRecord)
          // Map array of sendSurveyRecord promises to delete or update promises
            .map(function(submissionPromise) {
              submissionPromise.then(function(response) {
                return SurveySubmission.deleteSurveyRecord(id);
              }, function(error) {
                return SurveySubmission.updateTimeToSend(id);
              });
            });
        );
      }
    };
  });
}

/**
 * Delete the survey with the specified key from the database.
 * @param {int} id The ID primary key of survey to delete.
 * @returns {Promise} 
 */
SurveySubmission.deleteSurveyRecord = function(id) {
  return SurveySubmission.withObjectStore('PendingSurveyRecords', 'readwrite',
      function(store) {
    return new Promise(function(resolve, reject) {
      var request = store.delete(id);
      request.onsuccess = resolve;
      request.onerror = reject;
    });
  });
}

/**
 * Updates the timeToSend field of a survey with a given ID key based on the
 * number of times we've tried to send it.
 * @param {int} id The ID primary key of the survey to update.
 */
SurveySubmission.updateTimeToSend = function(id) {
  return SurveySubmission.withObjectStore('PendingSurveyRecords', 'readwrite',
      function(store) {
    return new Promise(function(resolve, reject) {
      var request = store.get(id);
      request.onsuccess =  function(event) {
        var record = event.target.result;
        record.tries = record.tries + 1;
        record.timeToSend = Date.now() +
            SurveySubmission.calculateSendingDelay(record.tries);
        var request = store.put(record);
        request.onsuccess = resolve;
        request.onerror = reject;
      };
      request.onerror = reject;
    });
  });
}

/**
 * Perform an action after opening the database and a given
 * object store.
 * @param {string} storeName The name of the object store to open.
 * @param {string} mode The transaction mode ('readwrite' or 'readonly').
 * @param {function(IDBObjectStore)} action A function that acts on the object
 *     store and returns a promise about its results.
 * @return {Promise<>} A promise about the results of the action function.
 */
SurveySubmission.withObjectStore = function(storeName, mode, action) {
  return new Promise(function(resolve, reject) {
    var request = indexedDB.open(SurveySubmission.DB_NAME,
        SurveySubmission.DB_VERSION);
    request.onsuccess = function(event) {
      var db = event.target.result;
      var transaction = db.transaction([storeName], mode);
      var objectStore = transaction.objectStore(storeName);
      action(objectStore).then(function(response) {
        resolve(response);
      }, function(error) {
        reject(error);
      });
    };
    request.onerror = function(event) {
      console.log("Database Error: " + event.target.errorCode);
      return Promise.reject();
      reject(event);
    }
    request.onupgradeneeded = SurveySubmission.setupPendingResponsesDatabase;
  });
}

/**
 * Sets up our object store and index for our database.
 * Used for the 'onupgradeneeded' event listener.
 * @param {event} event The event this listener is receiving.
 */
SurveySubmission.setupPendingResponsesDatabase = function(event) {
  var db = event.target.result;
  var objectStore = db.createObjectStore(
      'PendingSurveyRecords', {keyPath: 'id', autoIncrement: true});
  objectStore.createIndex('timeToSend', 'timeToSend', {unique: false});
}

/**
 * Sends a completed survey to the CESP backend via XHR.
 * @param {SurveyRecord} surveyRecord The completed survey to send to the
 *     backend.
 * @return {Promise<string|number>} A promise to the result of the submission.
 *     When resolved, this will be a string containing the response text. When 
 *     rejected, this will be the number of the HTTP status code.
 */
SurveySubmission.sendSurveyRecord = function(surveyRecord) {
  return new Promise(function(resolve, reject) {
    var url = SurveySubmission.SERVER_URL + SurveySubmission.SUBMIT_SURVEY_ACTION;
    var method = 'POST';
    var dateTaken = surveyRecord.dateTaken.toISOString();
    // Get rid of timezone 'Z' on end of ISO String for AppEngine compatibility.
    if (dateTaken.slice(-1) === 'Z') {
      dateTaken = dateTaken.slice(0, -1);
    }
    var data = {
      'date_taken': dateTaken,
      'participant_id': surveyRecord.participantId,
      'responses': [],
      'survey_type': surveyRecord.type
    };
    for (var i = 0; i < surveyRecord.responses.length; i++) {
      data.responses.push(surveyRecord.responses[i]);
    }
    var xhr = new XMLHttpRequest();
    function onLoadHandler(event) {
      if (xhr.readyState === 4) {
        if (xhr.status === 204) {
          resolve(xhr.response);
        } else {
          reject(xhr.status);
        }
      }
    }
    function onErrorHandler(event) {
      reject(xhr.status);
    }
    function onTimeoutHandler(event) {
      reject(xhr.status);
    }
    xhr.open(method, url, true);
    xhr.setRequestHeader('Content-Type', 'application/JSON');
    xhr.timeout = SurveySubmission.XHR_TIMEOUT;
    xhr.onload = onLoadHandler;
    xhr.onerror = onErrorHandler;
    xhr.ontimeout = onTimeoutHandler;
    xhr.send(JSON.stringify(data));
  });
}
