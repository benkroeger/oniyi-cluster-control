var path = require('path');
var cluster = require('cluster');
var clusterController = require('../');

cluster.setupMaster({
  exec: path.join(__dirname, 'experiments-worker.js'),
  silent: true
});

// clusterController.on('set-size', function(size) {
//   console.log('size is being set to %d', size);
// });

// clusterController.once('start', function(){
//   clusterController.status();
// });

// clusterController.once('resize', function() {
//   clusterController.status();
//   clusterController.setSize(3);

//   clusterController.once('resize', function() {
//     clusterController.status();
//     clusterController.setSize(2);
//   });
// });

// start acting when started
clusterController.once('start', function() {
  clusterController.status();
  // print status on resize
  clusterController.once('resize', function() {
    clusterController.status();
    // and restart whole closter --> one by one
    clusterController.on('restart', function() {
      clusterController.status();
      // resizing again --> print status
      clusterController.once('resize', function() {
        clusterController.status();
        clusterController.stop();
      });
      clusterController.setSize(1);
    });
    clusterController.restart();
  });
  clusterController.setSize(2);
});

clusterController.start({
  size: 1
});
