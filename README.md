#  [![NPM version][npm-image]][npm-url] [![Build Status][travis-image]][travis-url] [![Dependency Status][daviddm-image]][daviddm-url]

> Helper and Wrapper for Node.js cluster API


## Install

```sh
$ npm install --save oniyi-cluster-control
```


## Usage

```js
var oniyiClusterControl = require('oniyi-cluster-control');

oniyiClusterControl.start({
	size: 2,
	env: {
		NODE_ENV: 'development'
	}
});

```

## Events

start
stop
set-size
resize
worker-start
worker-stop
shutdown
terminate
restart
start-restart
fork
error

## API

status
setSize(number)
shutdownById(number) (worker.id)
shutdown(worker)
terminate(id, worker) (if worker is not defined, tries to resolve id to a running worker)
restart
start
stop


## License

MIT © [Benjamin Kroeger]()


[npm-image]: https://badge.fury.io/js/oniyi-cluster-control.svg
[npm-url]: https://npmjs.org/package/oniyi-cluster-control
[travis-image]: https://travis-ci.org/benkroeger/oniyi-cluster-control.svg?branch=master
[travis-url]: https://travis-ci.org/benkroeger/oniyi-cluster-control
[daviddm-image]: https://david-dm.org/benkroeger/oniyi-cluster-control.svg?theme=shields.io
[daviddm-url]: https://david-dm.org/benkroeger/oniyi-cluster-control
