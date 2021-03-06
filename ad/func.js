var assert = require('assert');
var graph = require('./graph.js');
var Tensor = require('../tensor.js');


function checkOutputType(OutputType) {
	assert(OutputType === Tensor || OutputType === Number,
		"Attempting to create AD function with invalid output type '"
		+ OutputType + "'; valid options are 'Number' and 'Tensor'");
}

// Create a new unary AD primitive function
// opts must contain:
//    - OutputType: Number or Tensor
//    - name: name of the operator
//    - forward: Function taking number input, computes number output.
//    - backward: Function taking Node input, computes derivative.
//      Output node available as 'this'.
function newUnaryFunction(opts) {
	var OutputType = opts.OutputType;
	var name = opts.name;
	var forward = opts.forward;
	var backward = opts.backward;
	checkOutputType(OutputType);

	var BaseNode = OutputType === Tensor ? graph.TensorNode : graph.ScalarNode;
	var UnaryNode = graph.UnaryNode(BaseNode);
	function FnNode(x, parent) {
		UnaryNode.call(this, x, parent, name);
	}
	FnNode.prototype = Object.create(UnaryNode.prototype);
	FnNode.prototype.backward = function() {
		backward.call(this, this.parent);
	};

	return function(x) {
		if (graph.isNode(x)) {
			return new FnNode(forward(x.x), x);
		} else {
			return forward(x);
		}
	};
}


// Create a new binary AD primitive function
// opts must contain:
//    - OutputType: Number or Tensor
//    - name: name of the operator
//    - forward: Function taking number inputs, computes number output.
//    - backward1: Function taking (Node, number) inputs, computes derivative
//      of first input. Output node available as 'this'.
//    - backward2: Function taking (number, Node) inputs, computes derivative
//      of second input. Output node available as 'this'.
function newBinaryFunction(opts) {
	var OutputType = opts.OutputType;
	var name = opts.name;
	var forward = opts.forward;
	var backward1 = opts.backward1;
	var backward2 = opts.backward2;
	checkOutputType(OutputType);

	// We create node types for all cases: the first input is a Node, the
	//    second input is a node, both inputs are Nodes.

	var BaseNode = OutputType === Tensor ? graph.TensorNode : graph.ScalarNode;
	var UnaryNode = graph.UnaryNode(BaseNode);
	var BinaryNode = graph.BinaryNode(BaseNode);

	function Node11(x, parent1, parent2) {
		BinaryNode.call(this, x, parent1, parent2, name);
	}
	Node11.prototype = Object.create(BinaryNode.prototype);
	Node11.prototype.backward = function() {
		backward1.call(this, this.parent1, this.parent2.x);
		backward2.call(this, this.parent1.x, this.parent2);
	};

	function Node10(x, parent, arg) {
		UnaryNode.call(this, x, parent, name);
		this.arg = arg;
	}
	Node10.prototype = Object.create(UnaryNode.prototype);
	Node10.prototype.backward = function() {
		backward1.call(this, this.parent, this.arg);
	};

	function Node01(x, arg, parent) {
		UnaryNode.call(this, x, parent, name);
		this.arg = arg;
	}
	Node01.prototype = Object.create(UnaryNode.prototype);
	Node01.prototype.backward = function() {
		backward2.call(this, this.arg, this.parent);
	};


	return function(x, y) {
		var xIsNode = graph.isNode(x);
		var yIsNode = graph.isNode(y);
		if (xIsNode && yIsNode) {
			return new Node11(forward(x.x, y.x), x, y);
		} else if (xIsNode) {
			return new Node10(forward(x.x, y), x, y);
		} else if (yIsNode) {
			return new Node01(forward(x, y.x), x, y);
		} else {
			return forward(x, y);
		}
	};
}


// Create a new arbitrary AD primitive function
// opts must contain:
//    - OutputType: Number or Tensor
//    - name: name of the operator
//    - forward: Function taking Node and number inputs, computes number
//      output.
//    - backward: Function taking Node and number inputs, computes
//      derivatives for all Node inputs. Output Node is available as 'this'.
//    - getParents: Function taking Node and number inputs, returns a list
//      of all Node inputs.
function newFunction(opts) {
	var OutputType = opts.OutputType;
	var name = opts.name;
	var forward = opts.forward;
	var backward = opts.backward;
	var getParents = opts.getParents;
	checkOutputType(OutputType);


	// We create unary, binary, and n-ary graph nodes for this function.
	// The node type is selected at runtime based on how many parents
	//    the node actually has (i.e. in case we call a vararg function
	//    with just 1 or 2 args).

	var BaseNode = OutputType === Tensor ? graph.TensorNode : graph.ScalarNode;
	var UnaryNode = graph.UnaryNode(BaseNode);
	var BinaryNode = graph.BinaryNode(BaseNode);
	var NaryNode = graph.NaryNode(BaseNode);

	function UnaryFnNode(x, parent, args) {
		UnaryNode.call(this, x, parent, name);
		this.args = args;
	}
	UnaryFnNode.prototype = Object.create(UnaryNode.prototype);
	UnaryFnNode.prototype.backward = function() {
		backward.apply(this, this.args);
	};

	function BinaryFnNode(x, parent1, parent2, args) {
		BinaryNode.call(this, x, parent1, parent2, name);
		this.args = args;
	}
	BinaryFnNode.prototype = Object.create(BinaryNode.prototype);
	BinaryFnNode.prototype.backward = function() {
		backward.apply(this, this.args);
	};

	function NaryFnNode(x, parents, args) {
		NaryNode.call(this, x, parents, name);
		this.args = args;
	}
	NaryFnNode.prototype = Object.create(NaryNode.prototype);
	NaryFnNode.prototype.backward = function() {
		backward.apply(this, this.args);
	};


	return function() {
		var output = forward.apply(null, arguments);
		var parents = getParents.apply(null, arguments);
		var n = parents.length;
		if (n === 0) {
			return output;
		// Expect that n > 2 will be the common case (else we would have used
		//    newUnaryFunction or newBinaryFunction).
		} else if (n > 2) {
			return new NaryFnNode(output, parents, arguments);
		} else if (n === 2) {
			return new BinaryFnNode(output, parents[0], parents[1], arguments);
		} else {
			return new UnaryFnNode(output, parents[0], arguments);
		}
	};
}


// 'getParents' implementation suitable for functions which take an array or
//    a variable number of args, all of which might be Nodes.
function naryGetParents() {
	var args = arguments.length === 1 && arguments[0] instanceof Array ?
		arguments[0] : arguments;
	var p = [];
	var n = args.length;
	while (n--) {
		var arg = args[n];
		if (graph.isNode(arg)) {
			p.push(arg);
		}
	}
	return p;
}


// Lifting functions which take numbers but don't return numbers to also work
//    on Nodes.
function liftUnaryFunction(f) {
	return function(x) { return f(graph.isNode(x) ? x.x : x); };
}
function liftBinaryFunction(f) {
	return function(x, y) {
		var xprim = graph.isNode(x) ? x.x : x;
		var yprim = graph.isNode(y) ? y.x : y;
		return f(xprim, yprim);
	};
}



module.exports = {
	newUnaryFunction: newUnaryFunction,
	newBinaryFunction: newBinaryFunction,
	newFunction: newFunction,
	naryGetParents: naryGetParents,
	liftUnaryFunction: liftUnaryFunction,
	liftBinaryFunction: liftBinaryFunction
};



