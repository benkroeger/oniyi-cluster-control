'use strict';
var assert = require('assert'),
	path = require('path'),
	cluster = require('cluster');
var clusterControl = require('../');

var clusterSize = 2;

cluster.setupMaster({
  exec: path.join(__dirname, 'worker.js'),
  silent: true
});

describe('oniyi-cluster-control node module', function () {
  it('must start ' + clusterSize + ' cluster members', function (done) {
  	clusterControl.on('start', function(){
  		assert(clusterSize === clusterControl.status().workers.length);
  		done();
  	});
  	clusterControl.start({
  		size: clusterSize
  	});
  });
});
