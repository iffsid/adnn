var Tensor = require('../tensor.js');
var graph = require('./graph.js');
var func = require('./func.js');
var derivs = require('./derivatives.js');


var Scalar = Number;

// Additional scalar functions 'missing' from Math
Math.sigmoid = function(x) { return 1 / (1 + Math.exp(-x)); };


// Scalar & tensor operators and math functions -------------------------------

function makeFunctions(OutputType) {

	var fns = {};

	// Define which backwards derivatives we'll use for the given OutputType
	function backward(derivFns) {
		return OutputType === Tensor ? derivFns.tensor : derivFns.scalar;
	}

	var namePrefix = OutputType === Scalar ? 'scalar.' : 'tensor.';

	// Lifted operators
	var ops = {
		add: OutputType === Tensor ?
			function(x, y) { return x.add(y); } :
			function(x, y) { return x + y; },
		sub: OutputType === Tensor ?
			function(x, y) { return x.sub(y); } :
			function(x, y) { return x - y; },
		mul: OutputType === Tensor ?
			function(x, y) { return x.mul(y); } :
			function(x, y) { return x * y; },
		div: OutputType === Tensor ?
			function(x, y) { return x.div(y); } :
			function(x, y) { return x / y; }
	};
	for (var op in ops) {
		fns[op] = func.newBinaryFunction({
			OutputType: OutputType,
			name: namePrefix+op,
			forward: ops[op],
			backward1: backward(derivs[op])[0],
			backward2: backward(derivs[op])[1]
		});
	}

	// Lifted Math functions
	var unaryFns = [
		'floor', 'ceil', 'round', 'sqrt', 'exp', 'log', 'abs', 'sin', 'cos',
		'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'asinh',
		'acosh', 'atanh', 'sigmoid'
	];
	var binaryFns = [
		'pow', 'min', 'max', 'atan2'
	];
	for (var i = 0; i < unaryFns.length; i++) {
		var fnname = unaryFns[i];
		var forward = OutputType === Tensor ?
			new Function('x', 'return x.' + fnname + '();') :
			new Function('x', 'return Math.' + fnname + '(x);');
		fns[fnname] = func.newUnaryFunction({
			OutputType: OutputType,
			name: namePrefix+fnname,
			forward: forward,
			backward: backward(derivs[fnname]),
		});
	}
	for (var i = 0; i < binaryFns.length; i++) {
		var fnname = binaryFns[i];
		var forward = OutputType === Tensor ?
			new Function('x', 'y', 'return x.' + fnname + '(y);') :
			new Function('x', 'y', 'return Math.' + fnname + '(x, y);');
		fns[fnname] = func.newBinaryFunction({
			OutputType: OutputType,
			name: namePrefix+fnname,
			forward: forward,
			backward1: backward(derivs[fnname])[0],
			backward2: backward(derivs[fnname])[1]
		});
	}

	return fns;
}


var fns = {
	scalar: makeFunctions(Scalar),
	tensor: makeFunctions(Tensor)
};


// Also lift scalar comparators -----------------------------------------------

fns.scalar.eq = func.liftBinaryFunction(
	function(x, y) { return x == y; }
);

fns.scalar.neq = func.liftBinaryFunction(
	function(x, y) { return x != y; }
);

fns.scalar.peq = func.liftBinaryFunction(
	function(x, y) { return x === y; }
);

fns.scalar.pneq = func.liftBinaryFunction(
	function(x, y) { return x !== y; }
);

fns.scalar.gt = func.liftBinaryFunction(
	function(x, y) { return x > y; }
);

fns.scalar.lt = func.liftBinaryFunction(
	function(x, y) { return x < y; }
);

fns.scalar.geq = func.liftBinaryFunction(
	function(x, y) { return x >= y; }
);

fns.scalar.leq = func.liftBinaryFunction(
	function(x, y) { return x <= y; }
);



// Scalar/tensor split/merge operations ---------------------------------------
// (TODO: Variants that can output higher-rank tensors?)
// (TODO: A lot of this might get moved to nn at some point...)

// Select one entry out of a tensor (by linear indexing)
var tensorEntry = func.newFunction({
	OutputType: Scalar,
	name: 'tensorEntry',
	forward: function(t, i) {
		return graph.isNode(t) ? t.x.data[i] : t.data[i];
	},
	backward: function(t, i) {
		if (graph.isNode(t)) {
			t.dx.data[i] += this.dx;
		}
	},
	getParents: function(t, i) {
		return graph.isNode(t) ? [t] : [];
	}
});

// Split a tensor into an array of its scalar entries
fns.tensorToScalars = function(t) {
	var n = graph.isNode(t) ? t.x.length : t.length;
	var s = new Array(n);
	while (n--) {
		s[n] = tensorEntry(t, n);
	}
	return s;
};

// Select a subtensor from a larger tensor
fns.tensor.range = func.newFunction({
	OutputType: Tensor,
	name: 'tensor.range',
	forward: function(t, start, end) {
		t = graph.isNode(t) ? t.x : t;
		var n = end - start;
		var tn = new Tensor([n]);
		while (n--) {
			var i = start + n;
			tn.data[n] = t.data[i];
		}
		return tn;
	},
	backward: function(t, start, end) {
		if (graph.isNode(t)) {
			var n = end - start;
			while (n--) {
				var i = start + n;
				this.dx.data[i] += t.dx.data[n];
			}
		}
	},
	getParents: function(t, start, end) {
		return graph.isNode(t) ? [t] : [];
	}
});


// Split a tensor into multiple smaller tensors
fns.tensor.split = function(t, lengths) {
	var ts = new Array(lengths.length);
	var start = 0;
	for (var i = 0; i < lengths.length; i++) {
		var l = lengths[i];
		ts[i] = fns.tensor.range(t, start, start + l);
		start += l;
	}
	return ts;
};

// Concatentate multiple scalars into a tensor
// Can either take an array of scalars or a variable number of arguments
fns.scalarsToTensor = func.newFunction({
	OutputType: Tensor,
	name: 'scalarsToTensor',
	forward: function() {
		var args = arguments.length === 1 && arguments[0] instanceof Array ?
			arguments[0] : arguments;
		var n = args.length;
		var t = new Tensor([n]);
		while (n--) {
			var arg = args[n];
			t.data[n] = graph.isNode(arg) ? arg.x : arg;
		}
		return t;
	},
	backward: function() {
		var args = arguments.length === 1 && arguments[0] instanceof Array ?
			arguments[0] : arguments;
		var n = args.length;
		while (n--) {
			var arg = args[n];
			if (graph.isNode(arg)) {
				arg.dx += this.dx.data[n];
			}
		}
	},
	getParents: func.naryGetParents
});

// Concatentate multiple tensors into one big tensor
// Can either take an array of tensors or a variable number of arguments
fns.tensor.concat = func.newFunction({
	OutputType: Tensor,
	name: 'tensor.concat',
	forward: function() {
		var args = arguments.length === 1 && arguments[0] instanceof Array ?
			arguments[0] : arguments;
		var n = args.length;
		var size = 0;
		while (n--) {
			var arg = args[n];
			var tn = graph.isNode(arg) ? arg.x : arg;
			size += tn.length;
		}
		var t = new Tensor([size]);
		n = args.length;
		var i = 0;
		for (var j = 0; j < n; j++) {
			var arg = args[j];
			var tn = graph.isNode(arg) ? arg.x : arg;
			t.copy(tn, i);
			i += tn.length;
		}
		return t;
	},
	backward: function() {
		var args = arguments.length === 1 && arguments[0] instanceof Array ?
			arguments[0] : arguments;
		var n = args.length;
		var i = 0;
		while (n--) {
			var arg = args[n];
			if (graph.isNode(arg)) {
				var tn = arg;
				var len = tn.dx.length;
				while (len--) {
					tn.dx.data[len] += this.dx.data[i + len];
				}
				i += tn.dx.length;
			} else i += arg.length;
		}
	},
	getParents: func.naryGetParents
});



// Misc. ----------------------------------------------------------------------


// Sum an arbitrary number of scalars
// Can either take an array of scalars or a variable number of arguments
fns.scalar.sum = func.newFunction({
	OutputType: Scalar,
	name: 'scalar.sum',
	forward: function() {
		var args = arguments.length === 1 && arguments[0] instanceof Array ?
			arguments[0] : arguments;
		var thesum = 0;
		var n = args.length;
		while (n--) {
			var arg = args[n];
			var x = graph.isNode(arg) ? arg.x : arg;
			thesum += x;
		}
		return thesum;
	},
	backward: function() {
		var args = arguments.length === 1 && arguments[0] instanceof Array ?
			arguments[0] : arguments;
		var n = args.length;
		while (n--) {
			var arg = args[n];
			if (graph.isNode(arg)) {
				arg.dx += this.dx;
			}
		}
	},
	getParents: func.naryGetParents
});


module.exports = fns;



