'use strict';

let mongoose = require('mongoose');
let Schema = mongoose.Schema;
let mixin = require('./modelMixin.js');

let model = Object.assign({
	sections: [{ type: 'ObjectId', ref: 'Section' }],
	template: Boolean,
	term: String,
	instructor: String,
	description: String,
	students: [{type: String, ref: 'User'}],
	start_date: Number,
	end_date: Number,
	tests: [{type:'ObjectId',ref:'Test'}]
}, mixin);

let courseSchema = new Schema(model);

module.exports = mongoose.model('Course', courseSchema);