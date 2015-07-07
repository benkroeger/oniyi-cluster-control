if (Math.round(Math.random()) === 0) {
	throw new Error('want to die');
}
setTimeout(function() {
	console.log('running');
}, 1000);
