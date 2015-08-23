var assert = require('assert'),
  cluster = require('cluster'),
  os = require('os'),
  util = require('util'),
  EventEmitter = require('events').EventEmitter;

var nextTick = setImmediate;
var _ = require('lodash');

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

// Debugging
controller.debug = process.env.NODE_DEBUG && /\boniyi-cluster-control\b/.test(process.env.NODE_DEBUG);

function debug() {
  if (controller.debug) {
    console.log('DEBUG [oniyi-cluster-control] %s', util.format.apply(util, arguments));
  }
}

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

  debug('status', retval);

  return retval;
};

controller.setSize = function setSize(size) {
  if (typeof size !== 'number' || size < 0) {
    debug('set size: invalid new size (%d) received', size);
    return this;
  }

  debug('setting cluster size from %d to %d', this.size, size);

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
    debug('abnormal exit by worker %s at time %s', worker.id, this._lastAbnormalExit);
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
  if (delay) {
    debug('delay worker start by %s', delay);
    setTimeout(function() {
      controller._startOneWorker(callback);
    }, delay);
  } else {
    controller._startOneWorker(callback);
  }
};

controller._resize = function resize(worker) {
  function resized(worker) {
    controller._resizing = false;
    controller._resize(worker);
  }

  controller._recordSuicide(worker);

  if (controller.size === null || controller.size === undefined) {
    return controller;
  }

  if (controller._resizing) {
    // don't do multiple resizes in parallel
    // debug('resize already in progress...');
    return controller;
  }

  var currentSize = clusterSize();

  debug('attempting to resize cluster from %d to %d', currentSize, controller.size);

  if (currentSize === controller.size) {
    // target cluster size reached, remove lock and emit "resize" event
    debug('cluster has reached the set size of %d active workers', currentSize);
    controller.emit('resize', controller.size);
    return controller;
  }

  controller._resizing = true;

  if (currentSize < controller.size) {
    // when cluster size is set higher than our current size, start a new worker (with delay).
    controller._startOneWorkerAfterDelay(controller._startDelay(), resized);
  } else {
    // cluster size is set lower than our current size, stop one worker
    controller._stopOneWorker(resized);
  }
  return controller;
};

controller._startOneWorker = function _startOneWorker(callback) {
  var worker;
  
  function online() {
    debug('worker %s is now online', worker.id);
    worker.removeListener('exit', exit);
    controller.emit('start-worker', worker);
    // to not pass worker to callback, since this is a success situation
    callback();
  }

  function exit(code, signal) {
    debug('worker %d did not start successfully',
      worker.id, {
        id: this.id,
        code: code,
        signal: signal,
        suicide: worker.suicide
      });
    worker.removeListener('online', online);
    callback(worker);
  }

  debug('attempting to fork worker');
  
  worker = cluster.fork(controller.options.env);

  debug('forked worker %s', worker.id);

  worker.once('online', online);
  worker.once('exit', exit);
};

// shutdown the first worker that has not had .disconnect() called on it already
controller._stopOneWorker = function _stopOneWorker(callback) {
  function onWorkerExit(code, sig) {
    debug(
      'worker %d has exited after stop', this.id, {
        id: this.id,
        code: code,
        signal: sig
      });
    controller.emit('stop-worker', this, code, sig);
    callback();
  }

  // @TODO: consider alternate worker selection: lowest ID, olderst worker

  var workerIds = liveWorkerIds();
  for (var i = workerIds.length - 1; i >= 0; i--) {
    var id = workerIds[i];
    var worker = cluster.workers[id];
    var connected = !worker.suicide; // suicide is set after .disconnect()

    debug('considering to stop worker %d', id, {
      id: id,
      connected: connected
    });

    if (connected) {
      controller.shutdown(worker);
      worker.once('exit', onWorkerExit.bind(worker));
      return;
    }
    debug('worker %d is not connected, trying next', id);
  }
  debug('found no workers to stop');
  nextTick(callback);
};

controller.shutdownById = function shutdownById(id) {
  return this.shutdown(toWorker(id));
};

controller.shutdown = function shutdown(worker) {
  worker = setupControl(worker);

  debug('attempting to shutdown worker %d', worker.id);

  // check if we have an exitTimer --> shutdown for this worker is in progress
  if (worker._control.exitTimer) {
    debug('shutdown for worker %d already in progress', worker.id);
    return controller;
  }

  // send shutdown comman to worker
  worker.send({
    cmd: msg.SHUTDOWN
  });
  worker.disconnect();

  // if exit event for this worker doesn't happen within timeout, terminate it
  worker._control.exitTimer = setTimeout(function() {
    worker._control.exitTimer = null;
    controller.terminate(null, worker);
  }, controller.options.shutdownTimeout);

  // on exit event, clear terminate timeout
  worker.once('exit', function(code, signal) {
    debug('worker %d has exited after shutdown', worker.id, {
      id: worker.id,
      code: code,
      signal: signal
    });
    clearTimeout(worker._control.exitTimer);
    controller.emit('shutdown', worker, code, signal);
  });

  return controller;
};

// Terminate a worker if "exit" event hasn't happened within an exit timeout.
// Keeping reference to worker since worker might not be resolvable by ID after "disconnect" has happened
controller.terminate = function terminate(id, shutdownWorker) {
  var worker = shutdownWorker || toWorker(id);

  if (worker._control.exitTimer) {
    debug('worker %d is being terminated already', worker.id);
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
  var id;
  var wasRestarting = controller._restartIds;

  function restartOne() {
    id = controller._restartIds.shift();

    if (id == null) {
      debug('finished restarting old workers');
      controller._restartIds = null;
      return controller.emit('restart');
    }

    var worker = cluster.workers[id];

    if (!worker) {
      // Worker could have stopped since restart began, don't bork
      debug('old worker %s already stopped', id);
      return restartOne();
    }

    debug('restarting old worker', id);
    controller.shutdown(worker);

    controller.once('resize', function() {
      setTimeout(stopOneAfterResize, controller.options.throttleDelay);
    });

    return controller;
  }

  function stopOneAfterResize() {
    if (controller._resizing) {
      return controller.once('resize', stopOneAfterResize);
    }
    return restartOne();
  }

  controller._restartIds = _.union(controller._restartIds, liveWorkerIds());

  debug('restarting workers with ids:', controller._restartIds);

  nextTick(function() {
    controller.emit('start-restart', controller._restartIds);
  });

  if (wasRestarting) {
    return controller;
  }

  nextTick(stopOneAfterResize);

  return controller;
};

function getRestarting() {
  return _.clone(this._restartIds);
}

// Functions need to be shared between start and stop, so they can be removed
// from the events on stop.
function onExit(worker, code, signal) {
  debug('worker %d has exited', worker.id, {
    id: worker.id,
    code: code,
    signal: signal,
    suicide: worker.suicide
  });
  controller._resize(worker);
}

function onFork(worker) {
  debug('worker %d has been forked', worker.id);
  setupControl(worker);
  controller._resize(); // should we really do this? or prefer to attach this to an "online" event?
  controller.emit('fork', worker);
}

controller.start = function start(options) {
  controller.options = options = _.merge({}, OPTION_DEFAULTS, options || {});

  if (controller._running === true) {
    debug('an attemp was made to start cluster when already running');
    return controller.emit('error', new Error('can not start cluster when already running'));
  }

  debug('starting cluster with options:', options);

  // When doing a stop/start, forget any previous abnormal exits
  controller._lastAbnormalExit = undefined;

  cluster.on('exit', onExit);
  cluster.on('fork', onFork);

  controller._running = true;

  // only emit the "start" event after resize has been completed once.
  controller.once('resize', controller.emit.bind(controller, 'start'));
  controller.setSize(options.size);
  
  controller.startTime = Date.now();

  return controller;
};

controller.stop = function stop(callback) {
  function stopListening() {
    controller.options.size = controller.size = null;
    cluster.removeListener('exit', onExit);
    cluster.removeListener('fork', onFork);
    controller.startTime = null;
    controller._running = false;
    debug('cluster stopped successfully');
    nextTick(controller.emit.bind(controller, 'stop'));
  }

  if (typeof callback === 'function') {
    controller.once('stop', callback);
  }

  if (controller._running && controller.size != null) {
    // We forked workers, stop should shut them down
    controller.once('resize', function(size) {
      if (size === 0) {
        stopListening();
      }
    });
    controller.setSize(0);
  } else {
    stopListening();
  }
  return controller;
};

controller.options = util._extend({}, OPTION_DEFAULTS);
controller.getRestarting = getRestarting;
controller.CPUS = os.cpus().length;
controller.cmd = msg;

module.exports = controller;