var graph = require('./graph.js');
var Tensor = require('../tensor.js');

function liftScalar(x, name) { return new graph.ScalarNode(x, name); };
function liftTensor(x, name) { return new graph.TensorNode(x, name); };
function doLift(x, name) {
	return x instanceof Tensor ? liftTensor(x, name) : liftScalar(x, name);
}

var ad = {
	lift: function(x, name) { return graph.isNode(x) ? x : doLift(x, name); },
	isLifted: graph.isNode,
	value: function(x) { return graph.isNode(x) ? x.x : x; },
	derivative: function(x) { return x.dx; }
};

var func = require('./func.js');
var functions = require('./functions.js');
var transform = require('./transform.js');
var modules = [
	func, functions, transform
];
for (var i = 0; i < modules.length; i++) {
	var m = modules[i];
	for (var prop in m) {
		ad[prop] = m[prop];
	}
}

module.exports = ad;