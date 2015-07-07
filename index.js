// cluster-control:

// var assert = require('assert');
var cluster = require('cluster'),
  util = require('util');
var pkg = require('./package.json');

// throw error if this module is loaded in a worker
// this module should not be required in application logic
if (!cluster.isMaster) {
  throw new Error(util.format('%s MUST ONLY be used in a cluster\'s master process', pkg.name));
}

// if (cluster._strongControlMaster) {
//   assert(
//     cluster._strongControlMaster.VERSION === VERSION,
//     'Multiple versions of strong-cluster-control are being initialized.\n' +
//     'This version ' + VERSION + ' is incompatible with already initialized\n' +
//     'version ' + cluster._strongControlMaster.VERSION + '.\n'
//   );
//   module.exports = cluster._strongControlMaster;
//   return;
// }

module.exports = require('./lib/controller');
module.exports.version = pkg.version;
