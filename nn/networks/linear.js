var Tensor = require('../../tensor.js');
var ad = require('../../ad');
var Network = require('../network.js');
var assert = require('assert');


function LinearNetwork(nIn, nOut, optname) {
	Network.call(this);
	this.name = optname || 'linear';
	this.inSize = nIn;
	this.outSize = nOut;
	this.weights = ad.lift(new Tensor([nOut, nIn]).fillRandom(), this.name+'_weights');
	this.biases = ad.lift(new Tensor([nOut]).fillRandom(), this.name+'_biases');
	this.parameters = [this.weights, this.biases];
	this.isTraining = false;
}
LinearNetwork.prototype = Object.create(Network.prototype);

LinearNetwork.prototype.setTraining = function(flag) {
	this.isTraining = flag;
};

LinearNetwork.prototype.serializeJSON = function() {
	return {
		type: 'linear',
		name: this.name,
		inSize: this.inSize,
		outSize: this.outSize,
		weights: ad.value(this.weights).toFlatArray(),
		biases: ad.value(this.biases).toFlatArray()
	};
}
Network.deserializers.linear = function(json) {
	var net = new LinearNetwork(json.inSize, json.outSize, json.name);
	ad.value(net.weights).fromFlatArray(json.weights);
	ad.value(net.biases).fromFlatArray(json.biases);
	return net;
};


var mvmuladd = ad.newFunction({
	OutputType: Tensor,
	name: 'mvmuladd',
	forward: function(A, x, b) {
		A = ad.value(A);
		x = ad.value(x);
		b = ad.value(b);
		var w = x.length;
		var h = b.length;
		if (w !== A.dims[1]) {
			assert(false, 'Linear network: input size is ' + w +
				' but should be ' + A.dims[1]);
		}
		var y = b.clone();
		for (var r = 0; r < h; r++) {
			var off = r*w;
			for (var c = 0; c < w; c++) {
				y.data[r] += A.data[off + c] * x.data[c];
			}
		}
		return y;
	},
	backward: function(A, x, b) {
		var Ap = ad.value(A);
		var xp = ad.value(x);
		var bp = ad.value(b);
		var aIs = A !== Ap;
		var xIs = x !== xp;
		var bIs = b !== bp;
		var w = xp.length;
		var h = bp.length;
		for (var r = 0; r < h; r++) {
			var off = r*w;
			var thisdx = this.dx.data[r];
			if (bIs) {
				b.dx.data[r] += thisdx;
			}
			for (var c = 0; c < w; c++) {
				if (xIs) {
					x.dx.data[c] += Ap.data[off + c] * thisdx;
				}
				if (aIs) {
					A.dx.data[off + c] += xp.data[c] * thisdx;
				}
			}
		}
	},
	getParents: ad.naryGetParents
});


LinearNetwork.prototype.eval = function(x) {
	var A = this.isTraining ? this.weights : ad.value(this.weights);
	var b = this.isTraining ? this.biases : ad.value(this.biases);
	return mvmuladd(A, x, b);
};


function linear(nIn, nOut, optname) {
	return new LinearNetwork(nIn, nOut, optname);
}

module.exports = {
	linear: linear
};

