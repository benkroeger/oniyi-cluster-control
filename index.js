var cluster = require('cluster'),
  util = require('util');
var pkg = require('./package.json');

// throw error if this module is loaded in a worker
// this module should not be required in application logic
if (!cluster.isMaster) {
  throw new Error(util.format('%s MUST ONLY be used in a cluster\'s master process', pkg.name));
}

module.exports = require('./lib/controller');
module.exports.version = pkg.version;
