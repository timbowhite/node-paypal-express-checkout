'use strict'; 

var urlParser = require('url');
var https = require('https');
var querystring = require('querystring');

/**
 * Instantiates a new Paypal object 
 *
 * @param {object} opt                  object of options 
 * @param {string} opt.username         API username
 * @param {string} opt.password         API password
 * @param {string} opt.signature        API signature
 * @param {bool} [opt.test]             flag to use paypal test system, default = false
 */
function Paypal(opt){ 


	this.username = opt.username;
	this.password = opt.password;
	this.signature = opt.signature;
	this.solutiontype = 'Mark';
	this.test = 'test' in opt ? !!opt.test : false; 

	this.url = 'https://' + (this.test ? 'api-3t.sandbox.paypal.com' : 'api-3t.paypal.com') + '/nvp';
	this.redirect = 'https://' + (this.test ? 'www.sandbox.paypal.com/cgi-bin/webscr' : 'www.paypal.com/cgi-bin/webscr');
};

Paypal.prototype.params = function() {
	var self = this;
	return {
		USER: self.username,
		PWD: self.password,
		SIGNATURE: self.signature,
		SOLUTIONTYPE: self.solutiontype,
		VERSION: '121'
	};
};

/**
 * Gets payment detail and optionally completes the express checkout order. To get the
 * payment status of the order, pass opt.complete = false, and check the
 * CHECKOUTSTATUS key in the returned data. if the value is 'PaymentActionCompleted', the order is paid. 
 * 
 * @function
 * @param {object} opt              object of options
 * @param {string} opt.token        token value from payl call (ie. SetExpressCheckout) 
 * @param {string} [opt.notifyUrl]  url for IPN. requires that opt.complete is set to true
 * @param {boolean} opt.complete    flag to complete the express checkout by calling DoExpressCheckoutPayment.
 *                                  Will only occur if the order has not been paid by customer.
 *                                  default = true. 
 * @param {function} callback       function passed 2 params: err and data from last API call.
 *                                  If data.PAID is true, then the order has been paid. 
 * @return {object} 
 */
Paypal.prototype.detail = function(opt, callback) {
    if (! ('complete' in opt)) opt.complete = true;

	var self = this;
	var params = self.params();

	params.TOKEN = opt.token;
	params.METHOD = 'GetExpressCheckoutDetails';

	self.request(self.url, 'POST', params, function(err, data) {
		if (err) return callback(err, data);
        data.PAID = false;
        if (! opt.complete || data.CHECKOUTSTATUS === 'PaymentActionCompleted'){
            data.PAID = true;
            return callback(null, data);
        }

		var params = self.params(),
            custom = data.PAYMENTREQUEST_0_CUSTOM.split('|');

        params.PAYMENTREQUEST_0_AMT = custom[1];
		params.PAYERID = data.PAYERID;
		params.TOKEN = opt.token;
		params.METHOD = 'DoExpressCheckoutPayment';
        if (opt.notifyUrl) params.PAYMENTREQUEST_0_NOTIFYURL = opt.notifyUrl;

		self.request(self.url, 'POST', params, function(err, data) {
			if (err) return callback(err, data);
            data.PAID = false;
            if (data.PAYMENTINFO_0_PAYMENTSTATUS === 'Completed'){
                data.PAID = true;
            }
			callback(null, data);
		});
	});

	return self;
};

/**
 * Generates a checkout express invoice 
 * @name pay
 * @function
 * @param {object} opt                          object of options
 * @param {string} opt.invoiceNumber 
 * @param {float|string} opt.amount 
 * @param {string} opt.description 
 * @param {string} opt.currency                 3 letter currency code 
 * @param {string} opt.returnUrl                URL to return the user to after invoice has been paid
 * @param {string} opt.cancelUrl                URL to return the user to when invoice has been canceled 
 * @param {function} callback                   callback function passed 3 params: error, paypal invoice url, and  
 *                                              data object returned from API
 * @return 
 */
Paypal.prototype.pay = function(opt, callback) {

	var self = this;
	var params = self.params();

	params.PAYMENTACTION = 'Sale';
	params.PAYMENTREQUEST_0_AMT = prepareNumber(opt.amount);
	params.RETURNURL = opt.returnUrl;
	params.CANCELURL = opt.cancelUrl;
	params.PAYMENTREQUEST_0_DESC = opt.description;
	params.NOSHIPPING = 1;
	params.ALLOWNOTE = 1;
	params.PAYMENTREQUEST_0_CURRENCYCODE = opt.currency;
	params.METHOD = 'SetExpressCheckout';
	params.INVNUM = opt.invoiceNumber;
    params.PAYMENTREQUEST_0_CUSTOM = opt.invoiceNumber + '|' + params.PAYMENTREQUEST_0_AMT + '|' + params.CURRENCYCODE;

	self.request(self.url, 'POST', params, function(err, data) {

		if (err) {
			callback(err, null);
			return;
		}

		if (data.ACK === 'Success') {
			callback(null, self.redirect + '?cmd=_express-checkout&useraction=commit&token=' + data.TOKEN, data);
			return;
		}

		callback(new Error('ACK ' + data.ACK + ': ' + data.L_LONGMESSAGE0), null);
	});

	return self;
};

/*
	Internal function
	@url {String}
	@method {String}
	@data {String}
	@callback {Function} :: callback(err, data);
	return {Paypal}
*/
Paypal.prototype.request = function(url, method, data, callback) {

	var self = this;
	var params = querystring.stringify(data);

	if (method === 'GET')
		url += '?' + params;

	var uri = urlParser.parse(url);
	var headers = {};

	headers['Content-Type'] = method === 'POST' ? 'application/x-www-form-urlencoded' : 'text/plain';
	headers['Content-Length'] = params.length;

	var location = '';
	var options = { protocol: uri.protocol, auth: uri.auth, method: method || 'GET', hostname: uri.hostname, port: uri.port, path: uri.path, agent: false, headers: headers };

	var response = function (res) {
		var buffer = '';

		res.on('data', function(chunk) {
			buffer += chunk.toString('utf8');
		})

		req.setTimeout(exports.timeout, function() {
			callback(new Error('timeout'), null);
		});

		res.on('end', function() {

			var error = null;
			var data = '';

			if (res.statusCode > 200) {
				error = new Error(res.statusCode);
				data = buffer;
			} else
				data = querystring.parse(buffer);

			callback(error, data);
		});
	};

	var req = https.request(options, response);

	if (method === 'POST')
		req.end(params);
	else
		req.end();

	return self;
};

function prepareNumber(num, doubleZero) {
	var str = num.toString().replace(',', '.');

	var index = str.indexOf('.');
	if (index > -1) {
		var len = str.substring(index + 1).length;
		if (len === 1)
			str += '0';
		if (len > 2)
			str = str.substring(0, index + 3);
	} else {
		if (doubleZero || true)
			str += '.00';
	}
	return str;
}

exports.timeout = 10000;
exports.Paypal = Paypal;

exports.init = function(username, password, signature, returnUrl, cancelUrl, test) {
	return new Paypal(username, password, signature, returnUrl, cancelUrl, test);
};

exports.create = function(username, password, signature, returnUrl, cancelUrl, test) {
	return exports.init(username, password, signature, returnUrl, cancelUrl, test);
};


