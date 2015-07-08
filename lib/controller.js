var assert = require('assert'),
  cluster = require('cluster'),
  os = require('os'),
  util = require('util'),
  EventEmitter = require('events').EventEmitter;

var nextTick = setImmediate;
var _ = require('lodash');
var pkg = require('../package.json');
var logger = require('oniyi-logger').makeLabeledLogger(pkg.name);

var OPTION_DEFAULTS = {
  shutdownTimeout: 5000,
  terminateTimeout: 5000,
  throttleDelay: 2000,
  env: {}
};

var msg = {
  SHUTDOWN: 'shutdown'
};

// A worker is only removed from cluster.workers after the worker has disconnected and exited.
// There might be a delay between the 'exit' and 'disconnect' events.
// Also, the order between these two events can not be determined in advance.
// This function will return an Array of alive worker's ids
function liveWorkerIds() {
  return Object.keys(cluster.workers).filter(function(id) {
    var worker = cluster.workers[id];
    // consider a worker alive when both, signalCode and exitCode are null
    var isAlive = worker.process.signalCode == null &&
      worker.process.exitCode == null;
    return isAlive;
  });
}

function clusterSize() {
  return liveWorkerIds().length;
}

// return worker by id
function toWorker(id) {
  var worker = cluster.workers[id];
  assert(worker, 'worker id ' + id + ' invalid');
  return worker;
}

// ensuring the worker is annotated with an _control property.
function setupControl(worker) {
  worker._control = worker._control || {};
  worker.startTime = worker.startTime || Date.now();
  return worker;
}

// use single instance of controller.
// controller needs to emit events
var controller = new EventEmitter();

// generate a status object with details about the controller and each individual worker
controller.status = function status() {
  var retval = {};
  var now = Date.now();

  retval.controller = {
    pid: process.pid,
    setSize: this.size,
    currentSize: clusterSize(),
    startTime: controller.startTime,
  };

  retval.workers = [];

  for (var id in cluster.workers) {
    var w = toWorker(id);
    retval.workers.push({
      id: id,
      pid: w.process.pid,
      uptime: now - w.startTime,
      startTime: w.startTime,
    });
  }

  logger.debug('status', retval);

  return retval;
};

controller.setSize = function setSize(size) {
  if (typeof size !== 'number' || size < 0) {
    logger.warn('set size: invalid new size (%d) received', size);
    return this;
  }

  logger.debug('setting cluster size from %d to %d', this.size, size);

  this.options.size = this.size = size;

  nextTick(this.emit.bind(this, 'set-size', this.size));
  nextTick(this._resize.bind(this));

  return this;
};

// Remember, suicide is the normal exit path, if a worker dies without suicide
// being set then it is abnormal, and we record the time.
controller._recordSuicide = function _recordSuicide(worker) {
  if (worker && !worker.suicide) {
    this._lastAbnormalExit = Date.now();
    logger.warn('abnormal exit by worker %s at time %s', worker.id, this._lastAbnormalExit);
  }
};

// With a few seconds of an abnormal exit, throttle the worker creation rate to
// one per second. We wait for longer than the throttleDelay to see if the new
// worker is going to stay up, or just exit right away.
controller._startDelay = function _startDelay() {
  var throttlePeriod = this.options.throttleDelay * 2;
  if (Date.now() - this._lastAbnormalExit < throttlePeriod) {
    return this.options.throttleDelay;
  }
  return 0;
};

controller._startOneWorkerAfterDelay = function _startOneWorkerAfterDelay(delay, callback) {
  var self = this;
  if (delay) {
    logger.debug('delay worker start by %s', delay);
    setTimeout(function() {
      self._startOneWorker(callback);
    }, delay);
  } else {
    self._startOneWorker(callback);
  }
};

controller._resize = function resize(worker) {
  var self = this;

  function resized(worker) {
    self._resizing = false;
    self._resize(worker);
  }

  self._recordSuicide(worker);

  if (self.size === null || self.size === undefined) {
    return self;
  }

  if (self._resizing) {
    // don't do multiple resizes in parallel
    // logger.debug('resize already in progress...');
    return self;
  }

  var currentSize = clusterSize();

  logger.debug('attempting to resize cluster from %d to %d', currentSize, self.size);

  if (currentSize === self.size) {
    // target cluster size reached, remove lock and emit "resize" event
    logger.debug('cluster has reached the set size of %d active workers', currentSize);
    self.emit('resize', self.size);
    return self;
  }

  self._resizing = true;

  if (currentSize < self.size) {
    // when cluster size is set higher than our current size, start a new worker (with delay).
    self._startOneWorkerAfterDelay(self._startDelay(), resized);
  } else {
    // cluster size is set lower than our current size, stop one worker
    self._stopOneWorker(resized);
  }
  return self;
};

controller._startOneWorker = function _startOneWorker(callback) {
  var self = this;
  var worker;
  
  function online() {
    logger.debug('worker %s is now online', worker.id);
    worker.removeListener('exit', exit);
    self.emit('start-worker', worker);
    // to not pass worker to callback, since this is a success situation
    callback();
  }

  function exit(code, signal) {
    logger.debug('worker %d did not start successfully',
      worker.id, {
        id: this.id,
        code: code,
        signal: signal,
        suicide: worker.suicide
      });
    worker.removeListener('online', online);
    callback(worker);
  }

  logger.debug('attempting to fork worker');
  
  worker = cluster.fork(self.options.env);

  logger.debug('forked worker %s', worker.id);

  worker.once('online', online);
  worker.once('exit', exit);
};

// shutdown the first worker that has not had .disconnect() called on it already
controller._stopOneWorker = function _stopOneWorker(callback) {
  var self = this;

  function onWorkerExit(code, sig) {
    logger.debug(
      'worker %d has exited after stop', this.id, {
        id: this.id,
        code: code,
        signal: sig
      });
    self.emit('stop-worker', this, code, sig);
    callback();
  }

  // @TODO: consider alternate worker selection: lowest ID, olderst worker

  var workerIds = liveWorkerIds();
  for (var i = workerIds.length - 1; i >= 0; i--) {
    var id = workerIds[i];
    var worker = cluster.workers[id];
    var connected = !worker.suicide; // suicide is set after .disconnect()

    logger.debug('considering to stop worker %d', id, {
      id: id,
      connected: connected
    });

    if (connected) {
      self.shutdown(worker);
      worker.once('exit', onWorkerExit.bind(worker));
      return;
    }
    logger.debug('worker %d is not connected, trying next', id);
  }
  logger.debug('found no workers to stop');
  nextTick(callback);
};

controller.shutdownById = function shutdownById(id) {
  return this.shutdown(toWorker(id));
};

controller.shutdown = function shutdown(worker) {
  var self = this;
  worker = setupControl(worker);

  logger.debug('attempting to shutdown worker %d', worker.id);

  // check if we have an exitTimer --> shutdown for this worker is in progress
  if (worker._control.exitTimer) {
    logger.debug('shutdown for worker %d already in progress', worker.id);
    return self;
  }

  // send shutdown comman to worker
  worker.send({
    cmd: msg.SHUTDOWN
  });
  worker.disconnect();

  // if exit event for this worker doesn't happen within timeout, terminate it
  worker._control.exitTimer = setTimeout(function() {
    worker._control.exitTimer = null;
    self.terminate(null, worker);
  }, self.options.shutdownTimeout);

  // on exit event, clear terminate timeout
  worker.once('exit', function(code, signal) {
    logger.debug('worker %d has exited after shutdown', worker.id, {
      id: worker.id,
      code: code,
      signal: signal
    });
    clearTimeout(worker._control.exitTimer);
    self.emit('shutdown', worker, code, signal);
  });

  return self;
};

// The worker arg is because as soon as a worker's comm channel closes, its
// removed from cluster.workers (the timing of this is not documented in node
// API), but it can be some time until exit occurs, or never. since we want to
// catch this, and TERM or KILL the worker, we need to keep a reference to the
// worker object, and pass it to terminate ourself, because we can no longer
// look it up by id.
controller.terminate = function terminate(id, shutdownWorker) {
  var worker = shutdownWorker || toWorker(id);

  if (worker._control.exitTimer) {
    logger.debug('worker %d is being terminated already', worker.id);
    return controller;
  }
  worker.kill();

  worker._control.exitTimer = setTimeout(function() {
    worker.kill('SIGKILL');
  }, controller.options.terminateTimeout);

  worker.once('exit', function(code, signal) {
    clearTimeout(worker._control.exitTimer);
    if (!shutdownWorker) {
      controller.emit('terminate', this, code, signal);
    }
  });

  return controller;
};

controller.restart = function restart() {
  var self = this;
  var id;
  var wasRestarting = self._restartIds;

  function restartOne() {
    id = self._restartIds.shift();

    if (id == null) {
      logger.debug('finished restarting old workers');
      self._restartIds = null;
      return self.emit('restart');
    }

    var worker = cluster.workers[id];

    if (!worker) {
      // Worker could have stopped since restart began, don't bork
      logger.debug('old worker %s already stopped', id);
      return restartOne();
    }

    logger.debug('restarting old worker', id);
    self.shutdown(worker);

    self.once('resize', function() {
      setTimeout(stopOneAfterResize, self.options.throttleDelay);
    });

    return self;
  }

  function stopOneAfterResize() {
    if (self._resizing) {
      return self.once('resize', stopOneAfterResize);
    }
    return restartOne();
  }

  self._restartIds = _.union(self._restartIds, liveWorkerIds());

  logger.debug('restarting workers with ids:', self._restartIds);

  nextTick(function() {
    self.emit('start-restart', self._restartIds);
  });

  if (wasRestarting) {
    return self;
  }

  nextTick(stopOneAfterResize);

  return self;
};

function getRestarting() {
  return _.clone(this._restartIds);
}

// Functions need to be shared between start and stop, so they can be removed
// from the events on stop.
function onExit(worker, code, signal) {
  logger.debug('worker %d has exited', worker.id, {
    id: worker.id,
    code: code,
    signal: signal,
    suicide: worker.suicide
  });
  controller._resize(worker);
}

function onFork(worker) {
  logger.debug('worker %d has been forked', worker.id);
  setupControl(worker);
  controller._resize(); // should we really do this? or prefer to attach this to an "online" event?
  controller.emit('fork', worker);
}

controller.start = function start(options) {
  var self = controller;

  self.options = options = _.merge({}, OPTION_DEFAULTS, options || {});

  if (self._running === true) {
    logger.error('an attemp was made to start cluster when already running');
    return self.emit('error', new Error('can not start cluster when already running'));
  }

  logger.debug('starting cluster with options:', options);

  // When doing a stop/start, forget any previous abnormal exits
  self._lastAbnormalExit = undefined;

  self.setSize(options.size);

  cluster.on('exit', onExit);
  cluster.on('fork', onFork);

  self._running = true;

  self.startTime = Date.now();

  // only emit the "start" event after resize has been completed once.
  self.once('resize', self.emit.bind(self, 'start'));

  return self;
};

controller.stop = function stop(callback) {
  var self = controller;

  function stopListening() {
    self.options.size = self.size = null;
    cluster.removeListener('exit', onExit);
    cluster.removeListener('fork', onFork);
    self.startTime = null;
    self._running = false;
    logger.info('cluster stopped successfully');
    nextTick(self.emit.bind(self, 'stop'));
  }

  if (typeof callback === 'function') {
    self.once('stop', callback);
  }

  if (self._running && self.size != null) {
    // We forked workers, stop should shut them down
    self.once('resize', function(size) {
      if (size === 0) {
        stopListening();
      }
    });
    self.setSize(0);
  } else {
    stopListening();
  }
  return self;
};

controller.options = util._extend({}, OPTION_DEFAULTS);
controller.getRestarting = getRestarting;
controller.CPUS = os.cpus().length;
controller.cmd = msg;

module.exports = controller;