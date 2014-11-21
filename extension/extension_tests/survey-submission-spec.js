/* Integration tests for the survey submission code.
 * 
 *
 */

function withAllRecords(successCallback) {
  var items = [];
  withObjectStore('PendingSurveyRecords', 'read', function(store) {
    store.openCursor().onsuccess = function(event) {
      var cursor = event.target.result;
      if (cursor) {
        items.push(cursor.value);
        cursor.continue();
      } else {
        successCallback(items);
      }
    }
  });
}

describe('Saving a survey record', function() {
  SurveySubmission.DB_NAME = 'testingDatabase';
  var response = new SurveySubmission.Response('q1', 'a1');
  var record = new SurveySubmission.SurveyRecord('testType', 0, new Date(), [response]);

  it('is in database with zero tries', function(done) {
    SurveySubmission.saveSurveyRecord(record);
    done();

    withAllRecords(function(items) {
      expect(items.length).toEqual(1);
      expect(items[0].tries).toEqual(0);
      expect(items[0].record.type).toBe('testType');
      expect(items[0].record.responses[0].question).toBe('q1');
    });
  });

  it('is in database with later time and two tries', function(done) {
    SurveySubmission.saveSurveyRecord(record, 2);
    done();

    withAllRecords(function(items) {
      expect(items.length).toEqual(1);
      expect(items[0].tries).toEqual(2);
      var currentTime = new Date();
      expect(items[0].timeToSend).toBeGreaterThan(currentTime);
    });
  });
});

describe('Calculating the sending delay', function() {
  it('should be zero delay when tries == 0', function() {
    expect(SurveySubmission.calculateSendingDelay(0)).toEqual(0);
  });

  it('should be 900,000 ms when tries == 4', function() {
    expect(SurveySubmission.calculateSendingDelay(4)).toEqual(900000);
  });

  it('should be monotonically increasing with tries', function() {
    var delay1 = SurveySubmission.calculateSendingDelay(1);
    var delay2 = SurveySubmission.calculateSendingDelay(2);
    var delay3 = SurveySubmission.calculateSendingDelay(3);
    expect(delay1).toBeLessThan(delay2);
    expect(delay2).toBeLessThan(delay3);
  });
});

describe('Saving, processing, and sending a single survey record', function() {
  SurveySubmission.DATABASE_NAME = 'testingDatabase';

  beforeEach(function(done) {
    jasmine.Ajax.install();

    this.onSucess = jasmine.createSpy('onSuccess');
    this.onFailure = jasmine.createSpy('onFailure');

    this.testResponse = new SurveySubmission.Response('q1', 'a1');
    this.testRecord = new SurveySubmission.SurveyRecord('testType', 0, new Date(), [this.testResponse]);
    
    SurveySubmission.saveSurveyRecord(this.testRecord, function());
    SurveySubmission.processQueue({name: SurveySubmission.QUEUE_ALARM_NAME});

    this.request = jasmine.Ajax.requests.mostRecent();
    expect(this.request).not.toBeUndefined();
    expect(this.request).not.toBeNull();
    expect(this.request.url).toBe(SurveySubmission.SERVER_URL + SurveySubmission.SUBMIT_SURVEY_ACTION);
    expect(this.request.method).toBe('POST');
    done();
  });

  it('will be removed from the database on success', function(done) {
    this.request.response({
      'status': 204,
      'contentType': 'text/plain',
      'responseText': ''
    });
    expect(this.onSuccess).toHaveBeenCalledWith();
    // Check that the testing database is empty.
    withAllRecords(function(items) {
      expect(items.length).toEqual(0);
    });
  });

  it('will be in database with a later time on failure', function(done) {
    this.request.response({
      'status': 500,
      'contentType': text/plain,
      'responseText': ''
    });

    expect(this.onFailure).toHaveBeenCalledWith();

    // Check that there is one item in the database with a time greater than now.
    withAllRecords(function(items) {
      expect(items.length).toEqual(1);
      var currentTime = new Date();
      expect(items[0].timeToSend).toBeGreaterThan(currentTime);
      expect(items[0].tries).toEqual(1);
    });
    done();
  });
});

describe('Handling a large number of pending surveys', function() {

});
